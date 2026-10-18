import { useEffect, useState } from 'react';
import { demoDays } from './demo';
import { DEFAULT_PROFILE, type Profile } from './profile';
import type { DayRecord } from './types';

// Everything stays on this device. Storage can be unavailable (private mode), so every access is guarded.
const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* not persisted; the app still works for this visit */
  }
};

export interface DataState {
  days: DayRecord[];
  demo: boolean;
}

export function useStored<T>(key: string, init: () => T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => read<T>(key) ?? init());
  useEffect(() => write(key, v), [key, v]);
  return [v, setV];
}

export const useProfile = () =>
  useStored<Profile>('myocoach.daily.profile.v1', () => DEFAULT_PROFILE);

export const useData = () =>
  useStored<DataState>('myocoach.daily.data.v1', () => ({ days: demoDays(), demo: true }));

export const hasStoredProfile = () => read('myocoach.daily.profile.v1') !== null;
