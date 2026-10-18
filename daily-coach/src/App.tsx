import { useState } from 'react';
import { isoDay } from './data/demo';
import { mergeDays } from './data/importer';
import { hasStoredProfile, useData, useProfile } from './data/store';
import type { DayRecord } from './data/types';
import { Today } from './ui/Today';
import { Trends } from './ui/Trends';
import { You } from './ui/You';
import './styles/base.css';
import './App.css';

type Tab = 'today' | 'trends' | 'you';
const TABS: [Tab, string, string][] = [
  ['today', 'Today', 'M4 12h4l2-5 4 10 2-5h4'],
  ['trends', 'Trends', 'M5 19V11M10 19V6M15 19v-9M20 19V4'],
  ['you', 'You', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0'],
];

export default function App() {
  const [profile, setProfile] = useProfile();
  const [data, setData] = useData();
  const [tab, setTab] = useState<Tab>(() => (hasStoredProfile() ? 'today' : 'you'));
  const latest = data.days[data.days.length - 1]?.date;

  const checkIn = (patch: Partial<DayRecord>) =>
    setData({ ...data, days: mergeDays(data.days, [{ date: isoDay(new Date()), ...patch }]) });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="serif brand-name">MyoCoach</span>
          <span className="brand-sub">Daily</span>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([t, label]) => (
            <button key={t} className={`tab ${tab === t ? 'on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{label}</button>
          ))}
        </nav>
        <div className="sync faint">
          <span className={`dot ${data.demo ? 'warn' : data.days.length ? 'ok' : ''}`} />
          {data.demo ? 'Demo data' : latest ? `Synced to ${latest.slice(5)}` : 'No data'}
        </div>
      </header>

      <main className="screen" key={tab}>
        {data.days.length === 0 && tab !== 'you' ? (
          <div className="empty card">
            <h2 className="serif">No days yet</h2>
            <p className="muted">Import your phone and garment exports, or load the demo, from the You tab.</p>
            <button className="btn accent" onClick={() => setTab('you')}>Go to You</button>
          </div>
        ) : tab === 'today' ? (
          <Today profile={profile} days={data.days} onCheckIn={checkIn} onOpenTrends={() => setTab('trends')} />
        ) : tab === 'trends' ? (
          <Trends days={data.days} />
        ) : (
          <You profile={profile} setProfile={setProfile} data={data} setData={setData} />
        )}
        {tab === 'you' && (
          <div className="you-cta">
            <button className="btn accent lg block" onClick={() => setTab('today')}>See today’s plan <span aria-hidden>→</span></button>
          </div>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Sections">
        {TABS.map(([t, label, d]) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            <svg viewBox="0 0 24 24" aria-hidden><path d={d} /></svg>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
