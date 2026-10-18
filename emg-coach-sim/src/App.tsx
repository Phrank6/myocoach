import { useEffect, useState } from 'react';
import { DEFAULT_PROFILE, loadProfile, saveProfile, type BodyProfile } from './domain/profile';
import { WorkoutEngine, type WorkoutResult } from './engine/WorkoutEngine';
import { PhoneLink } from './phone/PhoneLink';
import { usePhone } from './ui/common';
import { ConnectPhone } from './ui/ConnectPhone';
import { Onboarding } from './ui/Onboarding';
import { SummaryView } from './ui/SummaryView';
import { WorkoutView } from './ui/WorkoutView';
import { ModelVest } from './vest/ModelVest';
import './styles/base.css';
import './App.css';

type Screen = 'onboarding' | 'workout' | 'summary';
const STEPS: [Screen, string][] = [
  ['onboarding', 'Body'],
  ['workout', 'Train'],
  ['summary', 'Review'],
];

export default function App() {
  const [engine] = useState(() => new WorkoutEngine());
  const [link] = useState(() => new PhoneLink(engine));
  const [vest] = useState(() => new ModelVest(engine));
  const [profile, setProfile] = useState<BodyProfile>(() => loadProfile() ?? DEFAULT_PROFILE);
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [result, setResult] = useState<WorkoutResult | null>(null);
  const [started, setStarted] = useState(false);
  const [showPair, setShowPair] = useState(false);
  const phone = usePhone(link);

  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __engine: engine, __link: link });
    engine.onFinish = (r) => {
      setResult(r);
      setScreen('summary');
    };
    link.start();
    vest.start();
    return () => {
      engine.stop();
      link.stop();
      vest.stop();
    };
  }, [engine, link, vest]);

  // The training engine on the server reads the same body profile (for /api/plan/today).
  useEffect(() => {
    void fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile) }).catch(() => {});
  }, [profile]);

  useEffect(() => {
    engine.input.enabled = screen === 'workout';
    link.screen = screen;
  }, [engine, link, screen]);

  useEffect(() => {
    if (phone.phones > 0) setShowPair(false);
  }, [phone.phones]);

  const startWorkout = (p: BodyProfile) => {
    saveProfile(p);
    setProfile(p);
    engine.resetWorkout();
    engine.setCoachLine(null, null);
    if (!started) {
      void engine.start();
      setStarted(true);
    }
    setScreen('workout');
  };

  const stepIndex = STEPS.findIndex(([s]) => s === screen);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="serif brand-name">MyoCoach</span>
          <span className="brand-sub">EMG simulation</span>
        </div>
        <nav className="steps">
          {STEPS.map(([s, label], i) => (
            <span key={s} className={`step ${i === stepIndex ? 'on' : i < stepIndex ? 'done' : ''}`}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span> {label}
            </span>
          ))}
        </nav>
        <div className="top-right">
          <a className="phone-chip" href="/you" target="_blank" rel="noreferrer">You &amp; today’s plan ↗</a>
          <button className={`phone-chip ${phone.phones ? 'on' : ''}`} onClick={() => setShowPair((v) => !v)}>
            <span className={`dot ${phone.phones ? 'ok' : ''}`} />
            {phone.phones ? 'Phone connected' : 'Connect phone'}
            <span className="mono faint">{phone.code}</span>
          </button>
          <span className="who">{profile.name || 'Athlete'}</span>
        </div>
      </header>
      {showPair && (
        <>
          <div className="scrim" onClick={() => setShowPair(false)} />
          <div className="popover">
            <ConnectPhone link={link} onClose={() => setShowPair(false)} />
          </div>
        </>
      )}
      <main className="screen" key={screen}>
        {screen === 'onboarding' && <Onboarding initial={profile} onDone={startWorkout} />}
        {screen === 'workout' && <WorkoutView engine={engine} link={link} profile={profile} onEditBody={() => setScreen('onboarding')} onPair={() => setShowPair(true)} />}
        {screen === 'summary' && result && (
          <SummaryView engine={engine} result={result} profile={profile} onNewWorkout={() => startWorkout(profile)} onEditBody={() => setScreen('onboarding')} />
        )}
      </main>
    </div>
  );
}
