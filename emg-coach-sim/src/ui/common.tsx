import { useSyncExternalStore } from 'react';
import { MUSCLE_IDS, muscleShort, type MuscleId } from '../domain/muscles';
import type { WorkoutEngine } from '../engine/WorkoutEngine';
import { HEAT_GRADIENT_CSS, heatCss } from '../three/heat';

export function useEngine(engine: WorkoutEngine) {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export function MuscleBars({ values, scaleMax = 1, selected, onSelect, unit = '%', flagged }: {
  values: number[];
  scaleMax?: number;
  selected?: MuscleId | null;
  onSelect?: (m: MuscleId) => void;
  unit?: '%' | 's';
  flagged?: Partial<Record<MuscleId, 'elevated' | 'high'>>;
}) {
  return (
    <div className="bars">
      {MUSCLE_IDS.map((m, i) => {
        const v = values[i] / Math.max(1e-6, scaleMax);
        const f = flagged?.[m];
        return (
          <button key={m} className={`bar-row ${selected === m ? 'sel' : ''}`} onClick={() => onSelect?.(m)}>
            <span className="bar-label">
              {f && <i className={`dot ${f}`} />}
              {muscleShort(m)}
            </span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.min(100, v * 100)}%`, background: heatCss(v) }} />
            </span>
            <span className="bar-val">{unit === '%' ? `${Math.round(values[i] * 100)}%` : `${values[i].toFixed(0)}`}</span>
          </button>
        );
      })}
    </div>
  );
}

export function HeatLegend({ left = 'rest', right = 'max' }: { left?: string; right?: string }) {
  return (
    <div className="legend">
      <span>{left}</span>
      <div className="legend-bar" style={{ background: HEAT_GRADIENT_CSS }} />
      <span>{right}</span>
    </div>
  );
}

export function MiniHeat({ values }: { values: number[] }) {
  const max = Math.max(1e-6, ...values);
  return (
    <div className="mini-heat">
      {values.map((v, i) => (
        <span key={i} style={{ background: heatCss(v / max) }} title={`${muscleShort(MUSCLE_IDS[i])}: ${v.toFixed(1)}`} />
      ))}
    </div>
  );
}
