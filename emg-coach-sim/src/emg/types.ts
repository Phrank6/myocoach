import type { MuscleId } from '../domain/muscles';

/** One sample of every channel, as an Arduino would print it. Values are raw ADC counts (0–1023). */
export interface EmgFrame {
  t: number; // ms
  raw: number[];
}

export interface EmgSourceInfo {
  kind: 'simulated' | 'webserial';
  label: string;
  sampleRateHz: number;
  /** channel index -> muscle group */
  channels: MuscleId[];
  /** Known rest level / max-voluntary-contraction level per channel, if the source can provide it. */
  calibrationHint?: { baseline: number[]; mvc: number[] };
}

/**
 * Anything that produces per-channel EMG frames. The rest of the app only depends on this
 * interface, so the simulator can be swapped for real hardware (Web Serial, WebSocket bridge, BLE...).
 */
export interface EmgSource {
  readonly info: EmgSourceInfo;
  readonly running: boolean;
  start(): Promise<void>;
  stop(): void;
  onFrame(cb: (frame: EmgFrame) => void): () => void;
}

/**
 * Parse one line of the serial protocol:
 *   `t,c0,c1,...,cN-1`  (t = Arduino millis())   or   `c0,c1,...,cN-1`
 */
export function parseEmgLine(line: string, nChannels: number, now = performance.now()): EmgFrame | null {
  const parts = line.trim().split(/[,\s;]+/).filter(Boolean);
  if (parts.length !== nChannels && parts.length !== nChannels + 1) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === nChannels + 1) return { t: nums[0], raw: nums.slice(1) };
  return { t: now, raw: nums };
}

export class FrameEmitter {
  private listeners = new Set<(f: EmgFrame) => void>();
  on(cb: (f: EmgFrame) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(f: EmgFrame) {
    for (const l of this.listeners) l(f);
  }
}
