export interface BodyProfile {
  name: string;
  heightCm: number;
  weightKg: number;
  /** Arm length relative to average for the height (0.9 – 1.1). */
  armScale: number;
  /** 0 = slim, 0.5 = athletic, 1 = muscular. */
  build: number;
  experience: 'beginner' | 'intermediate' | 'advanced';
}

export const DEFAULT_PROFILE: BodyProfile = {
  name: '',
  heightCm: 175,
  weightKg: 72,
  armScale: 1,
  build: 0.5,
  experience: 'intermediate',
};

export interface BodyDims {
  scale: number;
  width: number;
  muscle: number;
  arm: number;
}

export function bodyDims(p: BodyProfile): BodyDims {
  const h = p.heightCm / 100;
  const bmi = p.weightKg / (h * h);
  return {
    scale: p.heightCm / 175,
    width: Math.min(1.35, Math.max(0.8, 0.88 + (bmi - 22) * 0.028)),
    muscle: 0.8 + p.build * 0.45,
    arm: p.armScale,
  };
}

const KEY = 'emgcoach.profile.v1';

export function loadProfile(): BodyProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: BodyProfile) {
  localStorage.setItem(KEY, JSON.stringify(p));
}
