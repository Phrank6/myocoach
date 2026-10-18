import { EXERCISES, lerpPose, profileVector, type Exercise, type Pose } from '../domain/exercises';
import { MUSCLE_IDS, N_MUSCLES, muscleLabel, zeroVector, type MuscleId, type MuscleVector } from '../domain/muscles';
import { EmgProcessor } from '../emg/EmgProcessor';
import { SimulatedEmgSource } from '../emg/SimulatedEmgSource';
import type { EmgFrame, EmgSource } from '../emg/types';
import { InputController, type InputAction } from '../input/InputController';
import { appendSession, loadHistory, type SessionRecord } from './history';
import { evaluateRisk, type RiskFlag, type RiskLevel } from './risk';
import { SliceRecorder, sumVectors, type Slice } from './slices';

export interface LiveAlert {
  id: string;
  muscle: MuscleId;
  level: RiskLevel;
  title: string;
  message: string;
  t: number;
}

export interface EngineSnapshot {
  exerciseIndex: number;
  intensity: number;
  inSet: boolean;
  autoRep: boolean;
  reps: number;
  setDuration: number;
  effort: number;
  gamepadName: string | null;
  sourceLabel: string;
  sourceKind: 'simulated' | 'webserial';
  live: MuscleVector;
  setLoad: MuscleVector;
  workoutLoad: MuscleVector;
  fatigue: MuscleVector;
  slices: Slice[];
  alerts: LiveAlert[];
  elapsedS: number;
  sessionIndex: number;
  externalLoadLb: number;
  restSinceSetS: number;
}

export interface WorkoutResult {
  slices: Slice[];
  flags: RiskFlag[];
  session: SessionRecord;
  historyBefore: SessionRecord[];
}

const SCOPE_LEN = 500;
const IDLE_END_S = 6;

export class WorkoutEngine {
  readonly input = new InputController();
  readonly live = zeroVector();
  /** Ring buffer of processed activation for the oscilloscope: SCOPE_LEN samples × N_MUSCLES. */
  readonly scope = new Float32Array(SCOPE_LEN * N_MUSCLES);
  scopeHead = 0;
  pose: Pose = EXERCISES[0].rest;

  private source: EmgSource;
  private sim: SimulatedEmgSource;
  private processor: EmgProcessor;
  private unsubFrame: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot;
  private timer = 0;
  private lastTick = 0;
  private lastEmit = 0;
  private lastRiskCheck = 0;
  private startedAt = Date.now();
  private lastSetEndedAt: number | null = null;
  private sessionIndex = 1;
  private externalLoadLb = 0;

  exerciseIndex = 0;
  intensity = 0.75;
  autoRep = false;
  effort = 0;
  private autoT = 0;
  private repUp = false;
  private idle = 0;
  private recorder: SliceRecorder | null = null;
  private slices: Slice[] = [];
  private alerts: LiveAlert[] = [];
  private alerted = new Map<MuscleId, RiskLevel>();
  private history: SessionRecord[] = loadHistory();
  private gamepadName: string | null = null;
  onFinish: ((r: WorkoutResult) => void) | null = null;

  constructor() {
    this.sim = new SimulatedEmgSource(() => this.drive());
    this.source = this.sim;
    this.processor = new EmgProcessor(this.source.info);
    this.snapshot = this.buildSnapshot();
  }

  get exercise(): Exercise {
    return EXERCISES[this.exerciseIndex];
  }

  // ---- lifecycle -------------------------------------------------------------------------
  async start() {
    this.input.attach();
    this.attachSource(this.source);
    await this.source.start();
    this.lastTick = performance.now();
    // Fixed-rate timer rather than rAF so input and rep logic keep up even when rendering is slow.
    this.timer = window.setInterval(() => this.tick(), 1000 / 60);
  }

  stop() {
    window.clearInterval(this.timer);
    this.input.detach();
    this.unsubFrame?.();
    this.source.stop();
  }

  resetWorkout() {
    this.slices = [];
    this.alerts = [];
    this.alerted.clear();
    this.recorder = null;
    this.history = loadHistory();
    this.startedAt = Date.now();
    this.lastSetEndedAt = null;
    this.sessionIndex = 1;
    this.externalLoadLb = 0;
    this.sim.resetFatigue();
    this.emit(true);
  }

  async useSource(src: EmgSource) {
    this.unsubFrame?.();
    this.source.stop();
    this.source = src;
    this.processor = new EmgProcessor(src.info);
    this.attachSource(src);
    try {
      await src.start();
    } catch (e) {
      await this.useSource(this.sim);
      throw e;
    }
    this.emit(true);
  }

  useSimulated() {
    return this.useSource(this.sim);
  }

  private attachSource(src: EmgSource) {
    this.unsubFrame?.();
    this.unsubFrame = src.onFrame((f) => this.onFrame(f));
  }

  // ---- signal path -----------------------------------------------------------------------
  /** Neural drive per channel for the simulator, derived from the controller effort. */
  private drive(): number[] {
    if (!this.recorder) return zeroVector();
    const prof = profileVector(this.exercise);
    const e = 0.12 + 0.88 * this.effort;
    return prof.map((p) => p * this.intensity * e);
  }

  private onFrame(f: EmgFrame) {
    const dt = this.processor.process(f);
    const act = this.processor.activation;
    for (let i = 0; i < N_MUSCLES; i++) {
      const value = act[i] ?? 0;
      this.live[i] = value;
      this.scope[this.scopeHead * N_MUSCLES + i] = value;
    }
    this.scopeHead = (this.scopeHead + 1) % SCOPE_LEN;
    this.recorder?.add(act, dt);
  }

  // ---- control loop ----------------------------------------------------------------------
  private tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const inp = this.input.poll();
    this.gamepadName = inp.gamepadName;
    for (const a of inp.actions) this.handle(a);

    let target: number;
    if (this.autoRep) {
      this.autoT += dt;
      const ph = (this.autoT % 2.6) / 2.6;
      target = ph < 0.35 ? 1 : ph < 0.45 ? 1 : ph < 0.8 ? 0.15 : 0;
      if (ph < 0.35) target = ph / 0.35;
    } else {
      target = inp.analogEffort ?? (inp.pushHeld ? 1 : 0);
    }
    const tau = target > this.effort ? 0.16 : 0.22;
    this.effort += (target - this.effort) * (1 - Math.exp(-dt / tau));

    if (!this.recorder && this.effort > 0.3) this.startSet();

    if (this.recorder) {
      if (this.effort > 0.7) this.repUp = true;
      if (this.repUp && this.effort < 0.25) {
        this.repUp = false;
        this.recorder.reps++;
      }
      this.idle = this.effort < 0.08 ? this.idle + dt : 0;
      if (this.idle > IDLE_END_S) this.endSet();
    }

    const ex = this.exercise;
    this.pose = lerpPose(ex.rest, ex.peak, Math.min(1, Math.max(0, this.effort)));

    if (now - this.lastRiskCheck > 400) {
      this.lastRiskCheck = now;
      this.checkLiveRisk();
    }
    if (now - this.lastEmit > 80) this.emit();
  }

  private handle(a: InputAction) {
    switch (a) {
      case 'toggleSet':
        if (this.recorder) this.endSet();
        else this.startSet();
        break;
      case 'nextExercise':
        this.selectExercise((this.exerciseIndex + 1) % EXERCISES.length);
        break;
      case 'prevExercise':
        this.selectExercise((this.exerciseIndex - 1 + EXERCISES.length) % EXERCISES.length);
        break;
      case 'intensityUp':
        this.setIntensity(this.intensity + 0.05);
        break;
      case 'intensityDown':
        this.setIntensity(this.intensity - 0.05);
        break;
      case 'toggleAuto':
        this.setAuto(!this.autoRep);
        break;
      case 'finish':
        this.finish();
        break;
    }
  }

  selectExercise(i: number) {
    if (this.recorder) this.endSet();
    if (i !== this.exerciseIndex && this.slices.some((slice) => slice.sessionIndex === this.sessionIndex)) this.endSession();
    this.exerciseIndex = i;
    this.emit(true);
  }

  setIntensity(v: number) {
    this.intensity = Math.round(Math.min(1.1, Math.max(0.3, v)) * 100) / 100;
    if (this.recorder) this.recorder.intensity = this.intensity;
    this.emit(true);
  }

  setAuto(on: boolean) {
    this.autoRep = on;
    this.autoT = 0;
    if (!on && this.recorder) this.idle = 0;
    this.emit(true);
  }

  startSet() {
    if (this.recorder) return;
    const restBeforeS = this.lastSetEndedAt === null ? 0 : Math.max(0, (Date.now() - this.lastSetEndedAt) / 1000);
    this.recorder = new SliceRecorder(this.exercise.id, this.intensity, this.sessionIndex, this.externalLoadLb, restBeforeS);
    this.repUp = false;
    this.idle = 0;
    this.emit(true);
  }

  endSet() {
    const rec = this.recorder;
    if (!rec) return;
    this.recorder = null;
    this.autoRep = false;
    this.lastSetEndedAt = Date.now();
    if (rec.reps > 0 || rec.durationS > 2) {
      const sessionSetIndex = this.slices.filter((slice) => slice.sessionIndex === rec.sessionIndex).length + 1;
      this.slices.push(rec.finish(sessionSetIndex));
    }
    this.emit(true);
  }

  setExternalLoadLb(value: number) {
    this.externalLoadLb = Math.max(0, Math.round(value / 2.5) * 2.5);
    this.emit(true);
  }

  setExperience(experience: 'beginner' | 'intermediate' | 'advanced') {
    this.sim.setExperience(experience);
    this.emit(true);
  }

  endSession() {
    if (this.recorder) this.endSet();
    if (!this.slices.some((slice) => slice.sessionIndex === this.sessionIndex)) return;
    this.sessionIndex += 1;
    this.lastSetEndedAt = null;
    this.emit(true);
  }

  finish() {
    this.endSet();
    if (!this.slices.length) return;
    const historyBefore = this.history;
    const flags = evaluateRisk(this.slices, historyBefore);
    const flagByMuscle = new Map(flags.map((f) => [f.muscle, f.level]));
    const session: SessionRecord = {
      id: `s-${this.startedAt}`,
      date: new Date().toISOString(),
      durationS: (Date.now() - this.startedAt) / 1000,
      restS: this.slices.reduce((sum, slice) => sum + slice.restBeforeS, 0),
      averageRestS: this.slices.length ? this.slices.reduce((sum, slice) => sum + slice.restBeforeS, 0) / this.slices.length : 0,
      sets: this.slices.length,
      exercises: [...new Set(this.slices.map((s) => s.exerciseId))],
      load: sumVectors(this.slices.map((s) => s.load)),
      highTime: sumVectors(this.slices.map((s) => s.highTime)),
      flags: MUSCLE_IDS.map((m) => flagByMuscle.get(m) ?? null),
    };
    appendSession(session);
    this.onFinish?.({ slices: [...this.slices], flags, session, historyBefore });
  }

  private checkLiveRisk() {
    const current = this.recorder ? [this.recorder.finish(-1)] : [];
    const flags = evaluateRisk([...this.slices, ...current], this.history);
    for (const f of flags) {
      const prev = this.alerted.get(f.muscle);
      if (prev === f.level || prev === 'high') continue;
      this.alerted.set(f.muscle, f.level);
      this.alerts = [
        {
          id: `${f.muscle}-${f.level}-${Date.now()}`,
          muscle: f.muscle,
          level: f.level,
          title: `${f.level === 'high' ? 'High' : 'Elevated'} strain risk · ${muscleLabel(f.muscle)}`,
          message: `${f.reasons[0]}. ${f.level === 'high' ? 'Rest this muscle group — switch exercise or end the session.' : 'Consider lighter load or longer rest between sets.'}`,
          t: Date.now(),
        },
        ...this.alerts,
      ].slice(0, 8);
      this.emit(true);
    }
  }

  dismissAlert(id: string) {
    this.alerts = this.alerts.filter((a) => a.id !== id);
    this.emit(true);
  }

  // ---- React bridge ----------------------------------------------------------------------
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit(force = false) {
    const now = performance.now();
    if (!force && now - this.lastEmit < 80) return;
    this.lastEmit = now;
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): EngineSnapshot {
    const finished = this.slices.map((s) => s.load);
    const rec = this.recorder;
    return {
      exerciseIndex: this.exerciseIndex,
      intensity: this.intensity,
      inSet: !!rec,
      autoRep: this.autoRep,
      reps: rec?.reps ?? 0,
      setDuration: rec?.durationS ?? 0,
      effort: this.effort,
      gamepadName: this.gamepadName,
      sourceLabel: this.source.info.label,
      sourceKind: this.source.info.kind,
      live: [...this.live],
      setLoad: rec ? [...rec.load] : zeroVector(),
      workoutLoad: sumVectors(rec ? [...finished, rec.load] : finished),
      fatigue: [...this.sim.fatigue],
      slices: this.slices,
      alerts: this.alerts,
      elapsedS: (Date.now() - this.startedAt) / 1000,
      sessionIndex: this.sessionIndex,
      externalLoadLb: this.externalLoadLb,
      restSinceSetS: this.lastSetEndedAt === null ? 0 : Math.max(0, (Date.now() - this.lastSetEndedAt) / 1000),
    };
  }
}
