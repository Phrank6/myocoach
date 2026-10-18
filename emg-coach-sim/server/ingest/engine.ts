import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { localDate, type IngestStore, type Stored } from './store.ts';
export { localDate };

/**
 * Bridge to ai_training_coach/training_coach.py. Builds the engine's profile file
 * ({profile, signals[], today, today_weekday}) from stored phone/vest data and runs
 * `training_coach.py plan --json`. Uses models/coach_model if it exists, else models/demo_model.
 */

/** Same fields the desktop onboarding stores (src/domain/profile.ts). */
export interface SiteProfile {
  name?: string;
  heightCm?: number;
  weightKg?: number;
  age?: number;
  sex?: 'female' | 'male';
  goal?: string;
  experience?: 'beginner' | 'intermediate' | 'advanced';
  daysPerWeek?: number;
  minutesPerWeek?: number;
  equipment?: 'home' | 'gym';
}

/** DailySignals fields the engine reads; anything else in a stored daily row is dropped. */
const SIGNAL_KEYS = [
  'sleep_hours', 'sleep_midpoint_h', 'hrv_rmssd_ms', 'resting_hr', 'steps', 'moderate_minutes', 'sitting_hours',
  'longest_sitting_bout_min', 'phone_screen_hours', 'head_down_minutes', 'phone_after_23h_minutes', 'gait_speed_mps',
  'gait_asymmetry_pct', 'emg_muscle_load', 'emg_fatigue_index', 'emg_glute_to_hamstring_ratio', 'upper_trap_desk_tone',
  'soreness_0_10', 'pain_0_10',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TRAINING_AGE = { beginner: 0.3, intermediate: 2, advanced: 5 } as const;


export function toEngineProfile(p: SiteProfile) {
  return {
    name: p.name || 'user',
    age: p.age ?? 30,
    sex: p.sex ?? 'female',
    height_cm: p.heightCm ?? 170,
    weight_kg: p.weightKg ?? 70,
    goal: p.goal ?? 'health',
    training_age_years: TRAINING_AGE[p.experience ?? 'beginner'],
    days_per_week: p.daysPerWeek ?? 3,
    minutes_per_week: p.minutesPerWeek ?? 150,
    max_minutes_per_session: Math.min(90, Math.max(30, Math.round((p.minutesPerWeek ?? 150) / Math.max(1, p.daysPerWeek ?? 3)))),
    equipment: p.equipment === 'gym' ? ['gym'] : ['none', 'dumbbells', 'bands'],
  };
}

function toSignal(r: Stored) {
  const out: Record<string, unknown> = { date: r.date };
  for (const k of SIGNAL_KEYS) if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
  return out;
}

/**
 * One engine signal row per date: the phone's daily rollup, with EMG load/fatigue filled from the
 * vest windows of that day when the rollup has none (e.g. the website's simulated model vest).
 */
export function dailySignals(store: IngestStore, upTo: string) {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const r of store.dailyRows()) if ((r.date as string) <= upTo) byDate.set(r.date as string, toSignal(r));
  for (const date of store.vestDates()) {
    if (date > upTo) continue;
    const v = store.vestDay(date)!;
    const row = byDate.get(date) ?? { date };
    if (!row.emg_muscle_load && Object.keys(v.emg_muscle_load).length) row.emg_muscle_load = v.emg_muscle_load;
    if (!row.emg_fatigue_index && Object.keys(v.emg_fatigue_index).length) row.emg_fatigue_index = v.emg_fatigue_index;
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** The engine input built from the store. Exported for tests and for GET /api/plan/today?inputs=1. */
export function buildEngineInput(store: IngestStore, profile: SiteProfile, now = new Date()) {
  const today = localDate(now);
  const rows = dailySignals(store, today);
  const history = rows.filter((r) => r.date !== today).slice(-14);
  const todayRow = rows.find((r) => r.date === today);
  // Today's readiness: last night's sleep etc. from today's daily row, plus today's self-reports.
  const t: Record<string, unknown> = todayRow ? { ...todayRow } : { date: today };
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const s of store.selfreportsSince(startOfDay)) {
    if (s.pain_0_10 !== undefined) t.pain_0_10 = Math.max(Number(t.pain_0_10 ?? 0), s.pain_0_10 as number);
    if (s.soreness_0_10 !== undefined) t.soreness_0_10 = Math.max(Number(t.soreness_0_10 ?? 0), s.soreness_0_10 as number);
  }
  return {
    profile: toEngineProfile(profile),
    // The engine needs some baseline; with no history yet it uses today's row alone.
    signals: history.length ? history : todayRow ? [todayRow] : [],
    checkins: [],
    today: t,
    today_weekday: WEEKDAYS[now.getDay()],
  };
}

export interface EngineConfig {
  engineDir: string; // ai_training_coach
  dataDir: string;
  python: string;
}

export function engineConfig(root: string, dataDir: string, env: Record<string, string | undefined>): EngineConfig {
  return {
    engineDir: resolve(env.MYOCOACH_ENGINE_DIR || join(root, '..', 'ai_training_coach')),
    dataDir,
    python: env.MYOCOACH_PYTHON || 'python3',
  };
}

function modelDir(cfg: EngineConfig): string | null {
  for (const m of ['coach_model', 'demo_model']) {
    const d = join(cfg.engineDir, 'models', m);
    if (existsSync(join(d, 'model.json'))) return d;
  }
  return null;
}

let cache: { key: string; at: number; value: unknown } | null = null;


/** Runs the engine and returns a compact "today" view for the phone and the desktop panel. */
export type PlanToday = Awaited<ReturnType<typeof planToday>>;

export async function planToday(cfg: EngineConfig, store: IngestStore, profile: SiteProfile, now = new Date()) {
  const input = buildEngineInput(store, profile, now);
  const key = JSON.stringify(input);
  if (cache && cache.key === key && Date.now() - cache.at < 10 * 60_000) return cache.value as never;

  const script = join(cfg.engineDir, 'training_coach.py');
  if (!existsSync(script)) throw new Error(`training_coach.py not found in ${cfg.engineDir} (set MYOCOACH_ENGINE_DIR)`);
  const profileFile = join(cfg.dataDir, 'engine-profile.json');
  writeFileSync(profileFile, JSON.stringify(input, null, 1));
  const model = modelDir(cfg);
  const args = [script, 'plan', '--json', '--profile', profileFile, ...(model ? ['--model', model] : [])];
  const stdout = await new Promise<string>((ok, fail) =>
    execFile(cfg.python, args, { cwd: cfg.engineDir, timeout: 60_000, maxBuffer: 16 << 20 }, (err, out, errOut) =>
      err ? fail(new Error(`engine failed: ${String(errOut || err.message).slice(-400)}`)) : ok(out),
    ),
  );
  const res = JSON.parse(stdout) as EngineResult;
  const s = res.today?.sessions?.[0];
  const value = {
    date: input.today.date,
    weekday: input.today_weekday,
    readiness: res.today?.readiness ?? null,
    session: s
      ? {
          name: s.session.name,
          kind: s.session.kind,
          minutes: s.session.minutes,
          note: s.session.note ?? null,
          blocks: (s.session.blocks ?? []).map((b) => ({
            name: b.name, sets: b.sets, reps: b.reps, target_rir: b.target_rir ?? null, rest_s: b.rest_s ?? null, cue: b.cue ?? null,
          })),
        }
      : null,
    changes: s?.changes ?? [],
    habits: res.plan?.daily_habits ?? [],
    flags: res.baseline?.flags ?? [],
    baseline: res.baseline ?? null,
    week: (res.plan?.sessions ?? []).map((x) => ({ day: x.day, name: x.name, minutes: x.minutes })),
    candidates: (res.top_suggestions ?? []).map((x) => x.name),
    tier: res.plan?.tier_label ?? null,
    inputs: { days_of_history: input.signals.length, today_has_phone_data: Object.keys(input.today).length > 1 },
    model: model ? model.split('/').slice(-1)[0] : 'rules',
    generated_at: Date.now(),
    disclaimer: 'Training suggestions only, not medical advice.',
  };
  cache = { key, at: Date.now(), value };
  return value;
}

interface EngineResult {
  baseline?: { flags?: string[] } & Record<string, unknown>;
  plan?: { tier_label?: string; daily_habits?: string[]; sessions?: { day: string; name: string; minutes: number }[] };
  top_suggestions?: { name: string }[];
  today?: {
    readiness?: { score: number; zone: string; reasons: string[] };
    sessions?: {
      changes: string[];
      session: {
        name: string; kind: string; minutes: number; note?: string;
        blocks?: { name: string; sets: number; reps: string; target_rir?: string; rest_s?: number; cue?: string }[];
      };
    }[];
  };
}

export function loadSiteProfile(dataDir: string): SiteProfile {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'profile.json'), 'utf8')) as SiteProfile;
  } catch {
    return {};
  }
}

export function saveSiteProfile(dataDir: string, p: SiteProfile) {
  writeFileSync(join(dataDir, 'profile.json'), JSON.stringify(p, null, 1));
}
