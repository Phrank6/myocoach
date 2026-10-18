import type { Profile } from '../data/profile';
import type { DayRecord } from '../data/types';
import modelJson from './coach-model.json';
import { createCoachModel, type CatalogItem, type CoachModelJson, type FeatureRow } from './model';

/**
 * The daily coach: the trained recommender picks exercises from the person's profile and their last
 * four weeks of phone and clothing signals; the rules (ported from ai_training_coach/training_coach.py)
 * add readiness, desk correctives, habits and the safety gate. Rules are never learned.
 */
export const model = createCoachModel(modelJson as unknown as CoachModelJson);
const BY_ID = new Map(model.items.map((i) => [i.id, i]));

// ── baseline ─────────────────────────────────────────────────────────────────────────────────
export interface Baseline {
  days: number;
  sleepHours?: number;
  sleepRegularitySd?: number;
  steps?: number;
  sittingHours?: number;
  longestSitMin?: number;
  screenHours?: number;
  headDownMin?: number;
  phoneAfter23Min?: number;
  gaitSpeed?: number;
  emgUpper?: number;
  emgLower?: number;
  emgTrunk?: number;
  upperTrapTone?: number;
  gluteHamRatio?: number;
  soreness?: number;
  flags: Flag[];
}

export type Flag =
  | 'high_sitting' | 'long_sitting_bouts' | 'head_down' | 'upper_trap_tension' | 'low_glute_activation'
  | 'short_sleep' | 'irregular_sleep' | 'late_phone_use' | 'low_steps' | 'slow_gait';

export const FLAG_TEXT: Record<Flag, string> = {
  high_sitting: 'Long sitting days',
  long_sitting_bouts: 'Long unbroken sits',
  head_down: 'Lots of head-down phone time',
  upper_trap_tension: 'Upper traps tense at the desk',
  low_glute_activation: 'Glutes underused when walking',
  short_sleep: 'Short sleep',
  irregular_sleep: 'Irregular sleep times',
  late_phone_use: 'Phone use after 11 pm',
  low_steps: 'Low daily steps',
  slow_gait: 'Slow walking speed',
};

const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};
const sd = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  if (v.length < 3) return undefined;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};

export function baseline(all: DayRecord[], window = 28): Baseline {
  const days = all.slice(-window);
  const pick = <K extends keyof DayRecord>(k: K) => days.map((d) => d[k] as number | undefined);
  const b: Baseline = {
    days: days.length,
    sleepHours: avg(pick('sleepHours')),
    sleepRegularitySd: sd(pick('sleepMidpointH')),
    steps: avg(pick('steps')),
    sittingHours: avg(pick('sittingHours')),
    longestSitMin: avg(pick('longestSitMin')),
    screenHours: avg(pick('screenHours')),
    headDownMin: avg(pick('headDownMin')),
    phoneAfter23Min: avg(pick('phoneAfter23Min')),
    gaitSpeed: avg(pick('gaitSpeed')),
    emgUpper: avg(pick('emgUpper')),
    emgLower: avg(pick('emgLower')),
    emgTrunk: avg(pick('emgTrunk')),
    upperTrapTone: avg(pick('upperTrapTone')),
    gluteHamRatio: avg(pick('gluteHamRatio')),
    soreness: avg(pick('soreness')),
    flags: [],
  };
  const chk = (v: number | undefined, cond: (v: number) => boolean, f: Flag) => {
    if (v !== undefined && cond(v)) b.flags.push(f);
  };
  chk(b.sittingHours, (v) => v >= 8, 'high_sitting');
  chk(b.longestSitMin, (v) => v >= 90, 'long_sitting_bouts');
  chk(b.headDownMin, (v) => v >= 120, 'head_down');
  chk(b.upperTrapTone, (v) => v >= 5, 'upper_trap_tension');
  chk(b.gluteHamRatio, (v) => v < 0.8, 'low_glute_activation');
  chk(b.sleepHours, (v) => v < 7, 'short_sleep');
  chk(b.sleepRegularitySd, (v) => v > 1, 'irregular_sleep');
  chk(b.phoneAfter23Min, (v) => v >= 30, 'late_phone_use');
  chk(b.steps, (v) => v < 5000, 'low_steps');
  chk(b.gaitSpeed, (v) => v < 1, 'slow_gait');
  return b;
}

// ── readiness (phone + clothes; no wristband, so no HRV or resting heart rate) ─────────────
export interface Readiness {
  score: number;
  zone: 'green' | 'amber' | 'red';
  reasons: string[];
  fatigued: string[];
}

export function readiness(today: DayRecord | undefined): Readiness {
  let score = 75;
  const why: string[] = [];
  const fatigued: string[] = [];
  if (today?.sleepHours !== undefined) {
    if (today.sleepHours < 5) { score -= 25; why.push(`very short sleep (${today.sleepHours.toFixed(1)} h)`); }
    else if (today.sleepHours < 6.5) { score -= 10; why.push(`short sleep (${today.sleepHours.toFixed(1)} h)`); }
    else if (today.sleepHours >= 7.5) { score += 5; why.push(`good sleep (${today.sleepHours.toFixed(1)} h)`); }
  }
  if (today?.phoneAfter23Min !== undefined && today.phoneAfter23Min >= 60) { score -= 5; why.push('an hour+ on the phone after 11 pm'); }
  if (today?.soreness !== undefined && today.soreness >= 6) { score -= 10; why.push(`soreness ${today.soreness}/10`); }
  if ((today?.emgFatigueUpper ?? 0) >= 0.6) fatigued.push('upper body');
  if ((today?.emgFatigueLower ?? 0) >= 0.6) fatigued.push('lower body');
  if (fatigued.length) { score -= 5 * fatigued.length; why.push(`clothing EMG shows fatigue in ${fatigued.join(' and ')}`); }
  if (today?.pain !== undefined && today.pain >= 4) { score = Math.min(score, today.pain >= 7 ? 20 : 35); why.push(`pain ${today.pain}/10`); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, zone: score >= 65 ? 'green' : score >= 40 ? 'amber' : 'red', reasons: why, fatigued };
}

// ── model input ──────────────────────────────────────────────────────────────────────────────
const TRAINING_YEARS: Record<Profile['experience'], number> = { new: 0, some: 0.7, trained: 2.5 };
const EQUIPMENT: Record<Profile['equipment'], string> = { none: 'none', home: 'bands;dumbbells;kettlebell;pull_up_bar', gym: 'gym' };
const GYM = new Set(['bands', 'dumbbells', 'kettlebell', 'barbell', 'machine', 'cable', 'pull_up_bar', 'cardio_machine', 'medicine_ball']);

export function featureRow(p: Profile, b: Baseline): FeatureRow {
  return {
    age: p.age,
    sex: p.sex,
    height_cm: p.heightCm,
    weight_kg: p.weightKg,
    goal: p.goal,
    body_shape_subgoal: p.goal === 'body_shape' ? p.subgoal : '',
    training_age_years: TRAINING_YEARS[p.experience],
    days_per_week: p.daysPerWeek,
    minutes_per_week: p.minutesPerWeek,
    equipment: EQUIPMENT[p.equipment],
    priority_muscles: '',
    program_block: Math.min(5, Math.floor(b.days / 28)),
    sleep_hours: b.sleepHours,
    steps: b.steps,
    sitting_hours: b.sittingHours,
    head_down_minutes: b.headDownMin,
    phone_after_23h_minutes: b.phoneAfter23Min,
    phone_screen_hours: b.screenHours,
    gait_speed_mps: b.gaitSpeed,
    soreness: b.soreness,
    emg_load_upper: b.emgUpper,
    emg_load_lower: b.emgLower,
    emg_load_trunk: b.emgTrunk,
  };
}

/** Same gate as training_coach.feasible: equipment, experience level and pain areas. */
export function feasible(e: CatalogItem, p: Profile): boolean {
  const eq = new Set(EQUIPMENT[p.equipment].split(';'));
  const hasEq = e.equipment === 'none' || eq.has(e.equipment) || (eq.has('gym') && GYM.has(e.equipment));
  const maxLevel = TRAINING_YEARS[p.experience] < 1 ? 2 : 3;
  return hasEq && e.level <= maxLevel && !e.contraindications.some((c) => p.painAreas.includes(c));
}

// ── today's plan ─────────────────────────────────────────────────────────────────────────────
export interface PlanItem {
  item: CatalogItem;
  fit: number;
  dose: string;
  why: string;
}

export interface TodayPlan {
  kind: 'training' | 'recovery';
  title: string;
  minutes: number;
  main: PlanItem[];
  cardio?: PlanItem;
  correctives: PlanItem[];
  changes: string[];
}

const STRENGTH_PATTERNS = ['squat', 'hinge', 'push_h', 'pull_h', 'push_v', 'pull_v', 'single_leg', 'core', 'upper_accessory', 'leg_accessory', 'carry', 'calves'];
const PATTERN_LABEL: Record<string, string> = {
  squat: 'squat', hinge: 'hip hinge', push_h: 'horizontal push', pull_h: 'row', push_v: 'overhead push', pull_v: 'vertical pull',
  single_leg: 'single-leg', core: 'core', upper_accessory: 'arms & shoulders', leg_accessory: 'legs', carry: 'carry', calves: 'calves',
};

function dose(p: Profile, zone: Readiness['zone']): { sets: number; reps: string; rir: string } {
  const base =
    p.goal === 'strength' ? { sets: 4, reps: '5–6', rir: '2 in reserve' }
      : p.goal === 'body_shape' ? { sets: 3, reps: '8–12', rir: '1–2 in reserve' }
        : p.goal === 'fit' ? { sets: 3, reps: '10–12', rir: '2 in reserve' }
          : { sets: 2, reps: '10–15', rir: '3 in reserve' };
  if (zone === 'amber') return { ...base, sets: Math.max(2, base.sets - 1), rir: '3 in reserve' };
  return base;
}

export function todayPlan(p: Profile, b: Baseline, r: Readiness): TodayPlan {
  const scores = model.score(featureRow(p, b));
  const fit = (id: string) => scores.get(id) ?? 0;
  const ok = model.items.filter((e) => feasible(e, p));
  const sessionMin = Math.round(p.minutesPerWeek / Math.max(1, p.daysPerWeek));
  const changes: string[] = [];

  // Desk correctives, chosen by the flags (training_coach._corrective_blocks).
  const want: string[] = [];
  const f = new Set(b.flags);
  if (f.has('low_glute_activation') || f.has('high_sitting') || f.has('long_sitting_bouts')) want.push('glute_bridge', 'half_kneeling_hip_flexor_stretch');
  if (f.has('head_down') || f.has('upper_trap_tension')) want.push('chin_tuck', 'wall_angel', 'upper_trap_stretch');
  if (!want.length) want.push('cat_cow', 'worlds_greatest_stretch', 'dead_bug');
  const reasonFor = (id: string) =>
    id === 'glute_bridge' ? (f.has('low_glute_activation') ? 'Your clothes show glutes doing little when you walk.' : 'Wakes the glutes after long sitting.')
      : id === 'half_kneeling_hip_flexor_stretch' ? `Opens the hips after ~${(b.sittingHours ?? 0).toFixed(1)} h of sitting a day.`
        : id === 'chin_tuck' || id === 'wall_angel' ? `Counters ~${Math.round(b.headDownMin ?? 0)} min a day looking down at your phone.`
          : id === 'upper_trap_stretch' ? 'Your clothes show tense upper traps at the desk.'
            : 'General mobility.';
  const correctives = want
    .map((id) => BY_ID.get(id))
    .filter((e): e is CatalogItem => !!e && feasible(e, p))
    .slice(0, 4)
    .map((item) => ({ item, fit: fit(item.id), dose: item.id.includes('stretch') ? '2 × 30 s per side' : '2 × 8–10', why: reasonFor(item.id) }));

  if (r.zone === 'red') {
    const walk = BY_ID.get('brisk_walk')!;
    return {
      kind: 'recovery',
      title: 'Recovery day',
      minutes: 25,
      main: [],
      cardio: { item: walk, fit: fit(walk.id), dose: '15 min, easy pace', why: 'Readiness is low, so today is an easy walk and mobility only.' },
      correctives,
      changes: ['Swapped strength work for recovery'],
    };
  }

  // Strength: the best-fitting exercise in each movement pattern, then the patterns the model rates highest.
  const d = dose(p, r.zone);
  if (r.zone === 'amber') changes.push('One set fewer and an extra rep in reserve');
  const fatiguedMuscles = new Set(r.fatigued.flatMap((x) => (x === 'upper body' ? ['chest', 'back', 'shoulders', 'biceps', 'triceps'] : ['quads', 'glutes', 'hamstrings', 'calves'])));
  const used = new Set(correctives.map((c) => c.item.id));
  const perPattern = STRENGTH_PATTERNS.map((pat) => {
    const best = ok
      .filter((e) => e.category === 'strength' && e.pattern === pat && !used.has(e.id))
      .map((e) => ({ e, s: fit(e.id) * (e.muscles.some((m) => fatiguedMuscles.has(m)) ? 0.5 : 1) }))
      .sort((a, b2) => b2.s - a.s)[0];
    return best ? { pat, ...best } : null;
  }).filter((x): x is { pat: string; e: CatalogItem; s: number } => !!x);
  const n = Math.max(3, Math.min(6, Math.round((sessionMin - 15) / 8)));
  const main = perPattern
    .sort((a, b2) => b2.s - a.s)
    .slice(0, n)
    .map(({ pat, e }) => ({
      item: e,
      fit: fit(e.id),
      dose: e.pattern === 'carry' ? `${Math.min(d.sets, 3)} × 30 m` : /plank|hold|hollow/.test(e.id) ? `${Math.min(d.sets, 3)} × 30–45 s` : `${d.sets} × ${d.reps}`,
      why: `Best ${PATTERN_LABEL[pat]} for you${e.muscles.some((m) => fatiguedMuscles.has(m)) ? ' (lighter today: EMG fatigue)' : ''}.`,
    }));

  const cardioPool = ok.filter((e) => e.category === 'cardio' && (r.zone === 'green' || !e.id.includes('interval')));
  const cardioPick = cardioPool.sort((a, b2) => fit(b2.id) - fit(a.id))[0];
  const cardio = cardioPick && (p.goal !== 'strength' || f.has('low_steps'))
    ? { item: cardioPick, fit: fit(cardioPick.id), dose: cardioPick.id.includes('interval') ? '4 × 4 min hard / 3 min easy' : '20 min', why: f.has('low_steps') ? `Steps average ${Math.round(b.steps ?? 0).toLocaleString()} a day.` : 'Builds stamina.' }
    : undefined;

  const pats = main.map((m) => m.item.pattern);
  const title = pats.every((x) => ['squat', 'hinge', 'single_leg', 'leg_accessory', 'calves'].includes(x)) ? 'Lower body'
    : pats.every((x) => ['push_h', 'pull_h', 'push_v', 'pull_v', 'upper_accessory'].includes(x)) ? 'Upper body' : 'Full body';
  return { kind: 'training', title, minutes: sessionMin, main, cardio, correctives, changes };
}

// ── habits (training_coach._habits, plus the phone and clothing signals) ─────────────────────
export function habits(b: Baseline, p: Profile): string[] {
  const h: string[] = [];
  const f = new Set(b.flags);
  const target = p.age >= 60 ? 7000 : 8000;
  if (b.steps !== undefined && b.steps < target) {
    const goal = Math.min(target, Math.round((b.steps + 2000) / 500) * 500);
    h.push(`Walk ${goal.toLocaleString()} steps a day this month (now ~${Math.round(b.steps).toLocaleString()}).`);
  }
  if (f.has('high_sitting') || f.has('long_sitting_bouts')) h.push(`Your longest sit averages ${Math.round(b.longestSitMin ?? 0)} min. Stand and walk for 2 min every 45 min; your phone can nudge you.`);
  if (f.has('head_down')) h.push('Hold the phone at eye level, and do 5 chin tucks after each long phone session.');
  if (f.has('short_sleep')) h.push(`Sleep averages ${(b.sleepHours ?? 0).toFixed(1)} h. Aim for 7+: lights out 30 min earlier.`);
  if (f.has('late_phone_use')) h.push(`About ${Math.round(b.phoneAfter23Min ?? 0)} min on the phone after 11 pm. Put it on the charger outside the bedroom.`);
  if (f.has('irregular_sleep')) h.push('Bedtime moves around by more than an hour. Keep wake-up time the same every day, weekends too.');
  if (f.has('upper_trap_tension')) h.push('Shoulders creep up at the desk: drop them and breathe out each time you send a message.');
  return h;
}

export const catalogItem = (id: string) => BY_ID.get(id);
