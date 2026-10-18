import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { agentPlan } from './ingest/agent.ts';
import { buildEngineInput, dailySignals, engineConfig, loadSiteProfile, localDate, planToday, saveSiteProfile, type SiteProfile } from './ingest/engine.ts';
import { IngestStore } from './ingest/store.ts';
import { validateSample } from './ingest/validate.ts';

/**
 * Phone + vest ingest for the MyoCoach Link Android app, and the "You" page / plan API.
 *   POST   /api/ingest/batch          (Bearer token) phone batches, idempotent by sample id
 *   POST   /api/ingest/local          (this computer only) the website's simulated model vest
 *   GET    /api/ingest/status         counts + last sync
 *   GET    /api/you                   readable summary of the person (latest day, 7-day averages, vest)
 *   GET    /api/pair                  (this computer only) server URL + pairing token for the app
 *   GET    /api/plan/today            engine plan for today          (token or this computer)
 *   POST   /api/plan/today/agent      LLM agent plan grounded on the engine
 *   POST   /api/profile               (this computer only) desktop body profile -> engine profile
 *   DELETE /api/device/<id>/data      (Bearer token) forget a device
 * Data lives in `.myocoach-data/` (gitignored). Override with MYOCOACH_DATA_DIR.
 */
const MAX_BODY = 1 << 20;
const MAX_SAMPLES = 500;
const LOCAL_DEVICE = 'site-model-vest';

function lanIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

const isLoopback = (req: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  const buf = Buffer.concat(chunks);
  if ((req.headers['content-encoding'] ?? '').includes('gzip')) {
    const out = gunzipSync(buf, { maxOutputLength: MAX_BODY });
    return out;
  }
  return buf;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Pairing token: 12 base32 chars (60 bits), shown as XXXX-XXXX-XXXX; dashes are ignored. */
function newToken() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...randomBytes(12)].map((b) => abc[b % abc.length]).join('');
}
const normToken = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function ingestServer(env: Record<string, string | undefined>): Plugin {
  const root = process.cwd();
  const dataDir = resolve(env.MYOCOACH_DATA_DIR || join(root, '.myocoach-data'));
  mkdirSync(dataDir, { recursive: true });
  const store = new IngestStore(dataDir);
  const cfg = engineConfig(root, dataDir, env);
  const pairFile = join(dataDir, 'pair.json');
  let token: string = existsSync(pairFile) ? (JSON.parse(readFileSync(pairFile, 'utf8')) as { token: string }).token : newToken();
  if (!existsSync(pairFile)) writeFileSync(pairFile, JSON.stringify({ token }));
  let port = 5173;

  const authed = (req: IncomingMessage) => {
    const h = req.headers.authorization ?? '';
    const got = Buffer.from(normToken(h.replace(/^Bearer\s+/i, '')));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  function ingest(deviceId: string, appVersion: string | null, samples: unknown[]) {
    const rejected: { index: number; reason: string }[] = [];
    let accepted = 0;
    let duplicates = 0;
    samples.forEach((raw, index) => {
      const s = validateSample(raw);
      if (typeof s === 'string') return rejected.push({ index, reason: s });
      if (store.add(deviceId, s, appVersion)) accepted++;
      else duplicates++; // already stored: counts as accepted for the client (idempotent retry)
    });
    return { accepted: accepted + duplicates, new: accepted, duplicates, rejected };
  }

  /** A readable "about you" summary: latest day, 7-day averages, vest muscle load, recent sessions. */
  function you() {
    const today = localDate();
    const days = dailySignals(store, today);
    const last7 = days.slice(-7);
    const avg = (k: string) => {
      const v = last7.map((d) => d[k]).filter((x): x is number => typeof x === 'number');
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
    };
    const latest = [...days].reverse().find((d) => d.sleep_hours !== undefined || d.steps !== undefined) ?? null;
    const phoneRow = store.dailyRows().at(-1) ?? null;
    const vest = store.latestVest();
    const vestToday = store.vestDay(today);
    return {
      today,
      profile: loadSiteProfile(dataDir),
      latest_day: latest,
      phone_meta: phoneRow ? { sleep_source: phoneRow.sleep_source ?? null, gait_source: phoneRow.gait_source ?? null, received_at: phoneRow.received_at } : null,
      avg7: Object.fromEntries(
        ['sleep_hours', 'steps', 'sitting_hours', 'phone_screen_hours', 'head_down_minutes', 'phone_after_23h_minutes', 'gait_speed_mps', 'hrv_rmssd_ms', 'resting_hr'].map((k) => [k, avg(k)]),
      ),
      trend: last7.map((d) => ({ date: d.date, sleep_hours: d.sleep_hours ?? null, steps: d.steps ?? null, phone_screen_hours: d.phone_screen_hours ?? null })),
      vest: {
        today: vestToday,
        live: vest && Date.now() - (vest.ts as number) < 15_000 ? { ts: vest.ts, source: vest.source ?? vest.device_id, activity: vest.activity ?? null, channels: vest.channels } : null,
        sessions: store.recentSessions(6).map((s) => ({ exercise: s.exercise, start: s.start, end: s.end, source: s.device_id })),
      },
      link: { devices: [...store.devices.values()].filter((d) => d.device_id !== LOCAL_DEVICE), last_received_at: store.lastReceivedAt },
    };
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    const m = req.method ?? 'GET';
    const local = isLoopback(req);

    if (p === '/api/ingest/batch' && m === 'POST') {
      if (!authed(req)) throw new HttpError(401, 'bad or missing pairing token');
      const body = JSON.parse((await readBody(req)).toString('utf8')) as { device_id?: string; app_version?: string; samples?: unknown[] };
      if (typeof body.device_id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.device_id)) throw new HttpError(400, 'device_id required');
      if (!Array.isArray(body.samples) || body.samples.length > MAX_SAMPLES) throw new HttpError(400, `samples must be an array of <= ${MAX_SAMPLES}`);
      send(res, 200, ingest(body.device_id, typeof body.app_version === 'string' ? body.app_version.slice(0, 20) : null, body.samples));
      return true;
    }
    if (p === '/api/ingest/local' && m === 'POST') {
      if (!local) throw new HttpError(403, 'local only');
      const body = JSON.parse((await readBody(req)).toString('utf8')) as { samples?: unknown[] };
      if (!Array.isArray(body.samples) || body.samples.length > MAX_SAMPLES) throw new HttpError(400, 'samples must be an array');
      send(res, 200, ingest(LOCAL_DEVICE, 'web', body.samples));
      return true;
    }
    if (p === '/api/ingest/status' && m === 'GET') {
      if (!local && !authed(req)) throw new HttpError(401, 'unauthorized');
      send(res, 200, { ok: true, server_time: Date.now(), last_received_at: store.lastReceivedAt, counts: store.counts, devices: [...store.devices.values()] });
      return true;
    }
    if (p === '/api/you' && m === 'GET') {
      if (!local && !authed(req)) throw new HttpError(401, 'unauthorized');
      send(res, 200, you());
      return true;
    }
    if (p === '/api/pair' && m === 'GET') {
      if (!local) throw new HttpError(403, 'open the pairing page on the computer running the site');
      if (url.searchParams.get('rotate') === '1') {
        token = newToken();
        writeFileSync(pairFile, JSON.stringify({ token }));
      }
      const urls = lanIps().map((ip) => `http://${ip}:${port}`);
      const shown = token.match(/.{1,4}/g)!.join('-');
      const server = urls[0] ?? `http://localhost:${port}`;
      send(res, 200, { url: server, urls, token: shown, qr: `myocoach://pair?url=${encodeURIComponent(server)}&token=${shown}` });
      return true;
    }
    if (p === '/api/profile' && m === 'POST') {
      if (!local) throw new HttpError(403, 'local only');
      saveSiteProfile(dataDir, JSON.parse((await readBody(req)).toString('utf8')) as SiteProfile);
      send(res, 200, { ok: true });
      return true;
    }
    if (p === '/api/plan/today' && m === 'GET') {
      if (!local && !authed(req)) throw new HttpError(401, 'unauthorized');
      if (url.searchParams.get('inputs') === '1') send(res, 200, buildEngineInput(store, loadSiteProfile(dataDir)));
      else send(res, 200, await planToday(cfg, store, loadSiteProfile(dataDir)));
      return true;
    }
    if (p === '/api/plan/today/agent' && m === 'POST') {
      if (!local && !authed(req)) throw new HttpError(401, 'unauthorized');
      const engine = await planToday(cfg, store, loadSiteProfile(dataDir));
      const y = you();
      send(res, 200, await agentPlan(env, engine, { latest_day: y.latest_day, avg7: y.avg7, vest_today: y.vest.today }));
      return true;
    }
    const del = p.match(/^\/api\/device\/([A-Za-z0-9-]{8,64})\/data$/);
    if (del && m === 'DELETE') {
      if (!authed(req)) throw new HttpError(401, 'unauthorized');
      send(res, 200, { deleted: store.deleteDevice(del[1]) });
      return true;
    }
    return false;
  }

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) return next();
    route(req, res)
      .then((handled) => !handled && next())
      .catch((e: unknown) => {
        if (e instanceof HttpError) return send(res, e.status, { error: e.message });
        if (e instanceof SyntaxError) return send(res, 400, { error: 'invalid JSON' });
        console.error('[myocoach]', e instanceof Error ? e.message : e);
        send(res, 500, { error: e instanceof Error ? e.message : 'server error' });
      });
  };

  const onListen = (httpServer: Server | null) => {
    httpServer?.once('listening', () => {
      const a = httpServer.address();
      if (a && typeof a === 'object') port = a.port;
      const ips = lanIps();
      console.log(`\n  MyoCoach Link: phone ingest on ${ips.map((ip) => `http://${ip}:${port}`).join(', ') || '(no LAN address found)'}`);
      console.log(`  Pair the Android app from http://localhost:${port}/you  (data in ${dataDir})\n`);
    });
  };

  return {
    name: 'myocoach-ingest',
    configureServer(server) {
      onListen(server.httpServer as Server | null);
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      onListen(server.httpServer as Server | null);
      server.middlewares.use(handler);
    },
  };
}
