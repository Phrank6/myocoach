import type { MuscleId } from './muscles';

/**
 * Electrode regions as numbered on the vest placement reference (01–14, bilateral, REF at C7).
 * Each region reads from one of the app's 14 simulated channels; the mapping is not 1:1 (see README).
 */
export interface ElectrodeRegion {
  no: string;
  name: string;
  /** Fits the phone legend. */
  short?: string;
  channel: MuscleId;
  view: 'front' | 'back' | 'both';
}

export const ELECTRODES: ElectrodeRegion[] = [
  { no: '01', name: 'Anterior deltoid', channel: 'delt_front', view: 'front' },
  { no: '02', name: 'Middle deltoid', channel: 'delt_side', view: 'both' },
  { no: '03', name: 'Posterior deltoid', channel: 'delt_rear', view: 'back' },
  { no: '04', name: 'Biceps brachii', channel: 'biceps', view: 'front' },
  { no: '05', name: 'Triceps brachii (long head)', short: 'Triceps long head', channel: 'triceps', view: 'back' },
  { no: '06', name: 'Pectoralis major (clavicular)', short: 'Pec major, clavicular', channel: 'pecs', view: 'front' },
  { no: '07', name: 'Upper trapezius', channel: 'traps', view: 'back' },
  { no: '08', name: 'Middle trapezius', channel: 'traps', view: 'back' },
  { no: '09', name: 'Lower trapezius', channel: 'traps', view: 'back' },
  { no: '10', name: 'Latissimus dorsi', channel: 'lats', view: 'back' },
  { no: '11', name: 'Serratus anterior', channel: 'serratus', view: 'front' },
  { no: '12', name: 'Rectus abdominis', channel: 'abs', view: 'front' },
  { no: '13', name: 'External oblique', channel: 'obliques', view: 'front' },
  { no: '14', name: 'Lumbar erector spinae', short: 'Lumbar erectors', channel: 'erectors', view: 'back' },
];

/** App channels with no electrode on the reference vest. */
export const UNPLACED_CHANNELS: MuscleId[] = ['forearms', 'rhomboids'];
