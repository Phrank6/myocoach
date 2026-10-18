import { useRef, useState } from 'react';
import { demoDays } from '../data/demo';
import { mergeDays, parseDays } from '../data/importer';
import { GOALS, PAIN_AREAS, type Profile } from '../data/profile';
import type { DataState } from '../data/store';
import { Field, Range, Seg, SourceTag } from './common';

const PAIN_LABEL: Record<string, string> = { low_back: 'Low back', knee: 'Knee', shoulder: 'Shoulder', neck: 'Neck', wrist: 'Wrist' };

export function You({ profile, setProfile, data, setData }: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  data: DataState;
  setData: (d: DataState) => void;
}) {
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile({ ...profile, [k]: v });
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const first = data.days[0]?.date;
  const last = data.days[data.days.length - 1]?.date;
  const hasGarment = data.days.some((d) => d.emgLower !== undefined || d.emgUpper !== undefined);
  const hasPhone = data.days.some((d) => d.sleepHours !== undefined || d.steps !== undefined);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { days, skipped } = parseDays(await f.text());
      if (!days.length) throw new Error('No rows with a date column were found.');
      setData({ days: mergeDays(data.demo ? [] : data.days, days), demo: false });
      setMsg(`Imported ${days.length} days from ${f.name}${skipped ? ` (${skipped} rows without a date skipped)` : ''}.`);
    } catch (e) {
      setMsg(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="you">
      <section className="card">
        <div className="eyebrow">About you</div>
        <label className="field text">
          <div className="field-head"><span>Name</span></div>
          <input value={profile.name} placeholder="Your name" onChange={(e) => set('name', e.target.value)} />
        </label>
        <div className="col-title">Goal</div>
        <div className="goals">
          {GOALS.map((g) => (
            <button key={g.id} className={`goal ${profile.goal === g.id ? 'on' : ''}`} onClick={() => set('goal', g.id)}>
              <b>{g.label}</b>
              <span className="faint">{g.blurb}</span>
            </button>
          ))}
        </div>
        {profile.goal === 'body_shape' && (
          <Seg label="Shape goal" value={profile.subgoal} onChange={(v) => set('subgoal', v)}
            options={[['lean_gain', 'Build muscle'], ['recomposition', 'Recomp'], ['lean_down', 'Lean down']]} small />
        )}
        <div className="form-grid">
          <Field label="Age" value={`${profile.age}`}><Range label="Age" value={profile.age} min={16} max={85} step={1} onChange={(v) => set('age', v)} /></Field>
          <Field label="Height" value={`${profile.heightCm} cm`}><Range label="Height" value={profile.heightCm} min={145} max={205} step={1} onChange={(v) => set('heightCm', v)} /></Field>
          <Field label="Weight" value={`${profile.weightKg} kg`}><Range label="Weight" value={profile.weightKg} min={40} max={150} step={1} onChange={(v) => set('weightKg', v)} /></Field>
          <Field label="Days per week" value={`${profile.daysPerWeek}`}><Range label="Days per week" value={profile.daysPerWeek} min={2} max={6} step={1} onChange={(v) => set('daysPerWeek', v)} /></Field>
          <Field label="Time per week" value={`${profile.minutesPerWeek} min`}><Range label="Time per week" value={profile.minutesPerWeek} min={60} max={480} step={15} onChange={(v) => set('minutesPerWeek', v)} /></Field>
        </div>
        <div className="seg-rows">
          <Seg label="Sex" value={profile.sex} onChange={(v) => set('sex', v)} options={[['female', 'Female'], ['male', 'Male']]} />
          <Seg label="Experience" value={profile.experience} onChange={(v) => set('experience', v)} options={[['new', 'New'], ['some', 'Some'], ['trained', 'Trained']]} />
          <Seg label="Equipment" value={profile.equipment} onChange={(v) => set('equipment', v)} options={[['none', 'None'], ['home', 'Home kit'], ['gym', 'Gym']]} />
        </div>
        <div className="col-title">Anything that hurts?</div>
        <div className="chips">
          {PAIN_AREAS.map((a) => {
            const on = profile.painAreas.includes(a);
            return (
              <button key={a} className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => set('painAreas', on ? profile.painAreas.filter((x) => x !== a) : [...profile.painAreas, a])}>
                {PAIN_LABEL[a]}
              </button>
            );
          })}
        </div>
        <p className="faint small">Exercises that load a painful area are left out of your plan.</p>
      </section>

      <section className="card">
        <div className="eyebrow">Your data</div>
        <div className="source-row">
          <SourceTag source="phone" />
          <span>{hasPhone ? 'Sleep, steps, sitting, phone use, walking speed' : 'No phone data yet'}</span>
        </div>
        <div className="source-row">
          <SourceTag source="clothes" />
          <span>{hasGarment ? 'Upper, lower and trunk muscle load, desk posture, fatigue' : 'No garment data yet'}</span>
        </div>
        <p className="muted small">
          {data.demo ? 'Showing 28 days of demo data for a desk worker. ' : ''}
          {first ? `${data.days.length} days, ${first} to ${last}.` : 'No days stored.'} Everything stays on this device.
        </p>
        <div className="btn-row">
          <button className="btn accent" onClick={() => file.current?.click()}>Import CSV or JSON</button>
          <button className="btn" onClick={() => { setData({ days: demoDays(), demo: true }); setMsg('Demo data loaded.'); }}>Load demo</button>
          <button className="btn" onClick={() => { setData({ days: [], demo: false }); setMsg('All days cleared.'); }}>Clear</button>
          <input ref={file} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {msg && <div className="note">{msg}</div>}
        <details className="fmt">
          <summary>File format</summary>
          <p className="faint small">One row per day with a <code>date</code> column, plus any of:</p>
          <code className="cols">sleep_hours, sleep_midpoint_h, steps, sitting_hours, longest_sitting_bout_min, phone_screen_hours, head_down_minutes, phone_after_23h_minutes, gait_speed_mps, emg_load_upper, emg_load_lower, emg_load_trunk, upper_trap_desk_tone, glute_to_hamstring_ratio, emg_fatigue_upper, emg_fatigue_lower, soreness, pain</code>
          <p className="faint small">Phone and garment exports can be separate files: rows with the same date are merged.</p>
        </details>
      </section>

      <section className="card">
        <div className="eyebrow">Use it on your phone</div>
        <p className="muted small">Open this page on your phone and choose <b>Add to Home Screen</b> (Safari share menu, or the Chrome menu). It opens full screen and works offline.</p>
      </section>
    </div>
  );
}
