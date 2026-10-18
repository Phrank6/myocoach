import { useSyncExternalStore } from 'react';

/** Electrode overlay visibility, shared by every body view in the tab. Off on each load. */
let shown = false;
const subs = new Set<() => void>();

export function getElectrodes(): boolean {
  return shown;
}

export function setElectrodes(v: boolean) {
  if (v === shown) return;
  shown = v;
  subs.forEach((f) => f());
}

export function toggleElectrodes() {
  setElectrodes(!shown);
}

export function useElectrodes(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getElectrodes,
    getElectrodes,
  );
}
