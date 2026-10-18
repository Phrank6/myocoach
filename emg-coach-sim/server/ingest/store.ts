import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sample } from './validate.ts';

export function localDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Append-only JSON-lines store for phone/vest samples. The site had no server storage, and this
 * keeps it dependency-free: one line per accepted sample in `<dataDir>/samples.jsonl`, replayed
 * into memory at startup. Duplicate ids are ignored (the app retries batches).
 * Fine for one person on a laptop; swap for SQLite if the file grows past a few hundred MB.
 */
export type Stored = Sample & { device_id: string; received_at: number };

export interface DeviceInfo {
  device_id: string;
  app_version: string | null;
  last_seen: number;
}

/** Per-day vest aggregate per engine muscle group (from vest_window rows that carry `group`). */
export interface VestDay {
  seconds: number;
  groups: Record<string, { normSeconds: number; seconds: number; fatigue: number | null }>;
}

const VEST_RECENT = 600; // keep the last ~10 min of 1 s windows in memory for the live panel

export class IngestStore {
  private readonly file: string;
  private ids = new Set<string>();
  /** latest daily row per device+date (later `updated_at` / arrival wins) */
  private daily = new Map<string, Stored>();
  private vestRecent: Stored[] = [];
  private sessions: Stored[] = [];
  private selfreports: Stored[] = [];
  private vestDays = new Map<string, VestDay>();
  readonly counts: Record<string, number> = { daily: 0, vest_window: 0, vest_session: 0, selfreport: 0 };
  readonly devices = new Map<string, DeviceInfo>();
  lastReceivedAt: number | null = null;

  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'samples.jsonl');
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          this.index(JSON.parse(line) as Stored);
        } catch {
          /* skip a torn last line */
        }
      }
    }
  }

  private key(s: Stored) {
    return `${s.device_id}|${s.id}`;
  }

  private index(s: Stored) {
    this.ids.add(this.key(s));
    this.counts[s.type] = (this.counts[s.type] ?? 0) + 1;
    this.lastReceivedAt = Math.max(this.lastReceivedAt ?? 0, s.received_at);
    const d = this.devices.get(s.device_id);
    if (!d || d.last_seen < s.received_at) this.devices.set(s.device_id, { device_id: s.device_id, app_version: d?.app_version ?? null, last_seen: s.received_at });
    if (s.type === 'daily') {
      const k = `${s.device_id}|${s.date}`;
      const prev = this.daily.get(k);
      const ver = (x: Stored) => (x.updated_at as number | undefined) ?? x.received_at;
      if (!prev || ver(s) >= ver(prev)) this.daily.set(k, s);
    } else if (s.type === 'vest_window') {
      this.vestRecent.push(s);
      this.aggregateVest(s);
      if (this.vestRecent.length > VEST_RECENT) this.vestRecent.splice(0, this.vestRecent.length - VEST_RECENT);
    } else if (s.type === 'vest_session') {
      this.sessions.push(s);
    } else if (s.type === 'selfreport') {
      this.selfreports.push(s);
    }
  }

  private aggregateVest(s: Stored) {
    const date = localDate(new Date(s.ts as number));
    let d = this.vestDays.get(date);
    if (!d) this.vestDays.set(date, (d = { seconds: 0, groups: {} }));
    const w = s.window_s as number;
    d.seconds += w;
    for (const c of s.channels as { group: string | null; norm: number | null; fatigue: number | null }[]) {
      if (!c.group || c.norm === null) continue;
      const g = (d.groups[c.group] ??= { normSeconds: 0, seconds: 0, fatigue: null });
      g.normSeconds += c.norm * w;
      g.seconds += w;
      if (c.fatigue !== null) g.fatigue = c.fatigue; // latest value of the day
    }
  }

  /** Engine-ready EMG summaries for a date: mean normalized activation per group while worn, latest fatigue. */
  vestDay(date: string): { emg_muscle_load: Record<string, number>; emg_fatigue_index: Record<string, number>; worn_minutes: number } | null {
    const d = this.vestDays.get(date);
    if (!d) return null;
    const load: Record<string, number> = {};
    const fat: Record<string, number> = {};
    for (const [g, v] of Object.entries(d.groups)) {
      if (v.seconds > 0) load[g] = Math.round((v.normSeconds / v.seconds) * 1000) / 1000;
      if (v.fatigue !== null) fat[g] = Math.round(v.fatigue * 100) / 100;
    }
    return { emg_muscle_load: load, emg_fatigue_index: fat, worn_minutes: Math.round(d.seconds / 6) / 10 };
  }

  vestDates(): string[] {
    return [...this.vestDays.keys()].sort();
  }

  has(deviceId: string, id: string) {
    return this.ids.has(`${deviceId}|${id}`);
  }

  /** Persist + index. Returns false for a duplicate. */
  add(deviceId: string, s: Sample, appVersion: string | null, now = Date.now()): boolean {
    if (this.has(deviceId, s.id)) return false;
    const row: Stored = { ...s, device_id: deviceId, received_at: now };
    appendFileSync(this.file, JSON.stringify(row) + '\n');
    this.index(row);
    if (appVersion) this.devices.get(deviceId)!.app_version = appVersion;
    return true;
  }

  /** Daily rows across devices, one per date (most recently received device wins), oldest first. */
  dailyRows(): Stored[] {
    const byDate = new Map<string, Stored>();
    for (const r of this.daily.values()) {
      const p = byDate.get(r.date as string);
      if (!p || r.received_at >= p.received_at) byDate.set(r.date as string, r);
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  latestVest(): Stored | null {
    return this.vestRecent.at(-1) ?? null;
  }

  recentVest(sinceMs: number): Stored[] {
    return this.vestRecent.filter((v) => (v.ts as number) >= sinceMs);
  }

  recentSessions(n = 5): Stored[] {
    return this.sessions.slice(-n);
  }

  selfreportsSince(ts: number): Stored[] {
    return this.selfreports.filter((s) => (s.ts as number) >= ts);
  }

  /** Remove everything a device sent (DELETE /api/device/<id>/data). Rewrites the file. */
  deleteDevice(deviceId: string): number {
    if (!existsSync(this.file)) return 0;
    const keep: string[] = [];
    let removed = 0;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        if ((JSON.parse(line) as Stored).device_id === deviceId) {
          removed++;
          continue;
        }
      } catch {
        continue;
      }
      keep.push(line);
    }
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, keep.length ? keep.join('\n') + '\n' : '');
    renameSync(tmp, this.file);
    // rebuild the in-memory index from what is left
    this.ids.clear();
    this.daily.clear();
    this.vestRecent = [];
    this.sessions = [];
    this.selfreports = [];
    this.vestDays.clear();
    for (const k of Object.keys(this.counts)) this.counts[k] = 0;
    this.devices.clear();
    this.lastReceivedAt = null;
    for (const line of keep) this.index(JSON.parse(line) as Stored);
    return removed;
  }
}
