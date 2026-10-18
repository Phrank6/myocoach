import { useCallback, useState } from 'react';
import { EXERCISES, exerciseById } from '../domain/exercises';
import { MUSCLE_IDS, MUSCLE_INDEX, muscleLabel, muscleShort, type MuscleId } from '../domain/muscles';
import type { BodyProfile } from '../domain/profile';
import { WebSerialEmgSource, webSerialSupported } from '../emg/WebSerialEmgSource';
import type { WorkoutEngine } from '../engine/WorkoutEngine';
import { normalize } from '../engine/slices';
import { BodyCanvas } from '../three/BodyCanvas';
import { EmgScope } from './EmgScope';
import { fmtTime, HeatLegend, MiniHeat, MuscleBars, useEngine } from './common';

type ViewMode = 'live' | 'set' | 'workout';

export function WorkoutView({ engine, profile, onEditBody }: { engine: WorkoutEngine; profile: BodyProfile; onEditBody: () => void }) {
  const s = useEngine(engine);
  const [mode, setMode] = useState<ViewMode>('live');
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [serialErr, setSerialErr] = useState<string | null>(null);
  const [facing, setFacing] = useState<{ side: 'front' | 'back'; n: number }>({ side: 'front', n: 0 });
  const ex = EXERCISES[s.exerciseIndex];

  const getValues = useCallback(() => {
    if (mode === 'live') return engine.live;
    const snap = engine.getSnapshot();
    return normalize(mode === 'set' ? snap.setLoad : snap.workoutLoad, 1);
  }, [engine, mode]);
  const getPose = useCallback(() => engine.pose, [engine]);

  const flagged = Object.fromEntries(s.alerts.map((a) => [a.muscle, a.level])) as Partial<Record<MuscleId, 'elevated' | 'high'>>;
  const sel = selected ? MUSCLE_INDEX[selected] : -1;

  const connectSerial = async () => {
    setSerialErr(null);
    try {
      await engine.useSource(new WebSerialEmgSource());
    } catch (e) {
      setSerialErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="workout">
      <aside className="panel left">
        <div className="panel-title">Exercise <span className="kbd-hint">← → / LB RB</span></div>
        <div className="ex-list">
          {EXERCISES.map((e, i) => (
            <button key={e.id} className={`ex ${i === s.exerciseIndex ? 'on' : ''}`} onClick={() => engine.selectExercise(i)}>
              <span className="ex-name">{e.name}</span>
              <span className="ex-muscles">
                {MUSCLE_IDS.filter((m) => (e.profile[m] ?? 0) >= 0.6).map((m) => muscleShort(m)).join(' · ')}
              </span>
            </button>
          ))}
        </div>
        <div className="panel-title">Load <span className="kbd-hint">↑ ↓ / D-pad</span></div>
        <div className="intensity">
          <input type="range" min={0.3} max={1.1} step={0.05} value={s.intensity} onChange={(e) => engine.setIntensity(Number(e.target.value))} />
          <b>{Math.round(s.intensity * 100)}%</b>
        </div>
        <div className="controls-card">
          <div className="panel-title">Controls</div>
          <div className="ctrl"><kbd>Space</kbd><span>hold = lift (rep)</span><em>RT / stick ↑</em></div>
          <div className="ctrl"><kbd>Enter</kbd><span>start / end set</span><em>A</em></div>
          <div className="ctrl"><kbd>A</kbd><span>auto-rep demo</span><em>Y</em></div>
          <div className="ctrl"><kbd>F</kbd><span>finish workout</span><em>Start</em></div>
          <div className={`pad ${s.gamepadName ? 'ok' : ''}`}>{s.gamepadName ? `🎮 ${s.gamepadName.slice(0, 38)}` : 'No gamepad — press any button on a controller to connect'}</div>
        </div>
        <div className="source-card">
          <div className="panel-title">EMG source</div>
          <div className={`source ${s.sourceKind}`}>{s.sourceLabel}</div>
          {s.sourceKind === 'simulated' ? (
            <button className="btn small" disabled={!webSerialSupported()} onClick={connectSerial} title={webSerialSupported() ? '' : 'Web Serial needs Chrome/Edge'}>
              Connect Arduino (Web Serial)
            </button>
          ) : (
            <button className="btn small" onClick={() => void engine.useSimulated()}>Back to simulator</button>
          )}
          {serialErr && <div className="err">{serialErr}</div>}
        </div>
        <button className="link" onClick={onEditBody}>Edit body model</button>
      </aside>

      <main className="stage">
        <BodyCanvas profile={profile} getValues={getValues} getPose={getPose} selected={selected} onSelect={setSelected} dumbbells smoothing={mode === 'live' ? 0.25 : 0.1} valueLabel={mode === 'live' ? 'activation' : 'relative load'} facing={facing} />
        <div className="view-btns stage-views">
          <button onClick={() => setFacing({ side: 'front', n: facing.n + 1 })}>Front</button>
          <button onClick={() => setFacing({ side: 'back', n: facing.n + 1 })}>Back</button>
        </div>
        <div className="hud-top">
          <div className="hud-ex">
            <div className="eyebrow">{ex.equipment}</div>
            <h2>{ex.name}</h2>
            <div className="muted">{ex.cue}</div>
          </div>
          <div className={`set-status ${s.inSet ? 'live' : ''}`}>
            {s.inSet ? (
              <>
                <span className="rec" /> SET {s.slices.length + 1}
                <b>{s.reps}</b> reps <span className="muted">{fmtTime(s.setDuration)}</span>
                {s.autoRep && <span className="tag">AUTO</span>}
              </>
            ) : (
              <>Ready · hold <kbd>Space</kbd> or pull <kbd>RT</kbd> to start set {s.slices.length + 1}</>
            )}
          </div>
        </div>
        <div className="mode-toggle">
          {(['live', 'set', 'workout'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'live' ? 'Live EMG' : m === 'set' ? 'This set' : 'Workout so far'}
            </button>
          ))}
        </div>
        <div className="effort">
          <div className="effort-fill" style={{ height: `${s.effort * 100}%` }} />
          <span>effort</span>
        </div>
        <div className="legend-wrap"><HeatLegend left="rest" right={mode === 'live' ? '100% MVC' : 'most worked'} /></div>
        <div className="alerts">
          {s.alerts.slice(0, 3).map((a) => (
            <div key={a.id} className={`alert ${a.level}`} onClick={() => engine.dismissAlert(a.id)}>
              <b>⚠ {a.title}</b>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
        <div className="slices-strip">
          {s.slices.length === 0 && <span className="muted">Completed sets appear here as slices.</span>}
          {s.slices.map((sl) => (
            <div key={sl.id} className="slice-chip">
              <div><b>#{sl.index}</b> {exerciseById(sl.exerciseId).name}</div>
              <div className="muted">{sl.reps} reps · {sl.durationS.toFixed(0)} s · {Math.round(sl.intensity * 100)}%</div>
              <MiniHeat values={sl.load} />
            </div>
          ))}
        </div>
      </main>

      <aside className="panel right">
        <div className="panel-title">Live EMG · {s.sourceKind === 'simulated' ? '100 Hz sim' : 'serial'}</div>
        <EmgScope engine={engine} />
        <div className="panel-title">{s.inSet ? 'Current set load' : 'Live activation'}</div>
        {s.inSet ? (
          <MuscleBars values={normalize(s.setLoad, 1)} selected={selected} onSelect={setSelected} flagged={flagged} />
        ) : (
          <MuscleBars values={s.live} selected={selected} onSelect={setSelected} flagged={flagged} />
        )}
        {selected && sel >= 0 && (
          <div className="muscle-info">
            <b>{muscleLabel(selected)}</b>
            <div className="mi-grid">
              <span>Live</span><b>{Math.round(s.live[sel] * 100)}% MVC</b>
              <span>Workout load</span><b>{s.workoutLoad[sel].toFixed(1)} a·s</b>
              <span>Fatigue (sim)</span><b>{Math.round(s.fatigue[sel] * 100)}%</b>
              <span>In this exercise</span><b>{Math.round((ex.profile[selected] ?? 0) * 100)}%</b>
            </div>
          </div>
        )}
        <div className="spacer" />
        <div className="workout-stats">
          <div><b>{s.slices.length}</b><span>sets</span></div>
          <div><b>{s.slices.reduce((a, x) => a + x.reps, 0) + s.reps}</b><span>reps</span></div>
          <div><b>{fmtTime(s.elapsedS)}</b><span>elapsed</span></div>
        </div>
        <button className="btn primary" disabled={!s.slices.length && !s.inSet} onClick={() => engine.finish()}>
          Finish workout (F)
        </button>
      </aside>
    </div>
  );
}
