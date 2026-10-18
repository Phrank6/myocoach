import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import '../styles/base.css';
import './you.css';

/** "You" page: what the phone and the vest say about you, and an agent-generated plan for today. */

type Day = Record<string, unknown> & { date: string };
interface VestChannel { ch: number; label: string | null; group: string | null; norm: number | null; rms: number; mdf: number | null; fatigue: number | null }
interface You {
  today: string;
  latest_day: Day | null;
  phone_meta: { sleep_source: string | null; gait_source: string | null; received_at: number } | null;
  avg7: Record<string, number | null>;
  trend: { date: string; sleep_hours: number | null; steps: number | null; phone_screen_hours: number | null }[];
  vest: {
    today: { emg_muscle_load: Record<string, number>; emg_fatigue_index: Record<string, number>; worn_minutes: number } | null;
    live: { ts: number; source: string; activity: string | null; channels: VestChannel[] } | null;
    sessions: { exercise: string; start: number; end: number; source: string }[];
  };
  link: { devices: { device_id: string; app_version: string | null; last_seen: number }[]; last_received_at: number | null };
}
interface Block { name: string; sets: number; reps: string; rest_s: number | null; cue: string | null }
interface Plan {
  source: 'agent' | 'engine';
  provider: string | null;
  model: string | null;
  headline: string;
  why: string[];
  session: { name: string; minutes: number; blocks: Block[] } | null;
  tips: string[];
  readiness: { score: number; zone: string; reasons: string[] } | null;
  error?: string;
  engine: { disclaimer: string; inputs: { days_of_history: number; today_has_phone_data: boolean } };
}

const num = (v: unknown, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—');
const ago = (ts: number | null | undefined) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const pretty = (s: string) => s.replace(/_/g, ' ');

function useYou() {
  const [you, setYou] = useState<You | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/you')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j: You) => live && (setYou(j), setErr(null)))
        .catch((e: Error) => live && setErr(e.message));
    void load();
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return { you, err };
}

function Stat({ label, value, unit, sub, tag }: { label: string; value: string; unit?: string; sub?: string; tag?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}{tag && <span className="est">{tag}</span>}</div>
      <div className="stat-value mono">{value}<span className="unit">{value !== '—' ? unit : ''}</span></div>
      {sub && <div className="stat-sub faint">{sub}</div>}
    </div>
  );
}

function Spark({ values }: { values: (number | null)[] }) {
  const v = values.map((x) => x ?? 0);
  const max = Math.max(1e-6, ...v);
  return (
    <div className="spark" aria-hidden>
      {v.map((x, i) => <span key={i} style={{ height: `${Math.max(4, (x / max) * 100)}%` }} className={values[i] === null ? 'none' : ''} />)}
    </div>
  );
}

function AboutYou({ you }: { you: You }) {
  const d = you.latest_day ?? ({} as Day);
  const a = you.avg7;
  const has = !!you.latest_day;
  return (
    <section className="card">
      <div className="card-head">
        <div><div className="eyebrow">From your phone</div><h2 className="serif">About you</h2></div>
        {has && <span className="faint">latest day {String(d.date)}</span>}
      </div>
      {!has ? (
        <p className="empty">No phone data yet. Pair the MyoCoach Link app (top right) and keep it running; daily summaries arrive on the next sync.</p>
      ) : (
        <div className="stats">
          <Stat label="Sleep" value={num(d.sleep_hours)} unit=" h" sub={`7-day avg ${num(a.sleep_hours)} h`} tag={you.phone_meta?.sleep_source === 'heuristic' ? 'estimate' : undefined} />
          <Stat label="Steps" value={typeof d.steps === 'number' ? d.steps.toLocaleString() : '—'} sub={`7-day avg ${a.steps ? Math.round(a.steps).toLocaleString() : '—'}`} />
          <Stat label="Sitting" value={num(d.sitting_hours)} unit=" h" sub={`longest bout ${num(d.longest_sitting_bout_min, 0)} min`} />
          <Stat label="Screen time" value={num(d.phone_screen_hours)} unit=" h" sub={`after 23:00 ${num(d.phone_after_23h_minutes, 0)} min`} />
          <Stat label="Head-down" value={num(d.head_down_minutes, 0)} unit=" min" sub="screen on + phone tilted down" tag="proxy" />
          <Stat label="Walking speed" value={num(d.gait_speed_mps, 2)} unit=" m/s" sub={`asymmetry ${num(d.gait_asymmetry_pct)} %`} tag="estimate" />
          {(d.hrv_rmssd_ms !== undefined || d.resting_hr !== undefined) && <Stat label="Recovery" value={num(d.resting_hr, 0)} unit=" bpm" sub={`HRV ${num(d.hrv_rmssd_ms, 0)} ms`} />}
        </div>
      )}
      {you.trend.length > 1 && (
        <div className="trends">
          <div><span className="faint">Sleep, 7 days</span><Spark values={you.trend.map((t) => t.sleep_hours)} /></div>
          <div><span className="faint">Steps, 7 days</span><Spark values={you.trend.map((t) => t.steps)} /></div>
          <div><span className="faint">Screen time, 7 days</span><Spark values={you.trend.map((t) => t.phone_screen_hours)} /></div>
        </div>
      )}
    </section>
  );
}

function Vest({ you }: { you: You }) {
  const live = you.vest.live;
  const today = you.vest.today;
  const sim = live?.source === 'site_model';
  const groups = Object.entries(today?.emg_muscle_load ?? {}).sort((a, b) => b[1] - a[1]);
  const gmax = Math.max(0.05, ...groups.map((g) => g[1]));
  return (
    <section className="card">
      <div className="card-head">
        <div><div className="eyebrow">From the vest</div><h2 className="serif">Muscle signal</h2></div>
        <span className={`tag ${live ? 'accent' : ''}`}><span className={`dot ${live ? 'ok' : ''}`} />{live ? (sim ? 'Live · simulated by the 3D model' : 'Live · vest') : 'Idle'}</span>
      </div>
      {live ? (
        <>
          <div className="faint small">Now: {live.activity ? pretty(live.activity) : 'rest'} · activation as % of the simulated max · updated {ago(live.ts)}</div>
          <div className="bars">
            {live.channels.map((c) => (
              <div className="bar-row" key={c.ch}>
                <span className="bar-name">{c.label ?? `Ch ${c.ch}`}</span>
                <span className="bar"><span style={{ width: `${Math.min(100, (c.norm ?? 0) * 100)}%` }} /></span>
                <span className="mono bar-val">{Math.round((c.norm ?? 0) * 100)}%</span>
                <span className={`mono bar-fat ${(c.fatigue ?? 0) >= 0.6 ? 'hi' : ''}`} title="fatigue index (simulated)">{c.fatigue !== null ? `F ${c.fatigue.toFixed(2)}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="empty">No live signal. Do a set on the main page (hold Space or press A for auto-rep) and the model's EMG streams here as the vest.</p>
      )}
      {groups.length > 0 && (
        <>
          <h3 className="sub">Today’s load by muscle group <span className="faint">· {today!.worn_minutes} min recorded</span></h3>
          <div className="groups">
            {groups.map(([g, v]) => (
              <div key={g} className="group">
                <span className="g-bar"><span style={{ height: `${(v / gmax) * 100}%` }} /></span>
                <span className="g-name">{pretty(g)}</span>
                <span className="mono faint">{v.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {you.vest.sessions.length > 0 && (
        <>
          <h3 className="sub">Recent sets</h3>
          <ul className="sets">
            {[...you.vest.sessions].reverse().map((s) => (
              <li key={s.start}><span>{pretty(s.exercise)}</span><span className="mono faint">{Math.round((s.end - s.start) / 1000)} s · {ago(s.end)}</span></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PlanCard() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const generate = () => {
    setBusy(true);
    setErr(null);
    fetch('/api/plan/today/agent', { method: 'POST' })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(((await r.json()) as { error: string }).error))))
      .then((p: Plan) => setPlan(p))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  const r = plan?.readiness;
  return (
    <section className="card plan">
      <div className="card-head">
        <div><div className="eyebrow">Coach agent</div><h2 className="serif">Today’s plan</h2></div>
        <button className="btn accent" onClick={generate} disabled={busy}>{busy ? 'Thinking…' : plan ? 'Regenerate' : 'Generate today’s plan'}</button>
      </div>
      {err && <p className="error">Couldn’t build a plan: {err}</p>}
      {busy && !plan && <div className="skeleton" style={{ height: 120 }} />}
      {!plan && !busy && !err && <p className="empty">The training engine reads your sleep, activity, phone habits and vest muscle load, checks readiness and safety, then the agent writes one session for today.</p>}
      {plan && (
        <div className={busy ? 'dim' : ''}>
          <div className="plan-top">
            {r && (
              <div className={`ready ${r.zone}`}>
                <span className="mono ready-n">{r.score}</span>
                <span className="ready-l">readiness · {r.zone}</span>
              </div>
            )}
            <div>
              <div className="plan-headline serif">{plan.headline}</div>
              <div className="faint small">
                {plan.source === 'agent' ? `Written by ${plan.provider} (${plan.model}) from the engine’s plan` : `Training engine (${plan.model}) · add an LLM key for agent-written plans`}
                {' · '}{plan.engine.inputs.days_of_history} days of history
              </div>
            </div>
          </div>
          {plan.error && <p className="faint small">Agent unavailable ({plan.error.slice(0, 120)}); showing the engine plan.</p>}
          {[...(r?.reasons ?? []), ...plan.why].length > 0 && (
            <ul className="why">{[...new Set([...(r?.reasons ?? []), ...plan.why])].map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          {plan.session ? (
            <table className="blocks">
              <thead><tr><th>Exercise</th><th>Sets × reps</th><th>Rest</th></tr></thead>
              <tbody>
                {plan.session.blocks.map((b, i) => (
                  <tr key={i}>
                    <td><div>{b.name}</div>{b.cue && <div className="faint small">{b.cue}</div>}</td>
                    <td className="mono">{b.sets} × {b.reps}</td>
                    <td className="mono">{b.rest_s ? `${b.rest_s}s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">No strength session scheduled today: easy 20–30 min walk and mobility.</p>
          )}
          {plan.tips.length > 0 && <ul className="tips">{plan.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
          <p className="faint small">{plan.engine.disclaimer}</p>
        </div>
      )}
    </section>
  );
}

function Pair({ onClose }: { onClose: () => void }) {
  const [pair, setPair] = useState<{ url: string; urls: string[]; token: string; qr: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = (rotate = false) =>
    fetch(`/api/pair${rotate ? '?rotate=1' : ''}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(((await r.json()) as { error: string }).error))))
      .then((p: typeof pair) => {
        setPair(p);
        return QRCode.toDataURL(p!.qr, { margin: 1, width: 280, color: { dark: '#0b0c0f', light: '#f4f1ec' } });
      })
      .then(setQr)
      .catch((e: Error) => setErr(e.message));
  useEffect(() => void load(), []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="pair">
        <div className="card-head"><h2 className="serif">Pair MyoCoach Link</h2><button className="x" aria-label="Close" onClick={onClose}>×</button></div>
        {err && <p className="error">{err}</p>}
        {pair && (
          <div className="pair-body">
            {qr && <img src={qr} alt="Pairing QR code" />}
            <div>
              <div className="faint small">Server</div>
              <div className="mono">{pair.url}</div>
              <div className="faint small" style={{ marginTop: 10 }}>Pairing code</div>
              <div className="mono pair-code">{pair.token}</div>
              <p className="faint small">In the app: Sync → enter the server and code (phone on the same Wi-Fi).</p>
              {pair.urls.length > 1 && <p className="faint small">Other addresses: {pair.urls.slice(1).join(', ')}</p>}
              <button className="link" onClick={() => void load(true)}>New code (unpairs the current phone)</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function YouApp() {
  const { you, err } = useYou();
  const [pairing, setPairing] = useState(false);
  const dev = you?.link.devices[0];
  return (
    <div className="you">
      <header className="you-top">
        <div className="brand"><span className="brand-mark" /><span className="serif brand-name">MyoCoach</span><span className="faint">You</span></div>
        <div className="you-right">
          <span className="faint small">{dev ? `Phone synced ${ago(dev.last_seen)}` : 'No phone paired'}</span>
          <button className="btn" onClick={() => setPairing(true)}>{dev ? 'Pair another phone' : 'Pair phone'}</button>
          <a className="link" href="/">Back to training</a>
        </div>
      </header>
      {err && !you && <p className="error">Can’t reach the local server ({err}). Run <span className="mono">npm run dev</span>.</p>}
      {!you && !err && <div className="skeleton" style={{ height: 240, margin: 24 }} />}
      {you && (
        <main className="you-grid">
          <PlanCard />
          <AboutYou you={you} />
          <Vest you={you} />
        </main>
      )}
      {pairing && <Pair onClose={() => setPairing(false)} />}
    </div>
  );
}
