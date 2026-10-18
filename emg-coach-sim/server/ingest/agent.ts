import type { PlanToday } from './engine.ts';

/**
 * "Agent" plan for today: the engine (training_coach.py) decides readiness, safety and the candidate
 * exercises; an LLM (same keys as the coach proxy: STEPFUN / OPENAI / ANTHROPIC) writes today's plan
 * from that, restricted to the engine's exercises. With no key, or a bad reply, the engine plan is used.
 */
const SYSTEM = `You are a strength & conditioning coach writing ONE training session for today.
You get: the person's recent signals (sleep, steps, sitting, phone use, walking speed, garment EMG muscle load/fatigue),
the engine's readiness score and today's engine session, and the allowed exercise list.
Rules: only use exercises from "allowed"; if readiness zone is "red" write a recovery session (easy walk + mobility);
if "amber" reduce volume; avoid loading muscles listed as fatigued; total minutes <= the engine session minutes + 10.
This is training guidance, not medical advice: never diagnose; if pain is reported suggest rest or a professional.
Reply ONLY with JSON: {"headline": string, "why": string[], "session": {"name": string, "minutes": number,
"blocks": [{"name": string, "sets": number, "reps": string, "rest_s": number, "cue": string}]}, "tips": string[]}.
Keep strings short (<25 words).`;

export interface AgentPlan {
  source: 'agent' | 'engine';
  provider: string | null;
  model: string | null;
  headline: string;
  why: string[];
  session: { name: string; minutes: number; blocks: { name: string; sets: number; reps: string; rest_s: number | null; cue: string | null }[] } | null;
  tips: string[];
  readiness: PlanToday['readiness'];
  engine: PlanToday;
  error?: string;
}

function provider(env: Record<string, string | undefined>) {
  if (env.STEPFUN_API_KEY) return { name: 'stepfun', model: env.STEPFUN_MODEL || 'step-5-preview' };
  if (env.OPENAI_API_KEY) return { name: 'openai', model: env.OPENAI_MODEL || 'gpt-4o-mini' };
  if (env.ANTHROPIC_API_KEY) return { name: 'anthropic', model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5' };
  return null;
}

async function chat(env: Record<string, string | undefined>, p: { name: string; model: string }, user: string): Promise<string> {
  if (p.name === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: p.model, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return ((await r.json()) as { content: { text: string }[] }).content[0].text;
  }
  const base = p.name === 'stepfun' ? env.STEPFUN_BASE_URL || 'https://api.stepfun.com/v1' : env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const key = p.name === 'stepfun' ? env.STEPFUN_API_KEY : env.OPENAI_API_KEY;
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: p.model,
      temperature: 0.4,
      ...(p.name === 'openai' ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`${p.name} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content;
}

function enginePlan(engine: PlanToday, error?: string): AgentPlan {
  const s = engine.session;
  return {
    source: 'engine',
    provider: null,
    model: engine.model,
    headline: s ? `${s.name} · ${s.minutes} min` : 'Rest day: easy walk and mobility',
    why: engine.readiness?.reasons ?? [],
    session: s ? { name: s.name, minutes: s.minutes, blocks: s.blocks.map((b) => ({ ...b, rest_s: b.rest_s ?? null, cue: b.cue ?? null })) } : null,
    tips: [...engine.changes, ...engine.habits].slice(0, 5),
    readiness: engine.readiness,
    engine,
    ...(error ? { error } : {}),
  };
}

export async function agentPlan(env: Record<string, string | undefined>, engine: PlanToday, recent: unknown): Promise<AgentPlan> {
  const p = provider(env);
  if (!p) return enginePlan(engine);
  const allowed = [...new Set([...(engine.session?.blocks.map((b) => b.name) ?? []), ...engine.candidates])];
  const user = JSON.stringify({
    recent_signals: recent,
    readiness: engine.readiness,
    engine_session_today: engine.session,
    weekly_plan: engine.week,
    flags: engine.flags,
    allowed,
  });
  try {
    const text = await chat(env, p, user);
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Partial<AgentPlan> & { session?: AgentPlan['session'] };
    const ok = new Set(allowed.map((n) => n.toLowerCase()));
    // Safety: drop anything the engine did not allow (the engine applies the pain/equipment/screening rules).
    const blocks = (j.session?.blocks ?? []).filter((b) => b && typeof b.name === 'string' && ok.has(b.name.toLowerCase()));
    if (engine.readiness?.zone !== 'red' && blocks.length === 0) return enginePlan(engine, 'agent reply had no allowed exercises');
    return {
      source: 'agent',
      provider: p.name,
      model: p.model,
      headline: String(j.headline ?? 'Today’s session'),
      why: Array.isArray(j.why) ? j.why.map(String).slice(0, 5) : [],
      session: { name: String(j.session?.name ?? 'Session'), minutes: Number(j.session?.minutes ?? 0), blocks: blocks.map((b) => ({ name: b.name, sets: Number(b.sets) || 2, reps: String(b.reps ?? '8-12'), rest_s: Number(b.rest_s) || null, cue: b.cue ? String(b.cue) : null })) },
      tips: Array.isArray(j.tips) ? j.tips.map(String).slice(0, 5) : [],
      readiness: engine.readiness,
      engine,
    };
  } catch (e) {
    return enginePlan(engine, String(e instanceof Error ? e.message : e));
  }
}
