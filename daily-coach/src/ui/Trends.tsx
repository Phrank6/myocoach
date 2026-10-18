import { useState } from 'react';
import { SIGNALS, type DayRecord, type Source } from '../data/types';
import { Bars, fmtValue, Seg, shortDate, SourceTag } from './common';

const GROUPS: [Source, string, string][] = [
  ['phone', 'From your phone', 'Sleep, steps, sitting and phone habits, estimated from motion and screen use.'],
  ['clothes', 'From your clothes', 'All-day muscle load and posture from the EMG garment.'],
  ['check-in', 'From your check-ins', 'How you said you felt each morning.'],
];

export function Trends({ days }: { days: DayRecord[] }) {
  const [range, setRange] = useState<'14' | '28'>('14');
  const shown = days.slice(-Number(range));
  const labels = shown.map((d) => shortDate(d.date));

  return (
    <div className="trends">
      <header className="trends-head">
        <div>
          <div className="eyebrow">Trends</div>
          <h1 className="serif display small-display">How your days add up</h1>
        </div>
        <Seg label="Range" value={range} onChange={setRange} options={[['14', '14 days'], ['28', '28 days']]} small />
      </header>
      {GROUPS.map(([src, title, blurb]) => (
        <section key={src} className="trend-group">
          <div className="group-head">
            <h3>{title}</h3>
            <span className="faint small">{blurb}</span>
          </div>
          <div className="trend-grid">
            {SIGNALS.filter((s) => s.source === src).map((s) => {
              const vals = shown.map((d) => d[s.key]);
              const nums = vals.filter((v): v is number => v !== undefined);
              const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
              const missing = vals.length - nums.length;
              return (
                <div key={s.key} className="card trend">
                  <div className="row-between">
                    <span className="trend-title">{s.label}</span>
                    <SourceTag source={s.source} />
                  </div>
                  <div className="trend-stats">
                    <span><b className="mono">{fmtValue(mean, s.digits, s.unit)}</b> <span className="faint">avg</span></span>
                    {s.target && <span className="faint">target {s.target.good === 'above' ? '≥' : '≤'} {s.target.label}</span>}
                    {missing > 0 && <span className="faint">{missing} {missing === 1 ? 'day' : 'days'} missing</span>}
                  </div>
                  <Bars values={vals} labels={labels} target={s.target?.value} good={s.target?.good} digits={s.digits} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
