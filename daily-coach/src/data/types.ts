/** One day of signals. Every field is optional: a phone or garment that missed a day leaves it out. */
export interface DayRecord {
  date: string; // YYYY-MM-DD
  // phone
  sleepHours?: number;
  sleepMidpointH?: number; // hours after midnight, e.g. 3.5 = 03:30
  steps?: number;
  sittingHours?: number;
  longestSitMin?: number;
  screenHours?: number;
  headDownMin?: number;
  phoneAfter23Min?: number;
  gaitSpeed?: number; // m/s
  // EMG clothing (0-1 = share of a reference effort, averaged over the day)
  emgUpper?: number;
  emgLower?: number;
  emgTrunk?: number;
  upperTrapTone?: number; // %MVC while sitting at a desk
  gluteHamRatio?: number; // glute vs hamstring activation while walking
  emgFatigueUpper?: number; // 0-1
  emgFatigueLower?: number; // 0-1
  // morning check-in
  soreness?: number; // 0-10
  pain?: number; // 0-10
}

export type SignalKey = Exclude<keyof DayRecord, 'date'>;
export type Source = 'phone' | 'clothes' | 'check-in';

export interface SignalInfo {
  key: SignalKey;
  label: string;
  short: string;
  unit: string;
  source: Source;
  digits: number;
  /** Reference line on the trend chart and the side that counts as "watch this". */
  target?: { value: number; good: 'above' | 'below'; label: string };
}

export const SIGNALS: SignalInfo[] = [
  { key: 'sleepHours', label: 'Sleep', short: 'Sleep', unit: 'h', source: 'phone', digits: 1, target: { value: 7, good: 'above', label: '7 h' } },
  { key: 'steps', label: 'Steps', short: 'Steps', unit: '', source: 'phone', digits: 0, target: { value: 8000, good: 'above', label: '8k' } },
  { key: 'sittingHours', label: 'Sitting', short: 'Sitting', unit: 'h', source: 'phone', digits: 1, target: { value: 8, good: 'below', label: '8 h' } },
  { key: 'longestSitMin', label: 'Longest sit', short: 'Long sit', unit: 'min', source: 'phone', digits: 0, target: { value: 90, good: 'below', label: '90 min' } },
  { key: 'headDownMin', label: 'Head-down phone time', short: 'Head down', unit: 'min', source: 'phone', digits: 0, target: { value: 120, good: 'below', label: '2 h' } },
  { key: 'phoneAfter23Min', label: 'Phone after 11 pm', short: 'Late phone', unit: 'min', source: 'phone', digits: 0, target: { value: 30, good: 'below', label: '30 min' } },
  { key: 'screenHours', label: 'Screen time', short: 'Screen', unit: 'h', source: 'phone', digits: 1 },
  { key: 'gaitSpeed', label: 'Walking speed', short: 'Gait', unit: 'm/s', source: 'phone', digits: 2, target: { value: 1.0, good: 'above', label: '1.0' } },
  { key: 'emgUpper', label: 'Upper-body muscle load', short: 'Upper load', unit: '', source: 'clothes', digits: 2 },
  { key: 'emgLower', label: 'Lower-body muscle load', short: 'Lower load', unit: '', source: 'clothes', digits: 2 },
  { key: 'emgTrunk', label: 'Trunk muscle load', short: 'Trunk load', unit: '', source: 'clothes', digits: 2 },
  { key: 'upperTrapTone', label: 'Upper-trap tension at desk', short: 'Trap tension', unit: '%', source: 'clothes', digits: 1, target: { value: 5, good: 'below', label: '5%' } },
  { key: 'gluteHamRatio', label: 'Glute : hamstring when walking', short: 'Glute ratio', unit: '', source: 'clothes', digits: 2, target: { value: 0.8, good: 'above', label: '0.8' } },
  { key: 'soreness', label: 'Soreness', short: 'Soreness', unit: '/10', source: 'check-in', digits: 0, target: { value: 6, good: 'below', label: '6' } },
];

export const signalInfo = (k: SignalKey) => SIGNALS.find((s) => s.key === k)!;
