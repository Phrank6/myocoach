/** Messages exchanged over /ws/session between the desktop host and phone companions. */

export interface HostState {
  type: 'state';
  exerciseIndex: number;
  inSet: boolean;
  reps: number;
  setNo: number;
  totalReps: number;
  intensity: number;
  sessionIndex: number;
  externalLoadLb: number;
  restS: number;
  effort: number;
  live: number[];
  alerts: { level: 'elevated' | 'high'; title: string }[];
  coachLine: string | null;
  coachSource: string | null;
  screen: 'onboarding' | 'workout' | 'summary';
}

export type PhoneMsg =
  | { type: 'hello'; device: string }
  | { type: 'rep' }
  | { type: 'effort'; value: number }
  | { type: 'endSet' }
  | { type: 'selectExercise'; index: number }
  | { type: 'intensity'; value: number }
  | { type: 'load'; value: number };

export type ServerMsg = { type: 'presence'; phones: number } | { type: 'hostStatus'; online: boolean };

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newSessionCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function wsUrl(code: string, role: 'host' | 'phone'): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/session?code=${encodeURIComponent(code)}&role=${role}`;
}
