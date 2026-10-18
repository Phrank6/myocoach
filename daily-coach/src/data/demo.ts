import type { DayRecord } from './types';

/** Seeded generator so the demo looks the same on phone and desktop. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 28 days for a desk worker: short weekday sleep, long sitting, lots of head-down phone time,
 * low glute activation. The garment is left off on a few days, as it would be in real life.
 */
export function demoDays(days = 28, seed = 7): DayRecord[] {
  const r = rng(seed);
  const n = (mu: number, sd: number) => mu + sd * (r() + r() + r() - 1.5) * 1.4;
  const out: DayRecord[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const trained = [1, 3, 5].includes(d.getDay());
    const trend = (days - i) / days; // slowly improving habits over the month
    const wearing = r() > 0.15;
    const rec: DayRecord = {
      date: isoDay(d),
      sleepHours: +n(weekend ? 7.6 : 6.3 + 0.3 * trend, 0.45).toFixed(2),
      sleepMidpointH: +n(weekend ? 4.4 : 3.4, 0.4).toFixed(2),
      steps: Math.round(n(weekend ? 8600 : 5000 + 900 * trend, 1100)),
      sittingHours: +n(weekend ? 5.5 : 9.6 - 0.6 * trend, 0.7).toFixed(2),
      longestSitMin: Math.round(n(weekend ? 60 : 125, 20)),
      screenHours: +n(weekend ? 5.2 : 4.3, 0.6).toFixed(2),
      headDownMin: Math.round(n(weekend ? 170 : 140, 25)),
      phoneAfter23Min: Math.max(0, Math.round(n(weekend ? 55 : 32, 14))),
      gaitSpeed: +n(1.17, 0.04).toFixed(2),
    };
    if (wearing) {
      Object.assign(rec, {
        emgUpper: +n(trained ? 0.42 : 0.27, 0.05).toFixed(3),
        emgLower: +n(trained ? 0.55 : weekend ? 0.48 : 0.36, 0.05).toFixed(3),
        emgTrunk: +n(0.3, 0.04).toFixed(3),
        upperTrapTone: +n(weekend ? 4.0 : 6.1, 0.6).toFixed(2),
        gluteHamRatio: +n(0.74 + 0.05 * trend, 0.05).toFixed(2),
        emgFatigueUpper: +Math.max(0, n(trained ? 0.35 : 0.12, 0.08)).toFixed(2),
        emgFatigueLower: +Math.max(0, n(trained ? 0.3 : 0.1, 0.08)).toFixed(2),
      });
    }
    if (r() > 0.2) rec.soreness = Math.max(0, Math.min(10, Math.round(n(trained ? 2 : 3.5, 1.2))));
    out.push(rec);
  }
  return out;
}
