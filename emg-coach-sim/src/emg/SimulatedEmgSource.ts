import { MUSCLE_IDS, N_MUSCLES } from '../domain/muscles';
import { FrameEmitter, parseEmgLine, type EmgFrame, type EmgSource, type EmgSourceInfo } from './types';

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Mimics an Arduino streaming MyoWare-style envelope EMG over serial:
 *  - per-channel rest baseline + gaussian noise
 *  - contraction bursts following a "neural drive" (0..1 per channel) supplied by the movement model
 *  - activation-dependent noise (EMG variance grows with force)
 *  - fatigue drift: amplitude creeps up at the same force while a muscle works, recovers at rest
 *  - occasional motion-artifact spikes
 * Each sample is serialised to a CSV line and parsed back through the same parser the Web Serial
 * adapter uses, so both paths share one wire format.
 */
export class SimulatedEmgSource implements EmgSource {
  readonly info: EmgSourceInfo;
  running = false;

  private emitter = new FrameEmitter();
  private timer: number | undefined;
  private lastWall = 0;
  private simT = 0;
  private baseline: number[];
  private gain: number[];
  private act = new Array(N_MUSCLES).fill(0);
  private artifact = new Array(N_MUSCLES).fill(0);
  readonly fatigue = new Array(N_MUSCLES).fill(0);
  private getDrive: () => number[];
  private fatigueSensitivity = 1;

  constructor(getDrive: () => number[], sampleRateHz = 100) {
    this.getDrive = getDrive;
    this.baseline = MUSCLE_IDS.map(() => 38 + Math.random() * 22);
    this.gain = MUSCLE_IDS.map(() => 560 + Math.random() * 160);
    this.info = {
      kind: 'simulated',
      label: `Simulated Arduino (${N_MUSCLES} ch @ ${sampleRateHz} Hz)`,
      sampleRateHz,
      channels: [...MUSCLE_IDS],
      calibrationHint: {
        baseline: [...this.baseline],
        mvc: this.baseline.map((b, i) => b + this.gain[i]),
      },
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.lastWall = performance.now();
    this.timer = window.setInterval(() => this.pump(), 20);
  }

  stop() {
    this.running = false;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  onFrame(cb: (f: EmgFrame) => void) {
    return this.emitter.on(cb);
  }

  resetFatigue() {
    this.fatigue.fill(0);
  }

  setExperience(experience: 'beginner' | 'intermediate' | 'advanced') {
    // Illustrative demo tuning only; this is not a physiological estimate.
    this.fatigueSensitivity = experience === 'beginner' ? 1.25 : experience === 'advanced' ? 0.82 : 1;
  }

  private pump() {
    const now = performance.now();
    const dtMs = 1000 / this.info.sampleRateHz;
    // cap catch-up after tab throttling
    let n = Math.min(50, Math.floor((now - this.lastWall) / dtMs));
    if (n <= 0) return;
    this.lastWall += n * dtMs;
    if (now - this.lastWall > 500) this.lastWall = now;
    const drive = this.getDrive();
    while (n-- > 0) {
      this.simT += dtMs;
      const line = this.sample(drive, dtMs / 1000);
      const frame = parseEmgLine(line, N_MUSCLES);
      if (frame) this.emitter.emit(frame);
    }
  }

  private sample(drive: number[], dt: number): string {
    const mean = drive.reduce((a, b) => a + b, 0) / N_MUSCLES;
    const vals: number[] = new Array(N_MUSCLES);
    for (let i = 0; i < N_MUSCLES; i++) {
      const target = Math.min(1.1, (drive[i] ?? 0) + 0.04 * mean);
      // electromechanical lag
      this.act[i] += (target - this.act[i]) * (1 - Math.exp(-dt / 0.06));
      const a = Math.max(0, this.act[i]);

      // fatigue accumulates above ~30% MVC, recovers at rest
      const load = Math.max(0, a - 0.3);
      this.fatigue[i] += (load * load * 0.09 * this.fatigueSensitivity - (a < 0.15 ? 0.02 : 0.002) * this.fatigue[i]) * dt;
      this.fatigue[i] = Math.min(1, Math.max(0, this.fatigue[i]));

      if (Math.random() < 0.0004) this.artifact[i] = 120 + Math.random() * 160;
      this.artifact[i] *= 0.82;

      const amp = this.gain[i] * a * (1 + 0.35 * this.fatigue[i]);
      const noise = gauss() * (3.5 + 26 * a + 18 * this.fatigue[i] * a);
      const v = this.baseline[i] + amp + noise + this.artifact[i];
      vals[i] = Math.round(Math.min(1023, Math.max(0, v)));
    }
    return `${Math.round(this.simT)},${vals.join(',')}`;
  }
}
