export const MUSCLES = [
  { id: 'delt_front', label: 'Front deltoids', short: 'F-Delt', region: 'Shoulders' },
  { id: 'delt_side', label: 'Side deltoids', short: 'S-Delt', region: 'Shoulders' },
  { id: 'delt_rear', label: 'Rear deltoids', short: 'R-Delt', region: 'Shoulders' },
  { id: 'pecs', label: 'Pectorals', short: 'Pecs', region: 'Chest' },
  { id: 'biceps', label: 'Biceps', short: 'Bis', region: 'Arms' },
  { id: 'triceps', label: 'Triceps', short: 'Tris', region: 'Arms' },
  { id: 'forearms', label: 'Forearms', short: 'Fore', region: 'Arms' },
  { id: 'lats', label: 'Latissimus dorsi', short: 'Lats', region: 'Back' },
  { id: 'traps', label: 'Trapezius', short: 'Traps', region: 'Back' },
  { id: 'rhomboids', label: 'Rhomboids / upper back', short: 'Rhomb', region: 'Back' },
  { id: 'abs', label: 'Abdominals', short: 'Abs', region: 'Core' },
  { id: 'obliques', label: 'Obliques', short: 'Obliques', region: 'Core' },
  { id: 'serratus', label: 'Serratus anterior', short: 'Serratus', region: 'Core' },
  { id: 'erectors', label: 'Spinal erectors', short: 'Erectors', region: 'Back' },
] as const;

export type MuscleId = (typeof MUSCLES)[number]['id'];

export const MUSCLE_IDS: MuscleId[] = MUSCLES.map((m) => m.id);
export const N_MUSCLES = MUSCLE_IDS.length;

export const MUSCLE_INDEX: Record<MuscleId, number> = Object.fromEntries(
  MUSCLE_IDS.map((id, i) => [id, i]),
) as Record<MuscleId, number>;

export function muscleLabel(id: MuscleId): string {
  return MUSCLES[MUSCLE_INDEX[id]].label;
}

export function muscleShort(id: MuscleId): string {
  return MUSCLES[MUSCLE_INDEX[id]].short;
}

export type MuscleVector = number[];

export function zeroVector(): MuscleVector {
  return new Array(N_MUSCLES).fill(0);
}

export const PUSH_GROUP: MuscleId[] = ['pecs', 'delt_front', 'triceps'];
export const PULL_GROUP: MuscleId[] = ['lats', 'rhomboids', 'delt_rear', 'biceps'];
