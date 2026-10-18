/**
 * Browser port of the trained exercise recommender in ai_training_coach/training_coach.py.
 * `FeatureEncoder.transform` and `ExerciseRecommender._forward` are mirrored line for line;
 * the weights come from ai_training_coach/tools/export_web.py (coach-model.json).
 * No app imports, so scripts/check-coach-model.mjs can run it under plain Node.
 */

type FeatureValue = string | number | null | undefined;
export type FeatureRow = Record<string, FeatureValue>;

type EncoderSpec =
  | { col: string; kind: 'num'; median: number; mean: number; std: number }
  | { col: string; kind: 'cat' | 'multi'; cats: string[] };

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  pattern: string;
  muscles: string[];
  equipment: string;
  level: number;
  contraindications: string[];
  cue: string;
}

export interface CoachModelJson {
  trainedOn: string;
  rows: number;
  splitBy: string;
  testMetrics: { model: Record<string, number>; popularity_baseline: Record<string, number> };
  encoder: EncoderSpec[];
  W1: number[][];
  b1: number[];
  W2: number[][];
  b2: number[];
  items: CatalogItem[];
  V: number[][];
  c: number[];
  reference: { rows: FeatureRow[]; top: [string, number][][] };
}

const SPLIT = /\s*[;|]\s*/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isNum = (v: FeatureValue): v is number | string =>
  typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
const empty = (v: FeatureValue) => v === null || v === undefined || v === '';

function derive(r: FeatureRow): FeatureRow {
  const out = { ...r };
  const h = r.height_cm;
  const w = r.weight_kg;
  if (empty(r.bmi) && isNum(h) && isNum(w) && Number(h) > 0) out.bmi = Number(w) / (Number(h) / 100) ** 2;
  return out;
}

export function encode(spec: EncoderSpec[], row: FeatureRow): number[] {
  const r = derive(row);
  const x: number[] = [];
  for (const s of spec) {
    const v = r[s.col];
    if (s.kind === 'num') {
      if (isNum(v)) x.push((Number(v) - s.mean) / s.std, 0);
      else x.push((s.median - s.mean) / s.std, 1);
      continue;
    }
    const slots = new Array(s.cats.length + (s.kind === 'cat' ? 1 : 0)).fill(0);
    if (!empty(v)) {
      const toks = s.kind === 'multi' ? String(v).split(SPLIT) : [String(v)];
      let hit = false;
      for (const t of toks) {
        const i = s.cats.indexOf(norm(t));
        if (i >= 0) {
          slots[i] = 1;
          hit = true;
        }
      }
      if (s.kind === 'cat' && !hit) slots[s.cats.length] = 1;
    }
    x.push(...slots);
  }
  return x;
}

export interface CoachModel {
  info: Pick<CoachModelJson, 'trainedOn' | 'rows' | 'splitBy' | 'testMetrics'>;
  items: CatalogItem[];
  /** Probability (0-1) that each catalog exercise belongs in this person's plan, keyed by catalog id. */
  score(row: FeatureRow): Map<string, number>;
}

export function createCoachModel(m: CoachModelJson): CoachModel {
  const score = (row: FeatureRow) => {
    const x = encode(m.encoder, row);
    const hidden = m.b1.map((b, j) => {
      let z = b;
      for (let i = 0; i < x.length; i++) if (x[i] !== 0) z += x[i] * m.W1[i][j];
      return Math.max(0, z);
    });
    const u = m.b2.map((b, k) => hidden.reduce((acc, h, j) => acc + h * m.W2[j][k], b));
    const out = new Map<string, number>();
    m.items.forEach((item, j) => {
      const s = m.V[j].reduce((acc, v, k) => acc + v * u[k], m.c[j]);
      out.set(item.id, 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, s)))));
    });
    return out;
  };
  return { info: { trainedOn: m.trainedOn, rows: m.rows, splitBy: m.splitBy, testMetrics: m.testMetrics }, items: m.items, score };
}
