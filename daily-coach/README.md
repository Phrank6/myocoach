# MyoCoach Daily: phone + EMG clothing coach

A web app that works on a phone and on a computer. It brings together what the **phone** knows (sleep, steps,
sitting, head-down phone time, late-night phone use, walking speed) and what the **EMG clothing** knows
(upper, lower and trunk muscle load, desk posture, glute activation, fatigue). From that, it suggests what to
train today. There is no wristband, so it does not use heart rate or HRV.

The EMG gym simulator in `../emg-coach-sim` is a separate app and is unchanged.

## Run

```bash
npm install
npm run dev        # http://localhost:5174; also on your Wi-Fi (the Network URL it prints) for your phone
npm run build      # static site in dist/, which any static host can serve
npm run preview    # serve the build at http://localhost:4174
npm run check-model  # the browser model still matches the NumPy model
```

**On a phone:** open the Network URL (same Wi-Fi), or the hosted site. Then use **Add to Home Screen**. It
opens full screen, and once it is built it also works offline (`public/sw.js`). Below 900 px wide the layout
switches to one column with a bottom tab bar.

## Screens

- **Today**:
  - **Readiness**, from last night's sleep, late phone use, clothing EMG fatigue, and the morning check-in (soreness, pain).
  - **Train today**: the model's best exercise for each movement pattern, sized to your session time and adjusted for readiness.
  - **Desk reset**: correctives triggered by long sitting, head-down time, upper-trap tension or low glute activation.
  - 14-day signal tiles, what the coach noticed, and habits for the month.
- **Trends**: 14- or 28-day bars for every signal, grouped by phone, clothes and check-in, with target lines.
- **You**: goal, body, schedule, equipment and pain areas. Exercises that load a painful area are never suggested.
  This is also where you import data, load the demo or clear everything. Data stays on the device (`localStorage`).

## Data in

There are no live sensors in the browser yet, so data arrives as files. Phone and garment exports can be
separate files; rows with the same date are merged. Each file needs one row per day with a `date` column,
plus any of these columns:

```
sleep_hours, sleep_midpoint_h, steps, sitting_hours, longest_sitting_bout_min, phone_screen_hours,
head_down_minutes, phone_after_23h_minutes, gait_speed_mps,
emg_load_upper, emg_load_lower, emg_load_trunk, upper_trap_desk_tone, glute_to_hamstring_ratio,
emg_fatigue_upper, emg_fatigue_lower, soreness, pain
```

CSV or JSON (an array of rows) both work. The app's own camelCase keys (see `src/data/types.ts`) work too.
Until something is imported, the app shows 28 days of demo data for a desk worker (`src/data/demo.ts`).

## How suggestions are made

- **Model** (`src/coach/model.ts`, weights in `src/coach/coach-model.json`): the two-tower recommender from
  `../ai_training_coach`. It was retrained on phone and clothing features only (`models/phone_garment_model`).
  It scores all 185 catalog exercises from your profile and your 4-week signal averages. On held-out people it
  scored NDCG@10 0.70, against 0.57 for a most-popular baseline. The training data is synthetic.
- **Rules** (`src/coach/coach.ts`, ported from `training_coach.py`): readiness, flags, desk correctives, habits,
  and the safety gate (equipment, experience level, pain areas). These are never learned.

Training guidance only, not medical advice.
