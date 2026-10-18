import { useMemo, useState } from 'react';
import { MUSCLE_IDS } from '../domain/muscles';
import { NEUTRAL_POSE } from '../domain/exercises';
import { bodyDims, type BodyProfile } from '../domain/profile';
import { BodyCanvas } from '../three/BodyCanvas';

function Slider({ label, value, min, max, step, fmt, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <b>{fmt(value)}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Onboarding({ initial, onDone }: { initial: BodyProfile; onDone: (p: BodyProfile) => void }) {
  const [p, setP] = useState<BodyProfile>(initial);
  const set = <K extends keyof BodyProfile>(k: K, v: BodyProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const d = bodyDims(p);
  const bmi = p.weightKg / (p.heightCm / 100) ** 2;
  const armSpan = Math.round(p.heightCm * p.armScale);
  // idle "breathing" preview so the scaled model is readable
  const getValues = useMemo(() => {
    const t0 = performance.now();
    return () => MUSCLE_IDS.map((_, i) => 0.18 + 0.12 * Math.sin((performance.now() - t0) / 700 + i * 0.7));
  }, []);

  return (
    <div className="onboarding">
      <section className="ob-form panel">
        <div className="eyebrow">Step 1 of 2 · Body model</div>
        <h1>Build your body model</h1>
        <p className="muted">EMG activation maps onto a personal 3D upper body. These numbers scale limb lengths, frame width and muscle size so heatmaps line up with you.</p>
        <label className="text">
          <span>Name (optional)</span>
          <input value={p.name} placeholder="Athlete" onChange={(e) => set('name', e.target.value)} />
        </label>
        <Slider label="Height" value={p.heightCm} min={145} max={205} step={1} fmt={(v) => `${v} cm`} onChange={(v) => set('heightCm', v)} />
        <Slider label="Weight" value={p.weightKg} min={40} max={140} step={1} fmt={(v) => `${v} kg`} onChange={(v) => set('weightKg', v)} />
        <Slider label="Arm length" value={p.armScale} min={0.9} max={1.1} step={0.01} fmt={(v) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}% · span ≈ ${Math.round(p.heightCm * v)} cm`} onChange={(v) => set('armScale', v)} />
        <Slider label="Build" value={p.build} min={0} max={1} step={0.05} fmt={(v) => (v < 0.3 ? 'Slim' : v < 0.7 ? 'Athletic' : 'Muscular')} onChange={(v) => set('build', v)} />
        <div className="seg">
          {(['beginner', 'intermediate', 'advanced'] as const).map((e) => (
            <button key={e} className={p.experience === e ? 'on' : ''} onClick={() => set('experience', e)}>
              {e}
            </button>
          ))}
        </div>
        <p className="muted">Experience changes fatigue in this demo simulator only; it is not a measured estimate of your muscle tolerance.</p>
        <div className="ob-stats">
          <div><b>{bmi.toFixed(1)}</b><span>BMI</span></div>
          <div><b>{armSpan}</b><span>arm span cm</span></div>
          <div><b>×{d.width.toFixed(2)}</b><span>frame width</span></div>
          <div><b>×{d.muscle.toFixed(2)}</b><span>muscle size</span></div>
        </div>
        <button className="btn primary big" onClick={() => onDone(p)}>
          Start training →
        </button>
      </section>
      <section className="ob-preview">
        <BodyCanvas profile={p} getValues={getValues} getPose={() => NEUTRAL_POSE} autoRotate valueLabel="preview" />
      </section>
    </div>
  );
}
