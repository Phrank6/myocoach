import { useEffect, useState } from 'react';
import { DEFAULT_PROFILE, loadProfile, saveProfile, type BodyProfile } from './domain/profile';
import { WorkoutEngine, type WorkoutResult } from './engine/WorkoutEngine';
import { PhoneLink } from './phone/PhoneLink';
import { useTheme } from './theme';
import { usePhone } from './ui/common';
import { ConnectPhone } from './ui/ConnectPhone';
import { Onboarding } from './ui/Onboarding';
import { SummaryView } from './ui/SummaryView';
import { ThemeToggle } from './ui/ThemeToggle';
import { WorkoutView } from './ui/WorkoutView';
import './styles/tokens.css';
import './App.css';

type Screen = 'onboarding' | 'workout' | 'summary';

export default function App() {
  useTheme();
  const [engine] = useState(() => new WorkoutEngine());
  const [link] = useState(() => new PhoneLink(engine));
  const phone = usePhone(link);
  const [profile, setProfile] = useState<BodyProfile>(() => loadProfile() ?? DEFAULT_PROFILE);
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [result, setResult] = useState<WorkoutResult | null>(null);
  const [started, setStarted] = useState(false);
  const [showPair, setShowPair] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __engine: engine, __link: link });
    engine.onFinish = (r) => {
      setResult(r);
      setScreen('summary');
    };
    link.start();
    return () => {
      engine.stop();
      link.stop();
    };
  }, [engine, link]);

  useEffect(() => {
    engine.input.enabled = screen === 'workout';
    link.screen = screen;
  }, [engine, link, screen]);

  const phones = phone.phones;
  useEffect(() => {
    if (phones > 0) setShowPair(false);
  }, [phones]);

  const startWorkout = (p: BodyProfile) => {
    saveProfile(p);
    setProfile(p);
    engine.setExperience(p.experience);
    engine.resetWorkout();
    engine.setCoachLine(null, null);
    if (!started) {
      void engine.start();
      setStarted(true);
    }
    setScreen('workout');
  };

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">
          <span className="logo">◢◤</span> MyoCoach <span className="sim-badge">EMG · simulation</span>
        </div>
        <div className="steps">
          <span className={screen === 'onboarding' ? 'on' : ''}>1 · Body model</span>
          <span className={screen === 'workout' ? 'on' : ''}>2 · Train</span>
          <span className={screen === 'summary' ? 'on' : ''}>3 · Summary & coach</span>
        </div>
        <div className="top-right">
          <div className="who">{profile.name || 'Athlete'} · {profile.heightCm} cm · {profile.weightKg} kg</div>
          <button className={`phone-chip ${phone.phones ? 'on' : ''}`} onClick={() => setShowPair((v) => !v)}>
            <span className={`dot ${phone.phones ? 'ok' : ''}`} />
            {phone.phones ? 'Phone connected' : 'Connect phone'}
            <span className="mono faint">{phone.code}</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>
      {showPair && (
        <>
          <div className="scrim" onClick={() => setShowPair(false)} />
          <div className="popover">
            <ConnectPhone link={link} onClose={() => setShowPair(false)} />
          </div>
        </>
      )}
      {screen === 'onboarding' && <Onboarding initial={profile} onDone={startWorkout} />}
      {screen === 'workout' && <WorkoutView engine={engine} link={link} profile={profile} onEditBody={() => setScreen('onboarding')} onPair={() => setShowPair(true)} />}
      {screen === 'summary' && result && (
        <SummaryView
          result={result}
          profile={profile}
          onCoach={(line, source) => engine.setCoachLine(line, source)}
          onEndWorkout={() => { setResult(null); setScreen('onboarding'); }}
          onEditBody={() => setScreen('onboarding')}
        />
      )}
    </div>
  );
}
