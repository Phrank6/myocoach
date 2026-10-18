import type { CSSProperties, ReactNode } from 'react';
import type { Source } from '../data/types';

export function Range({ value, min, max, step, onChange, label }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input aria-label={label} className="range" type="range" min={min} max={max} step={step} value={value}
      style={{ '--p': `${p}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
  );
}

export function Seg<T extends string>({ value, options, onChange, label, small }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`seg ${small ? 'small' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <label className="field">
      <div className="field-head">
        <span>{label}</span>
        {value && <b className="mono">{value}</b>}
      </div>
      {children}
    </label>
  );
}

const SOURCE_LABEL: Record<Source, string> = { phone: 'Phone', clothes: 'Clothes', 'check-in': 'Check-in' };
export function SourceTag({ source }: { source: Source }) {
  return <span className={`src src-${source}`}><i />{SOURCE_LABEL[source]}</span>;
}

/** Tiny trend line; gaps (missing days) break the line. */
export function Spark({ values, target }: { values: (number | undefined)[]; target?: number }) {
  const nums = values.filter((v): v is number => v !== undefined);
  if (nums.length < 2) return <svg className="spark" viewBox="0 0 100 28" aria-hidden />;
  const lo = Math.min(...nums, target ?? Infinity);
  const hi = Math.max(...nums, target ?? -Infinity);
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * 100;
  const y = (v: number) => 25 - ((v - lo) / Math.max(1e-9, hi - lo)) * 22;
  const segs: string[] = [];
  let cur = '';
  values.forEach((v, i) => {
    if (v === undefined) { if (cur) segs.push(cur); cur = ''; return; }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const last = [...values].reverse().findIndex((v) => v !== undefined);
  const li = values.length - 1 - last;
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
      {target !== undefined && <line x1="0" x2="100" y1={y(target)} y2={y(target)} className="spark-target" />}
      {segs.map((d) => <path key={d} d={d} className="spark-line" vectorEffect="non-scaling-stroke" />)}
      {last >= 0 && <circle cx={x(li)} cy={y(values[li]!)} r="1.8" className="spark-dot" />}
    </svg>
  );
}

/** Daily bars with an optional target line; days on the wrong side of the target are highlighted. */
export function Bars({ values, labels, target, good, digits }: {
  values: (number | undefined)[];
  labels: string[];
  target?: number;
  good?: 'above' | 'below';
  digits: number;
}) {
  const nums = values.filter((v): v is number => v !== undefined);
  const hi = Math.max(...nums, target ?? 0) * 1.08 || 1;
  const w = 100 / values.length;
  const fmt = (v: number) => v.toFixed(digits);
  return (
    <div className="bars-wrap">
      <svg className="bars" viewBox="0 0 100 60" preserveAspectRatio="none" role="img"
        aria-label={`Daily values, latest ${nums.length ? fmt(nums[nums.length - 1]) : 'missing'}`}>
        {values.map((v, i) => {
          if (v === undefined) return <rect key={i} x={i * w + w * 0.2} y={57} width={w * 0.6} height={1.5} className="bar-missing" />;
          const h = (v / hi) * 58;
          const off = target !== undefined && good && (good === 'above' ? v < target : v > target);
          return (
            <rect key={i} x={i * w + w * 0.18} y={60 - h} width={w * 0.64} height={h} rx={0.6} className={off ? 'bar off' : 'bar'}>
              <title>{`${labels[i]}: ${fmt(v)}`}</title>
            </rect>
          );
        })}
        {target !== undefined && <line x1="0" x2="100" y1={60 - (target / hi) * 58} y2={60 - (target / hi) * 58} className="bars-target" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="bars-axis faint mono"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
    </div>
  );
}

export const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const fmtValue = (v: number | undefined, digits: number, unit = '') =>
  v === undefined ? '—' : `${digits === 0 ? Math.round(v).toLocaleString() : v.toFixed(digits)}${unit && unit !== '/10' ? ` ${unit}` : unit}`;
