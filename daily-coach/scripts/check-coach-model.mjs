// Checks the browser port of the coach model against NumPy reference scores written by
// ai_training_coach/tools/export_web.py.  Run: npm run check-model
import { readFileSync } from 'node:fs';
import { createCoachModel } from '../src/coach/model.ts';

const json = JSON.parse(readFileSync(new URL('../src/coach/coach-model.json', import.meta.url), 'utf8'));
const model = createCoachModel(json);
let worst = 0;
json.reference.rows.forEach((row, i) => {
  const scores = model.score(row);
  for (const [id, want] of json.reference.top[i]) worst = Math.max(worst, Math.abs(scores.get(id) - want));
  const top = [...scores].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  const same = top.every((id, k) => id === json.reference.top[i][k][0]);
  console.log(`row ${i}: top-8 order ${same ? 'matches' : 'DIFFERS'}`);
  if (!same) process.exitCode = 1;
});
console.log(`max |ts - numpy| = ${worst.toExponential(2)}`);
if (worst > 1e-3) process.exitCode = 1;
