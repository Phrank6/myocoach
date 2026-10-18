import { EXERCISES, exerciseById } from '../domain/exercises';
import { MUSCLE_IDS, MUSCLE_INDEX, PULL_GROUP, PUSH_GROUP, muscleLabel, type MuscleId, type MuscleVector } from '../domain/muscles';
import type { BodyProfile } from '../domain/profile';
import type { SessionRecord } from '../engine/history';
import type { RiskFlag } from '../engine/risk';
import { normalize, sumVectors, type Slice } from '../engine/slices';

export interface CoachPlanItem {
  exercise: string;
  sets: number;
  reps: string;
  intensity: string;
  why: string;
}

export interface CoachReport {
  source: 'rules' | 'llm';
  model?: string;
  headline: string;
  underTrained: { muscle: MuscleId; note: string }[];
  overloaded: { muscle: MuscleId; note: string }[];
  insights: string[];
  plan: CoachPlanItem[];
  restAdvice: string[];
}

export interface CoachInput {
  profile: BodyProfile;
  slices: Slice[];
  flags: RiskFlag[];
  history: SessionRecord[];
}

export function workoutSummary(input: CoachInput) {
  const load = sumVectors(input.slices.map((s) => s.load));
  const norm = normalize(load);
  return {
    load,
    norm,
    totalSets: input.slices.length,
    totalReps: input.slices.reduce((a, s) => a + s.reps, 0),
    durationS: input.slices.reduce((a, s) => a + s.durationS, 0),
    restS: input.slices.reduce((a, s) => a + s.restBeforeS, 0),
  };
}

const groupSum = (v: MuscleVector, g: MuscleId[]) => g.reduce((a, m) => a + v[MUSCLE_INDEX[m]], 0);

export function ruleBasedCoach(input: CoachInput): CoachReport {
  const { load, norm, totalSets, totalReps } = workoutSummary(input);
  const flagged = new Map(input.flags.map((f) => [f.muscle, f]));

  // Muscles barely touched over this workout + recent history count as under-trained.
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  const recent = input.history.filter((h) => Date.parse(h.date) > weekAgo);
  const weekLoad = sumVectors([load, ...recent.map((h) => h.load)]);
  const weekNorm = normalize(weekLoad);

  const underTrained = MUSCLE_IDS.filter((_, i) => norm[i] < 0.2)
    .map((m) => {
      const i = MUSCLE_INDEX[m];
      return {
        muscle: m,
        note:
          weekNorm[i] < 0.25
            ? `Only ${(norm[i] * 100).toFixed(0)}% of your top group today and low across the last 7 days.`
            : `Light today (${(norm[i] * 100).toFixed(0)}% of top group) but covered earlier this week.`,
        weight: weekNorm[i],
      };
    })
    .sort((a, b) => a.weight - b.weight)
    .slice(0, 5)
    .map(({ muscle, note }) => ({ muscle, note }));

  const overloaded = input.flags.map((f) => ({ muscle: f.muscle, note: `${f.level === 'high' ? 'High' : 'Elevated'} risk: ${f.reasons.join('; ')}.` }));
  MUSCLE_IDS.forEach((m, i) => {
    if (!flagged.has(m) && norm[i] > 0.95 && totalSets >= 3) {
      overloaded.push({ muscle: m, note: 'Carried the most volume today — fine once, but watch it next session.' });
    }
  });

  const insights: string[] = [];
  const push = groupSum(load, PUSH_GROUP);
  const pull = groupSum(load, PULL_GROUP);
  if (push > 1.5 * pull && push > 5) insights.push(`Push-dominant session (push:pull ≈ ${(push / Math.max(pull, 0.1)).toFixed(1)}:1). Balance with rows / pulldowns to protect shoulder health.`);
  else if (pull > 1.5 * push && pull > 5) insights.push(`Pull-dominant session (pull:push ≈ ${(pull / Math.max(push, 0.1)).toFixed(1)}:1). Add pressing next time for balance.`);
  else if (push + pull > 5) insights.push('Push and pull volume are reasonably balanced.');
  const rear = load[MUSCLE_INDEX.delt_rear];
  const front = load[MUSCLE_INDEX.delt_front];
  if (front > 2.5 * rear && front > 5) insights.push('Front delts are doing far more work than rear delts — add rear delt flys or face pulls.');
  const best = input.slices.reduce<Slice | null>((b, s) => (!b || s.reps > b.reps ? s : b), null);
  if (best) insights.push(`Most reps in one set: ${best.reps} × ${exerciseById(best.exerciseId).name}.`);
  insights.push(`${totalSets} sets, ${totalReps} reps logged.`);
  const restTotal = input.slices.reduce((sum, slice) => sum + slice.restBeforeS, 0);
  if (input.slices.length > 1) insights.push(`Logged ${Math.round(restTotal)} seconds of rest before sets (about ${Math.round(restTotal / input.slices.length)} s per set).`);

  // Next-session plan: score each exercise by how much it hits under-trained muscles, penalise flagged ones.
  const need = weekNorm.map((w) => 1 - w);
  const scored = EXERCISES.map((ex) => {
    let score = 0;
    let penalty = 0;
    MUSCLE_IDS.forEach((m, i) => {
      const p = ex.profile[m] ?? 0;
      score += p * need[i];
      const f = flagged.get(m);
      if (f) penalty += p * (f.level === 'high' ? 2.5 : 1.2);
    });
    return { ex, score: score - penalty };
  })
    .filter((s) => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const beginner = input.profile.experience === 'beginner';
  const plan: CoachPlanItem[] = scored.map(({ ex }) => {
    const targets = MUSCLE_IDS.filter((m) => (ex.profile[m] ?? 0) >= 0.5)
      .sort((a, b) => need[MUSCLE_INDEX[b]] - need[MUSCLE_INDEX[a]])
      .slice(0, 2)
      .map((m) => muscleLabel(m).toLowerCase());
    return {
      exercise: ex.name,
      sets: beginner ? 2 : 3,
      reps: '10–12',
      intensity: beginner ? '~60% effort' : '~70% effort',
      why: `Targets ${targets.join(' & ')} which got less work recently.`,
    };
  });

  const restAdvice = input.flags.map((f) => f.suggestion);
  if (!restAdvice.length) restAdvice.push('No strain-risk flags. Normal 48 h recovery for the muscles you trained hardest is enough.');

  const top = MUSCLE_IDS.filter((_, i) => norm[i] >= 0.6).map((m) => muscleLabel(m).toLowerCase());
  const headline = input.flags.some((f) => f.level === 'high')
    ? `Solid work on ${top.slice(0, 2).join(' and ') || 'your session'} — but some groups need rest before you load them again.`
    : `Good session focused on ${top.slice(0, 3).join(', ') || 'mixed groups'}. Next time, shift volume to what you skipped.`;

  return { source: 'rules', headline, underTrained, overloaded, insights, plan, restAdvice };
}
