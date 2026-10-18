import { MUSCLE_IDS, muscleLabel, type MuscleId } from '../domain/muscles';
import type { SessionRecord } from './history';
import type { Slice } from './slices';

/** Activation (fraction of MVC) considered "high load". */
export const HIGH_ACT = 0.6;
/** Activation for the continuous-hold check. */
export const SUSTAIN_ACT = 0.7;
/** Cumulative seconds above HIGH_ACT in one workout. Tuned short so a demo can reach them. */
export const ELEVATED_HIGH_TIME = 25;
export const HIGH_HIGH_TIME = 45;
/** Single continuous stretch above SUSTAIN_ACT. */
export const SUSTAIN_LIMIT_S = 12;
export const NEAR_MAX_ACT = 0.9;
export const NEAR_MAX_SETS = 4;
export const RECOVERY_WINDOW_H = 48;

export type RiskLevel = 'elevated' | 'high';

export interface RiskFlag {
  muscle: MuscleId;
  level: RiskLevel;
  reasons: string[];
  suggestion: string;
}

export function suggestionFor(muscle: MuscleId, level: RiskLevel): string {
  const name = muscleLabel(muscle).toLowerCase();
  return level === 'high'
    ? `High strain risk for ${name}. Stop loading them this session and give them 48–72 h of rest. If you feel sharp or lingering pain, check with a professional.`
    : `Elevated strain risk for ${name}. Consider lighter load (~20% less) or fewer sets for them today, and allow ~48 h before training them hard again.`;
}

const bump = (l: RiskLevel | null): RiskLevel => (l ? 'high' : 'elevated');

export function evaluateRisk(slices: Slice[], history: SessionRecord[], now = Date.now()): RiskFlag[] {
  const flags: RiskFlag[] = [];
  MUSCLE_IDS.forEach((m, i) => {
    const reasons: string[] = [];
    let level: RiskLevel | null = null;
    const high = slices.reduce((a, s) => a + s.highTime[i], 0);
    const sustained = Math.max(0, ...slices.map((s) => s.maxSustained[i]));
    const nearMax = slices.filter((s) => s.peak[i] >= NEAR_MAX_ACT).length;

    if (high >= HIGH_HIGH_TIME) {
      level = 'high';
      reasons.push(`${high.toFixed(0)} s above ${HIGH_ACT * 100}% activation this workout (limit ${HIGH_HIGH_TIME} s)`);
    } else if (high >= ELEVATED_HIGH_TIME) {
      level = 'elevated';
      reasons.push(`${high.toFixed(0)} s above ${HIGH_ACT * 100}% activation this workout`);
    }
    if (sustained >= SUSTAIN_LIMIT_S) {
      level = level ?? 'elevated';
      reasons.push(`one continuous ${sustained.toFixed(0)} s hold above ${SUSTAIN_ACT * 100}%`);
    }
    if (nearMax >= NEAR_MAX_SETS) {
      level = level ?? 'elevated';
      reasons.push(`${nearMax} sets reached near-max activation`);
    }

    if (high > 8) {
      const recent = history.filter((h) => {
        const age = (now - Date.parse(h.date)) / 3600_000;
        return age >= 0 && age < RECOVERY_WINDOW_H && (h.highTime[i] >= ELEVATED_HIGH_TIME || h.flags[i]);
      });
      if (recent.length) {
        const hrs = Math.round((now - Date.parse(recent[recent.length - 1].date)) / 3600_000);
        level = bump(level);
        reasons.push(`also heavily loaded ${hrs} h ago (less than ${RECOVERY_WINDOW_H} h recovery)`);
      }
      const week = history.filter((h) => {
        const age = (now - Date.parse(h.date)) / 3600_000;
        return age >= 0 && age < 168 && h.highTime[i] >= ELEVATED_HIGH_TIME;
      }).length;
      if (week >= 2) {
        level = bump(level);
        reasons.push(`${week + 1} heavy sessions for this muscle in 7 days`);
      }
    }

    if (level) flags.push({ muscle: m, level, reasons, suggestion: suggestionFor(m, level) });
  });
  return flags.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
}
