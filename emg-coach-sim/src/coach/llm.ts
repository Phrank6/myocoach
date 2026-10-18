import { EXERCISES, exerciseById } from '../domain/exercises';
import { MUSCLE_IDS, type MuscleId } from '../domain/muscles';
import { ruleBasedCoach, workoutSummary, type CoachInput, type CoachReport } from './rules';

export interface CoachStatus {
  llm: boolean;
  provider?: string;
  model?: string;
}

export async function coachStatus(): Promise<CoachStatus> {
  try {
    const r = await fetch('/api/coach/status');
    if (!r.ok) return { llm: false };
    return (await r.json()) as CoachStatus;
  } catch {
    return { llm: false };
  }
}

/** Compact, model-friendly description of the workout. */
export function coachPayload(input: CoachInput) {
  const { load, norm } = workoutSummary(input);
  return {
    profile: input.profile,
    availableExercises: EXERCISES.map((e) => e.name),
    sets: input.slices.map((s) => ({
      exercise: exerciseById(s.exerciseId).name,
      reps: s.reps,
      durationS: +s.durationS.toFixed(1),
      intensity: s.intensity,
      externalLoadLb: s.externalLoadLb,
      restBeforeS: +s.restBeforeS.toFixed(1),
      peakActivation: Object.fromEntries(MUSCLE_IDS.map((m, i) => [m, +s.peak[i].toFixed(2)])),
    })),
    muscleLoad: Object.fromEntries(MUSCLE_IDS.map((m, i) => [m, { activationSeconds: +load[i].toFixed(1), relative: +norm[i].toFixed(2) }])),
    strainFlags: input.flags,
    recentSessions: input.history.slice(-7).map((h) => ({
      date: h.date,
      exercises: h.exercises,
      load: Object.fromEntries(MUSCLE_IDS.map((m, i) => [m, +h.load[i].toFixed(0)])),
    })),
  };
}

/** Calls the dev-server LLM proxy when a key is configured; otherwise (or on error) returns the rule-based report. */
export async function generateCoachReport(input: CoachInput, useLlm: boolean): Promise<CoachReport & { error?: string }> {
  const rules = ruleBasedCoach(input);
  if (!useLlm) return rules;
  try {
    const r = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workout: coachPayload(input), muscleIds: MUSCLE_IDS }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `LLM proxy returned ${r.status}`);
    }
    const data = (await r.json()) as Partial<CoachReport> & { model?: string; provider?: string };
    const valid = (m: unknown): m is MuscleId => typeof m === 'string' && (MUSCLE_IDS as string[]).includes(m);
    return {
      source: 'llm',
      model: data.model,
      headline: data.headline || rules.headline,
      underTrained: (data.underTrained ?? []).filter((u) => valid(u.muscle)),
      overloaded: (data.overloaded ?? []).filter((u) => valid(u.muscle)),
      insights: data.insights?.length ? data.insights : rules.insights,
      plan: data.plan?.length ? data.plan : rules.plan,
      // Safety copy for strain flags always comes from the deterministic rules.
      restAdvice: rules.restAdvice,
    };
  } catch (e) {
    return { ...rules, error: e instanceof Error ? e.message : String(e) };
  }
}
