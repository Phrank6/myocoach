import { toggleElectrodes, useElectrodes } from '../overlay';

export function ElectrodeToggle({ className }: { className?: string }) {
  const on = useElectrodes();
  return (
    <button
      className={`${className ?? ''} electrode-toggle ${on ? 'on' : ''}`.trim()}
      aria-pressed={on}
      title={on ? 'Hide electrode placement' : 'Show electrode placement (01–14, REF at C7)'}
      onClick={toggleElectrodes}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <rect x="4" y="1.5" width="8" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="5" r="1.7" fill="currentColor" />
        <circle cx="8" cy="11" r="1.7" fill="currentColor" />
      </svg>
      Electrodes
    </button>
  );
}
