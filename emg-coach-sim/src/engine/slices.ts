import { N_MUSCLES, zeroVector, type MuscleVector } from '../domain/muscles';
import { HIGH_ACT, SUSTAIN_ACT } from './risk';

/** One set = one slice: per-muscle activation over time plus summary stats. */
export interface Slice {
  id: string;
  index: number;
  exerciseId: string;
  intensity: number;
  startedAt: number;
  durationS: number;
  reps: number;
  sessionIndex: number;
  externalLoadLb: number;
  restBeforeS: number;
  /** Activation per muscle sampled every SERIES_DT seconds. */
  series: MuscleVector[];
  /** ∫ activation dt  (activation-seconds) */
  load: MuscleVector;
  peak: MuscleVector;
  /** seconds above HIGH_ACT */
  highTime: MuscleVector;
  /** longest continuous run above SUSTAIN_ACT (s) */
  maxSustained: MuscleVector;
}

export const SERIES_DT = 0.1;

export class SliceRecorder {
  readonly startedAt = Date.now();
  durationS = 0;
  reps = 0;
  readonly load = zeroVector();
  readonly peak = zeroVector();
  readonly highTime = zeroVector();
  readonly maxSustained = zeroVector();
  readonly sustained = zeroVector();
  readonly series: MuscleVector[] = [];
  private bucket = zeroVector();
  private bucketT = 0;
  readonly exerciseId: string;
  readonly sessionIndex: number;
  readonly externalLoadLb: number;
  readonly restBeforeS: number;
  intensity: number;

  constructor(exerciseId: string, intensity: number, sessionIndex = 1, externalLoadLb = 0, restBeforeS = 0) {
    this.exerciseId = exerciseId;
    this.intensity = intensity;
    this.sessionIndex = sessionIndex;
    this.externalLoadLb = externalLoadLb;
    this.restBeforeS = restBeforeS;
  }

  add(act: number[], dt: number) {
    this.durationS += dt;
    for (let i = 0; i < N_MUSCLES; i++) {
      const a = act[i] ?? 0;
      this.load[i] += a * dt;
      if (a > this.peak[i]) this.peak[i] = a;
      if (a > HIGH_ACT) this.highTime[i] += dt;
      if (a > SUSTAIN_ACT) {
        this.sustained[i] += dt;
        if (this.sustained[i] > this.maxSustained[i]) this.maxSustained[i] = this.sustained[i];
      } else {
        this.sustained[i] = 0;
      }
      this.bucket[i] += a * dt;
    }
    this.bucketT += dt;
    if (this.bucketT >= SERIES_DT) {
      this.series.push(this.bucket.map((v) => v / this.bucketT));
      this.bucket = zeroVector();
      this.bucketT = 0;
    }
  }

  finish(index: number): Slice {
    return {
      id: `${this.startedAt}-${index}`,
      index,
      exerciseId: this.exerciseId,
      intensity: this.intensity,
      startedAt: this.startedAt,
      durationS: this.durationS,
      reps: this.reps,
      sessionIndex: this.sessionIndex,
      externalLoadLb: this.externalLoadLb,
      restBeforeS: this.restBeforeS,
      series: this.series,
      load: [...this.load],
      peak: [...this.peak],
      highTime: [...this.highTime],
      maxSustained: [...this.maxSustained],
    };
  }
}

export function sumVectors(vs: MuscleVector[]): MuscleVector {
  const out = zeroVector();
  for (const v of vs) for (let i = 0; i < N_MUSCLES; i++) out[i] += v[i];
  return out;
}

export function normalize(v: MuscleVector, floor = 1e-6): MuscleVector {
  const max = Math.max(floor, ...v);
  return v.map((x) => x / max);
}
