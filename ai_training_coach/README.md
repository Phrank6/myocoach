# AI Training Coach: trainable exercise-suggestion model

Everything is in one Python file, `training_coach.py`. It needs only Python 3.10+ and NumPy.

It learns **which exercises to suggest** from a person's information (profile, goal, sleep,
steps, sitting, phone use, walking speed and posture, garment EMG). It then turns those
suggestions into a full weekly plan with sets, reps, time cost and expected results over time.

## Folder contents

| Path | What it is |
|---|---|
| `training_coach.py` | Catalog, data loader, model, planner, result predictor, readiness check and command line |
| `data/dataset_template.csv` | The column layout your dataset should follow (2 example rows) |
| `data/exercise_catalog.csv` | The 185 built-in exercises: common US gym, home, cardio, mobility and balance moves |
| `data/demo_dataset.csv` | 3,000 generated people, labelled by the rule planner. **Demo only** |
| `models/demo_model/` | A model trained on the demo data, so `plan` works right away. Replace it with yours |
| `examples/profile_*.json` | Example people (profile + 14 days of sensor summaries + check-ins) |
| `examples/plan_example.md` | Example output plan |
| `tests/` | 16 tests: `python -m unittest discover -s tests` |

## Quick start

```bash
pip install numpy
python training_coach.py inspect data/dataset_template.csv     # check that a dataset is read correctly
python training_coach.py train   data/YOUR_DATA.csv --out models/coach_model
python training_coach.py plan    --model models/coach_model --profile examples/profile_example.json -o plan.md
python training_coach.py recommend --model models/coach_model --profile examples/profile_example.json --top 15
```

Training 3,000 rows takes a few seconds on a laptop CPU.

## Preparing your dataset

**Wide format (recommended):** one row per person, or per person-period. Use the feature columns
plus one label column called `exercises`. That column lists the movements that person should
do, separated by `;`.

```
sample_id,age,sex,goal,equipment,sleep_hours,steps,sitting_hours,...,exercises
p001,34,female,active,none;bands,6.4,4200,9.5,...,Glute Bridge; Chin Tuck; Brisk Walk
```

- **Feature columns:** any subset of the names in `dataset_template.csv` works, and missing values are fine. Extra columns are picked up automatically:
  - Numbers are standardized, and missing values are filled in and flagged.
  - Text columns are one-hot encoded.
  - Lists such as `none;bands` are multi-hot encoded.
- **Ignored columns:** `sample_id`, `user_id`, `date`, `week` and `timestamp`.
- **Exercise names:** free text works. "Bench Press", "push ups" and "RDL" are matched to the catalog. A name that isn't in the catalog becomes a new movement, and its type is guessed from its name. Run `inspect` to see how names were matched.
- **Soft labels:** `Incline Dumbbell Press:0.6` gives a weight between 0 and 1. You can use ratings, completion rates or coach confidence.
- **Different label column name:** pass `--label-col my_column`.

**Long format:** one row per person and exercise, with columns `sample_id, exercise` and
optionally `label`, `rating` (1-5) or `score`. The feature columns repeat on each row.

CSV, TSV, JSON and JSONL are read with no extra packages. Excel and Parquet need `pandas`.

## How the model works

```
person features ──► MLP (128, ReLU, dropout) ──► user vector u (48-d)
exercise j ──► learned embedding E_j + (catalog metadata_j × W_m) ──► exercise vector v_j
score(person, j) = sigmoid(u · v_j + bias_j)
```

- It is trained as multi-label prediction over the whole catalog. The loss is weighted binary cross-entropy, with positives up-weighted because each person does only a few exercises. Training uses Adam, L2 regularization and early stopping on validation NDCG@10. The default split is 70/15/15.
- The metadata part (category, pattern, muscles, equipment, level, contraindications) lets the model score exercises that are rare or missing in your data.
- After training it prints test metrics for the model and for a "most popular exercises" baseline. If the model doesn't beat the baseline, the dataset doesn't hold a learnable signal yet.
- Safety rules are never learned. Screening red flags, pain areas, equipment and experience level filter the model's output before anything is suggested.
- The planner fills each slot of the week, such as "horizontal push" or "core", with the highest-scoring allowed exercise. It then adds sets, reps, rest, time budget, habits, nutrition and the results forecast.

Useful settings: `--epochs 80 --hidden 128 --dim 48 --lr 0.003 --dropout 0.1 --l2 1e-4`.
For small datasets (under ~1,000 rows), try `--hidden 64 --dim 24 --dropout 0.2`.

## A good way to use the demo data

The demo labels come from the rule planner. Train on demo data plus your real data at first.
As your data grows, drop the demo rows. This gives the model sensible defaults for kinds of
people your data hasn't covered yet.

## What the forecasts are

The "what to expect" ranges come from published average responses of beginners: ACSM 2026,
WHO 2020, and the meta-analyses listed in the project design doc. They are adjusted for the
plan's dose and for check-in results. They are not learned from your dataset in this version.
