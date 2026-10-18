"""Run: python -m unittest discover -s tests"""
import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import numpy as np  # noqa: E402
import training_coach as tc  # noqa: E402


def demo_profile(**kw):
    d = dict(name="T", age=30, sex="male", height_cm=178, weight_kg=75, goal="strength",
             days_per_week=3, minutes_per_week=200, equipment=["gym"])
    d.update(kw)
    return tc.Profile.from_dict(d)


def demo_signals(**kw):
    base = dict(sleep_hours=7.5, hrv_rmssd_ms=60, resting_hr=58, steps=7000, sitting_hours=6,
                gait_speed_mps=1.3)
    base.update(kw)
    out = []
    for i in range(14):
        d = dict(base, date=f"d{i}")
        d["hrv_rmssd_ms"] += (i % 3 - 1) * 4
        out.append(tc.DailySignals.from_dict(d))
    return out


class CatalogTests(unittest.TestCase):
    def test_catalog_is_consistent(self):
        self.assertGreater(len(tc.CATALOG), 150)
        self.assertEqual(len(tc.BY_ID), len(tc.CATALOG))
        for e in tc.CATALOG:
            self.assertIn(e.level, (1, 2, 3))
            self.assertTrue(e.cue, e.id)

    def test_name_matching(self):
        self.assertEqual(tc.match_exercise("Bench Press"), "barbell_bench_press")
        self.assertEqual(tc.match_exercise("push ups"), "push_up")
        self.assertEqual(tc.match_exercise("Goblet squats"), "goblet_squat")
        self.assertEqual(tc.match_exercise("RDL"), "dumbbell_romanian_deadlift")
        self.assertIsNone(tc.match_exercise("underwater basket weaving"))

    def test_unknown_movement_is_guessed(self):
        g = tc.guess_exercise("Zottman Curl")
        self.assertEqual(g.pattern, "upper_accessory")


class DataAndModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.data = cls.tmp / "demo.csv"
        tc.write_csv(tc.make_demo_data(600, seed=3), str(cls.data))
        cls.info = tc.train_model(str(cls.data), str(cls.tmp / "m"), epochs=25, verbose=False)
        cls.model = tc.CoachModel.load(str(cls.tmp / "m"))

    def test_model_beats_popularity(self):
        t = self.info["test_metrics"]
        self.assertGreater(t["model"]["ndcg@10"], t["popularity_baseline"]["ndcg@10"])

    def test_gradients_match_numeric(self):
        rng = np.random.default_rng(0)
        X = rng.normal(size=(5, 4))
        Y = (rng.random((5, 6)) > 0.6).astype(float)
        M = (rng.random((6, 3)) > 0.5).astype(float)
        r = tc.ExerciseRecommender(4, M, hidden=5, dim=3, seed=1)
        loss, g = r._loss_grad(X, Y, 2.0, 1e-3, 0.0, rng)
        for k in ("W1", "W2", "E", "Wm", "c"):
            idx = tuple(0 for _ in r.p[k].shape)
            old = r.p[k][idx]
            r.p[k][idx] = old + 1e-5
            lp, _ = r._loss_grad(X, Y, 2.0, 1e-3, 0.0, rng)
            r.p[k][idx] = old - 1e-5
            lm, _ = r._loss_grad(X, Y, 2.0, 1e-3, 0.0, rng)
            r.p[k][idx] = old
            self.assertAlmostEqual((lp - lm) / 2e-5, g[k][idx], places=5, msg=k)

    def test_save_load_same_scores(self):
        rows = tc.load_dataset(str(self.data)).rows[:3]
        a = self.model.score_rows(rows)
        self.model.save(str(self.tmp / "m2"))
        b = tc.CoachModel.load(str(self.tmp / "m2")).score_rows(rows)
        np.testing.assert_allclose(a, b)

    def test_long_format_and_unknown_names(self):
        path = self.tmp / "long.csv"
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["sample_id", "age", "goal", "exercise", "rating"])
            w.writerows([["a", 30, "fit", "Jogging", 5], ["a", 30, "fit", "Zottman Curl", 4],
                         ["b", 60, "health", "walking", 5]])
        ds = tc.load_dataset(str(path))
        self.assertEqual(len(ds.rows), 2)
        self.assertIn("Zottman Curl", ds.unmatched)
        ids = dict(ds.labels[0])
        self.assertAlmostEqual(ids["jogging"], 1.0)

    def test_soft_labels(self):
        self.assertEqual(tc._parse_labels("squat; push up:0.5"), [("squat", 1.0), ("push up", 0.5)])

    def test_missing_columns_at_inference(self):
        # a profile row with most features missing must still score
        probs = self.model.score_rows([{"age": 40, "goal": "health"}])
        self.assertEqual(probs.shape, (1, len(self.model.items)))
        self.assertTrue(np.isfinite(probs).all())

    def test_plan_uses_model_and_respects_safety(self):
        p = demo_profile(pain_areas=["knee", "shoulder"])
        res = tc.run(p, demo_signals(), model=self.model)
        self.assertEqual(res["plan"]["suggested_by"], "trained model")
        for s in res["plan"]["sessions"]:
            for b in s["blocks"]:
                self.assertFalse({"knee", "shoulder"} & set(tc.BY_ID[b["exercise_id"]].contraindications))
        for r in res["top_suggestions"]:
            self.assertFalse({"knee", "shoulder"} & set(tc.BY_ID[r["exercise_id"]].contraindications))


class PlannerTests(unittest.TestCase):
    def test_red_flag_restricts(self):
        p = demo_profile(goal="body_shape", screening={"chest_pain": True})
        plan = tc.build_plan(p, tc.summarize(demo_signals()), tc.screen(p))
        self.assertEqual(plan["tier"], "health")

    def test_budget_and_session_cap(self):
        for g in tc.TIERS:
            p = demo_profile(goal=g, minutes_per_week=180, max_minutes_per_session=45)
            plan = tc.build_plan(p, tc.summarize(demo_signals(sitting_hours=9)), tc.screen(p))
            self.assertLessEqual(plan["weekly_minutes_planned"], 185, g)
            for s in plan["sessions"]:
                self.assertLessEqual(s["minutes"], 46)

    def test_equipment_respected(self):
        p = demo_profile(equipment=["none"])
        plan = tc.build_plan(p, tc.summarize(demo_signals()), tc.screen(p))
        for s in plan["sessions"]:
            for b in s["blocks"]:
                self.assertEqual(tc.BY_ID[b["exercise_id"]].equipment, "none")


class PredictorReadinessTests(unittest.TestCase):
    def test_checkin_narrows(self):
        p, dose = demo_profile(), {"strength": 1.0}
        a = tc.forecast("strength_pct", p, dose, [tc.CheckIn(0, {"strength_pct": 0})])
        b = tc.forecast("strength_pct", p, dose, [tc.CheckIn(0, {"strength_pct": 0}),
                                                  tc.CheckIn(4, {"strength_pct": 25}),
                                                  tc.CheckIn(8, {"strength_pct": 40})])
        wa = a["change_by_week"][12][2] - a["change_by_week"][12][0]
        wb = b["change_by_week"][12][2] - b["change_by_week"][12][0]
        self.assertLess(wb, wa)

    def test_red_day(self):
        base = tc.summarize(demo_signals())
        r = tc.assess_readiness(tc.DailySignals(sleep_hours=4, hrv_rmssd_ms=40, resting_hr=66), base)
        self.assertEqual(r["zone"], "red")


class CliTests(unittest.TestCase):
    def test_examples_plan(self):
        for f in (ROOT / "examples").glob("profile_*.json"):
            res = tc.run(**{k: v for k, v in tc.load_profile_file(str(f)).items()
                            if k in ("profile", "signals", "checkins", "today", "today_weekday")})
            self.assertTrue(res["plan"]["sessions"])
            self.assertIn("What to expect", tc.render_markdown(res))


if __name__ == "__main__":
    unittest.main()
