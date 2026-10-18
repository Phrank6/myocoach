import { MUSCLES, N_MUSCLES, type MuscleId } from '../domain/muscles';
import type { WorkoutEngine } from '../engine/WorkoutEngine';

/**
 * The 3D model doing reps *is* the vest for now: this bridge turns the engine's live simulated EMG
 * activation into the same `vest_window` / `vest_session` samples the Android app sends, and posts them
 * to /api/ingest/local. The training engine then sees it as garment EMG (emg_muscle_load / fatigue).
 * Values are simulated: `norm` = activation as a fraction of the simulated MVC, `mdf` is a fatigue proxy.
 */

/** Site muscle -> training_coach.py EMG group. */
const GROUP: Record<MuscleId, string> = {
  delt_front: 'shoulders', delt_side: 'shoulders', delt_rear: 'shoulders', pecs: 'chest', biceps: 'biceps',
  triceps: 'triceps', forearms: 'forearms', lats: 'back', traps: 'upper_trap', rhomboids: 'back',
};

const SAMPLE_MS = 100;
const WINDOW_MS = 1000;
const FLUSH_MS = 2000;
const TAIL_MS = 3000; // keep sending a few seconds after a set ends, to capture the relaxation

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export class ModelVest {
  private timer = 0;
  private sum = new Float64Array(N_MUSCLES);
  private sumSq = new Float64Array(N_MUSCLES);
  private n = 0;
  private windowStart = Date.now();
  private lastFlush = Date.now();
  private lastActive = 0;
  private queue: unknown[] = [];
  private set: { id: string; exercise: string; start: number } | null = null;

  private engine: WorkoutEngine;
  constructor(engine: WorkoutEngine) {
    this.engine = engine;
  }

  start() {
    this.timer = window.setInterval(() => this.tick(), SAMPLE_MS);
  }

  stop() {
    window.clearInterval(this.timer);
    void this.flush();
  }

  private tick() {
    const snap = this.engine.getSnapshot();
    const now = Date.now();
    if (snap.inSet) this.lastActive = now;
    // set boundaries -> vest_session
    if (snap.inSet && !this.set) this.set = { id: id('set'), exercise: this.engine.exercise.id, start: now };
    if (!snap.inSet && this.set) {
      this.queue.push({ id: id('vs'), type: 'vest_session', session_id: this.set.id, exercise: this.set.exercise, start: this.set.start, end: now });
      this.set = null;
    }
    const live = this.engine.live;
    for (let i = 0; i < N_MUSCLES; i++) {
      this.sum[i] += live[i];
      this.sumSq[i] += live[i] * live[i];
    }
    this.n++;
    if (now - this.windowStart >= WINDOW_MS) {
      if (now - this.lastActive < TAIL_MS && this.n > 0) this.queue.push(this.window(now, snap.fatigue));
      this.sum.fill(0);
      this.sumSq.fill(0);
      this.n = 0;
      this.windowStart = now;
    }
    if (now - this.lastFlush >= FLUSH_MS) void this.flush();
  }

  private window(now: number, fatigue: number[]) {
    const channels = MUSCLES.map((m, i) => {
      const mean = this.sum[i] / this.n;
      const rms = Math.sqrt(this.sumSq[i] / this.n);
      const f = Math.max(0, Math.min(1, fatigue[i] ?? 0));
      return {
        ch: i, label: m.label, group: GROUP[m.id],
        rms: round(rms), mav: round(mean), norm: round(mean), fatigue: round(f),
        mdf: round(95 - 30 * f, 1), // simulated: median frequency falls as the simulated muscle fatigues
        quality: 1,
      };
    });
    return {
      id: id('vw'), type: 'vest_window', ts: now, window_s: 1, source: 'site_model',
      activity: this.set ? this.set.exercise : 'rest', session_id: this.set?.id, channels,
    };
  }

  private async flush() {
    this.lastFlush = Date.now();
    if (!this.queue.length) return;
    const samples = this.queue.splice(0, 500);
    try {
      const r = await fetch('/api/ingest/local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ samples }) });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      // static host / server down: keep the most recent windows only
      this.queue = [...samples, ...this.queue].slice(-300);
    }
  }
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
