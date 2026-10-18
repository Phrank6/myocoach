import type { DayRecord, SignalKey } from './types';

/** Column names accepted on import: the app's own keys plus the coach dataset's snake_case names. */
const ALIASES: Record<string, SignalKey | 'date'> = {
  date: 'date', day: 'date',
  sleep_hours: 'sleepHours', sleep_h: 'sleepHours', sleep_midpoint_h: 'sleepMidpointH',
  steps: 'steps', sitting_hours: 'sittingHours', sitting_h: 'sittingHours',
  longest_sitting_bout_min: 'longestSitMin', phone_screen_hours: 'screenHours',
  head_down_minutes: 'headDownMin', head_down_min: 'headDownMin',
  phone_after_23h_minutes: 'phoneAfter23Min', phone_after23_min: 'phoneAfter23Min',
  gait_speed_mps: 'gaitSpeed', gait_speed_free: 'gaitSpeed',
  emg_load_upper: 'emgUpper', emg_load_lower: 'emgLower', emg_load_trunk: 'emgTrunk',
  upper_trap_desk_tone: 'upperTrapTone', glute_to_hamstring_ratio: 'gluteHamRatio',
  emg_fatigue_upper: 'emgFatigueUpper', emg_fatigue_lower: 'emgFatigueLower',
  soreness: 'soreness', soreness_0_10: 'soreness', pain: 'pain', pain_0_10: 'pain',
};

const KEYS = new Set<string>(Object.values(ALIASES));

function keyFor(col: string): SignalKey | 'date' | null {
  const c = col.trim();
  if (KEYS.has(c)) return c as SignalKey | 'date';
  return ALIASES[c.toLowerCase().replace(/[^a-z0-9]+/g, '_')] ?? null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function toRecord(raw: Record<string, unknown>): DayRecord | null {
  const rec: Record<string, unknown> = {};
  for (const [col, v] of Object.entries(raw)) {
    const k = keyFor(col);
    if (!k || v === '' || v === null || v === undefined) continue;
    if (k === 'date') {
      const d = new Date(String(v));
      if (!Number.isNaN(d.getTime())) rec.date = String(v).slice(0, 10);
    } else if (Number.isFinite(Number(v))) rec[k] = Number(v);
  }
  return typeof rec.date === 'string' ? (rec as unknown as DayRecord) : null;
}

/** Reads a CSV (header row) or JSON array of daily rows. Returns the rows that have a date. */
export function parseDays(text: string): { days: DayRecord[]; skipped: number } {
  const t = text.trim();
  let raws: Record<string, unknown>[];
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t) as unknown;
    raws = (Array.isArray(j) ? j : ((j as { days?: unknown[] }).days ?? [])) as Record<string, unknown>[];
  } else {
    const lines = t.split(/\r?\n/).filter((l) => l.trim());
    const head = splitCsvLine(lines[0]);
    raws = lines.slice(1).map((l) => Object.fromEntries(splitCsvLine(l).map((v, i) => [head[i], v])));
  }
  const days = raws.map(toRecord).filter((d): d is DayRecord => !!d);
  return { days, skipped: raws.length - days.length };
}

/** Merges new rows into existing ones by date; new values win, missing ones keep the old value. */
export function mergeDays(old: DayRecord[], add: DayRecord[]): DayRecord[] {
  const by = new Map(old.map((d) => [d.date, { ...d }]));
  for (const d of add) by.set(d.date, { ...by.get(d.date), ...d });
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}
