// Scripted demo: drives the app with keyboard + a virtual Gamepad-API controller and records the X display.
// Usage: DISPLAY=:1 node scripts/record-demo.mjs [out.mp4] [summary.png]   (dev server must run on :5173)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'demo.mp4';
const SHOT = process.argv[3] ?? 'summary.png';
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME ?? '/usr/local/bin/google-chrome';
const RECORD = process.env.NO_RECORD ? false : true;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--force-device-scale-factor=1.25', '--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--disable-infobars'],
});
const ctx = await browser.newContext({ viewport: null });
await ctx.addInitScript(() => {
  const mk = () => ({ pressed: false, touched: false, value: 0 });
  const pad = { id: 'Virtual Xbox Controller (scripted demo)', index: 0, connected: false, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, mk) };
  window.__pad = pad;
  navigator.getGamepads = () => [pad.connected ? pad : null];
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));

const wait = (ms) => page.waitForTimeout(ms);
const caption = (text) =>
  page.evaluate((t) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;background:rgba(37,99,235,.92);color:#fff;font:600 16px Inter,system-ui,sans-serif;padding:10px 20px;border-radius:99px;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none;transition:opacity .3s';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
const pad = (fn, arg) => page.evaluate(fn, arg);
async function slide(nth, from, to, steps = 12) {
  const loc = page.locator('input[type=range]').nth(nth);
  const step = Number(await loc.getAttribute('step')) || 1;
  for (let i = 1; i <= steps; i++) {
    const v = Math.round((from + ((to - from) * i) / steps) / step) * step;
    await loc.fill(String(+v.toFixed(2)));
    await wait(45);
  }
}
async function keyReps(n, down = 850, up = 650) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down('Space');
    await wait(down);
    await page.keyboard.up('Space');
    await wait(up);
  }
}
async function press(key, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await wait(180);
  }
}

const cdp = await ctx.newCDPSession(page);
const { windowId } = await cdp.send('Browser.getWindowForTarget');
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await wait(1500);

let ff;
if (RECORD) {
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '24', '-video_size', '1920x1200', '-i', process.env.DISPLAY ?? ':1', '-vf', 'scale=1600:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  await wait(800);
}

await caption('1 · Build a personal body model (height, weight, arm length, build)');
await page.locator('.text input').fill('Alex');
await slide(0, 175, 186);
await slide(1, 72, 84);
await slide(2, 1, 1.05, 6);
await slide(3, 0.5, 0.8, 6);
await wait(1500);
await page.getByText('Start training').click();
await wait(1200);

await caption('2 · Bench press — keyboard: hold Space for each rep (simulated EMG streams at 100 Hz)');
await press('ArrowUp', 2);
await keyReps(6);
await press('Enter');
await wait(600);

await caption('3 · Bicep curl — gamepad: RB switches exercise, right trigger = effort (Gamepad API)');
await pad(() => { window.__pad.connected = true; });
await wait(700);
const padButton = async (i) => {
  await pad((i) => { window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 }; }, i);
  await wait(120);
  await pad((i) => { window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; }, i);
  await wait(200);
};
await padButton(5);
for (let r = 0; r < 6; r++) {
  for (let k = 0; k <= 10; k++) {
    await pad((v) => { window.__pad.buttons[7] = { pressed: v > 0.5, touched: v > 0, value: v }; }, k / 10);
    await wait(55);
  }
  await wait(250);
  for (let k = 10; k >= 0; k--) {
    await pad((v) => { window.__pad.buttons[7] = { pressed: v > 0.5, touched: v > 0, value: v }; }, k / 10);
    await wait(45);
  }
  await wait(300);
}
await padButton(0);
await wait(500);

await caption('4 · Shoulder press — auto-rep mode (A / Y)');
await press('ArrowRight', 2);
await press('KeyA');
await wait(8500);
await press('Enter');

await caption('5 · Seated row — back muscles light up (Back view)');
await press('ArrowRight', 4);
await page.locator('.stage-views button', { hasText: 'Back' }).click();
await keyReps(6);
await press('Enter');
await page.locator('.stage-views button', { hasText: 'Front' }).click();

await caption('6 · Heavy bench at 105% — a long grinding hold triggers a live strain-risk warning');
await press('ArrowRight', 2);
await press('ArrowUp', 4);
await page.keyboard.down('Space');
await wait(15000);
await page.keyboard.up('Space');
await wait(700);
await keyReps(3);
await page.getByRole('button', { name: 'Workout so far' }).click();
await caption('Live view → "Workout so far": cumulative load of every slice on the model');
await wait(3000);
await press('Enter');
await wait(800);

await caption('7 · Finish → summary overlays all slices into a cumulative heatmap');
await press('KeyF');
await wait(3500);
const rows = page.locator('.slice-row input');
await caption('Toggle slices on/off to see how each set contributes');
await rows.nth(0).click();
await wait(900);
await rows.nth(1).click();
await wait(1200);
await page.getByRole('button', { name: 'all', exact: true }).click();
await wait(800);
await page.locator('.view-btns button', { hasText: 'Back' }).click();
await wait(1800);

await caption('8 · Multi-session history (localStorage): heavy push day yesterday → risk escalates');
await page.getByText('seed demo history').click();
await page.locator('.view-btns button', { hasText: 'Front' }).click();
await wait(3000);
await page.evaluate(() => document.getElementById('demo-caption')?.remove());
await page.mouse.move(400, 500);
for (let i = 0; i < 5; i++) {
  await page.locator('.sum-right').evaluate((el) => { el.style.overflowAnchor = 'none'; el.scrollTop = 0; });
  await wait(300);
}
console.log('sum-right scrollTop before screenshot:', await page.locator('.sum-right').evaluate((el) => el.scrollTop));
await page.screenshot({ path: SHOT });

await caption('9 · AI coach: overloaded + under-trained groups and a next-session plan (rule-based offline; LLM if key set)');
const right = page.locator('.sum-right');
for (let y = 0; y <= 1400; y += 70) {
  await right.evaluate((el, y) => el.scrollTo({ top: y }), y);
  await wait(110);
}
await wait(2500);
await right.evaluate((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
await page.locator('.view-btns button', { hasText: 'Spin' }).click();
await caption('MyoCoach · EMG smart gym coach — simulation prototype');
await wait(3500);

if (ff) {
  ff.stdin.write('q');
  await new Promise((r) => ff.on('close', r));
}
await browser.close();
console.log('done', OUT, SHOT);
