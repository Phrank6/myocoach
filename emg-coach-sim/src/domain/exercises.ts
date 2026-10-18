import { MUSCLE_IDS, type MuscleId, type MuscleVector } from './muscles';

/** Arm pose in degrees. Applied to the +x arm; the other arm is mirrored. */
export interface Pose {
  flex: number; // shoulder flexion (forward raise)
  abd: number; // shoulder abduction (side raise)
  rot: number; // upper-arm twist about its long axis
  yaw: number; // horizontal abduction (arm swings out from forward)
  elbow: number; // elbow flexion
  shrug: number; // 0..1 shoulder elevation
}

export interface Exercise {
  id: string;
  name: string;
  equipment: string;
  cue: string;
  /** Fraction of MVC each muscle reaches at full effort with a working load. */
  profile: Partial<Record<MuscleId, number>>;
  rest: Pose;
  peak: Pose;
}

const P = (p: Partial<Pose>): Pose => ({ flex: 0, abd: 0, rot: 0, yaw: 0, elbow: 0, shrug: 0, ...p });

export const EXERCISES: Exercise[] = [
  {
    id: 'bench',
    name: 'Bench press',
    equipment: 'Barbell',
    cue: 'Press up, elbows ~45°',
    profile: { pecs: 0.95, delt_front: 0.72, triceps: 0.66, forearms: 0.25, delt_side: 0.15, lats: 0.12, biceps: 0.08 },
    rest: P({ flex: 90, yaw: 70, rot: -90, elbow: 95 }),
    peak: P({ flex: 90, yaw: 12, rot: -90, elbow: 6 }),
  },
  {
    id: 'curl',
    name: 'Bicep curl',
    equipment: 'Dumbbells',
    cue: 'Elbows pinned, full squeeze',
    profile: { biceps: 0.95, forearms: 0.6, delt_front: 0.2, traps: 0.08 },
    rest: P({ abd: 6, elbow: 10 }),
    peak: P({ flex: 12, abd: 6, elbow: 135 }),
  },
  {
    id: 'pushdown',
    name: 'Tricep pushdown',
    equipment: 'Cable',
    cue: 'Lock elbows, extend fully',
    profile: { triceps: 0.95, forearms: 0.35, lats: 0.15, delt_rear: 0.1 },
    rest: P({ flex: 14, abd: 4, elbow: 105 }),
    peak: P({ flex: 8, abd: 4, elbow: 5 }),
  },
  {
    id: 'ohp',
    name: 'Shoulder press',
    equipment: 'Dumbbells',
    cue: 'Brace core, press overhead',
    profile: { delt_front: 0.9, delt_side: 0.7, triceps: 0.6, traps: 0.45, pecs: 0.2, forearms: 0.25 },
    rest: P({ abd: 85, rot: 90, elbow: 95 }),
    peak: P({ abd: 165, rot: 90, elbow: 10 }),
  },
  {
    id: 'lateral',
    name: 'Lateral raise',
    equipment: 'Dumbbells',
    cue: 'Lead with elbows to shoulder height',
    profile: { delt_side: 0.95, traps: 0.5, delt_front: 0.35, delt_rear: 0.25, forearms: 0.15 },
    rest: P({ abd: 8, elbow: 12 }),
    peak: P({ abd: 88, elbow: 15 }),
  },
  {
    id: 'reardelt',
    name: 'Rear delt fly',
    equipment: 'Dumbbells',
    cue: 'Arms wide, squeeze shoulder blades',
    profile: { delt_rear: 0.9, rhomboids: 0.7, traps: 0.5, delt_side: 0.3 },
    rest: P({ flex: 85, elbow: 12 }),
    peak: P({ flex: 85, yaw: 85, elbow: 12 }),
  },
  {
    id: 'pulldown',
    name: 'Lat pulldown',
    equipment: 'Cable',
    cue: 'Pull elbows down to ribs',
    profile: { lats: 0.95, biceps: 0.6, rhomboids: 0.5, delt_rear: 0.4, forearms: 0.5, traps: 0.25 },
    rest: P({ abd: 160, rot: 90, elbow: 15 }),
    peak: P({ abd: 75, rot: 90, elbow: 115 }),
  },
  {
    id: 'row',
    name: 'Seated row',
    equipment: 'Cable',
    cue: 'Chest up, row to the navel',
    profile: { rhomboids: 0.85, lats: 0.75, delt_rear: 0.65, traps: 0.55, biceps: 0.5, forearms: 0.45 },
    rest: P({ flex: 80, elbow: 5 }),
    peak: P({ flex: -28, elbow: 100 }),
  },
  {
    id: 'shrug',
    name: 'Shrug',
    equipment: 'Dumbbells',
    cue: 'Ears to shoulders, pause',
    profile: { traps: 0.95, forearms: 0.55, rhomboids: 0.25, delt_side: 0.15 },
    rest: P({ abd: 5, elbow: 5 }),
    peak: P({ abd: 5, elbow: 5, shrug: 1 }),
  },
];

export function exerciseById(id: string): Exercise {
  return EXERCISES.find((e) => e.id === id) ?? EXERCISES[0];
}

export function profileVector(ex: Exercise): MuscleVector {
  return MUSCLE_IDS.map((m) => ex.profile[m] ?? 0);
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    flex: l(a.flex, b.flex),
    abd: l(a.abd, b.abd),
    rot: l(a.rot, b.rot),
    yaw: l(a.yaw, b.yaw),
    elbow: l(a.elbow, b.elbow),
    shrug: l(a.shrug, b.shrug),
  };
}

export const NEUTRAL_POSE: Pose = P({ abd: 8, elbow: 8 });
