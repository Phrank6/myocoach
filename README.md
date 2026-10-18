# MyoCoach — EMG smart gym coach (simulation prototype)

LA Hacks prototype of an EMG-based **upper-body smart gym coach**. Everything runs in the browser.
There are no real sensors yet: a simulated Arduino streams EMG, and a gamepad or keyboard performs the reps.

**Loop:** build body model → train sets (each set = a *slice*) → live 3D muscle activation → cumulative heatmap → strain-risk warnings → AI coach plan.

## Run

```bash
npm i
npm run dev                  # http://localhost:5173 (also on your LAN IP, for the phone)
npm run build                # type-check + production build
npm run preview              # serve the build; the coach proxy and phone relay work here too
```

Without an API key everything works offline, and the AI coach is rule-based.

### StepFun coach (step-5-preview)

1. Create `.env.local` next to `package.json`. It is gitignored (`*.local`); never commit it.

   ```bash
   STEPFUN_API_KEY=your-key-here
   # International keys (platform.stepfun.ai) need this; api.stepfun.com rejects them with a 401:
   STEPFUN_BASE_URL=https://api.stepfun.ai/v1
   # Optional, defaults to step-5-preview:
   # STEPFUN_MODEL=step-5-preview
   ```

2. Run `npm i && npm run dev`. Vite reads `.env.local` on startup, so restart it after editing the file.
3. Check the proxy: `curl http://localhost:5173/api/coach/status` should print
   `{"llm":true,"provider":"stepfun","model":"step-5-preview"}`. `"llm":false` means no key was loaded.
4. Finish a workout and open **Risk & coach**. The coach badge shows `step-5-preview` when the note came from the model.
   If the call fails, the panel shows the error and falls back to the rule-based coach.

The key stays on the server. The browser only calls `/api/coach`, a proxy defined in `vite.config.ts`.
That proxy only exists under `vite dev` / `vite preview`; a static host falls back to rules.
OpenAI (`OPENAI_API_KEY`, optional `OPENAI_MODEL` / `OPENAI_BASE_URL`) and Anthropic (`ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`) work the same way.
Priority is StepFun, then OpenAI, then Anthropic.

### Connect an Android phone (`/phone`)

The phone is a remote and a live display. It runs in the phone browser; there is no APK.

1. Run `npm run dev`. It listens on your LAN because of `--host`. The phone must be on the same Wi-Fi as the computer.
2. On the desktop, click **Connect phone** in the top bar. It shows a QR code and a 4-character session code.
3. Scan the QR code with the phone camera; it opens `http://<computer-lan-ip>:5173/phone?s=CODE`. Or open `/phone` on the phone and type the code.
4. The chip turns into **Phone connected** and the workout's left panel lists the device.

On the phone:
- pick the exercise (arrows or chips) and change the external weight (− / +, 5 lb steps);
- **tap Rep** for one scripted rep, or **hold Rep** to grind a long effort;
- tap **End set**.

It also shows the session and set number, the rest timer, a live front/back muscle map, the top strain alert, and the coach's latest headline.
Keyboard and gamepad keep working alongside the phone.
Transport: a Vite plugin (`server/sessionRelay.ts`) relays WebSocket messages on `/ws/session?code=CODE&role=host|phone`. Message types live in `src/phone/protocol.ts`.

### Light / dark theme

The sun/moon button in the top bar (desktop and phone) switches themes, and the choice is saved in `localStorage` (`myocoach.theme`).
Light is Eason's white design and is the default. Dark is derived from the same palette: warm charcoal panels, the same orange and ember accents, a darker tan mannequin, and the heat scale reversed so the most-worked muscle is the brightest.

### Sessions and rest

- Each set records `restBeforeS`: the time since the previous set in the same session ended. The first set of a session has 0.
- While you're between sets, the workout screen shows **Rest since last set**, and the phone shows a **Rest** pill.
- Switching exercise, or pressing **End session N**, starts a new session and resets the rest clock.
- The review shows **Rest logged** in the stats, and each set row shows its rest.
- Rest is sent to the AI coach with each set and stored in local history (`restS`, `averageRestS`).

### Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Lift / perform rep (effort) | hold **Space** | **RT** (analog) or right/left stick up, LT = digital |
| Start / end set | **Enter** | **A** |
| Previous / next exercise | ← → or Q / E | LB / RB, D-pad ← → |
| Load (intensity) | ↑ ↓ or − / = | D-pad ↑ ↓ |
| External weight | slider in the left panel, or − / + on the phone | |
| Auto-rep (hands-free demo) | **A** | **Y** |
| Finish workout | **F** | **Start** |

A set starts automatically when you first apply effort. It ends on Enter/A, or after 6 s idle. Click any muscle on the 3D model for details.

### Demo recording
`scripts/record-demo.mjs` drives the app with Playwright and records it: keyboard input, a scripted *virtual* Gamepad-API controller, and on-screen captions.
Run it with `DISPLAY=:1 node scripts/record-demo.mjs out.mp4 summary.png`, with the dev server running. It needs `ffmpeg` and Chrome.

## Anatomy and electrode overlay

- Desktop 3D: muscles are sculpted surface patches (`src/three/anatomy.ts`) laid onto the torso and arms. They have deltoid caps, fan-shaped pecs, lats and traps, segmented abs, serratus slips and fibre striation. Heat is tinted over a neutral muscle tone.
- Phone: `src/phone/AnatomyMap.tsx` draws front and back anatomy plates with thin outlines, fibre hatching and heat tint.
- Electrodes: the **Electrodes** button (on the workout stage, the review page and the phone map) shows the vest placement. Pads 01–14 appear on both sides, with REF at C7. The overlay is off by default. The mapping lives in `src/domain/electrodes.ts`.

The reference numbering does not match the app's 14 channels one to one:
- Reference regions 07, 08 and 09 (upper, middle and lower trapezius) all read the single `traps` channel.
- The `forearms` and `rhomboids` channels have no electrode on the reference vest.
- The reference is bilateral (28 contacts); the app uses one channel per muscle for both sides.
- Reference 06 is the clavicular pec only; the app's `pecs` channel is the whole muscle.
- REF at C7 is a ground contact, not a data channel.
- The app's channel index order differs from the 01–14 numbering.

## Architecture

```
src/
  domain/      muscles.ts (14 muscle groups = 14 EMG channels, incl. abs / obliques / serratus / erectors), exercises.ts (activation profiles + arm poses), profile.ts
  emg/         types.ts        EmgSource interface, EmgFrame, CSV line parser (shared wire format)
               SimulatedEmgSource.ts   mock Arduino @100 Hz: baseline, noise, bursts, fatigue drift, artifacts
               WebSerialEmgSource.ts   real Arduino over Web Serial (Chrome/Edge)
               EmgProcessor.ts         baseline removal → rectify → RMS envelope → %MVC activation
  input/       InputController.ts      Gamepad API polling + keyboard fallback
  engine/      WorkoutEngine.ts        60 Hz control loop: input → effort → neural drive → EMG → slices, live risk alerts
               slices.ts               SliceRecorder (per-set activation series + load / peak / time-above-threshold)
               risk.ts                 strain-risk rules (in-workout + multi-session)
               history.ts              localStorage session history (+ demo seed)
  coach/       rules.ts                offline rule-based coach (under/over-trained, push:pull balance, next-session plan)
               llm.ts                  calls /api/coach (vite.config.ts proxy) and falls back to rules
  three/       BodyCanvas.tsx          procedural 3D upper body (react-three-fiber); clickable heat-coloured muscles, posed arms
  ui/          Onboarding, WorkoutView (live), EmgScope (oscilloscope), SummaryView (overlay heatmap, risk, coach, history),
               ConnectPhone (QR pairing), ThemeToggle
  phone/       protocol.ts, PhoneLink.ts (desktop side), PhoneApp.tsx + AnatomyMap.tsx (the /phone page)
  styles/      tokens.css (light + dark colour tokens)   theme.ts  light/dark store (localStorage)
server/        sessionRelay.ts         Vite plugin: WebSocket relay for the phone
```

**Data flow.**
1. The `InputController` reads the trigger or Space as *effort*.
2. The `WorkoutEngine` turns effort into a per-muscle **neural drive**: exercise profile × load × effort.
3. The `SimulatedEmgSource` turns that drive into raw ADC counts. Each sample is serialised as a CSV line and parsed back with the same parser the serial adapter uses.
4. The `EmgProcessor` converts raw counts into activation (0–1 of MVC).
5. The `SliceRecorder` accumulates activation for the current set.
6. Finished slices are summed into the cumulative map, and the risk rules and coach read them.

**Strain-risk rules** (`engine/risk.ts`, tuned short so a demo can trigger them). A muscle group is flagged when any of these apply:
- more than 25 s (elevated) or 45 s (high) above 60 % activation in one workout;
- a single continuous hold above 70 % for 12 s or longer;
- 4 or more sets reaching near-max activation;
- it was heavily loaded again within 48 h, or had 3 heavy sessions in 7 days (from localStorage history). This raises the level by one.

Warnings are phrased as *risk + rest suggestion*, never as a diagnosis.

## Swapping in real EMG / Arduino

1. **Arduino sketch.** Print one line per sample at 115200 baud, about 100 Hz. Use the channel order in `src/domain/muscles.ts`.
   An envelope sensor such as MyoWare is ideal; its output is already rectified and smoothed.
   ```cpp
   const int pins[10] = {A0,A1,A2,A3,A4,A5,A6,A7,A8,A9};   // Mega; use a mux / fewer channels on Uno
   void setup(){ Serial.begin(115200); }
   void loop(){
     Serial.print(millis());
     for(int i=0;i<10;i++){ Serial.print(','); Serial.print(analogRead(pins[i])); }
     Serial.println(); delay(10);
   }
   ```
   Lines may be `millis,c0..c9` or `c0..c9`. Fewer channels: pass `channels: ['biceps','triceps',...]` to `new WebSerialEmgSource({ channels })`.
2. **In the app.** Click **Connect Arduino (Web Serial)** in the workout's left panel (Chrome/Edge). Or call `engine.useSource(new WebSerialEmgSource())`.
3. **Calibration.** With no calibration hint, `EmgProcessor` tracks the rest floor automatically and uses a running max as MVC.
   For real use, add a calibration step: 3 s rest, then 3 s max contraction per muscle. Pass the result as `calibrationHint`.
4. **Other transports** (BLE, WebSocket bridge from Python, etc.). Implement the 4-method `EmgSource` interface (`start`, `stop`, `onFrame`, `info`). Nothing else changes.

With real sensors, the gamepad only drives the avatar pose and rep counting. Muscle activation comes from the EMG itself.

## Status

- **Works:** onboarding scaling, 3D model with 14 clickable muscle groups (incl. core), 9 exercises with poses, simulated 100 Hz EMG with fatigue, gamepad and keyboard input, sets as slices, live / per-set / cumulative heatmaps, slice overlay toggles, live and summary strain warnings, localStorage history with multi-session escalation, sessions with rest tracking, rule-based coach, StepFun / OpenAI / Anthropic LLM coach, Android phone companion, light/dark theme.
- **Stubbed / simplified:** the Web Serial adapter is implemented but untested on hardware, with no calibration UI. Muscles are procedural ellipsoids, not anatomical meshes. Risk thresholds are demo-tuned, not validated. Left and right sides share one channel per group.
