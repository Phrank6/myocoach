import { MUSCLE_IDS, type MuscleId } from '../domain/muscles';
import { FrameEmitter, parseEmgLine, type EmgFrame, type EmgSource, type EmgSourceInfo } from './types';

/* Minimal typings for the Web Serial API (Chrome/Edge only). */
interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(opts?: unknown): Promise<SerialPortLike>;
}

export function webSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Real-hardware adapter: reads newline-delimited CSV from an Arduino over Web Serial.
 * Expected sketch output (115200 baud, ~100 Hz):  `millis,a0,a1,...,a9\n`
 * Channel order must match `channels` (defaults to MUSCLE_IDS order).
 */
export class WebSerialEmgSource implements EmgSource {
  readonly info: EmgSourceInfo;
  running = false;
  private emitter = new FrameEmitter();
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private baudRate: number;

  constructor(opts: { baudRate?: number; channels?: MuscleId[]; sampleRateHz?: number } = {}) {
    this.baudRate = opts.baudRate ?? 115200;
    const channels = opts.channels ?? [...MUSCLE_IDS];
    this.info = {
      kind: 'webserial',
      label: `Arduino via Web Serial (${channels.length} ch)`,
      sampleRateHz: opts.sampleRateHz ?? 100,
      channels,
    };
  }

  async start() {
    if (!webSerialSupported()) throw new Error('Web Serial is not available in this browser (use Chrome/Edge).');
    const serial = (navigator as unknown as { serial: SerialLike }).serial;
    this.port = await serial.requestPort();
    await this.port.open({ baudRate: this.baudRate });
    this.running = true;
    void this.readLoop();
  }

  stop() {
    this.running = false;
    void this.reader?.cancel().catch(() => {});
    void this.port?.close().catch(() => {});
    this.reader = null;
    this.port = null;
  }

  onFrame(cb: (f: EmgFrame) => void) {
    return this.emitter.on(cb);
  }

  private async readLoop() {
    if (!this.port?.readable) return;
    const decoded = this.port.readable.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>);
    this.reader = decoded.getReader();
    let buf = '';
    const n = this.info.channels.length;
    while (this.running) {
      const { value, done } = await this.reader.read();
      if (done) break;
      buf += value;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const frame = parseEmgLine(line, n);
        if (frame) this.emitter.emit(frame);
      }
    }
  }
}
