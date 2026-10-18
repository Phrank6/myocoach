import { useSyncExternalStore } from 'react';
import { setHeatTheme } from './three/heat';

export type Theme = 'dark' | 'light';

const KEY = 'myocoach.theme';
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

// Eason's white design is the default; dark is opt-in.
let current: Theme = stored() ?? 'light';

function apply(t: Theme) {
  current = t;
  setHeatTheme(t);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#FFFFFF' : '#1a1817');
  listeners.forEach((l) => l());
}

apply(current);

export function getTheme(): Theme {
  return current;
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode: theme still applies for this page */
  }
  apply(t);
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
