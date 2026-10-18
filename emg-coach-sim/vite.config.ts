import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Tiny server-side proxy so LLM keys never reach the browser.
 *   OPENAI_API_KEY    (+ optional OPENAI_MODEL, default gpt-4o-mini, OPENAI_BASE_URL)
 *   ANTHROPIC_API_KEY (+ optional ANTHROPIC_MODEL, default claude-3-5-haiku-latest)
 * With neither set, /api/coach/status reports llm:false and the app stays rule-based.
 */
function coachProxy(env: Record<string, string>): Plugin {
  const openaiKey = env.OPENAI_API_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const provider = openaiKey ? 'openai' : anthropicKey ? 'anthropic' : null;
  const model = provider === 'openai' ? env.OPENAI_MODEL || 'gpt-4o-mini' : env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';

  const system = `You are an evidence-based strength coach inside an EMG muscle-activation app (upper body only).
You receive per-muscle activation load for a workout, strain-risk flags and recent sessions.
Reply ONLY with JSON: {"headline": string, "underTrained": [{"muscle": <muscleId>, "note": string}], "overloaded": [{"muscle": <muscleId>, "note": string}], "insights": string[], "plan": [{"exercise": <one of availableExercises>, "sets": number, "reps": string, "intensity": string, "why": string}]}.
Keep notes short (<25 words). Never diagnose injuries; phrase strain as risk and suggest rest or seeing a professional.`;

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  async function callLlm(payload: unknown): Promise<string> {
    const user = JSON.stringify(payload);
    if (provider === 'openai') {
      const base = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
      const j = (await r.json()) as { choices: { message: { content: string } }[] };
      return j.choices[0].message.content;
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1200, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { content: { text: string }[] };
    return j.content[0].text;
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url === '/api/coach/status') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(provider ? { llm: true, provider, model } : { llm: false }));
      return;
    }
    if (req.url === '/api/coach' && req.method === 'POST') {
      res.setHeader('content-type', 'application/json');
      if (!provider) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'no LLM key configured' }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req));
        const text = await callLlm(body.workout);
        const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        res.end(JSON.stringify({ ...json, model: `${provider}:${model}` }));
      } catch (e) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }
    next();
  };

  return {
    name: 'coach-llm-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string>;
  return {
    plugins: [react(), coachProxy(env)],
  };
});
