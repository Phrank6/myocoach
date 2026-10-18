# MyoCoach — EMG smart gym coach (simulation prototype)

LA Hacks prototype of an EMG-based **upper-body smart gym coach**. Everything runs in the browser.
There are no real sensors yet: a simulated Arduino streams EMG, and a gamepad or keyboard performs the reps.

**Loop:** build body model → train sets (each set = a *slice*) → live 3D muscle activation → cumulative heatmap → strain-risk warnings → AI coach plan.

## Run

```bash
npm install
npm run dev            # http://localhost:5173
# optional LLM coach (server-side proxy, key never reaches the browser):
OPENAI_API_KEY=sk-... npm run dev          # optional OPENAI_MODEL (default gpt-4o-mini), OPENAI_BASE_URL
ANTHROPIC_API_KEY=... npm run dev          # optional ANTHROPIC_MODEL
npm run build && npm run preview            # production build (proxy also works in preview)
```

Without a key the coach is fully rule-based and offline. The LLM proxy only exists in `vite dev` / `vite preview`.
A static host has no proxy, so the app falls back to rules there.

### Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Lift / perform rep (effort) | hold **Space** | **RT** (analog) or right/left stick up, LT = digital |
| Start / end set | **Enter** | **A** |
| Previous / next exercise | ← → or Q / E | LB / RB, D-pad ← → |
| Load (intensity) | ↑ ↓ or − / = | D-pad ↑ ↓ |
| Auto-rep (hands-free demo) | **A** | **Y** |
| Finish workout | **F** | **Start** |

A set starts automatically when you first apply effort. It ends on Enter/A, or after 6 s idle. Click any muscle on the 3D model for details.

### Demo recording
`scripts/record-demo.mjs` drives the app with Playwright and records it: keyboard input, a scripted *virtual* Gamepad-API controller, and on-screen captions.
Run it with `DISPLAY=:1 node scripts/record-demo.mjs out.mp4 summary.png`, with the dev server running. It needs `ffmpeg` and Chrome.

## Architecture

```
src/
  domain/      muscles.ts (10 muscle groups = 10 EMG channels), exercises.ts (activation profiles + arm poses), profile.ts
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
  ui/          Onboarding, WorkoutView (live), EmgScope (oscilloscope), SummaryView (overlay heatmap, risk, coach, history)
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

- **Works:** onboarding scaling, 3D model with 10 clickable muscle groups, 9 exercises with poses, simulated 100 Hz EMG with fatigue, gamepad and keyboard input, sets as slices, live / per-set / cumulative heatmaps, slice overlay toggles, live and summary strain warnings, localStorage history with multi-session escalation, rule-based coach, optional LLM coach.
- **Stubbed / simplified:** the Web Serial adapter is implemented but untested on hardware, with no calibration UI. Muscles are procedural ellipsoids, not anatomical meshes. Risk thresholds are demo-tuned, not validated. Left and right sides share one channel per group.
