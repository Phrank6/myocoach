import { useMemo, useState, type ReactNode } from 'react';
import { NEUTRAL_POSE } from '../domain/exercises';
import { MUSCLE_IDS } from '../domain/muscles';
import { bodyDims, type BodyProfile } from '../domain/profile';
import { BodyCanvas } from '../three/BodyCanvas';
import { Range } from './common';

function Field({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <label className="field">
      <div className="field-head">
        <span>{label}</span>
        <b className="mono">{value}</b>
      </div>
      {children}
    </label>
  );
}

export function Onboarding({ initial, onDone }: { initial: BodyProfile; onDone: (p: BodyProfile) => void }) {
  const [p, setP] = useState<BodyProfile>(initial);
  const set = <K extends keyof BodyProfile>(k: K, v: BodyProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const d = bodyDims(p);
  const bmi = p.weightKg / (p.heightCm / 100) ** 2;
  const getValues = useMemo(() => {
    const t0 = performance.now();
    return () => MUSCLE_IDS.map((_, i) => 0.22 + 0.16 * Math.sin((performance.now() - t0) / 900 + i * 0.8));
  }, []);

  return (
    <div className="onboarding">
      <section className="ob-form">
        <div className="eyebrow">Step one · Body model</div>
        <h1 className="serif display">
          Map the body
          <br />
          <em>you train.</em>
        </h1>
        <p className="muted lede">Muscle activation is drawn onto a model scaled to you — limb length, frame and build — so the heatmap lines up with what you feel.</p>

        <label className="field text">
          <div className="field-head"><span>Name</span></div>
          <input value={p.name} placeholder="Athlete" onChange={(e) => set('name', e.target.value)} />
        </label>
        <Field label="Height" value={`${p.heightCm} cm`}>
          <Range label="Height" value={p.heightCm} min={145} max={205} step={1} onChange={(v) => set('heightCm', v)} />
        </Field>
        <Field label="Weight" value={`${p.weightKg} kg`}>
          <Range label="Weight" value={p.weightKg} min={40} max={140} step={1} onChange={(v) => set('weightKg', v)} />
        </Field>
        <Field label="Arm length" value={`${p.armScale >= 1 ? '+' : '−'}${Math.abs(Math.round((p.armScale - 1) * 100))}%`}>
          <Range label="Arm length" value={p.armScale} min={0.9} max={1.1} step={0.01} onChange={(v) => set('armScale', v)} />
        </Field>
        <Field label="Build" value={p.build < 0.3 ? 'Slim' : p.build < 0.7 ? 'Athletic' : 'Muscular'}>
          <Range label="Build" value={p.build} min={0} max={1} step={0.05} onChange={(v) => set('build', v)} />
        </Field>
        <div className="seg" role="radiogroup" aria-label="Experience">
          {(['beginner', 'intermediate', 'advanced'] as const).map((e) => (
            <button key={e} role="radio" aria-checked={p.experience === e} className={p.experience === e ? 'on' : ''} onClick={() => set('experience', e)}>
              {e}
            </button>
          ))}
        </div>
        <div className="facts faint">
          <span>BMI <b className="mono">{bmi.toFixed(1)}</b></span>
          <span>Span <b className="mono">{Math.round(p.heightCm * p.armScale)} cm</b></span>
          <span>Frame <b className="mono">×{d.width.toFixed(2)}</b></span>
          <span>Muscle <b className="mono">×{d.muscle.toFixed(2)}</b></span>
        </div>
        <button className="btn accent lg block" onClick={() => onDone(p)}>
          Start training <span aria-hidden>→</span>
        </button>
      </section>
      <section className="ob-hero stage-surface">
        <BodyCanvas profile={p} getValues={getValues} getPose={() => NEUTRAL_POSE} autoRotate valueLabel="preview" />
        <div className="ob-caption faint">
          <span className="mono">{p.heightCm} cm · {p.weightKg} kg</span>
        </div>
      </section>
    </div>
  );
}
