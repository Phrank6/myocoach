import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { EXERCISES } from '../domain/exercises';
import { N_MUSCLES } from '../domain/muscles';
import { MuscleMap2D } from './MuscleMap2D';
import { wsUrl, type HostState, type PhoneMsg, type ServerMsg } from './protocol';
import '../styles/base.css';
import './phone.css';

type Conn = 'idle' | 'connecting' | 'waiting' | 'live' | 'lost';
const HOLD_MS = 320;

function deviceName() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+;\s*([^;)]+)/);
  if (m) return m[1].replace(/Build.*/, '').trim() || 'Android phone';
  if (/Android/.test(ua)) return 'Android phone';
  if (/iPhone/.test(ua)) return 'iPhone';
  return 'Phone browser';
}

function usePhoneSession(code: string | null) {
  const [conn, setConn] = useState<Conn>('idle');
  const [state, setState] = useState<HostState | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let retry = 0;
    let timer = 0;
    const connect = () => {
      setConn((c) => (c === 'live' ? 'lost' : 'connecting'));
      const sock = new WebSocket(wsUrl(code, 'phone'));
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        sock.send(JSON.stringify({ type: 'hello', device: deviceName() } satisfies PhoneMsg));
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as HostState | ServerMsg;
        if (msg.type === 'hostStatus') setConn(msg.online ? 'live' : 'waiting');
        else if (msg.type === 'state') {
          setState(msg);
          setConn('live');
        }
      };
      sock.onclose = () => {
        if (stopped) return;
        setConn('lost');
        timer = window.setTimeout(connect, Math.min(6000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ws.current?.close();
    };
  }, [code]);

  const send = useCallback((m: PhoneMsg) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);
  return { conn, state, send };
}

function Join({ onJoin }: { onJoin: (c: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="p-join">
      <div className="p-brand"><span className="brand-mark" /> <span className="serif">MyoCoach</span></div>
      <h1 className="serif">Join your<br /><em>session.</em></h1>
      <p className="muted">Enter the four-character code shown on the desktop under <b>Connect phone</b>.</p>
      <input
        className="p-code-input mono"
        value={v}
        maxLength={4}
        autoCapitalize="characters"
        autoComplete="off"
        inputMode="text"
        placeholder="AB12"
        onChange={(e) => setV(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
      />
      <button className="btn accent lg block" disabled={v.length !== 4} onClick={() => onJoin(v)}>Join</button>
    </div>
  );
}

export default function PhoneApp() {
  const [code, setCode] = useState<string | null>(() => new URLSearchParams(location.search).get('s')?.toUpperCase() ?? null);
  const { conn, state, send } = usePhoneSession(code);
  const [pressed, setPressed] = useState(false);
  const [flash, setFlash] = useState(0);
  const holdTimer = useRef(0);
  const holdStream = useRef(0);
  const holding = useRef(false);

  const join = (c: string) => {
    history.replaceState(null, '', `/phone?s=${c}`);
    setCode(c);
  };

  const down = () => {
    setPressed(true);
    holding.current = false;
    holdTimer.current = window.setTimeout(() => {
      holding.current = true;
      send({ type: 'effort', value: 1 });
      holdStream.current = window.setInterval(() => send({ type: 'effort', value: 1 }), 120);
    }, HOLD_MS);
  };
  const up = () => {
    if (!pressed) return;
    setPressed(false);
    window.clearTimeout(holdTimer.current);
    window.clearInterval(holdStream.current);
    if (holding.current) send({ type: 'effort', value: 0 });
    else send({ type: 'rep' });
    setFlash((f) => f + 1);
    navigator.vibrate?.(12);
  };

  if (!code) return <Join onJoin={join} />;

  const ex = EXERCISES[state?.exerciseIndex ?? 0];
  const live = state?.live ?? new Array(N_MUSCLES).fill(0);
  const canTrain = state?.screen === 'workout';
  const statusText =
    conn === 'live' ? (canTrain ? 'Live' : state?.screen === 'summary' ? 'Reviewing' : 'Desktop is on setup') : conn === 'waiting' ? 'Waiting for desktop' : conn === 'lost' ? 'Reconnecting…' : 'Connecting…';

  return (
    <div className="p-app">
      <header className="p-head">
        <div className="p-brand"><span className="brand-mark" /> <span className="serif">MyoCoach</span></div>
        <div className={`p-status ${conn}`}>
          <span className={`dot ${conn === 'live' ? 'ok' : conn === 'lost' ? 'danger' : ''}`} />
          {statusText}
          <span className="mono faint">{code}</span>
        </div>
      </header>

      <section className="p-ex">
        <button className="p-arrow" aria-label="Previous exercise" onClick={() => send({ type: 'selectExercise', index: ((state?.exerciseIndex ?? 0) - 1 + EXERCISES.length) % EXERCISES.length })}>‹</button>
        <div className="p-ex-name">
          <div className="eyebrow">{ex.equipment} · load {Math.round((state?.intensity ?? 0.75) * 100)}%</div>
          <h2 className="serif">{ex.name}</h2>
        </div>
        <button className="p-arrow" aria-label="Next exercise" onClick={() => send({ type: 'selectExercise', index: ((state?.exerciseIndex ?? 0) + 1) % EXERCISES.length })}>›</button>
      </section>
      <div className="p-chips">
        {EXERCISES.map((e, i) => (
          <button key={e.id} className={i === state?.exerciseIndex ? 'on' : ''} onClick={() => send({ type: 'selectExercise', index: i })}>{e.name}</button>
        ))}
      </div>

      <MuscleMap2D values={live} />

      <section className="p-set">
        <div>
          <div className="eyebrow">{state?.inSet ? `Set ${state.setNo}` : `Set ${(state?.setNo ?? 0) + 1} · ready`}</div>
          <div className="p-reps"><span className="mono">{String(state?.inSet ? state.reps : 0).padStart(2, '0')}</span> <span className="faint">reps</span></div>
        </div>
        <div className="p-total faint"><b className="mono">{state?.totalReps ?? 0}</b> reps today</div>
      </section>

      {state?.alerts?.[0] && (
        <div className={`p-alert ${state.alerts[0].level}`}><span className={`dot ${state.alerts[0].level}`} />{state.alerts[0].title}</div>
      )}

      <div className="p-controls">
        <button
          className={`p-rep ${pressed ? 'down' : ''}`}
          disabled={!canTrain || conn !== 'live'}
          onPointerDown={(e) => { e.preventDefault(); down(); }}
          onPointerUp={up}
          onPointerLeave={up}
          onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()}
          style={{ '--effort': `${Math.round((state?.effort ?? 0) * 100)}%` } as CSSProperties}
        >
          <span className="p-rep-ring" />
          <span key={flash} className="p-rep-label">Rep</span>
          <span className="p-rep-sub">tap · hold to grind</span>
        </button>
        <div className="p-row">
          <button className="btn" onClick={() => send({ type: 'intensity', value: (state?.intensity ?? 0.75) - 0.05 })} aria-label="Less load">−</button>
          <button className="btn p-end" disabled={!state?.inSet} onClick={() => send({ type: 'endSet' })}>End set</button>
          <button className="btn" onClick={() => send({ type: 'intensity', value: (state?.intensity ?? 0.75) + 0.05 })} aria-label="More load">+</button>
        </div>
      </div>

      <section className="p-coach">
        <div className="row">
          <span className="eyebrow">Coach</span>
          {state?.coachSource && <span className={`tag ${state.coachSource === 'rule-based' ? '' : 'accent'}`}>{state.coachSource}</span>}
        </div>
        <p className="serif">{state?.coachLine ?? 'Finish a session on the desktop and the coach’s latest note shows up here.'}</p>
      </section>
    </div>
  );
}
