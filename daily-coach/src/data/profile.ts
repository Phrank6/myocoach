export type Goal = 'health' | 'active' | 'fit' | 'strength' | 'body_shape';

export interface Profile {
  name: string;
  age: number;
  sex: 'female' | 'male';
  heightCm: number;
  weightKg: number;
  goal: Goal;
  /** Only used for the body-shape goal. */
  subgoal: 'lean_gain' | 'recomposition' | 'lean_down';
  experience: 'new' | 'some' | 'trained';
  daysPerWeek: number;
  minutesPerWeek: number;
  equipment: 'none' | 'home' | 'gym';
  painAreas: string[];
}

export const GOALS: { id: Goal; label: string; blurb: string }[] = [
  { id: 'health', label: 'Health', blurb: 'Move more, feel better' },
  { id: 'active', label: 'Posture', blurb: 'Undo the desk and phone' },
  { id: 'fit', label: 'Fitness', blurb: 'Stamina and all-round fitness' },
  { id: 'strength', label: 'Strength', blurb: 'Get stronger on the big lifts' },
  { id: 'body_shape', label: 'Shape', blurb: 'Build muscle or lean out' },
];

export const PAIN_AREAS = ['low_back', 'knee', 'shoulder', 'neck', 'wrist'] as const;

export const DEFAULT_PROFILE: Profile = {
  name: '',
  age: 29,
  sex: 'female',
  heightCm: 168,
  weightKg: 63,
  goal: 'active',
  subgoal: 'recomposition',
  experience: 'some',
  daysPerWeek: 3,
  minutesPerWeek: 150,
  equipment: 'home',
  painAreas: [],
};
