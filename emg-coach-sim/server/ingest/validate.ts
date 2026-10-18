/**
 * Validation for samples posted by the MyoCoach Link Android app (POST /api/ingest/batch).
 * Daily field names follow `DailySignals` in ai_training_coach/training_coach.py so a stored
 * daily row can be handed to the engine without renaming.
 */

export type SampleType = 'daily' | 'vest_window' | 'vest_session' | 'selfreport';
export type Sample = { id: string; type: SampleType } & Record<string, unknown>;

type Range = [number, number];

/** Numeric DailySignals fields (engine names) plus a few phone-only extras, with sane bounds. */
const DAILY_NUM: Record<string, Range> = {
  sleep_hours: [0, 24],
  sleep_midpoint_h: [-12, 36],
  sleep_regularity_sd_h: [0, 24],
  hrv_rmssd_ms: [1, 400],
  resting_hr: [20, 220],
  steps: [0, 200000],
  moderate_minutes: [0, 1440],
  sitting_hours: [0, 24],
  longest_sitting_bout_min: [0, 1440],
  phone_screen_hours: [0, 24],
  head_down_minutes: [0, 1440],
  phone_after_23h_minutes: [0, 1440],
  phone_pickups: [0, 5000],
  gait_speed_mps: [0, 4],
  gait_cadence_spm: [0, 250],
  gait_asymmetry_pct: [-100, 100],
  emg_glute_to_hamstring_ratio: [0, 20],
  upper_trap_desk_tone: [0, 100],
  soreness_0_10: [0, 10],
  pain_0_10: [0, 10],
};
const DAILY_STR: Record<string, number> = { sleep_start: 40, sleep_end: 40, sleep_source: 20, gait_source: 20 };
const DAILY_MAPS = ['emg_muscle_load', 'emg_fatigue_index'];
const SELF_NUM: Record<string, Range> = { rpe: [0, 10], rir: [0, 10], pain_0_10: [0, 10], soreness_0_10: [0, 10] };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTs = (v: unknown): v is number => isNum(v) && v > 1.5e12 && v < 4.1e12; // ms epoch, 2017..2099

function pickNumbers(src: Record<string, unknown>, spec: Record<string, Range>, out: Record<string, unknown>): string | null {
  for (const [k, [lo, hi]] of Object.entries(spec)) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (!isNum(v) || v < lo || v > hi) return `${k} must be a number in [${lo}, ${hi}]`;
    out[k] = v;
  }
  return null;
}

function numMap(v: unknown, name: string): [Record<string, number> | null, string | null] {
  if (v === undefined || v === null) return [null, null];
  if (typeof v !== 'object' || Array.isArray(v)) return [null, `${name} must be an object`];
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z_]{1,32}$/.test(k) || !isNum(x) || x < 0 || x > 100) return [null, `${name}.${k} invalid`];
    out[k] = x;
  }
  return [out, null];
}

/** Returns a cleaned sample (unknown fields dropped) or an error reason. */
export function validateSample(raw: unknown): Sample | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'sample must be an object';
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !/^[A-Za-z0-9:_.-]{8,80}$/.test(s.id)) return 'id must be 8-80 chars [A-Za-z0-9:_.-]';
  const out: Record<string, unknown> = { id: s.id, type: s.type };
  let err: string | null = null;

  switch (s.type) {
    case 'daily': {
      if (typeof s.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return 'date must be YYYY-MM-DD';
      out.date = s.date;
      if ((err = pickNumbers(s, DAILY_NUM, out))) return err;
      for (const [k, max] of Object.entries(DAILY_STR)) {
        if (s[k] === undefined || s[k] === null) continue;
        if (typeof s[k] !== 'string' || (s[k] as string).length > max) return `${k} must be a short string`;
        out[k] = s[k];
      }
      for (const k of DAILY_MAPS) {
        const [m, e] = numMap(s[k], k);
        if (e) return e;
        if (m) out[k] = m;
      }
      if (isTs(s.updated_at)) out.updated_at = s.updated_at;
      return out as Sample;
    }
    case 'vest_window': {
      if (!isTs(s.ts)) return 'ts must be a ms epoch';
      if (!isNum(s.window_s) || s.window_s <= 0 || s.window_s > 60) return 'window_s must be in (0, 60]';
      if (!Array.isArray(s.channels) || s.channels.length === 0 || s.channels.length > 64) return 'channels must be a 1-64 item array';
      const chans = [];
      for (const c of s.channels as Record<string, unknown>[]) {
        if (!c || !Number.isInteger(c.ch) || (c.ch as number) < 0 || (c.ch as number) > 63) return 'channels[].ch must be 0-63';
        if (!isNum(c.rms) || !isNum(c.mav) || c.rms < 0 || c.mav < 0) return 'channels[].rms/mav must be >= 0';
        const mdf = c.mdf === null || c.mdf === undefined ? null : c.mdf;
        if (mdf !== null && (!isNum(mdf) || mdf < 0 || mdf > 2000)) return 'channels[].mdf out of range';
        const norm = c.norm === null || c.norm === undefined ? null : c.norm;
        if (norm !== null && (!isNum(norm) || norm < 0 || norm > 50)) return 'channels[].norm out of range';
        const q = c.quality === undefined || c.quality === null ? null : c.quality;
        if (q !== null && (!isNum(q) || q < 0 || q > 1)) return 'channels[].quality must be 0-1';
        const fat = c.fatigue === undefined || c.fatigue === null ? null : c.fatigue;
        if (fat !== null && (!isNum(fat) || fat < 0 || fat > 1)) return 'channels[].fatigue must be 0-1';
        // Optional engine muscle group (quads, chest, upper_trap, ...) and a human label for the channel.
        const group = typeof c.group === 'string' && /^[a-z_]{1,32}$/.test(c.group) ? c.group : null;
        const label = typeof c.label === 'string' ? c.label.slice(0, 48) : null;
        chans.push({ ch: c.ch, rms: c.rms, mav: c.mav, mdf, norm, quality: q, fatigue: fat, group, label });
      }
      Object.assign(out, { ts: s.ts, window_s: s.window_s, channels: chans });
      if (typeof s.activity === 'string' && s.activity.length <= 20) out.activity = s.activity;
      if (typeof s.source === 'string' && s.source.length <= 24) out.source = s.source;
      if (typeof s.session_id === 'string' && s.session_id.length <= 80) out.session_id = s.session_id;
      return out as Sample;
    }
    case 'vest_session': {
      if (typeof s.session_id !== 'string' || s.session_id.length < 4 || s.session_id.length > 80) return 'session_id required';
      if (typeof s.exercise !== 'string' || s.exercise.length < 1 || s.exercise.length > 80) return 'exercise required';
      if (!isTs(s.start) || !isTs(s.end) || s.end < s.start) return 'start/end must be ms epochs with end >= start';
      Object.assign(out, { session_id: s.session_id, exercise: s.exercise, start: s.start, end: s.end, raw_csv_url: null });
      return out as Sample;
    }
    case 'selfreport': {
      if (!isTs(s.ts)) return 'ts must be a ms epoch';
      out.ts = s.ts;
      if ((err = pickNumbers(s, SELF_NUM, out))) return err;
      if (s.note !== undefined && s.note !== null) {
        if (typeof s.note !== 'string' || s.note.length > 500) return 'note must be <= 500 chars';
        out.note = s.note;
      }
      return out as Sample;
    }
    default:
      return 'unknown type';
  }
}
