import { useEffect, useState } from 'react';
import { DEFAULT_PROFILE, loadProfile, saveProfile, type BodyProfile } from './domain/profile';
import { WorkoutEngine, type WorkoutResult } from './engine/WorkoutEngine';
import { Onboarding } from './ui/Onboarding';
import { SummaryView } from './ui/SummaryView';
import { WorkoutView } from './ui/WorkoutView';
import './App.css';

type Screen = 'onboarding' | 'workout' | 'summary';

export default function App() {
  const [engine] = useState(() => new WorkoutEngine());
  const [profile, setProfile] = useState<BodyProfile>(() => loadProfile() ?? DEFAULT_PROFILE);
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [result, setResult] = useState<WorkoutResult | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __engine: WorkoutEngine }).__engine = engine;
    engine.onFinish = (r) => {
      setResult(r);
      setScreen('summary');
    };
    return () => engine.stop();
  }, [engine]);

  useEffect(() => {
    engine.input.enabled = screen === 'workout';
  }, [engine, screen]);

  const startWorkout = (p: BodyProfile) => {
    saveProfile(p);
    setProfile(p);
    engine.resetWorkout();
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
        <div className="who">{profile.name || 'Athlete'} · {profile.heightCm} cm · {profile.weightKg} kg</div>
      </nav>
      {screen === 'onboarding' && <Onboarding initial={profile} onDone={startWorkout} />}
      {screen === 'workout' && <WorkoutView engine={engine} profile={profile} onEditBody={() => setScreen('onboarding')} />}
      {screen === 'summary' && result && (
        <SummaryView result={result} profile={profile} onNewWorkout={() => startWorkout(profile)} onEditBody={() => setScreen('onboarding')} />
      )}
    </div>
  );
}
