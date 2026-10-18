import { useEffect, useMemo, useRef, useState } from 'react';
import { coachStatus, generateCoachReport, type CoachStatus } from '../coach/llm';
import type { CoachReport } from '../coach/rules';
import { exerciseById } from '../domain/exercises';
import { MUSCLE_INDEX, muscleLabel, type MuscleId } from '../domain/muscles';
import type { BodyProfile } from '../domain/profile';
import { clearHistory, loadHistory, seedDemoHistory, type SessionRecord } from '../engine/history';
import { evaluateRisk } from '../engine/risk';
import { normalize, sumVectors } from '../engine/slices';
import type { WorkoutResult } from '../engine/WorkoutEngine';
import { BodyCanvas } from '../three/BodyCanvas';
import { heatCss } from '../three/heat';
import { fmtTime, HeatLegend, MuscleBars } from './common';

export function SummaryView({ result, profile, onEndWorkout, onEditBody }: {
  result: WorkoutResult;
  profile: BodyProfile;
  onEndWorkout: () => void;
  onEditBody: () => void;
}) {
  const { slices, session } = result;
  const [historyBefore, setHistoryBefore] = useState(result.historyBefore);
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(slices.map((s) => s.id)));
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [status, setStatus] = useState<CoachStatus | null>(null);
  const [report, setReport] = useState<(CoachReport & { error?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<SessionRecord[]>(() => loadHistory());
  const [spin, setSpin] = useState(true);
  const [facing, setFacing] = useState<{ side: 'front' | 'back'; n: number }>({ side: 'front', n: 0 });
  const [page, setPage] = useState<'workout' | 'coach'>('workout');

  const flags = useMemo(() => evaluateRisk(slices, historyBefore, Date.parse(session.date)), [slices, historyBefore, session.date]);
  const flaggedMap = Object.fromEntries(flags.map((f) => [f.muscle, f.level])) as Partial<Record<MuscleId, 'elevated' | 'high'>>;
  const active = slices.filter((s) => enabled.has(s.id));
  const cumulative = useMemo(() => sumVectors(active.map((s) => s.load)), [active]);
  const norm = useMemo(() => normalize(cumulative, 1), [cumulative]);
  const normRef = useRef(norm);
  normRef.current = norm;

  const totalReps = slices.reduce((a, s) => a + s.reps, 0);
  const tut = slices.reduce((a, s) => a + s.durationS, 0);

  const runCoach = async (useLlm: boolean) => {
    setLoading(true);
    const r = await generateCoachReport({ profile, slices, flags, history: historyBefore }, useLlm);
    setReport(r);
    setLoading(false);
  };

  useEffect(() => {
    void coachStatus().then((st) => {
      setStatus(st);
      void runCoach(st.llm);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);

  const toggle = (id: string) =>
    setEnabled((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const seed = () => {
    const h = seedDemoHistory().filter((x) => x.id !== session.id);
    setHistoryBefore(h);
    setHistory(loadHistory());
  };

  const sel = selected ? MUSCLE_INDEX[selected] : -1;

  return (
    <div className="summary">
      <header className="sum-head">
        <div>
          <div className="eyebrow">Workout review · {new Date(session.date).toLocaleString()}</div>
          <h1>Cumulative muscle map</h1>
        </div>
        <div className="sum-stats">
          <div><b>{slices.length}</b><span>sets</span></div>
          <div><b>{totalReps}</b><span>reps</span></div>
          <div><b>{fmtTime(tut)}</b><span>time under tension</span></div>
          <div><b>{fmtTime(slices.reduce((sum, slice) => sum + slice.restBeforeS, 0))}</b><span>rest logged</span></div>
          <div><b>{flags.length}</b><span>risk flags</span></div>
        </div>
        <div className="sum-actions">
          <button className={`btn ${page === 'workout' ? 'primary' : ''}`} onClick={() => setPage('workout')}>Workout dashboard</button>
          <button className={`btn ${page === 'coach' ? 'primary' : ''}`} onClick={() => setPage('coach')}>Risk & coach</button>
          <button className="btn" onClick={onEditBody}>Body model</button>
          {page === 'coach' && <button className="btn primary" onClick={onEndWorkout}>End workout</button>}
        </div>
      </header>

      <div className={`sum-grid ${page === 'coach' ? 'detail' : ''}`}>
        {page === 'workout' ? <>
        <section className="sum-model panel">
          <BodyCanvas profile={profile} getValues={() => normRef.current} selected={selected} onSelect={setSelected} smoothing={0.12} valueLabel="relative load" autoRotate={spin && !selected} facing={facing} />
          <div className="view-btns">
            <button className={!spin && facing.side === 'front' ? 'on' : ''} onClick={() => { setSpin(false); setFacing({ side: 'front', n: facing.n + 1 }); }}>Front</button>
            <button className={!spin && facing.side === 'back' ? 'on' : ''} onClick={() => { setSpin(false); setFacing({ side: 'back', n: facing.n + 1 }); }}>Back</button>
            <button className={spin ? 'on' : ''} onClick={() => setSpin(true)}>Spin</button>
          </div>
          <div className="legend-wrap"><HeatLegend left="untrained" right="most worked" /></div>
          <div className="overlay-title">Muscle map · {active.length} of {slices.length} sets included</div>
        </section>

        <section className="sum-mid">
          <div className="panel">
            <div className="panel-title">
              Set records · select rows to include in the map
              <span>
                <button className="link" onClick={() => setEnabled(new Set(slices.map((s) => s.id)))}>all</button>
                <button className="link" onClick={() => setEnabled(new Set())}>none</button>
              </span>
            </div>
            <div className="slice-list">
              {slices.map((s) => (
                <label key={s.id} className={`slice-row ${enabled.has(s.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={enabled.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="sr-name"><b>Session {s.sessionIndex} · Set {s.index}</b> {exerciseById(s.exerciseId).name}</span>
                  <span className="muted">{s.reps} reps · {s.durationS.toFixed(0)} s · {s.externalLoadLb} lb · rest {fmtTime(s.restBeforeS)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-title">Accumulated EMG workload <span className="muted">activation × time (a·s)</span></div>
            <MuscleBars values={cumulative} scaleMax={Math.max(...cumulative, 1)} unit="s" selected={selected} onSelect={setSelected} flagged={flaggedMap} />
            {selected && sel >= 0 && (
              <div className="muscle-info">
                <b>{muscleLabel(selected)}</b> — contribution per set
                {active.map((s) => (
                  <div key={s.id} className="contrib">
                    <span>#{s.index} {exerciseById(s.exerciseId).name}</span>
                    <span className="bar-track"><span className="bar-fill" style={{ width: `${(s.load[sel] / Math.max(1e-6, cumulative[sel])) * 100}%`, background: heatCss(s.peak[sel]) }} /></span>
                    <span>{s.load[sel].toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        </> : <section className="sum-right">
          <div className="panel risk">
            <div className="panel-title">Strain-risk check</div>
            {flags.length === 0 && <div className="ok-box">No sustained high-load patterns detected. Normal recovery applies.</div>}
            {flags.map((f) => (
              <div key={f.muscle} className={`risk-card ${f.level}`} onClick={() => setSelected(f.muscle)}>
                <div className="risk-head">
                  <b>{muscleLabel(f.muscle)}</b>
                  <span className={`pill ${f.level}`}>{f.level === 'high' ? 'High risk' : 'Elevated risk'}</span>
                </div>
                <ul>{f.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <div className="risk-sugg">{f.suggestion}</div>
              </div>
            ))}
            <div className="disclaimer">Training guidance only — not a medical diagnosis. Thresholds: time above 60% activation, continuous holds above 70%, and repeat loading within 48 h.</div>
          </div>

          <div className="panel coach">
            <div className="panel-title">
              AI coach
              <span className={`pill ${report?.source === 'llm' ? 'llm' : 'rules'}`}>
                {loading
                  ? `thinking…${status?.llm ? ` (${status.model})` : ''}`
                  : report?.source === 'llm'
                    ? report.model ?? status?.model ?? 'LLM'
                    : status?.llm
                      ? `rule-based · fallback (${status.model} failed)`
                      : 'rule-based (offline)'}
              </span>
            </div>
            {report && (
              <>
                <p className="headline">{report.headline}</p>
                {report.error && <div className="err">{status?.model ?? 'LLM'} call failed — showing rule-based coach instead. ({report.error.slice(0, 140)})</div>}
                {report.overloaded.length > 0 && (
                  <div className="coach-sec">
                    <h4>Overloaded</h4>
                    {report.overloaded.map((o) => <div key={o.muscle} className="coach-item hot"><b>{muscleLabel(o.muscle)}</b> {o.note}</div>)}
                  </div>
                )}
                {report.underTrained.length > 0 && (
                  <div className="coach-sec">
                    <h4>Under-trained</h4>
                    {report.underTrained.map((o) => <div key={o.muscle} className="coach-item cold"><b>{muscleLabel(o.muscle)}</b> {o.note}</div>)}
                  </div>
                )}
                <div className="coach-sec">
                  <h4>Insights</h4>
                  <ul>{report.insights.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
                <div className="coach-sec">
                  <h4>Next-session plan</h4>
                  <table className="plan">
                    <tbody>
                      {report.plan.map((p) => (
                        <tr key={p.exercise}>
                          <td><b>{p.exercise}</b><div className="muted">{p.why}</div></td>
                          <td className="nowrap">{p.sets} × {p.reps}</td>
                          <td className="nowrap muted">{p.intensity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="coach-sec">
                  <h4>Recovery</h4>
                  <ul>{report.restAdvice.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <div className="panel-title">
              Session history (local)
              <span>
                <button className="link" onClick={seed} title="Adds a heavy push day yesterday + a pull day 4 days ago">seed demo history</button>
                <button className="link" onClick={() => { clearHistory(); setHistory([]); setHistoryBefore([]); }}>clear</button>
              </span>
            </div>
            {history.slice(-6).reverse().map((h) => (
              <div key={h.id} className="hist-row">
                <span>{new Date(h.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{h.id === session.id ? ' · today' : ''}{h.demo ? ' · demo' : ''}</span>
                <span className="muted">{h.exercises.map((e) => exerciseById(e).name).join(', ')}</span>
              </div>
            ))}
            {history.length === 0 && <div className="muted">No sessions stored yet.</div>}
          </div>
        </section>}
      </div>
    </div>
  );
}
