// Scripted demo: desktop window (left) + emulated Android phone (right) paired over the /ws/session relay.
// Records the X display with ffmpeg and saves a desktop + a phone screenshot.
// Usage: DISPLAY=:1 node scripts/record-demo.mjs [out.mp4] [desktop.png] [phone.png]   (dev server must run on :5173)
import { spawn, spawnSync } from 'node:child_process';
import { renameSync } from 'node:fs';
import { chromium, devices } from 'playwright-core';

const OUT = process.argv[2] ?? 'demo.mp4';
const DESK_SHOT = process.argv[3] ?? 'desktop.png';
const PHONE_SHOT = process.argv[4] ?? 'phone.png';
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME ?? '/usr/local/bin/google-chrome';
const RECORD = !process.env.NO_RECORD;
const COMMON = ['--disable-gpu-compositing', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--disable-infobars', '--hide-scrollbars'];

const deskBrowser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: [...COMMON, '--force-device-scale-factor=1.25', '--window-position=0,0', '--window-size=1184,928'],
});
const desk = await (await deskBrowser.newContext({ viewport: null })).newPage();
let lastCaption = '';
desk.on('pageerror', (e) => console.error('desk pageerror', `[${lastCaption}]`, e.stack ?? e.message));

const phoneBrowser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: [...COMMON, '--window-position=1490,40', '--window-size=428,1120'],
});
const phoneCtx = await phoneBrowser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 990 } });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => console.error('phone pageerror', e.message));

const wait = (ms) => desk.waitForTimeout(ms);
const caption = (text) => (lastCaption = text) &&
  desk.evaluate((t) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;background:rgba(20,21,26,.92);border:1px solid rgba(255,122,69,.55);color:#f2efe9;font:500 15px "Inter Variable",Inter,system-ui,sans-serif;padding:10px 18px;border-radius:999px;box-shadow:0 10px 40px rgba(0,0,0,.6);pointer-events:none;white-space:nowrap';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
const hideCaption = () => desk.evaluate(() => document.getElementById('demo-caption')?.remove());

async function slide(nth, from, to, steps = 10) {
  const loc = desk.locator('input[type=range]').nth(nth);
  const step = Number(await loc.getAttribute('step')) || 1;
  for (let i = 1; i <= steps; i++) {
    const v = Math.round((from + ((to - from) * i) / steps) / step) * step;
    await loc.fill(String(+v.toFixed(2)));
    await wait(45);
  }
}
async function tapReps(n, gap = 1450) {
  for (let i = 0; i < n; i++) {
    await phone.locator('.p-rep').tap();
    await wait(gap);
  }
}
async function keyReps(n, down = 850, up = 650) {
  for (let i = 0; i < n; i++) {
    await desk.keyboard.down('Space');
    await wait(down);
    await desk.keyboard.up('Space');
    await wait(up);
  }
}

await desk.goto(URL);
await desk.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await desk.reload();
await phone.goto(`${URL}/phone`);
await wait(2000);

let ff;
let t0 = 0;
if (RECORD) {
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '24', '-video_size', '1920x1200', '-i', process.env.DISPLAY ?? ':1', '-vf', 'scale=1600:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', OUT + '.raw.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  t0 = Date.now();
  await wait(800);
}
const mark = () => (Date.now() - t0) / 1000;

await caption('01 · Body model: size the mannequin to you');
await desk.getByPlaceholder('Athlete').fill('Alex');
await slide(0, 175, 184);
await slide(1, 72, 80);
await wait(900);

await caption('Connect phone: scan the QR or type the code on /phone');
await desk.locator('.phone-chip').click();
await wait(2200);
const code = await desk.evaluate(() => window.__link.code);
const input = phone.locator('.p-code-input');
for (const ch of code) { await input.press(ch); await wait(220); }
await wait(400);
await phone.getByRole('button', { name: 'Join' }).tap();
await caption(`Phone joined session ${code} over WebSocket, desktop chip turns live`);
await wait(2600);

await desk.getByText('Start training').click();
await wait(1000);
await caption('02 · Train: tap the big Rep button on the phone, muscles light up on both screens');
await tapReps(3);
await tapReps(3);
await caption('End set from the phone: the set is saved as a slice');
await phone.locator('.p-end').tap();
await wait(1400);

await caption('Pick the exercise on the phone: Seated row, back view on desktop');
await phone.locator('.p-chips button', { hasText: 'Seated row' }).tap();
await wait(700);
await desk.locator('.seg button', { hasText: 'Back' }).click();
await wait(500);
await tapReps(4);
await phone.locator('.p-end').tap();
await wait(900);
await desk.locator('.seg button', { hasText: 'Front' }).click();

await caption('Keyboard still works: Bicep curl, hold Space for each rep');
await desk.locator('.ex-list .ex-name', { hasText: 'Bicep curl' }).click();
await wait(500);
await keyReps(4);
await desk.keyboard.press('Enter');
await wait(900);

await caption('Heavy bench at 100%: hold Rep on the phone, a strain warning reaches both screens');
await phone.locator('.p-chips button', { hasText: 'Bench press' }).tap();
for (let i = 0; i < 5; i++) { await phone.getByRole('button', { name: 'More load' }).tap(); await wait(160); }
await wait(400);
{
  const b = await phone.locator('.p-rep').boundingBox();
  await phone.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await phone.mouse.down();
  await wait(13500);
  await phone.screenshot({ path: PHONE_SHOT });
  await wait(1500);
  await phone.mouse.up();
}
await wait(1200);
await tapReps(2);
await wait(600);
await phone.locator('.p-end').tap();
await wait(1000);

await caption('03 · Review: every slice overlaid, step-5-preview reads the session');
await desk.keyboard.press('KeyF');
await wait(3500);
const cutA = mark();
await desk.locator('.coach-headline').waitFor({ timeout: 150000 });
const cutB = mark() - 1.2;
await caption('StepFun coach note lands on desktop and on the phone');
await phone.locator('.p-coach').scrollIntoViewIfNeeded();
await wait(4000);
await hideCaption();
await desk.mouse.move(300, 500);
await desk.locator('.sum-side').evaluate((el) => { el.style.overflowAnchor = 'none'; el.scrollTop = 0; });
await wait(600);
await desk.screenshot({ path: DESK_SHOT });

await caption('Strain, coach notes and next-session plan');
const side = desk.locator('.sum-side');
for (let y = 0; y <= 1500; y += 60) {
  await side.evaluate((el, y) => el.scrollTo({ top: y }), y);
  await wait(90);
}
await wait(1800);
await side.evaluate((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
await desk.locator('.seg button', { hasText: 'Spin' }).click();
await caption('MyoCoach: desktop and Android companion, simulation prototype');
await wait(4000);

if (ff) {
  ff.stdin.write('q');
  await new Promise((r) => ff.on('close', r));
  const keep = cutB - cutA > 3;
  if (keep) {
    const fc = `[0:v]trim=0:${cutA.toFixed(2)},setpts=PTS-STARTPTS[a];[0:v]trim=start=${cutB.toFixed(2)},setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1[out]`;
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT + '.raw.mp4', '-filter_complex', fc, '-map', '[out]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', OUT], { stdio: 'inherit' });
    if (r.status !== 0) renameSync(OUT + '.raw.mp4', OUT);
    console.log(`trimmed coach wait ${cutA.toFixed(1)}s → ${cutB.toFixed(1)}s`);
  } else {
    renameSync(OUT + '.raw.mp4', OUT);
  }
}
await phoneBrowser.close();
await deskBrowser.close();
console.log('done', OUT, DESK_SHOT, PHONE_SHOT);
