import { useMemo, type CSSProperties } from 'react';
import { baseline, FLAG_TEXT, habits, model, readiness, todayPlan, type PlanItem } from '../coach/coach';
import { isoDay } from '../data/demo';
import type { Profile } from '../data/profile';
import { SIGNALS, type DayRecord, type SignalKey } from '../data/types';
import { fmtValue, SourceTag, Spark } from './common';

const TILES: SignalKey[] = ['sleepHours', 'steps', 'sittingHours', 'headDownMin', 'phoneAfter23Min', 'gaitSpeed', 'emgLower', 'gluteHamRatio', 'upperTrapTone'];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Item({ p, index }: { p: PlanItem; index: number }) {
  return (
    <li className="plan-item">
      <span className="mono faint">{String(index + 1).padStart(2, '0')}</span>
      <div className="plan-main">
        <b>{p.item.name}</b>
        <span className="faint">{p.why}</span>
        {p.item.cue && <span className="cue">{p.item.cue}</span>}
      </div>
      <div className="plan-side">
        <span className="mono plan-dose">{p.dose}</span>
        <span className="fit" title="How well the trained model thinks this fits you">{Math.round(p.fit * 100)}% fit</span>
      </div>
    </li>
  );
}

export function Today({ profile, days, onCheckIn, onOpenTrends }: {
  profile: Profile;
  days: DayRecord[];
  onCheckIn: (patch: Partial<DayRecord>) => void;
  onOpenTrends: () => void;
}) {
  const todayIso = isoDay(new Date());
  const today = days.find((d) => d.date === todayIso);
  const b = useMemo(() => baseline(days), [days]);
  const r = useMemo(() => readiness(today ?? days[days.length - 1]), [today, days]);
  const plan = useMemo(() => todayPlan(profile, b, r), [profile, b, r]);
  const tips = useMemo(() => habits(b, profile), [b, profile]);
  const last14 = days.slice(-14);
  const m = model.info.testMetrics;

  return (
    <div className="today">
      <section className="col">
        <header className="hello">
          <div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="serif display">{greeting()}{profile.name ? `, ${profile.name}` : ''}.</h1>
        </header>

        <div className={`card ready ${r.zone}`}>
          <div className="ready-ring" style={{ '--v': r.score } as CSSProperties}>
            <span className="mono">{r.score}</span>
          </div>
          <div>
            <div className="eyebrow">Readiness</div>
            <h2 className="serif">{r.zone === 'green' ? 'Good to train' : r.zone === 'amber' ? 'Train, but go lighter' : 'Recover today'}</h2>
            <p className="muted small">{r.reasons.length ? r.reasons.join(' · ') : 'Nothing unusual in last night’s sleep or your clothing data.'}</p>
          </div>
        </div>

        <div className="card checkin">
          <div className="row-between">
            <span className="eyebrow">Morning check-in</span>
            <span className="faint small">{today?.soreness !== undefined ? 'saved' : 'how do you feel?'}</span>
          </div>
          <div className="checkin-row">
            <span>Soreness</span>
            <div className="dots" role="radiogroup" aria-label="Soreness 0 to 10">
              {Array.from({ length: 11 }, (_, i) => (
                <button key={i} role="radio" aria-checked={today?.soreness === i} className={today?.soreness === i ? 'on' : ''} onClick={() => onCheckIn({ soreness: i })}>{i}</button>
              ))}
            </div>
          </div>
          <div className="checkin-row">
            <span>Pain</span>
            <div className="dots" role="radiogroup" aria-label="Pain 0 to 10">
              {Array.from({ length: 11 }, (_, i) => (
                <button key={i} role="radio" aria-checked={(today?.pain ?? -1) === i} className={`${(today?.pain ?? -1) === i ? 'on' : ''} ${i >= 4 ? 'warnish' : ''}`} onClick={() => onCheckIn({ pain: i })}>{i}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="card plan">
          <div className="row-between plan-head">
            <div>
              <div className="eyebrow">Train today</div>
              <h2 className="serif">{plan.title}</h2>
            </div>
            <span className="tag accent">~{plan.minutes} min</span>
          </div>
          {plan.changes.length > 0 && <div className="note">{plan.changes.join(' · ')}</div>}
          {plan.main.length > 0 && <ol className="plan-list">{plan.main.map((p, i) => <Item key={p.item.id} p={p} index={i} />)}</ol>}
          {plan.cardio && (
            <>
              <div className="col-title">Cardio</div>
              <ol className="plan-list"><Item p={plan.cardio} index={plan.main.length} /></ol>
            </>
          )}
          {plan.correctives.length > 0 && (
            <>
              <div className="col-title">Desk reset · from your phone and clothing data</div>
              <ol className="plan-list">{plan.correctives.map((p, i) => <Item key={p.item.id} p={p} index={plan.main.length + (plan.cardio ? 1 : 0) + i} />)}</ol>
            </>
          )}
          <p className="disclaimer faint">
            Picked by a model trained on {model.info.rows.toLocaleString()} person-blocks (synthetic). It beat a most-popular baseline on unseen people
            (NDCG@10 {m.model['ndcg@10'].toFixed(2)} vs {m.popularity_baseline['ndcg@10'].toFixed(2)}). Equipment, level and pain rules are applied on top. Training guidance only, not medical advice.
          </p>
        </div>
      </section>

      <section className="col">
        <div className="card">
          <div className="row-between">
            <span className="eyebrow">Your signals · last 14 days</span>
            <button className="link" onClick={onOpenTrends}>all trends</button>
          </div>
          <div className="tiles">
            {TILES.map((k) => {
              const s = SIGNALS.find((x) => x.key === k)!;
              const vals = last14.map((d) => d[k]);
              const latest = [...vals].reverse().find((v) => v !== undefined);
              const off = s.target && latest !== undefined && (s.target.good === 'above' ? latest < s.target.value : latest > s.target.value);
              return (
                <div key={k} className={`tile ${off ? 'off' : ''}`}>
                  <div className="tile-head"><span>{s.short}</span><SourceTag source={s.source} /></div>
                  <b className="mono tile-val">{fmtValue(latest, s.digits, s.unit)}</b>
                  <Spark values={vals} target={s.target?.value} />
                </div>
              );
            })}
          </div>
        </div>

        {b.flags.length > 0 && (
          <div className="card">
            <div className="eyebrow">What the coach noticed · 4-week average</div>
            <div className="flags">
              {b.flags.map((f) => <span key={f} className="tag elevated">{FLAG_TEXT[f]}</span>)}
            </div>
          </div>
        )}

        {tips.length > 0 && (
          <div className="card">
            <div className="eyebrow">Habits for this month</div>
            <ul className="habits">{tips.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        )}
      </section>
    </div>
  );
}
