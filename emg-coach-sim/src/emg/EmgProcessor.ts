import type { EmgFrame, EmgSourceInfo } from './types';

/**
 * Turns raw ADC counts into normalised activation (0 ≈ rest, 1 ≈ max voluntary contraction):
 *   baseline removal -> rectification -> RMS envelope -> MVC normalisation.
 * Uses the source's calibration hint when present; otherwise auto-calibrates
 * (slowly tracking the rest floor, and a decaying running max as MVC).
 */
export class EmgProcessor {
  private n: number;
  private baseline: number[];
  private mvc: number[];
  private ms: number[]; // mean-square envelope
  private auto: boolean;
  private lastT: number | null = null;
  private tauMs: number;
  readonly activation: number[];

  constructor(info: EmgSourceInfo, tauMs = 90) {
    this.tauMs = tauMs;
    this.n = info.channels.length;
    this.auto = !info.calibrationHint;
    this.baseline = info.calibrationHint ? [...info.calibrationHint.baseline] : new Array(this.n).fill(1023);
    this.mvc = info.calibrationHint ? [...info.calibrationHint.mvc] : new Array(this.n).fill(400);
    this.ms = new Array(this.n).fill(0);
    this.activation = new Array(this.n).fill(0);
  }

  /** Returns dt in seconds since the previous frame. */
  process(frame: EmgFrame): number {
    const dtMs = this.lastT === null ? 10 : Math.min(200, Math.max(1, frame.t - this.lastT));
    this.lastT = frame.t;
    const alpha = 1 - Math.exp(-dtMs / this.tauMs);
    for (let i = 0; i < this.n; i++) {
      const raw = frame.raw[i] ?? 0;
      if (this.auto) {
        if (raw < this.baseline[i]) this.baseline[i] = raw;
        else this.baseline[i] += (raw - this.baseline[i]) * 0.0004;
      }
      const x = Math.max(0, raw - this.baseline[i]);
      this.ms[i] += (x * x - this.ms[i]) * alpha;
      const env = Math.sqrt(this.ms[i]);
      if (this.auto) {
        const span = this.mvc[i] - this.baseline[i];
        if (env > span) this.mvc[i] = this.baseline[i] + env;
      }
      const span = Math.max(30, this.mvc[i] - this.baseline[i]);
      this.activation[i] = Math.min(1.25, env / span);
    }
    return dtMs / 1000;
  }
}
