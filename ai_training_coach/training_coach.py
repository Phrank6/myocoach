#!/usr/bin/env python3
"""
AI Training Coach: a trainable exercise-suggestion model plus the rule-based training planner.

One file, needs only Python 3.10+ and NumPy.

What it does
------------
1. CATALOG    ~190 exercises covering the common US gym / home / cardio / mobility catalog, each
              tagged with category, movement pattern, muscles, equipment, level, contraindications.
2. MODEL      A neural recommender (NumPy, trained with Adam) that learns which exercises to
              suggest from a person's information (profile, goal, sleep, steps, sitting, phone
              use, gait, EMG...). It is a two-tower model:
                  user tower:     features -> MLP -> user vector u
                  exercise tower: learned embedding + projection of catalog metadata -> v_j
                  score(user, exercise j) = u . v_j + bias_j          (sigmoid -> probability)
              The metadata part lets it score exercises that are rare or absent in the data.
3. SAFETY     Hard rules (screening red flags, pain areas, equipment) mask the model's output.
              They are never learned.
4. PLANNER    Goal tiers (health -> active -> fit -> strength -> body shape) with evidence-based
              weekly dose, time budgeting, sessions with sets/reps/RIR/rest, daily habits,
              nutrition targets. Exercise slots are filled with the model's top choices.
5. PREDICTOR  Expected results at weeks 4/8/12/26 as ranges, updated from check-ins.
6. READINESS  Today's session adjusted for sleep, HRV, resting HR, soreness, EMG fatigue.

Commands
--------
    python training_coach.py make-demo-data --n 3000 --out data/demo_dataset.csv
    python training_coach.py inspect   data/your_dataset.csv
    python training_coach.py train     data/your_dataset.csv --out models/coach_model
    python training_coach.py evaluate  data/your_dataset.csv --model models/coach_model
    python training_coach.py recommend --model models/coach_model --profile examples/profile_example.json
    python training_coach.py plan      --model models/coach_model --profile examples/profile_example.json -o plan.md
    python training_coach.py catalog   --out catalog.csv

Dataset format: see README.md and data/dataset_template.csv. In short, one row per person
(or person-period), feature columns, and a label column (default name "exercises") listing the
suggested movements separated by ";" (optionally "name:score" with score 0-1). A long format
(sample_id, exercise, label) is also accepted.

Design background: design/personalized-training-engine-design.md in the project.
"""
from __future__ import annotations

import argparse
import copy
import csv
import difflib
import json
import math
import random
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from statistics import mean, pstdev
from typing import Optional

import numpy as np

__version__ = "0.2.0"

# =============================================================================================
# 1. EXERCISE CATALOG
# =============================================================================================
# id | name | category | pattern | muscles | equipment | level | contraindications
# category:  strength, cardio, plyometric, balance, mobility, corrective
# pattern:   squat, hinge, single_leg, leg_accessory, push_h, push_v, pull_h, pull_v,
#            upper_accessory, calves, core, carry, cardio, plyometric, balance, mobility, corrective
# equipment: none, bands, dumbbells, kettlebell, barbell, machine, cable, pull_up_bar,
#            cardio_machine, medicine_ball, pool        ("gym" in a profile means all of these)
# level:     1 beginner, 2 intermediate, 3 advanced
_CATALOG_TABLE = """
bodyweight_squat|Bodyweight Squat|strength|squat|quads,glutes|none|1|
sit_to_stand|Sit-to-Stand|strength|squat|quads,glutes|none|1|
box_squat|Box Squat|strength|squat|quads,glutes|none|1|
wall_sit|Wall Sit|strength|squat|quads|none|1|knee
band_squat|Banded Squat|strength|squat|quads,glutes|bands|1|
goblet_squat|Goblet Squat|strength|squat|quads,glutes,core|dumbbells|2|knee
kettlebell_goblet_squat|Kettlebell Goblet Squat|strength|squat|quads,glutes,core|kettlebell|2|knee
dumbbell_squat|Dumbbell Squat|strength|squat|quads,glutes|dumbbells|2|knee
sumo_squat|Dumbbell Sumo Squat|strength|squat|quads,glutes,adductors|dumbbells|2|
leg_press|Leg Press|strength|squat|quads,glutes|machine|1|
hack_squat|Hack Squat|strength|squat|quads,glutes|machine|2|knee
smith_machine_squat|Smith Machine Squat|strength|squat|quads,glutes|machine|2|knee
barbell_back_squat|Barbell Back Squat|strength|squat|quads,glutes,back|barbell|3|knee,low_back
barbell_front_squat|Barbell Front Squat|strength|squat|quads,glutes,core|barbell|3|knee,wrist
glute_bridge|Glute Bridge|strength|hinge|glutes,hamstrings|none|1|
single_leg_glute_bridge|Single-Leg Glute Bridge|strength|hinge|glutes,hamstrings|none|2|
kettlebell_deadlift|Kettlebell Deadlift|strength|hinge|glutes,hamstrings,back|kettlebell|1|
band_good_morning|Band Good Morning|strength|hinge|hamstrings,glutes,back|bands|1|
cable_pull_through|Cable Pull-Through|strength|hinge|glutes,hamstrings|cable|1|
back_extension|Back Extension (45 degree)|strength|hinge|back,glutes,hamstrings|machine|1|low_back
dumbbell_hip_thrust|Dumbbell Hip Thrust|strength|hinge|glutes,hamstrings|dumbbells|2|
barbell_hip_thrust|Barbell Hip Thrust|strength|hinge|glutes,hamstrings|barbell|2|
dumbbell_romanian_deadlift|Dumbbell Romanian Deadlift|strength|hinge|hamstrings,glutes,back|dumbbells|2|low_back
kettlebell_swing|Kettlebell Swing|strength|hinge|glutes,hamstrings,core|kettlebell|2|low_back
trap_bar_deadlift|Trap Bar Deadlift|strength|hinge|glutes,quads,hamstrings|barbell|2|low_back
barbell_romanian_deadlift|Barbell Romanian Deadlift|strength|hinge|hamstrings,glutes,back|barbell|3|low_back
conventional_deadlift|Conventional Deadlift|strength|hinge|hamstrings,glutes,back|barbell|3|low_back
sumo_deadlift|Sumo Deadlift|strength|hinge|glutes,hamstrings,adductors|barbell|3|low_back
step_up|Step-Up|strength|single_leg|quads,glutes|none|1|knee
reverse_lunge|Reverse Lunge|strength|single_leg|quads,glutes|none|1|knee
split_squat|Split Squat|strength|single_leg|quads,glutes|none|2|knee
forward_lunge|Forward Lunge|strength|single_leg|quads,glutes|none|2|knee
lateral_lunge|Lateral Lunge|strength|single_leg|quads,glutes,adductors|none|2|knee
curtsy_lunge|Curtsy Lunge|strength|single_leg|glutes,quads|none|2|knee
dumbbell_step_up|Dumbbell Step-Up|strength|single_leg|quads,glutes|dumbbells|2|knee
dumbbell_split_squat|Dumbbell Split Squat|strength|single_leg|quads,glutes|dumbbells|2|knee
dumbbell_walking_lunge|Dumbbell Walking Lunge|strength|single_leg|quads,glutes|dumbbells|2|knee
single_leg_romanian_deadlift|Single-Leg Romanian Deadlift|strength|single_leg|hamstrings,glutes|dumbbells|2|
bulgarian_split_squat|Bulgarian Split Squat|strength|single_leg|quads,glutes|dumbbells|3|knee
single_leg_box_squat|Single-Leg Box Squat|strength|single_leg|quads,glutes|none|3|knee
band_lateral_walk|Banded Lateral Walk|strength|leg_accessory|glutes|bands|1|
hip_abduction_machine|Hip Abduction Machine|strength|leg_accessory|glutes|machine|1|
hip_adduction_machine|Hip Adduction Machine|strength|leg_accessory|adductors|machine|1|
cable_glute_kickback|Cable Glute Kickback|strength|leg_accessory|glutes|cable|1|
lying_leg_curl|Lying Leg Curl|strength|leg_accessory|hamstrings|machine|1|
seated_leg_curl|Seated Leg Curl|strength|leg_accessory|hamstrings|machine|1|
leg_extension|Leg Extension|strength|leg_accessory|quads|machine|1|knee
stability_ball_leg_curl|Stability Ball Leg Curl|strength|leg_accessory|hamstrings,glutes|none|2|
nordic_hamstring_curl|Nordic Hamstring Curl|strength|leg_accessory|hamstrings|none|3|knee
wall_push_up|Wall Push-Up|strength|push_h|chest,triceps,shoulders|none|1|
incline_push_up|Incline Push-Up|strength|push_h|chest,triceps,shoulders|none|1|wrist
knee_push_up|Knee Push-Up|strength|push_h|chest,triceps,shoulders|none|1|wrist
band_chest_press|Band Chest Press|strength|push_h|chest,triceps|bands|1|
machine_chest_press|Machine Chest Press|strength|push_h|chest,triceps,shoulders|machine|1|
dumbbell_floor_press|Dumbbell Floor Press|strength|push_h|chest,triceps|dumbbells|1|
assisted_dip|Assisted Dip|strength|push_h|chest,triceps|machine|1|shoulder
push_up|Push-Up|strength|push_h|chest,triceps,shoulders|none|2|wrist
dumbbell_bench_press|Dumbbell Bench Press|strength|push_h|chest,triceps,shoulders|dumbbells|2|shoulder
incline_dumbbell_press|Incline Dumbbell Press|strength|push_h|chest,shoulders,triceps|dumbbells|2|shoulder
decline_push_up|Decline Push-Up|strength|push_h|chest,shoulders,triceps|none|3|wrist,shoulder
barbell_bench_press|Barbell Bench Press|strength|push_h|chest,triceps,shoulders|barbell|3|shoulder
incline_barbell_bench_press|Incline Barbell Bench Press|strength|push_h|chest,shoulders,triceps|barbell|3|shoulder
parallel_bar_dip|Parallel Bar Dip|strength|push_h|chest,triceps,shoulders|machine|3|shoulder
band_overhead_press|Band Overhead Press|strength|push_v|shoulders,triceps|bands|1|shoulder
machine_shoulder_press|Machine Shoulder Press|strength|push_v|shoulders,triceps|machine|1|shoulder
landmine_press|Landmine Press|strength|push_v|shoulders,chest,triceps|barbell|2|
pike_push_up|Pike Push-Up|strength|push_v|shoulders,triceps|none|2|shoulder,wrist
dumbbell_shoulder_press|Dumbbell Shoulder Press|strength|push_v|shoulders,triceps|dumbbells|2|shoulder
arnold_press|Arnold Press|strength|push_v|shoulders,triceps|dumbbells|2|shoulder
half_kneeling_dumbbell_press|Half-Kneeling Single-Arm Press|strength|push_v|shoulders,core|dumbbells|2|shoulder
kettlebell_overhead_press|Kettlebell Overhead Press|strength|push_v|shoulders,triceps|kettlebell|2|shoulder
barbell_overhead_press|Barbell Overhead Press|strength|push_v|shoulders,triceps,core|barbell|3|shoulder,low_back
towel_row|Door Towel Row|strength|pull_h|back,biceps|none|1|
band_row|Band Seated Row|strength|pull_h|back,biceps|bands|1|
seated_cable_row|Seated Cable Row|strength|pull_h|back,biceps|cable|1|
machine_row|Machine Row|strength|pull_h|back,biceps|machine|1|
chest_supported_dumbbell_row|Chest-Supported Dumbbell Row|strength|pull_h|back,biceps|dumbbells|1|
inverted_row|Inverted Row|strength|pull_h|back,biceps|none|2|
single_arm_dumbbell_row|Single-Arm Dumbbell Row|strength|pull_h|back,biceps|dumbbells|2|
kettlebell_row|Kettlebell Row|strength|pull_h|back,biceps|kettlebell|2|
bent_over_barbell_row|Bent-Over Barbell Row|strength|pull_h|back,biceps|barbell|3|low_back
t_bar_row|T-Bar Row|strength|pull_h|back,biceps|barbell|3|low_back
renegade_row|Renegade Row|strength|pull_h|back,core|dumbbells|3|wrist
band_lat_pulldown|Band Lat Pulldown|strength|pull_v|back,biceps|bands|1|
lat_pulldown|Lat Pulldown|strength|pull_v|back,biceps|cable|1|
straight_arm_pulldown|Straight-Arm Cable Pulldown|strength|pull_v|back|cable|1|
assisted_pull_up|Assisted Pull-Up|strength|pull_v|back,biceps|machine|1|shoulder
negative_pull_up|Negative Pull-Up|strength|pull_v|back,biceps|pull_up_bar|2|shoulder
pull_up|Pull-Up|strength|pull_v|back,biceps|pull_up_bar|3|shoulder
chin_up|Chin-Up|strength|pull_v|back,biceps|pull_up_bar|3|shoulder
dumbbell_curl|Dumbbell Biceps Curl|strength|upper_accessory|biceps|dumbbells|1|
hammer_curl|Hammer Curl|strength|upper_accessory|biceps,forearms|dumbbells|1|
concentration_curl|Concentration Curl|strength|upper_accessory|biceps|dumbbells|1|
cable_curl|Cable Curl|strength|upper_accessory|biceps|cable|1|
band_curl|Band Curl|strength|upper_accessory|biceps|bands|1|
preacher_curl_machine|Machine Preacher Curl|strength|upper_accessory|biceps|machine|1|
barbell_curl|Barbell Curl|strength|upper_accessory|biceps|barbell|2|
triceps_pushdown|Cable Triceps Pushdown|strength|upper_accessory|triceps|cable|1|
band_triceps_extension|Band Triceps Extension|strength|upper_accessory|triceps|bands|1|
overhead_triceps_extension|Dumbbell Overhead Triceps Extension|strength|upper_accessory|triceps|dumbbells|1|shoulder
bench_dip|Bench Dip|strength|upper_accessory|triceps|none|1|shoulder,wrist
close_grip_push_up|Close-Grip Push-Up|strength|upper_accessory|triceps,chest|none|2|wrist
skull_crusher|Lying Triceps Extension (Skull Crusher)|strength|upper_accessory|triceps|barbell|2|shoulder
dumbbell_lateral_raise|Dumbbell Lateral Raise|strength|upper_accessory|shoulders|dumbbells|1|shoulder
cable_lateral_raise|Cable Lateral Raise|strength|upper_accessory|shoulders|cable|1|shoulder
front_raise|Dumbbell Front Raise|strength|upper_accessory|shoulders|dumbbells|1|shoulder
rear_delt_fly|Bent-Over Rear Delt Fly|strength|upper_accessory|shoulders,upper_back|dumbbells|1|
reverse_pec_deck|Reverse Pec Deck|strength|upper_accessory|shoulders,upper_back|machine|1|
face_pull|Cable Face Pull|strength|upper_accessory|upper_back,shoulders|cable|1|
band_face_pull|Band Face Pull|strength|upper_accessory|upper_back,shoulders|bands|1|
cable_chest_fly|Cable Chest Fly|strength|upper_accessory|chest|cable|1|shoulder
pec_deck|Pec Deck|strength|upper_accessory|chest|machine|1|shoulder
dumbbell_fly|Dumbbell Fly|strength|upper_accessory|chest|dumbbells|2|shoulder
dumbbell_shrug|Dumbbell Shrug|strength|upper_accessory|traps|dumbbells|1|neck
wrist_curl|Dumbbell Wrist Curl|strength|upper_accessory|forearms|dumbbells|1|wrist
standing_calf_raise|Standing Calf Raise|strength|calves|calves|none|1|
dumbbell_calf_raise|Dumbbell Calf Raise|strength|calves|calves|dumbbells|1|
seated_calf_raise|Seated Calf Raise|strength|calves|calves|machine|1|
single_leg_calf_raise|Single-Leg Calf Raise|strength|calves|calves|none|2|
dead_bug|Dead Bug|strength|core|core|none|1|
bird_dog|Bird Dog|strength|core|core,back|none|1|
front_plank|Front Plank|strength|core|core|none|1|
superman|Superman Hold|strength|core|back,glutes|none|1|
band_pallof_press|Band Pallof Press|strength|core|core|bands|1|
cable_pallof_press|Cable Pallof Press|strength|core|core|cable|1|
crunch|Crunch|strength|core|core|none|1|neck
side_plank|Side Plank|strength|core|core|none|2|shoulder
reverse_crunch|Reverse Crunch|strength|core|core|none|2|
bicycle_crunch|Bicycle Crunch|strength|core|core|none|2|neck
mountain_climber|Mountain Climber|strength|core|core,shoulders|none|2|wrist
russian_twist|Russian Twist|strength|core|core|none|2|low_back
hollow_body_hold|Hollow Body Hold|strength|core|core|none|2|low_back
cable_crunch|Cable Crunch|strength|core|core|cable|2|
hanging_knee_raise|Hanging Knee Raise|strength|core|core|pull_up_bar|2|shoulder
hanging_leg_raise|Hanging Leg Raise|strength|core|core|pull_up_bar|3|shoulder
ab_wheel_rollout|Ab Wheel Rollout|strength|core|core|none|3|low_back,shoulder
farmers_carry|Farmer's Carry|strength|carry|forearms,core,back|dumbbells|1|
suitcase_carry|Suitcase Carry|strength|carry|core,forearms|dumbbells|1|
kettlebell_rack_carry|Kettlebell Rack Carry|strength|carry|core,shoulders|kettlebell|2|
overhead_carry|Overhead Carry|strength|carry|shoulders,core|dumbbells|2|shoulder
brisk_walk|Brisk Walk|cardio|cardio|heart,legs|none|1|
dance_cardio|Dance Cardio|cardio|cardio|heart,legs|none|1|
incline_treadmill_walk|Incline Treadmill Walk|cardio|cardio|heart,legs|cardio_machine|1|
stationary_bike|Stationary Bike|cardio|cardio|heart,legs|cardio_machine|1|
elliptical|Elliptical Trainer|cardio|cardio|heart,legs|cardio_machine|1|
water_aerobics|Water Aerobics|cardio|cardio|heart,full_body|pool|1|
hiking|Hiking|cardio|cardio|heart,legs|none|2|knee
jogging|Jogging|cardio|cardio|heart,legs|none|2|knee
rowing_machine|Rowing Machine|cardio|cardio|heart,back,legs|cardio_machine|2|low_back
stair_climber|Stair Climber|cardio|cardio|heart,legs|cardio_machine|2|knee
swimming_laps|Swimming Laps|cardio|cardio|heart,full_body|pool|2|shoulder
bike_intervals|Bike Intervals|cardio|cardio|heart,legs|cardio_machine|2|
intervals_4x4|4x4 Intervals (walk-run, bike or rower)|cardio|cardio|heart,legs|none|2|knee
jump_rope|Jump Rope|cardio|cardio|heart,calves|none|2|knee
bodyweight_hiit_circuit|Bodyweight HIIT Circuit|cardio|cardio|heart,full_body|none|2|knee,wrist
running_intervals|Running Intervals|cardio|cardio|heart,legs|none|3|knee
jump_squat|Jump Squat|plyometric|plyometric|quads,glutes,calves|none|2|knee
skater_jump|Skater Jump|plyometric|plyometric|glutes,quads|none|2|knee
medicine_ball_slam|Medicine Ball Slam|plyometric|plyometric|core,shoulders,back|medicine_ball|2|low_back
burpee|Burpee|plyometric|plyometric|full_body|none|2|wrist,knee,low_back
box_jump|Box Jump|plyometric|plyometric|quads,glutes,calves|none|2|knee
broad_jump|Broad Jump|plyometric|plyometric|glutes,quads|none|3|knee
single_leg_stand|Single-Leg Balance|balance|balance|ankles,core|none|1|
heel_to_toe_walk|Heel-to-Toe Walk|balance|balance|ankles,core|none|1|
tai_chi|Tai Chi Session|balance|balance_class|full_body|none|1|
single_leg_reach|Single-Leg Reach|balance|balance|glutes,ankles,core|none|2|knee
half_kneeling_hip_flexor_stretch|Half-Kneeling Hip-Flexor Stretch|corrective|corrective|hip_flexors|none|1|
chin_tuck|Chin Tuck|corrective|corrective|neck|none|1|
band_pull_apart|Band Pull-Apart|corrective|corrective|upper_back,shoulders|bands|1|
wall_angel|Wall Angel|corrective|corrective|upper_back,shoulders|none|1|shoulder
prone_y_t_raise|Prone Y-T Raise|corrective|corrective|upper_back|none|1|
thoracic_extension_chair|Chair Thoracic Extension|corrective|corrective|upper_back|none|1|
clamshell|Clamshell|corrective|corrective|glutes|none|1|
doorway_pec_stretch|Doorway Pec Stretch|corrective|corrective|chest|none|1|shoulder
upper_trap_stretch|Upper Trap Stretch|corrective|corrective|neck|none|1|
cat_cow|Cat-Cow|mobility|mobility|back|none|1|
childs_pose|Child's Pose|mobility|mobility|back,hips|none|1|knee
worlds_greatest_stretch|World's Greatest Stretch|mobility|mobility|hips,upper_back|none|1|
standing_hamstring_stretch|Standing Hamstring Stretch|mobility|mobility|hamstrings|none|1|
figure_four_stretch|Figure-4 Glute Stretch|mobility|mobility|glutes|none|1|
open_book_rotation|Open Book Rotation|mobility|mobility|upper_back|none|1|
hip_90_90|90/90 Hip Switch|mobility|mobility|hips|none|1|knee
knee_to_wall_ankle_mobility|Knee-to-Wall Ankle Mobility|mobility|mobility|ankles|none|1|
foam_roll_quads|Foam Roll Quads and IT Band|mobility|mobility|quads|none|1|
beginner_yoga_flow|Beginner Yoga Flow|mobility|mobility|full_body|none|1|wrist
"""

_CUES = {
    "squat": "Sit back and down, knees track over toes, chest up, brace your core.",
    "hinge": "Push hips back with a flat back, feel the hamstrings, then squeeze glutes to stand.",
    "single_leg": "Keep the front knee over the middle of the foot and hips level.",
    "leg_accessory": "Control the lowering, pause briefly at full contraction.",
    "push_h": "Shoulder blades pulled back and down, elbows about 45 degrees from the body.",
    "push_v": "Ribs down, glutes squeezed, press straight overhead without arching.",
    "pull_h": "Pull elbows back toward the hips, squeeze shoulder blades, no shrugging.",
    "pull_v": "Pull elbows down to the ribs, chest up, control the way back.",
    "upper_accessory": "Keep the joint above still, move only the working joint, full range.",
    "calves": "Full stretch at the bottom, pause one second at the top.",
    "core": "Keep your low back neutral and breathe steadily.",
    "carry": "Tall posture, ribs down, short quick steps.",
    "cardio": "Moderate: you can talk but not sing. Hard intervals: only a few words.",
    "plyometric": "Land softly with knees over toes; stop when jumps get sloppy.",
    "balance": "Stand near a wall or chair for safety, eyes on a fixed point.",
    "mobility": "Move slowly into the range; mild stretch only, never pain.",
    "corrective": "Slow and controlled; focus on the target muscle, not the number of reps.",
}


_CUE_OVERRIDE = {
    "glute_bridge": "Ribs down, drive through the heels, squeeze glutes for 2 s at the top.",
    "single_leg_glute_bridge": "Keep hips level, drive through the planted heel, squeeze at the top.",
    "dumbbell_hip_thrust": "Upper back on a bench, chin tucked, drive hips to full extension.",
    "barbell_hip_thrust": "Upper back on a bench, chin tucked, drive hips to full extension.",
    "chin_tuck": "Slide the chin straight back (make a double chin), hold 5 s.",
    "wall_angel": "Back and head on the wall, slide the arms up slowly without losing contact.",
    "half_kneeling_hip_flexor_stretch": "Tuck the pelvis, squeeze the back-leg glute, lean slightly forward.",
    "upper_trap_stretch": "Ear toward shoulder, opposite hand reaches down, gentle 30 s hold.",
    "clamshell": "Heels together, open the top knee without rolling the hips back.",
    "sit_to_stand": "Feet under knees, stand up without using your hands, sit down slowly.",
    "brisk_walk": "Pace where you can talk but not sing.",
    "tai_chi": "Follow a 20-30 min beginner class or video; slow, continuous weight shifts.",
    "farmers_carry": "Heavy weights at your sides, tall posture, short quick steps.",
}


@dataclass(frozen=True)
class Exercise:
    id: str
    name: str
    category: str
    pattern: str
    muscles: tuple[str, ...]
    equipment: str
    level: int
    contraindications: tuple[str, ...]

    @property
    def cue(self) -> str:
        return _CUE_OVERRIDE.get(self.id) or _CUES.get(self.pattern, "")


def _parse_catalog(table: str) -> list[Exercise]:
    out = []
    for line in table.strip().splitlines():
        f = line.split("|")
        out.append(Exercise(f[0], f[1], f[2], f[3], tuple(f[4].split(",")), f[5], int(f[6]),
                            tuple(x for x in f[7].split(",") if x)))
    return out


CATALOG: list[Exercise] = _parse_catalog(_CATALOG_TABLE)
BY_ID: dict[str, Exercise] = {e.id: e for e in CATALOG}
GYM_EQUIPMENT = {"bands", "dumbbells", "kettlebell", "barbell", "machine", "cable",
                 "pull_up_bar", "cardio_machine", "medicine_ball"}
LOADED_EQUIPMENT = {"dumbbells", "kettlebell", "barbell", "machine", "cable"}

# Progression ladders within a pattern: next harder/easier exercise at the same equipment or below
def ladder(e: Exercise) -> tuple[Optional[str], Optional[str]]:
    same = sorted([x for x in CATALOG if x.pattern == e.pattern and x.id != e.id
                   and x.muscles[0] == e.muscles[0]], key=lambda x: x.level)
    easier = [x for x in same if x.level < e.level and
              (x.equipment == e.equipment or x.equipment == "none")]
    harder = [x for x in same if x.level > e.level and
              (x.equipment == e.equipment or e.equipment == "none" and x.equipment == "none")]
    return (easier[-1].id if easier else None), (harder[0].id if harder else None)


def has_equipment(e: Exercise, equipment: list[str]) -> bool:
    eq = set(equipment or ["none"])
    if e.equipment == "none":
        return True
    if "gym" in eq and e.equipment in GYM_EQUIPMENT:
        return True
    if e.equipment == "pool":
        return "pool" in eq
    return e.equipment in eq


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


_ALIASES = {
    "squat": "bodyweight_squat", "air squat": "bodyweight_squat", "back squat": "barbell_back_squat",
    "front squat": "barbell_front_squat", "deadlift": "conventional_deadlift",
    "rdl": "dumbbell_romanian_deadlift", "romanian deadlift": "dumbbell_romanian_deadlift",
    "bench press": "barbell_bench_press", "bench": "barbell_bench_press",
    "db bench": "dumbbell_bench_press", "pushup": "push_up", "push ups": "push_up",
    "pullup": "pull_up", "pull ups": "pull_up", "chinup": "chin_up", "ohp": "barbell_overhead_press",
    "overhead press": "barbell_overhead_press", "military press": "barbell_overhead_press",
    "shoulder press": "dumbbell_shoulder_press", "row": "single_arm_dumbbell_row",
    "dumbbell row": "single_arm_dumbbell_row", "barbell row": "bent_over_barbell_row",
    "cable row": "seated_cable_row", "pulldown": "lat_pulldown", "curl": "dumbbell_curl",
    "bicep curl": "dumbbell_curl", "biceps curl": "dumbbell_curl", "pushdown": "triceps_pushdown",
    "tricep pushdown": "triceps_pushdown", "lateral raise": "dumbbell_lateral_raise",
    "plank": "front_plank", "lunge": "reverse_lunge", "lunges": "reverse_lunge",
    "bridge": "glute_bridge", "hip thrust": "barbell_hip_thrust", "calf raise": "standing_calf_raise",
    "walk": "brisk_walk", "walking": "brisk_walk", "run": "jogging", "running": "jogging",
    "jog": "jogging", "bike": "stationary_bike", "cycling": "stationary_bike",
    "rowing": "rowing_machine", "rower": "rowing_machine", "swim": "swimming_laps",
    "swimming": "swimming_laps", "yoga": "beginner_yoga_flow", "hiit": "bodyweight_hiit_circuit",
    "kb swing": "kettlebell_swing", "dips": "parallel_bar_dip", "dip": "parallel_bar_dip",
    "farmer walk": "farmers_carry", "farmers walk": "farmers_carry", "step ups": "step_up",
    "bulgarian split squats": "bulgarian_split_squat", "leg curl": "lying_leg_curl",
    "hip flexor stretch": "half_kneeling_hip_flexor_stretch", "chin tucks": "chin_tuck",
}
_NAME_INDEX = {**{_norm(e.id): e.id for e in CATALOG}, **{_norm(e.name): e.id for e in CATALOG},
               **{_norm(k): v for k, v in _ALIASES.items()}}


def match_exercise(name: str, cutoff: float = 0.85) -> Optional[str]:
    """Map a free-text exercise name from a dataset to a catalog id (None if no good match)."""
    n = _norm(name)
    if not n:
        return None
    if n in _NAME_INDEX:
        return _NAME_INDEX[n]
    if n.endswith("s") and n[:-1] in _NAME_INDEX:
        return _NAME_INDEX[n[:-1]]
    hit = difflib.get_close_matches(n, list(_NAME_INDEX), n=1, cutoff=cutoff)
    return _NAME_INDEX[hit[0]] if hit else None


_GUESS_RULES = [  # keyword -> (pattern, muscles) for exercises not in the catalog
    ("curl", "upper_accessory", ("biceps",)), ("tricep", "upper_accessory", ("triceps",)),
    ("raise", "upper_accessory", ("shoulders",)), ("fly", "upper_accessory", ("chest",)),
    ("squat", "squat", ("quads", "glutes")), ("lunge", "single_leg", ("quads", "glutes")),
    ("deadlift", "hinge", ("hamstrings", "glutes")), ("bridge", "hinge", ("glutes",)),
    ("thrust", "hinge", ("glutes",)), ("press", "push_h", ("chest", "triceps")),
    ("push", "push_h", ("chest", "triceps")), ("row", "pull_h", ("back", "biceps")),
    ("pull", "pull_v", ("back", "biceps")), ("plank", "core", ("core",)),
    ("crunch", "core", ("core",)), ("calf", "calves", ("calves",)), ("carry", "carry", ("core",)),
    ("stretch", "mobility", ("full_body",)), ("yoga", "mobility", ("full_body",)),
    ("jump", "plyometric", ("legs",)), ("run", "cardio", ("heart",)), ("bike", "cardio", ("heart",)),
    ("walk", "cardio", ("heart",)), ("swim", "cardio", ("heart",)),
]


def guess_exercise(name: str) -> Exercise:
    """Create a catalog entry for an unknown movement so the model can still learn it."""
    n = _norm(name)
    pattern, muscles = "other", ("full_body",)
    for kw, p, m in _GUESS_RULES:
        if kw in n:
            pattern, muscles = p, m
            break
    cat = {"cardio": "cardio", "mobility": "mobility", "plyometric": "plyometric"}.get(pattern,
                                                                                       "strength")
    return Exercise(n.replace(" ", "_"), name.strip(), cat, pattern, muscles, "none", 2, ())


# =============================================================================================
# 2. PROFILE, SIGNALS, SAFETY
# =============================================================================================
@dataclass
class Screening:
    heart_condition: bool = False
    chest_pain: bool = False
    dizziness_or_fainting: bool = False
    uncontrolled_blood_pressure: bool = False
    uncontrolled_diabetes: bool = False
    recent_surgery_or_injury: bool = False
    pregnant: bool = False
    radiating_pain_or_numbness: bool = False
    clinician_cleared: bool = False


@dataclass
class Profile:
    name: str = "user"
    age: int = 35
    sex: str = "female"
    height_cm: float = 170
    weight_kg: float = 70
    goal: str = "health"              # health | active | fit | strength | body_shape
    body_shape_subgoal: Optional[str] = None   # lean_gain | recomposition | lean_down
    priority_muscles: list[str] = field(default_factory=list)
    training_age_years: float = 0.0
    days_per_week: int = 3
    minutes_per_week: int = 150
    max_minutes_per_session: int = 60
    equipment: list[str] = field(default_factory=lambda: ["none"])
    likes: list[str] = field(default_factory=list)
    dislikes: list[str] = field(default_factory=list)
    pain_areas: list[str] = field(default_factory=list)   # low_back, knee, shoulder, neck, wrist
    screening: Screening = field(default_factory=Screening)

    @staticmethod
    def from_dict(d: dict) -> "Profile":
        d = dict(d)
        d["screening"] = Screening(**d.get("screening", {}))
        return Profile(**{k: v for k, v in d.items() if k in Profile.__dataclass_fields__})


@dataclass
class DailySignals:
    date: str = ""
    sleep_hours: Optional[float] = None
    sleep_midpoint_h: Optional[float] = None
    hrv_rmssd_ms: Optional[float] = None
    resting_hr: Optional[float] = None
    steps: Optional[int] = None
    moderate_minutes: Optional[float] = None
    sitting_hours: Optional[float] = None
    longest_sitting_bout_min: Optional[float] = None
    phone_screen_hours: Optional[float] = None
    head_down_minutes: Optional[float] = None
    phone_after_23h_minutes: Optional[float] = None
    gait_speed_mps: Optional[float] = None
    gait_asymmetry_pct: Optional[float] = None
    emg_muscle_load: dict = field(default_factory=dict)
    emg_fatigue_index: dict = field(default_factory=dict)
    emg_glute_to_hamstring_ratio: Optional[float] = None
    upper_trap_desk_tone: Optional[float] = None
    soreness_0_10: Optional[float] = None
    pain_0_10: Optional[float] = None

    @staticmethod
    def from_dict(d: dict) -> "DailySignals":
        return DailySignals(**{k: v for k, v in d.items() if k in DailySignals.__dataclass_fields__})


@dataclass
class CheckIn:
    week: int
    metrics: dict


_STOP = ["heart_condition", "chest_pain", "dizziness_or_fainting", "uncontrolled_blood_pressure",
         "uncontrolled_diabetes", "radiating_pain_or_numbness"]
_CAUTION = ["recent_surgery_or_injury", "pregnant"]


@dataclass
class SafetyResult:
    restricted: bool
    reasons: list[str] = field(default_factory=list)
    excluded_tags: set = field(default_factory=set)
    max_tier: Optional[str] = None
    notes: list[str] = field(default_factory=list)


def screen(p: Profile) -> SafetyResult:
    """PAR-Q+-style gate. Hard rules: never learned, always override the model."""
    s = p.screening
    res = SafetyResult(False, excluded_tags=set(p.pain_areas))
    flags = [k for k in _STOP + _CAUTION if getattr(s, k)]
    if flags and not s.clinician_cleared:
        res.restricted, res.reasons, res.max_tier = True, flags, "health"
        res.notes.append("You reported " + ", ".join(f.replace("_", " ") for f in flags) +
                         ". Please check with a doctor or physiotherapist before harder training. "
                         "Until then the plan is walking, light strength and mobility only.")
    if s.pregnant:
        res.excluded_tags |= {"low_back"}
        res.notes.append("Pregnancy: no lying flat on your back after the first trimester, no "
                         "high-impact or maximal efforts.")
    if p.pain_areas:
        res.notes.append("Avoiding exercises that load: " + ", ".join(sorted(p.pain_areas)) +
                         ". Stop any movement that causes pain of 4/10 or more.")
    return res


_PREGNANCY_EXCLUDE_PATTERNS = {"plyometric"}
_SUPINE = {"glute_bridge", "single_leg_glute_bridge", "dead_bug", "dumbbell_bench_press",
           "barbell_bench_press", "incline_barbell_bench_press", "dumbbell_floor_press",
           "dumbbell_fly", "crunch", "bicycle_crunch", "reverse_crunch", "hollow_body_hold",
           "skull_crusher", "dumbbell_hip_thrust", "barbell_hip_thrust"}


def allowed(e: Exercise, safety: SafetyResult, p: Profile) -> bool:
    if set(e.contraindications) & safety.excluded_tags:
        return False
    if safety.restricted and (e.level > 1 and e.category != "mobility" or
                              e.category == "plyometric" or "interval" in e.id or
                              e.id == "bodyweight_hiit_circuit"):
        return False
    if p.screening.pregnant and (e.pattern in _PREGNANCY_EXCLUDE_PATTERNS or e.id in _SUPINE):
        return False
    return True


def feasible(e: Exercise, p: Profile, safety: SafetyResult) -> bool:
    max_level = 1 if safety.restricted else 2 if p.training_age_years < 1 else 3
    return (has_equipment(e, p.equipment) and allowed(e, safety, p) and e.id not in p.dislikes
            and e.level <= max_level)


def live_pain_rule(pain: Optional[float]) -> Optional[str]:
    if pain is None:
        return None
    return "stop_session" if pain >= 7 else "stop_exercise_and_regress" if pain >= 4 else None


# =============================================================================================
# 3. LIFESTYLE BASELINE AND FEATURE ROW
# =============================================================================================
EMG_MUSCLES = ["quads", "glutes", "hamstrings", "back", "chest", "shoulders", "upper_trap", "core"]

# Canonical model features. A dataset may contain any subset (plus extra columns); missing
# ones are imputed. Profiles are turned into exactly these names at prediction time.
CANONICAL_FEATURES = [
    "age", "sex", "height_cm", "weight_kg", "bmi", "goal", "body_shape_subgoal",
    "training_age_years", "days_per_week", "minutes_per_week", "equipment", "pain_areas",
    "priority_muscles", "sleep_hours", "sleep_regularity_sd_h", "hrv_ms", "resting_hr", "steps",
    "moderate_minutes_week", "sitting_hours", "longest_sitting_bout_min", "phone_screen_hours",
    "head_down_minutes", "phone_after_23h_minutes", "gait_speed_mps", "gait_asymmetry_pct",
    "glute_to_hamstring_ratio", "upper_trap_desk_tone",
] + [f"emg_load_{m}" for m in EMG_MUSCLES]


def _avg(days, attr):
    v = [getattr(d, attr) for d in days if getattr(d, attr) is not None]
    return mean(v) if v else None


def _sd(days, attr):
    v = [getattr(d, attr) for d in days if getattr(d, attr) is not None]
    return pstdev(v) if len(v) >= 3 else None


@dataclass
class Baseline:
    sleep_hours: Optional[float] = None
    sleep_regularity_sd_h: Optional[float] = None
    hrv_ms: Optional[float] = None
    hrv_sd: Optional[float] = None
    resting_hr: Optional[float] = None
    rhr_sd: Optional[float] = None
    steps: Optional[float] = None
    moderate_minutes_week: float = 0.0
    sitting_hours: Optional[float] = None
    longest_sitting_bout_min: Optional[float] = None
    phone_screen_hours: Optional[float] = None
    head_down_minutes: Optional[float] = None
    phone_after_23h_minutes: Optional[float] = None
    gait_speed_mps: Optional[float] = None
    gait_asymmetry_pct: Optional[float] = None
    glute_to_hamstring_ratio: Optional[float] = None
    upper_trap_desk_tone: Optional[float] = None
    muscle_load: dict = field(default_factory=dict)
    flags: list = field(default_factory=list)


def summarize(days: list[DailySignals]) -> Baseline:
    steps = _avg(days, "steps")
    mod = _avg(days, "moderate_minutes")
    if mod is None and steps is not None:
        mod = max(0.0, steps - 3000) / 110 * 0.5   # heuristic: half of extra steps are brisk
    loads: dict = {}
    for d in days:
        for m, v in (d.emg_muscle_load or {}).items():
            loads.setdefault(m, []).append(v)
    b = Baseline(
        sleep_hours=_avg(days, "sleep_hours"), sleep_regularity_sd_h=_sd(days, "sleep_midpoint_h"),
        hrv_ms=_avg(days, "hrv_rmssd_ms"), hrv_sd=_sd(days, "hrv_rmssd_ms"),
        resting_hr=_avg(days, "resting_hr"), rhr_sd=_sd(days, "resting_hr"), steps=steps,
        moderate_minutes_week=(mod or 0.0) * 7, sitting_hours=_avg(days, "sitting_hours"),
        longest_sitting_bout_min=_avg(days, "longest_sitting_bout_min"),
        phone_screen_hours=_avg(days, "phone_screen_hours"),
        head_down_minutes=_avg(days, "head_down_minutes"),
        phone_after_23h_minutes=_avg(days, "phone_after_23h_minutes"),
        gait_speed_mps=_avg(days, "gait_speed_mps"), gait_asymmetry_pct=_avg(days, "gait_asymmetry_pct"),
        glute_to_hamstring_ratio=_avg(days, "emg_glute_to_hamstring_ratio"),
        upper_trap_desk_tone=_avg(days, "upper_trap_desk_tone"),
        muscle_load={m: mean(v) for m, v in loads.items()})
    b.flags = coaching_flags(b)
    return b


def coaching_flags(b: Baseline) -> list[str]:
    f = []
    def chk(v, cond, name):
        if v is not None and cond(v):
            f.append(name)
    chk(b.sitting_hours, lambda v: v >= 8, "high_sitting")
    chk(b.longest_sitting_bout_min, lambda v: v >= 90, "long_sitting_bouts")
    chk(b.head_down_minutes, lambda v: v >= 120, "head_down")
    chk(b.upper_trap_desk_tone, lambda v: v >= 5, "upper_trap_tension")
    chk(b.glute_to_hamstring_ratio, lambda v: v < 0.8, "low_glute_activation")
    chk(b.gait_asymmetry_pct, lambda v: v >= 10, "gait_asymmetry")
    chk(b.sleep_hours, lambda v: v < 7, "short_sleep")
    chk(b.sleep_regularity_sd_h, lambda v: v > 1.0, "irregular_sleep")
    chk(b.phone_after_23h_minutes, lambda v: v >= 30, "late_phone_use")
    chk(b.steps, lambda v: v < 5000, "low_steps")
    chk(b.gait_speed_mps, lambda v: v < 1.0, "slow_gait")
    return f


def feature_row(p: Profile, b: Baseline) -> dict:
    """Profile + lifestyle baseline -> one row with the canonical feature names."""
    row = {
        "age": p.age, "sex": p.sex, "height_cm": p.height_cm, "weight_kg": p.weight_kg,
        "bmi": round(p.weight_kg / (p.height_cm / 100) ** 2, 1), "goal": p.goal,
        "body_shape_subgoal": p.body_shape_subgoal or "", "training_age_years": p.training_age_years,
        "days_per_week": p.days_per_week, "minutes_per_week": p.minutes_per_week,
        "equipment": ";".join(p.equipment), "pain_areas": ";".join(p.pain_areas),
        "priority_muscles": ";".join(p.priority_muscles),
    }
    for k in ["sleep_hours", "sleep_regularity_sd_h", "hrv_ms", "resting_hr", "steps",
              "moderate_minutes_week", "sitting_hours", "longest_sitting_bout_min",
              "phone_screen_hours", "head_down_minutes", "phone_after_23h_minutes",
              "gait_speed_mps", "gait_asymmetry_pct", "glute_to_hamstring_ratio",
              "upper_trap_desk_tone"]:
        row[k] = getattr(b, k)
    for m in EMG_MUSCLES:
        row[f"emg_load_{m}"] = b.muscle_load.get(m)
    return row


# =============================================================================================
# 4. DATASET LOADING AND FEATURE ENCODING
# =============================================================================================
LABEL_COL_CANDIDATES = ["exercises", "suggested_exercises", "movements", "labels", "label",
                        "recommended_exercises", "exercise_list"]
ID_COLS = {"sample_id", "user_id", "id", "person_id", "participant_id", "date", "week", "timestamp"}
_SPLIT = re.compile(r"\s*[;|]\s*")


def _is_num(x: str) -> bool:
    try:
        float(x)
        return True
    except (TypeError, ValueError):
        return False


def read_table(path: str) -> list[dict]:
    p = Path(path)
    if p.suffix.lower() in (".json", ".jsonl"):
        txt = p.read_text()
        if p.suffix.lower() == ".jsonl":
            return [json.loads(l) for l in txt.splitlines() if l.strip()]
        data = json.loads(txt)
        return data if isinstance(data, list) else data["rows"]
    if p.suffix.lower() in (".xlsx", ".xls", ".parquet"):
        try:
            import pandas as pd   # optional, only for Excel/Parquet input
        except ImportError as e:
            raise SystemExit("Reading Excel/Parquet needs pandas (pip install pandas openpyxl), "
                             "or save the file as CSV.") from e
        df = pd.read_parquet(p) if p.suffix.lower() == ".parquet" else pd.read_excel(p)
        return [{k: (None if pd.isna(v) else v) for k, v in r.items()}
                for r in df.to_dict("records")]
    delim = "\t" if p.suffix.lower() in (".tsv", ".txt") else ","
    with open(p, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f, delimiter=delim))


def _parse_labels(cell) -> list[tuple[str, float]]:
    """'squat; push up:0.8; plank' -> [('squat',1.0), ('push up',0.8), ('plank',1.0)]"""
    if cell is None:
        return []
    items = cell if isinstance(cell, list) else _SPLIT.split(str(cell))
    if not isinstance(cell, list) and len(items) == 1 and "," in str(cell):
        items = [x.strip() for x in str(cell).split(",")]
    out = []
    for it in items:
        it = str(it).strip()
        if not it:
            continue
        m = re.match(r"^(.*?):\s*([0-9.]+)$", it)
        out.append((m.group(1), max(0.0, min(1.0, float(m.group(2))))) if m else (it, 1.0))
    return out


@dataclass
class Dataset:
    rows: list[dict]                    # feature dicts
    labels: list[list[tuple[str, float]]]   # per row: (catalog id, weight)
    items: list[Exercise]               # item vocabulary (catalog + any new movements)
    unmatched: dict                     # raw name -> created id
    label_col: str


def load_dataset(path: str, label_col: Optional[str] = None, match_cutoff: float = 0.85,
                 add_unknown: bool = True) -> Dataset:
    raw = read_table(path)
    if not raw:
        raise ValueError(f"{path} has no rows")
    cols = list(raw[0].keys())
    lc = label_col or next((c for c in LABEL_COL_CANDIDATES if c in cols), None)
    long_format = lc is None and "exercise" in cols
    items = list(CATALOG)
    known = {e.id for e in items}
    unmatched: dict = {}

    def resolve(name: str) -> Optional[str]:
        eid = match_exercise(name, match_cutoff)
        if eid:
            return eid
        if not add_unknown:
            return None
        if name not in unmatched:
            g = guess_exercise(name)
            if g.id not in known:
                items.append(g)
                known.add(g.id)
            unmatched[name] = g.id
        return unmatched[name]

    rows, labels = [], []
    if long_format:
        # sample_id, exercise, [label|rating|score], feature columns...
        key = next((c for c in ("sample_id", "user_id", "person_id", "id") if c in cols), None)
        if key is None:
            raise ValueError("Long format needs a sample_id/user_id column")
        wcol = next((c for c in ("label", "rating", "score", "weight") if c in cols), None)
        groups: dict = {}
        for r in raw:
            g = groups.setdefault(r[key], {"row": {k: v for k, v in r.items()
                                                    if k not in ("exercise", wcol)}, "lab": {}})
            w = float(r[wcol]) if wcol and _is_num(r[wcol]) else 1.0
            if wcol == "rating":
                w = w / 5.0 if w > 1 else w
            eid = resolve(r["exercise"])
            if eid:
                g["lab"][eid] = max(g["lab"].get(eid, 0.0), w)
        for g in groups.values():
            rows.append(g["row"])
            labels.append(list(g["lab"].items()))
        lc = "exercise (long format)"
    else:
        if lc is None:
            raise ValueError(f"No label column found. Pass --label-col (columns: {cols})")
        for r in raw:
            lab: dict = {}
            for name, w in _parse_labels(r.get(lc)):
                eid = resolve(name)
                if eid:
                    lab[eid] = max(lab.get(eid, 0.0), w)
            rows.append({k: v for k, v in r.items() if k != lc})
            labels.append(list(lab.items()))
    return Dataset(rows, labels, items, unmatched, lc)


class FeatureEncoder:
    """Turns heterogeneous rows into a numeric matrix.
    numeric -> median impute + missing flag + standardize; text -> one-hot (top values);
    multi-valued text ('a;b') -> multi-hot. Fitted on training rows, saved with the model."""

    def __init__(self, max_categories: int = 40):
        self.max_categories = max_categories
        self.spec: list[dict] = []

    @staticmethod
    def _derive(r: dict) -> dict:
        r = dict(r)
        h, w = r.get("height_cm"), r.get("weight_kg")
        if (r.get("bmi") in (None, "")) and _is_num(h) and _is_num(w) and float(h) > 0:
            r["bmi"] = float(w) / (float(h) / 100) ** 2
        return r

    def fit(self, rows: list[dict]) -> "FeatureEncoder":
        rows = [self._derive(r) for r in rows]
        cols = sorted({k for r in rows for k in r} - ID_COLS)
        self.spec = []
        for c in cols:
            vals = [r.get(c) for r in rows if r.get(c) not in (None, "")]
            if not vals:
                continue
            nums = [float(v) for v in vals if _is_num(v)]
            if len(nums) >= 0.9 * len(vals):
                arr = np.array(nums, float)
                self.spec.append({"col": c, "kind": "num", "median": float(np.median(arr)),
                                  "mean": float(arr.mean()), "std": float(arr.std() or 1.0)})
                continue
            multi = any(isinstance(v, list) or re.search(r"[;|]", str(v)) for v in vals)
            counts: dict = {}
            for v in vals:
                toks = (v if isinstance(v, list) else _SPLIT.split(str(v))) if multi else [str(v)]
                for t in toks:
                    t = _norm(str(t))
                    if t:
                        counts[t] = counts.get(t, 0) + 1
            cats = [k for k, n in sorted(counts.items(), key=lambda x: -x[1]) if n >= 2]
            cats = cats[: self.max_categories]
            if cats:
                self.spec.append({"col": c, "kind": "multi" if multi else "cat", "cats": cats})
        return self

    @property
    def dim(self) -> int:
        return sum(2 if s["kind"] == "num" else len(s["cats"]) + (1 if s["kind"] == "cat" else 0)
                   for s in self.spec)

    def names(self) -> list[str]:
        out = []
        for s in self.spec:
            if s["kind"] == "num":
                out += [s["col"], s["col"] + "__missing"]
            else:
                out += [f"{s['col']}={c}" for c in s["cats"]]
                if s["kind"] == "cat":
                    out.append(f"{s['col']}=other")
        return out

    def transform(self, rows: list[dict]) -> np.ndarray:
        X = np.zeros((len(rows), self.dim), dtype=np.float64)
        for i, r in enumerate(rows):
            r = self._derive(r)
            j = 0
            for s in self.spec:
                v = r.get(s["col"])
                if s["kind"] == "num":
                    if _is_num(v) and v not in ("",):
                        X[i, j] = (float(v) - s["mean"]) / s["std"]
                    else:
                        X[i, j] = (s["median"] - s["mean"]) / s["std"]
                        X[i, j + 1] = 1.0
                    j += 2
                else:
                    n = len(s["cats"])
                    if v not in (None, ""):
                        toks = (v if isinstance(v, list) else _SPLIT.split(str(v))) \
                            if s["kind"] == "multi" else [str(v)]
                        hit = False
                        for t in toks:
                            t = _norm(str(t))
                            if t in s["cats"]:
                                X[i, j + s["cats"].index(t)] = 1.0
                                hit = True
                        if s["kind"] == "cat" and not hit:
                            X[i, j + n] = 1.0
                    j += n + (1 if s["kind"] == "cat" else 0)
        return X

    def to_json(self) -> dict:
        return {"max_categories": self.max_categories, "spec": self.spec}

    @staticmethod
    def from_json(d: dict) -> "FeatureEncoder":
        e = FeatureEncoder(d["max_categories"])
        e.spec = d["spec"]
        return e


def item_metadata(items: list[Exercise]) -> tuple[np.ndarray, list[str]]:
    """One/multi-hot exercise metadata used by the exercise tower."""
    vocab = []
    for prefix, values in [
        ("cat", sorted({e.category for e in items})), ("pat", sorted({e.pattern for e in items})),
        ("eq", sorted({e.equipment for e in items})), ("lvl", ["1", "2", "3"]),
        ("mus", sorted({m for e in items for m in e.muscles})),
        ("contra", sorted({c for e in items for c in e.contraindications}))]:
        vocab += [f"{prefix}:{v}" for v in values]
    idx = {v: i for i, v in enumerate(vocab)}
    M = np.zeros((len(items), len(vocab)))
    for r, e in enumerate(items):
        for key in [f"cat:{e.category}", f"pat:{e.pattern}", f"eq:{e.equipment}", f"lvl:{e.level}"] + \
                [f"mus:{m}" for m in e.muscles] + [f"contra:{c}" for c in e.contraindications]:
            if key in idx:
                M[r, idx[key]] = 1.0
    return M, vocab


def label_matrix(labels: list[list[tuple[str, float]]], items: list[Exercise]) -> np.ndarray:
    pos = {e.id: j for j, e in enumerate(items)}
    Y = np.zeros((len(labels), len(items)))
    for i, lab in enumerate(labels):
        for eid, w in lab:
            if eid in pos:
                Y[i, pos[eid]] = w
    return Y


# =============================================================================================
# 5. THE TRAINABLE MODEL (two-tower neural recommender in NumPy)
# =============================================================================================
class ExerciseRecommender:
    """score(x, j) = MLP(x) . (E_j + M_j W_m) + c_j ;  trained with weighted binary
    cross-entropy over the whole catalog (multi-label) using Adam and early stopping."""

    def __init__(self, n_features: int, item_meta: np.ndarray, hidden: int = 128, dim: int = 48,
                 seed: int = 0):
        rng = np.random.default_rng(seed)
        n_items, n_meta = item_meta.shape
        self.M = item_meta
        self.p = {
            "W1": rng.normal(0, math.sqrt(2 / max(1, n_features)), (n_features, hidden)),
            "b1": np.zeros(hidden),
            "W2": rng.normal(0, math.sqrt(1 / hidden), (hidden, dim)),
            "b2": np.zeros(dim),
            "E": rng.normal(0, 0.05, (n_items, dim)),
            "Wm": rng.normal(0, math.sqrt(1 / max(1, n_meta)), (n_meta, dim)),
            "c": np.zeros(n_items),
        }
        self.history: list[dict] = []

    # forward / backward ---------------------------------------------------------------------
    def _forward(self, X, train=False, dropout=0.0, rng=None):
        p = self.p
        Z = X @ p["W1"] + p["b1"]
        H = np.maximum(Z, 0)
        mask = None
        if train and dropout > 0:
            mask = (rng.random(H.shape) >= dropout) / (1 - dropout)
            H = H * mask
        U = H @ p["W2"] + p["b2"]
        V = p["E"] + self.M @ p["Wm"]
        S = U @ V.T + p["c"]
        return S, (X, Z, H, U, V, mask)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        S, _ = self._forward(X)
        return 1 / (1 + np.exp(-np.clip(S, -30, 30)))

    def _loss_grad(self, X, Y, pos_weight, l2, dropout, rng):
        S, (X, Z, H, U, V, mask) = self._forward(X, True, dropout, rng)
        P = 1 / (1 + np.exp(-np.clip(S, -30, 30)))
        n = X.shape[0]
        eps = 1e-9
        loss = -np.mean(pos_weight * Y * np.log(P + eps) + (1 - Y) * np.log(1 - P + eps))
        dS = (P * (pos_weight * Y + 1 - Y) - pos_weight * Y) / (n * Y.shape[1])
        p = self.p
        g = {"c": dS.sum(0)}
        dU = dS @ V
        dV = dS.T @ U
        g["E"] = dV
        g["Wm"] = self.M.T @ dV
        g["W2"] = H.T @ dU
        g["b2"] = dU.sum(0)
        dH = dU @ p["W2"].T
        if mask is not None:
            dH = dH * mask
        dZ = dH * (Z > 0)
        g["W1"] = X.T @ dZ
        g["b1"] = dZ.sum(0)
        for k in ("W1", "W2", "E", "Wm"):
            g[k] = g[k] + l2 * p[k]
            loss += 0.5 * l2 * float(np.sum(p[k] ** 2))
        return loss, g

    def fit(self, X, Y, X_val=None, Y_val=None, epochs=80, batch_size=128, lr=3e-3,
            l2=1e-4, dropout=0.1, pos_weight=None, patience=10, seed=0, verbose=True):
        rng = np.random.default_rng(seed)
        if pos_weight is None:   # balance positives vs negatives, capped
            density = max(1e-4, float((Y > 0).mean()))
            pos_weight = min(20.0, (1 - density) / density)
        m = {k: np.zeros_like(v) for k, v in self.p.items()}
        v = {k: np.zeros_like(v) for k, v in self.p.items()}
        b1, b2, t = 0.9, 0.999, 0
        best, best_state, bad = -1.0, None, 0
        for ep in range(1, epochs + 1):
            order = rng.permutation(len(X))
            tot = 0.0
            for s in range(0, len(X), batch_size):
                idx = order[s:s + batch_size]
                loss, g = self._loss_grad(X[idx], Y[idx], pos_weight, l2, dropout, rng)
                tot += loss * len(idx)
                t += 1
                for k in self.p:
                    m[k] = b1 * m[k] + (1 - b1) * g[k]
                    v[k] = b2 * v[k] + (1 - b2) * g[k] ** 2
                    mh = m[k] / (1 - b1 ** t)
                    vh = v[k] / (1 - b2 ** t)
                    self.p[k] -= lr * mh / (np.sqrt(vh) + 1e-8)
            rec = {"epoch": ep, "train_loss": round(tot / len(X), 5)}
            if X_val is not None and len(X_val):
                met = ranking_metrics(self.predict_proba(X_val), Y_val, k=10)
                rec.update({f"val_{k}": v_ for k, v_ in met.items()})
                score = met["ndcg@10"]
                if score > best + 1e-4:
                    best, best_state, bad = score, copy.deepcopy(self.p), 0
                else:
                    bad += 1
            self.history.append(rec)
            if verbose and (ep == 1 or ep % 5 == 0):
                print("  " + "  ".join(f"{k}={v_}" for k, v_ in rec.items()))
            if X_val is not None and bad >= patience:
                if verbose:
                    print(f"  early stop at epoch {ep} (best val ndcg@10={best:.4f})")
                break
        if best_state is not None:
            self.p = best_state
        return self

    def state(self) -> dict:
        return {k: v for k, v in self.p.items()}


def ranking_metrics(P: np.ndarray, Y: np.ndarray, k: int = 10) -> dict:
    """precision@5, recall@k, ndcg@k, hit@5 over rows that have at least one positive."""
    rows = np.where((Y > 0).sum(1) > 0)[0]
    if len(rows) == 0:
        return {"precision@5": 0.0, f"recall@{k}": 0.0, f"ndcg@{k}": 0.0, "hit@5": 0.0}
    p5, rk, nd, h5 = [], [], [], []
    disc = 1 / np.log2(np.arange(2, k + 2))
    for i in rows:
        rel = Y[i] > 0
        order = np.argsort(-P[i])
        top5, topk = order[:5], order[:k]
        p5.append(rel[top5].mean())
        rk.append(rel[topk].sum() / rel.sum())
        gains = Y[i][topk]
        ideal = np.sort(Y[i])[::-1][:k]
        nd.append(float((gains * disc).sum() / max(1e-9, (ideal * disc).sum())))
        h5.append(float(rel[top5].any()))
    r = lambda x: round(float(np.mean(x)), 4)
    return {"precision@5": r(p5), f"recall@{k}": r(rk), f"ndcg@{k}": r(nd), "hit@5": r(h5)}


class CoachModel:
    """Encoder + recommender + item vocabulary: everything needed to score a new person."""

    def __init__(self, encoder: FeatureEncoder, rec: ExerciseRecommender, items: list[Exercise],
                 meta_vocab: list[str], info: dict):
        self.encoder, self.rec, self.items, self.meta_vocab, self.info = \
            encoder, rec, items, meta_vocab, info

    def score_rows(self, rows: list[dict]) -> np.ndarray:
        return self.rec.predict_proba(self.encoder.transform(rows))

    def score_profile(self, p: Profile, b: Baseline) -> dict[str, float]:
        probs = self.score_rows([feature_row(p, b)])[0]
        return {e.id: float(s) for e, s in zip(self.items, probs)}

    def save(self, path: str) -> None:
        out = Path(path)
        out.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(out / "weights.npz", M=self.rec.M, **self.rec.state())
        meta = {"version": __version__, "encoder": self.encoder.to_json(),
                "items": [asdict(e) for e in self.items], "meta_vocab": self.meta_vocab,
                "info": self.info, "history": self.rec.history}
        (out / "model.json").write_text(json.dumps(meta, indent=1))

    @staticmethod
    def load(path: str) -> "CoachModel":
        d = Path(path)
        meta = json.loads((d / "model.json").read_text())
        w = np.load(d / "weights.npz")
        items = [Exercise(i["id"], i["name"], i["category"], i["pattern"], tuple(i["muscles"]),
                          i["equipment"], i["level"], tuple(i["contraindications"]))
                 for i in meta["items"]]
        enc = FeatureEncoder.from_json(meta["encoder"])
        rec = ExerciseRecommender(enc.dim, w["M"])
        rec.p = {k: w[k] for k in ("W1", "b1", "W2", "b2", "E", "Wm", "c")}
        rec.history = meta.get("history", [])
        for e in items:   # make learned new movements usable by the planner
            BY_ID.setdefault(e.id, e)
        return CoachModel(enc, rec, items, meta["meta_vocab"], meta["info"])


def train_model(data_path: str, out: str, label_col: Optional[str] = None, epochs: int = 80,
                hidden: int = 128, dim: int = 48, lr: float = 3e-3, batch_size: int = 128,
                l2: float = 1e-4, dropout: float = 0.1, val_frac: float = 0.15,
                test_frac: float = 0.15, seed: int = 0, verbose: bool = True) -> dict:
    ds = load_dataset(data_path, label_col)
    n = len(ds.rows)
    rng = np.random.default_rng(seed)
    order = rng.permutation(n)
    n_test, n_val = int(n * test_frac), int(n * val_frac)
    te, va, tr = order[:n_test], order[n_test:n_test + n_val], order[n_test + n_val:]
    enc = FeatureEncoder().fit([ds.rows[i] for i in tr])
    X = enc.transform(ds.rows)
    Y = label_matrix(ds.labels, ds.items)
    M, vocab = item_metadata(ds.items)
    if verbose:
        print(f"Loaded {n} rows, {enc.dim} encoded features, {len(ds.items)} exercises "
              f"({len(ds.unmatched)} new movements added), label column '{ds.label_col}'.")
        print(f"Split: train {len(tr)}, val {len(va)}, test {len(te)}. Training...")
    rec = ExerciseRecommender(enc.dim, M, hidden, dim, seed)
    rec.fit(X[tr], Y[tr], X[va], Y[va], epochs=epochs, batch_size=batch_size, lr=lr, l2=l2,
            dropout=dropout, seed=seed, verbose=verbose)
    pop = Y[tr].mean(0)
    test = {"model": ranking_metrics(rec.predict_proba(X[te]), Y[te]),
            "popularity_baseline": ranking_metrics(np.tile(pop, (len(te), 1)), Y[te])}
    info = {"trained_on": str(data_path), "rows": n, "label_col": ds.label_col,
            "unmatched_names": ds.unmatched, "test_metrics": test,
            "hyperparameters": {"hidden": hidden, "dim": dim, "lr": lr, "epochs": epochs,
                                "batch_size": batch_size, "l2": l2, "dropout": dropout}}
    model = CoachModel(enc, rec, ds.items, vocab, info)
    model.save(out)
    if verbose:
        print("Test set:", json.dumps(test, indent=1))
        print(f"Saved model to {out}/")
    return info


# =============================================================================================
# 6. GOAL TIERS, PLANNER, SESSIONS
# =============================================================================================
@dataclass(frozen=True)
class Tier:
    key: str
    order: int
    label: str
    aerobic_min_per_week: int
    strength_sessions: int
    sets_per_muscle_week: int
    reps: str
    target_rir: str
    load_hint: str
    interval_sessions: int
    corrective_daily: bool
    min_weekly_minutes: int
    headline_metrics: tuple


# WHO 2020, ACSM 2026 resistance training position stand, Schoenfeld 2017, Milanovic 2015
TIERS = {
    "health": Tier("health", 1, "Health", 150, 2, 4, "8-12", "2-3",
                   "a weight you could lift 2-3 more times", 0, False, 60,
                   ("sit_to_stand_30s", "strength_pct", "gait_speed_mps")),
    "active": Tier("active", 2, "Active & posture", 150, 2, 4, "8-12", "2-3",
                   "a weight you could lift 2-3 more times", 0, True, 90,
                   ("sit_to_stand_30s", "gait_speed_mps", "strength_pct")),
    "fit": Tier("fit", 3, "Fit", 180, 2, 6, "8-12", "2", "moderate", 1, False, 150,
                ("vo2max", "strength_pct", "gait_speed_mps")),
    "strength": Tier("strength", 4, "Strength", 150, 3, 8, "4-8", "1-3",
                     "about 80% of your 1-rep max", 0, False, 150,
                     ("strength_pct", "sit_to_stand_30s", "lean_mass_kg")),
    "body_shape": Tier("body_shape", 5, "Body shape", 150, 4, 10, "8-12", "0-3",
                       "any load 30-85% 1RM taken close to failure", 0, False, 180,
                       ("lean_mass_kg", "arm_circumference_cm", "strength_pct")),
}
TIER_ORDER = sorted(TIERS.values(), key=lambda t: t.order)
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_LAYOUT = {1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5],
              6: [0, 1, 2, 3, 4, 5], 7: list(range(7))}
TEMPLATES = {
    "full_body_A": [("squat", None), ("pull_h", None), ("push_h", None), ("hinge", None), ("core", None)],
    "full_body_B": [("single_leg", None), ("pull_v", None), ("push_v", None), ("hinge", None), ("core", None)],
    "full_body_C": [("squat", None), ("pull_h", None), ("push_h", None), ("single_leg", None), ("carry", None)],
    "upper": [("push_h", None), ("pull_h", None), ("push_v", None), ("pull_v", None),
              ("upper_accessory", "biceps"), ("upper_accessory", "triceps"),
              ("upper_accessory", "shoulders")],
    "lower": [("squat", None), ("hinge", None), ("single_leg", None),
              ("leg_accessory", "hamstrings"), ("calves", None), ("core", None)],
}
PRIORITY_SLOTS = {"chest": ("push_h", None), "back": ("pull_h", None), "quads": ("squat", None),
                  "glutes": ("hinge", None), "hamstrings": ("hinge", None)}
WARMUP_MIN, CORRECTIVE_MIN, INTERVAL_MIN = 8, 5, 30
MIN_PER_SET = {"main": 3.0, "light": 2.5, "accessory": 2.0, "core": 1.5}


@dataclass
class Block:
    exercise_id: str
    name: str
    sets: int
    reps: str
    target_rir: Optional[str]
    rest_s: int
    tempo: Optional[str]
    load: Optional[str]
    cue: str
    easier: Optional[str]
    harder: Optional[str]
    minutes: float
    priority: bool = False
    model_score: Optional[float] = None


@dataclass
class Session:
    day: str
    name: str
    kind: str
    minutes: int
    blocks: list = field(default_factory=list)
    note: Optional[str] = None


def rule_prior(e: Exercise, p: Profile, b: Baseline) -> float:
    """Hand-written preference used when no model is trained (and to generate demo labels)."""
    target = 1 if p.training_age_years < 0.25 else 2 if p.training_age_years < 2 else 3
    s = 1.0 - 0.4 * abs(target - e.level)
    eq = set(p.equipment)
    if (eq & LOADED_EQUIPMENT or "gym" in eq) and e.equipment in LOADED_EQUIPMENT:
        s += 0.8
    if e.equipment == "machine" and p.training_age_years < 1:
        s += 0.3                       # machines are easy to learn
    if p.age >= 60 and (e.level == 1 or e.pattern == "balance"):
        s += 0.4
    if "gait_asymmetry" in b.flags and e.pattern == "single_leg":
        s += 0.3
    if e.id in p.likes:
        s += 2.0
    return s


def choose(pattern: str, muscle: Optional[str], p: Profile, b: Baseline, safety: SafetyResult,
           scores: Optional[dict], used: set, exclude: set, rng: random.Random) -> Optional[Exercise]:
    cands = [e for e in BY_ID.values() if e.pattern == pattern and
             (muscle is None or muscle in e.muscles) and feasible(e, p, safety)
             and e.id not in exclude]
    if not cands:
        return None
    def score(e):
        base = (4.0 * scores.get(e.id, 0.0)) if scores else rule_prior(e, p, b)
        return base - (0.6 if e.id in used else 0.0) + rng.random() * 0.05
    return max(cands, key=score)


def _dose(tier: Tier, kind: str, priority: bool):
    if kind == "core":
        return 2, "8-12 reps or 20-40 s", None, 45, None
    if kind == "carry":
        return 3, "30-40 m", None, 60, "heavy, upright posture"
    sets = {"health": 2, "active": 2, "fit": 2, "strength": 3, "body_shape": 3}[tier.key] + \
        (1 if priority else 0)
    return sets, tier.reps, tier.target_rir, 150 if tier.key == "strength" else 90, tier.load_hint


def _block(e: Exercise, sets, reps, rir, rest, load, minutes, priority, score) -> Block:
    easier, harder = ladder(e)
    if e.equipment == "none" and load and e.category == "strength":
        load = "bodyweight; move to the harder version when the top of the range is easy"
    return Block(e.id, e.name, sets, reps, rir, rest,
                 "2-0-1" if e.category == "strength" and e.pattern not in ("core", "carry") else None,
                 load, e.cue, easier, harder, round(minutes, 1), priority,
                 None if score is None else round(score, 3))


def _fit_session(s: Session, cap: int) -> None:
    def mins():
        return round(WARMUP_MIN + sum(x.minutes for x in s.blocks))
    while mins() > cap:
        over = [x for x in s.blocks if x.sets > (3 if x.priority else 2)]
        if over:
            x = max(over, key=lambda x: (not x.priority, x.sets))
            per = x.minutes / x.sets
            x.sets -= 1
            x.minutes = round(x.sets * per, 1)
        elif len(s.blocks) > 3:
            idx = max((i for i, x in enumerate(s.blocks) if not x.priority), default=len(s.blocks) - 1)
            s.blocks.pop(idx)
        else:
            break
    s.minutes = mins()


def strength_session(day, template, tier, p, b, safety, scores, used, rng) -> Session:
    slots = list(TEMPLATES[template])
    if tier.key == "body_shape":
        for m in p.priority_muscles:
            extra = PRIORITY_SLOTS.get(m)
            if extra and extra in slots and slots.count(extra) == 1:
                slots.insert(slots.index(extra) + 1, extra)
    if template.startswith("full_body") and (p.age >= 60 or {"slow_gait", "gait_asymmetry"} & set(b.flags)):
        slots.append(("balance", None))
    blocks, in_session = [], set()
    for pattern, muscle in slots:
        e = choose(pattern, muscle, p, b, safety, scores, used, in_session, rng)
        if e is None:
            continue
        used.add(e.id)
        in_session.add(e.id)
        if pattern == "balance":
            blocks.append(_block(e, 2, "30 s per side", None, 30, None, 2.0, False,
                                 scores.get(e.id) if scores else None))
            continue
        kind = "core" if pattern == "core" else "carry" if pattern == "carry" else "main"
        prio = e.muscles[0] in p.priority_muscles
        sets, reps, rir, rest, load = _dose(tier, kind, prio)
        unilateral = pattern == "single_leg" or "single" in e.id
        if unilateral and kind == "main":
            reps += " per side"
        per = MIN_PER_SET["core"] if kind != "main" else MIN_PER_SET["accessory"] \
            if pattern in ("upper_accessory", "leg_accessory", "calves") else \
            MIN_PER_SET["main"] if tier.key in ("strength", "body_shape") else MIN_PER_SET["light"]
        if unilateral:
            per *= 1.5
        blocks.append(_block(e, sets, reps, rir, rest, load if kind == "main" else load,
                             sets * per, prio, scores.get(e.id) if scores else None))
    s = Session(day, template.replace("_", " ").title(), "strength", 0, blocks)
    _fit_session(s, p.max_minutes_per_session)
    return s


def _corrective_blocks(b: Baseline, p: Profile, safety: SafetyResult, scores) -> list[Block]:
    want = []
    if {"low_glute_activation", "high_sitting", "long_sitting_bouts"} & set(b.flags):
        want += ["glute_bridge", "half_kneeling_hip_flexor_stretch"]
    if {"head_down", "upper_trap_tension"} & set(b.flags):
        want += ["chin_tuck", "wall_angel", "upper_trap_stretch"]
    if "gait_asymmetry" in b.flags:
        want += ["clamshell"]
    if not want:
        want = ["cat_cow", "worlds_greatest_stretch", "dead_bug"]
    out = []
    for i in want:
        e = BY_ID[i]
        if feasible(e, p, safety) and len(out) < 4:
            reps = "30 s per side" if "stretch" in i else "8-10"
            blk = _block(e, 2, reps, None, 20, None, 1.2, False,
                         scores.get(e.id) if scores else None)
            blk.tempo = None
            out.append(blk)
    return out


def _cardio_choice(p, b, safety, scores, intervals: bool) -> Exercise:
    pool = [e for e in BY_ID.values() if e.pattern == "cardio" and feasible(e, p, safety)
            and (("interval" in e.id) == intervals)]
    if not pool:
        return BY_ID["brisk_walk"]
    if scores:
        return max(pool, key=lambda e: scores.get(e.id, 0.0))
    return BY_ID["intervals_4x4"] if intervals and BY_ID["intervals_4x4"] in pool else \
        BY_ID["brisk_walk"] if BY_ID["brisk_walk"] in pool else pool[0]


def _nutrition(p: Profile, b: Baseline, tier: Tier) -> Optional[dict]:
    if tier.key != "body_shape" and p.body_shape_subgoal is None:
        return None
    bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age + (5 if p.sex == "male" else -161)
    steps = b.steps or 6000
    tdee = bmr * (1.3 if steps < 5000 else 1.45 if steps < 7500 else 1.6 if steps < 10000 else 1.75) + 150
    sub = p.body_shape_subgoal or "recomposition"
    bmi = p.weight_kg / (p.height_cm / 100) ** 2
    delta = round(0.08 * tdee) if sub == "lean_gain" else \
        -round(min(500, 0.2 * tdee)) if sub == "lean_down" and bmi >= 18.5 else 0
    kcal = max(1500 if p.sex == "male" else 1200, round(tdee + delta))
    return {"subgoal": sub, "estimated_maintenance_kcal": round(tdee), "target_kcal": kcal,
            "daily_energy_change_kcal": kcal - round(tdee), "protein_g": round(1.6 * p.weight_kg),
            "note": "Estimates. Weigh yourself 3x/week; calories are corrected from the 2-week trend."}


def _habits(b: Baseline, p: Profile) -> list[str]:
    h, f = [], set(b.flags)
    target = 7000 if p.age >= 60 else 8000
    if b.steps is not None and b.steps < target:
        goal = min(target, round((b.steps + 2000) / 500) * 500)
        h.append(f"Walk {goal:,} steps a day this month (now ~{round(b.steps):,})" +
                 (f"; the goal rises toward {target:,} as you hit it." if goal < target else "."))
    if f & {"high_sitting", "long_sitting_bouts"}:
        h.append("Every 45 min seated: stand and walk for 2 min (the watch will nudge you).")
    if "head_down" in f:
        h.append("Hold the phone at eye level; 5 chin tucks after each long phone session.")
    if "short_sleep" in f:
        h.append(f"Sleep is ~{b.sleep_hours:.1f} h. Aim for 7+ h: lights out 30 min earlier.")
    if "irregular_sleep" in f:
        h.append("Keep wake-up time within 1 h every day, weekends included.")
    if "late_phone_use" in f:
        h.append("Screens off by 22:30; phone charges outside the bedroom.")
    return h


def sets_per_muscle(sessions) -> dict:
    out: dict = {}
    for s in sessions:
        if s.kind != "strength":
            continue
        for bl in s.blocks:
            e = BY_ID[bl.exercise_id]
            if e.category != "strength":
                continue
            for i, m in enumerate(e.muscles):
                out[m] = out.get(m, 0) + bl.sets * (1.0 if i == 0 else 0.5)
    return {k: round(v, 1) for k, v in sorted(out.items())}


def build_plan(p: Profile, b: Baseline, safety: SafetyResult, scores: Optional[dict] = None,
               seed: int = 7) -> dict:
    rng = random.Random(seed)
    warnings = list(safety.notes)
    req = TIERS[p.goal]
    tier = req
    if safety.max_tier and TIERS[safety.max_tier].order < tier.order:
        tier = TIERS[safety.max_tier]
        warnings.append(f"Goal capped at '{tier.label}' until you are cleared.")
    if p.minutes_per_week < tier.min_weekly_minutes:
        fits = [t for t in TIER_ORDER if t.min_weekly_minutes <= p.minutes_per_week]
        warnings.append(f"'{tier.label}' needs at least {tier.min_weekly_minutes} min/week; you have "
                        f"{p.minutes_per_week}. The plan is trimmed and results will be slower." +
                        (f" '{fits[-1].label}' fits your time fully." if fits else ""))

    n = max(1, min(tier.strength_sessions, p.days_per_week))
    days = [WEEKDAYS[i] for i in DAY_LAYOUT[min(7, max(1, p.days_per_week))]]
    tpls = (["upper", "lower"] * 3)[:n] if tier.key == "body_shape" and n >= 4 else \
        (["full_body_A", "full_body_B", "full_body_C"] * 3)[:n]
    used: set = set()
    sessions = [strength_session(days[i], t, tier, p, b, safety, scores, used, rng)
                for i, t in enumerate(tpls)]
    total = lambda: sum(s.minutes for s in sessions)
    while total() > p.minutes_per_week and len(sessions) > 1:
        sessions.pop()

    if tier.corrective_daily or set(b.flags) & {"high_sitting", "head_down", "low_glute_activation",
                                                 "upper_trap_tension", "gait_asymmetry"}:
        blocks = _corrective_blocks(b, p, safety, scores)
        nd = 6 if tier.corrective_daily else 3
        while nd and total() + nd * CORRECTIVE_MIN > p.minutes_per_week:
            nd -= 1
        for d in (WEEKDAYS[:nd] if blocks else []):
            sessions.append(Session(d, "Posture micro-routine", "corrective", CORRECTIVE_MIN, blocks,
                                    "Do it after your longest sitting stretch."))

    aerobic_life, aerobic_plan = b.moderate_minutes_week, 0.0
    if tier.interval_sessions and not safety.restricted and total() + INTERVAL_MIN <= p.minutes_per_week:
        e = _cardio_choice(p, b, safety, scores, True)
        if "interval" in e.id:
            day = days[len([s for s in sessions if s.kind == "strength"]) % len(days)]
            sessions.append(Session(day, "Intervals", "cardio", INTERVAL_MIN, [
                _block(e, 4, "4 min hard / 3 min easy", None, 180, "hard: ~85-95% of max heart rate",
                       28, False, scores.get(e.id) if scores else None)]))
            aerobic_plan += 32
    gap = max(0.0, tier.aerobic_min_per_week - aerobic_life - aerobic_plan)
    if gap > 0:
        k = min(3, max(1, round(gap / 30)))
        per = max(10, round(gap / k / 5) * 5)
        room = p.minutes_per_week - total()
        while k and k * per > room:
            if per > 15:
                per -= 5
            else:
                k -= 1
        e = _cardio_choice(p, b, safety, scores, False)
        busy = {s.day for s in sessions if s.kind != "corrective"}
        free = [d for d in WEEKDAYS if d not in busy] or WEEKDAYS
        for i in range(k):
            sessions.append(Session(free[i % len(free)], e.name, "cardio", per, [
                _block(e, 1, f"{per} min", None, 0, None, per, False,
                       scores.get(e.id) if scores else None)]))
            aerobic_plan += per

    order = {d: i for i, d in enumerate(WEEKDAYS)}
    sessions.sort(key=lambda s: (order[s.day], s.kind != "strength"))
    spm = sets_per_muscle(sessions)
    major = ["quads", "glutes", "hamstrings", "chest", "back", "shoulders"]
    achieved = sum(min(spm.get(m, 0), tier.sets_per_muscle_week * 2) for m in major) / len(major)
    n_str = sum(1 for s in sessions if s.kind == "strength")
    dose = {"sets_per_muscle": round(achieved, 1), "hypertrophy": round(achieved / 10, 2),
            "strength": round(min(1.2, n_str / 2 * min(1.0, achieved / 4)), 2),
            "aerobic": round(min(1.3, (aerobic_life + aerobic_plan) / 150), 2),
            "intervals": float(any(s.name == "Intervals" for s in sessions))}
    prog = ["Double progression: when you reach the top of the rep range on every set with the "
            "target reps in reserve, add 2-5% load or move to the harder version.",
            "Move to the easier version if you miss the bottom of the range or feel pain of 4/10+.",
            "Weekly volume rises at most ~20%; a lighter week comes when fatigue trends up or "
            "progress stalls."]
    if tier.interval_sessions:
        prog.append("Intervals: add 1 min to each hard bout every 2 weeks up to 4x5 min, then go faster.")
    return {"tier": tier.key, "tier_label": tier.label, "requested_tier": req.key,
            "suggested_by": "trained model" if scores else "rules (no model loaded)",
            "sessions": [asdict(s) for s in sessions], "daily_habits": _habits(b, p),
            "nutrition": _nutrition(p, b, tier), "progression_rules": prog,
            "weekly_minutes_planned": total(), "weekly_minutes_budget": p.minutes_per_week,
            "sets_per_muscle_week": spm,
            "aerobic_minutes_week": {"from_daily_life": round(aerobic_life),
                                     "planned": round(aerobic_plan), "target": tier.aerobic_min_per_week},
            "dose": dose, "warnings": warnings}


# =============================================================================================
# 7. OUTCOME PREDICTOR (expected results over time)
# =============================================================================================
@dataclass(frozen=True)
class Outcome:
    key: str
    label: str
    unit: str
    family: str
    a_pop: float      # population plateau gain, untrained adults
    tau: float        # weeks
    lag: float        # weeks before change is real (hypertrophy)
    noise: float      # check-in measurement noise


OUTCOMES = {
    "strength_pct": Outcome("strength_pct", "Strength on main lifts", "%", "strength", 45, 10, 0, 4),
    "lean_mass_kg": Outcome("lean_mass_kg", "Lean mass", "kg", "hypertrophy", 4.0, 20, 2, 0.7),
    "arm_circumference_cm": Outcome("arm_circumference_cm", "Upper-arm circumference", "cm",
                                    "hypertrophy", 2.5, 20, 2, 0.4),
    "vo2max": Outcome("vo2max", "VO2max (watch estimate)", "mL/kg/min", "aerobic", 6, 6, 0, 1.5),
    "gait_speed_mps": Outcome("gait_speed_mps", "Walking speed", "m/s", "function", 0.12, 8, 0, 0.04),
    "sit_to_stand_30s": Outcome("sit_to_stand_30s", "30-s sit-to-stand", "reps", "function", 5, 6, 0, 1.5),
    "body_weight_kg": Outcome("body_weight_kg", "Body weight", "kg", "energy", 0, 75, 0, 0.8),
}
PRIOR_SD = 0.35
GRID = [i / 100 for i in range(-200, 201)]


def _scale(o, p, sleep, base):
    s = 1.0
    if o.family in ("strength", "hypertrophy", "function"):
        s *= 1.0 if p.training_age_years < 1 else 0.5 if p.training_age_years < 3 else 0.25
    if o.family == "hypertrophy":
        s *= (0.7 if o.key == "lean_mass_kg" else 0.8) if p.sex == "female" else 1.0
        s *= 0.8 if p.age >= 60 else 1.0
    if o.family in ("strength", "hypertrophy") and sleep is not None:
        s *= 0.85 if sleep < 6 else 0.93 if sleep < 7 else 1.0
    if o.key == "gait_speed_mps" and base is not None:
        s *= 0.4 if base >= 1.3 else 0.7 if base >= 1.1 else 1.0
    if o.key == "sit_to_stand_30s" and base is not None and base >= 18:
        s *= 0.5
    if o.key == "vo2max" and p.training_age_years >= 2:
        s *= 0.5
    return s


def _dose_factor(o, dose):
    if o.family == "hypertrophy":
        return min(1.3, math.log(1 + 10 * max(0.0, dose.get("hypertrophy", 0))) / math.log(11))
    if o.family == "strength":
        return max(0.0, dose.get("strength", 0))
    if o.family == "aerobic":
        return min(1.3, math.sqrt(max(0.0, dose.get("aerobic", 0))) * (1.15 if dose.get("intervals") else 1))
    if o.family == "function":
        return min(1.2, 0.6 * dose.get("strength", 0) + 0.4 * math.sqrt(dose.get("aerobic", 0)))
    return 1.0


def pop_gain(o, week, p, dose, adherence, sleep, base):
    t = max(0.0, week * adherence - o.lag)
    return o.a_pop * _scale(o, p, sleep, base) * _dose_factor(o, dose) * (1 - math.exp(-t / o.tau))


def forecast(metric, p, dose, checkins, adherence=0.85, sleep=None, kcal=0.0, horizons=(4, 8, 12, 26)):
    o = OUTCOMES[metric]
    bases = {}
    for c in checkins:
        if c.week == 0:
            bases.update(c.metrics)
    base = bases.get(metric)
    used = [c for c in checkins if c.week > 0 and metric in c.metrics]
    if o.family == "energy":
        out = {}
        for w in horizons:
            mid = kcal * adherence / 22.0 * (1 - math.exp(-w / 75.0))   # NIH energy-balance rule
            sp = abs(mid) * 0.35 + 0.5
            out[w] = (round(mid - sp, 1), round(mid, 1), round(mid + sp, 1))
        return {"metric": metric, "label": o.label, "unit": o.unit, "baseline": base,
                "change_by_week": out, "note": "Follows energy balance (NIH model rule of thumb)."}
    logw = [-0.5 * (lr / PRIOR_SD) ** 2 for lr in GRID]
    for c in checkins:
        if c.week <= 0:
            continue
        for k, val in c.metrics.items():
            oo = OUTCOMES.get(k)
            if not oo or oo.family != o.family or k not in bases:
                continue
            g = pop_gain(oo, c.week, p, dose, adherence, sleep, bases.get(k))
            obs = val - bases[k]
            for i, lr in enumerate(GRID):
                logw[i] += -0.5 * ((obs - math.exp(lr) * g) / oo.noise) ** 2
    mx = max(logw)
    w = [math.exp(x - mx) for x in logw]
    z = sum(w)
    w = [x / z for x in w]
    def q(qq):
        acc = 0.0
        for lr, wi in zip(GRID, w):
            acc += wi
            if acc >= qq:
                return math.exp(lr)
        return math.exp(GRID[-1])
    rq = (q(0.1), q(0.5), q(0.9))
    rnd = 2 if o.unit == "m/s" else 1
    out = {wk: tuple(round(pop_gain(o, wk, p, dose, adherence, sleep, base) * r, rnd) for r in rq)
           for wk in horizons}
    note = None
    if max([c.week for c in used], default=0) >= 8 and rq[1] < 0.6:
        note = ("Slower than typical. Check adherence and measurements first; then the planner "
                "raises the dose or changes the training type.")
    return {"metric": metric, "label": o.label, "unit": o.unit, "baseline": base,
            "change_by_week": out, "responsiveness": [round(x, 2) for x in rq], "note": note}


# =============================================================================================
# 8. DAILY READINESS
# =============================================================================================
def assess_readiness(t: DailySignals, b: Baseline) -> dict:
    score, why = 75.0, []
    def z(x, mu, sd, floor):
        return 0.0 if x is None or mu is None else (x - mu) / max(sd or 0, floor)
    if t.sleep_hours is not None:
        if t.sleep_hours < 5:
            score -= 25; why.append(f"very short sleep ({t.sleep_hours:.1f} h)")
        elif t.sleep_hours < 6.5:
            score -= 10; why.append(f"short sleep ({t.sleep_hours:.1f} h)")
        elif t.sleep_hours >= 7.5:
            score += 5
    hz = z(t.hrv_rmssd_ms, b.hrv_ms, b.hrv_sd, 4)
    if hz <= -1.5:
        score -= 20; why.append("HRV well below your normal")
    elif hz <= -0.75:
        score -= 10; why.append("HRV below your normal")
    elif hz >= 0.75:
        score += 5
    if z(t.resting_hr, b.resting_hr, b.rhr_sd, 2) >= 1.5:
        score -= 10; why.append("resting heart rate raised")
    if t.soreness_0_10 is not None and t.soreness_0_10 >= 6:
        score -= 10; why.append(f"soreness {t.soreness_0_10:.0f}/10")
    fatigued = sorted(m for m, v in (t.emg_fatigue_index or {}).items() if v >= 0.6)
    if fatigued:
        why.append("EMG shows fatigue in " + ", ".join(fatigued))
    if live_pain_rule(t.pain_0_10):
        score = min(score, 30); why.append(f"pain {t.pain_0_10:.0f}/10")
    score = int(max(0, min(100, score)))
    return {"score": score, "zone": "green" if score >= 65 else "amber" if score >= 40 else "red",
            "reasons": why, "fatigued_muscles": fatigued}


def adjust_session(s: dict, r: dict) -> tuple[dict, list[str]]:
    out, changes = copy.deepcopy(s), []
    if r["zone"] == "red":
        out.update(name="Recovery: easy walk + mobility", kind="recovery", minutes=20,
                   blocks=[x for x in out["blocks"] if BY_ID[x["exercise_id"]].category in
                           ("mobility", "corrective")][:3],
                   note="Readiness is low: 15 min easy walk and gentle mobility only.")
        return out, ["swapped to recovery day"]
    for x in out["blocks"]:
        e = BY_ID[x["exercise_id"]]
        if r["zone"] == "amber" or set(e.muscles) & set(r["fatigued_muscles"]):
            if x["sets"] > 2:
                per = x["minutes"] / x["sets"]
                x["sets"] -= 1
                x["minutes"] = round(x["sets"] * per, 1)
                changes.append(f"{x['name']}: one set fewer")
            if x["target_rir"]:
                x["target_rir"] = "3"
        if "interval" in e.id and r["zone"] == "amber":
            x["reps"] = "3 x 3 min hard / 3 min easy"
            changes.append("intervals shortened")
    if r["zone"] == "green" and r["score"] >= 85:
        changes.append("good readiness: add load if the first set feels easy")
    if out["kind"] == "strength":
        out["minutes"] = round(WARMUP_MIN + sum(x["minutes"] for x in out["blocks"]))
    return out, changes


# =============================================================================================
# 9. END-TO-END: profile -> plan + forecasts + today
# =============================================================================================
def load_profile_file(path: str) -> dict:
    d = json.loads(Path(path).read_text())
    return {"profile": Profile.from_dict(d["profile"]),
            "signals": [DailySignals.from_dict(x) for x in d.get("signals", [])],
            "checkins": [CheckIn(**x) for x in d.get("checkins", [])],
            "today": DailySignals.from_dict(d["today"]) if d.get("today") else None,
            "today_weekday": d.get("today_weekday", "Mon"), "adherence": d.get("adherence", 0.85)}


def recommend(model: Optional[CoachModel], p: Profile, b: Baseline, top: int = 10) -> list[dict]:
    safety = screen(p)
    scores = model.score_profile(p, b) if model else {e.id: rule_prior(e, p, b) for e in CATALOG}
    ranked = sorted((e for e in BY_ID.values() if e.id in scores and feasible(e, p, safety)),
                    key=lambda e: -scores[e.id])
    return [{"exercise_id": e.id, "name": e.name, "pattern": e.pattern, "equipment": e.equipment,
             "score": round(scores[e.id], 4)} for e in ranked[:top]]


def run(profile: Profile, signals: list, checkins=None, model: Optional[CoachModel] = None,
        today: Optional[DailySignals] = None, today_weekday="Mon", adherence=0.85, seed=7) -> dict:
    checkins = list(checkins or [])
    safety = screen(profile)
    base = summarize(signals)
    scores = model.score_profile(profile, base) if model else None
    plan = build_plan(profile, base, safety, scores, seed)
    week0 = next((c for c in checkins if c.week == 0), None)
    if week0 is None:
        week0 = CheckIn(0, {})
        checkins.insert(0, week0)
    if base.gait_speed_mps is not None:
        week0.metrics.setdefault("gait_speed_mps", round(base.gait_speed_mps, 2))
    week0.metrics.setdefault("strength_pct", 0.0)
    metrics = list(TIERS[plan["tier"]].headline_metrics)
    kcal = plan["nutrition"]["daily_energy_change_kcal"] if plan["nutrition"] else 0
    if kcal:
        metrics.append("body_weight_kg")
    fc = [forecast(m, profile, plan["dose"], checkins, adherence, base.sleep_hours, kcal) for m in metrics]
    res = {"profile": profile.name, "baseline": asdict(base), "plan": plan, "forecasts": fc,
           "top_suggestions": recommend(model, profile, base, 10)}
    if today is not None:
        r = assess_readiness(today, base)
        res["today"] = {"weekday": today_weekday, "readiness": r,
                        "sessions": [dict(zip(("session", "changes"), adjust_session(s, r)))
                                     for s in plan["sessions"] if s["day"] == today_weekday]}
    return res


def render_markdown(r: dict) -> str:
    p, b = r["plan"], r["baseline"]
    L = [f"# Training plan for {r['profile']}", "",
         f"**Goal tier:** {p['tier_label']}" + (f" (you asked for {TIERS[p['requested_tier']].label})"
                                                if p["tier"] != p["requested_tier"] else ""),
         f"**Time:** {p['weekly_minutes_planned']} min/week planned (budget {p['weekly_minutes_budget']}).",
         f"**Exercises chosen by:** {p['suggested_by']}.", ""]
    if p["warnings"]:
        L += ["## Before you start", ""] + [f"- {w}" for w in p["warnings"]] + [""]
    facts = []
    for k, fmt in [("sleep_hours", "sleep {:.1f} h"), ("steps", "{:,.0f} steps/day"),
                   ("sitting_hours", "{:.1f} h sitting"), ("head_down_minutes", "{:.0f} min head-down"),
                   ("gait_speed_mps", "walking speed {:.2f} m/s"),
                   ("glute_to_hamstring_ratio", "glute:hamstring activation {:.2f}")]:
        if b.get(k) is not None:
            facts.append(fmt.format(b[k]))
    L += ["## What your data shows", "", "- " + "; ".join(facts) + ".",
          f"- Flags: {', '.join(b['flags']) or 'none'}.", ""]
    L += ["## Your week", ""]
    corr = [s for s in p["sessions"] if s["kind"] == "corrective"]
    for s in [s for s in p["sessions"] if s["kind"] != "corrective"] + corr[:1]:
        day = ", ".join(c["day"] for c in corr) if s["kind"] == "corrective" else s["day"]
        L.append(f"### {day} · {s['name']} · {s['minutes']} min")
        if s.get("note"):
            L.append(f"_{s['note']}_")
        L.append("")
        for x in s["blocks"]:
            d = f"{x['sets']} x {x['reps']}"
            if x["target_rir"]: d += f", stop with {x['target_rir']} reps in reserve"
            if x["load"]: d += f", load: {x['load']}"
            if x["rest_s"]: d += f", rest {x['rest_s']} s"
            if x["tempo"]: d += f", tempo {x['tempo']}"
            L.append(f"- **{x['name']}**: {d}. {x['cue']}")
            extra = [f"easier: {BY_ID[x['easier']].name}" if x["easier"] else None,
                     f"harder: {BY_ID[x['harder']].name}" if x["harder"] else None]
            extra = [e for e in extra if e]
            if extra:
                L.append("  - " + "; ".join(extra))
        L.append("")
    L += ["**Weekly hard sets per muscle:** " +
          ", ".join(f"{k} {v:g}" for k, v in p["sets_per_muscle_week"].items()), ""]
    if p["daily_habits"]:
        L += ["## Daily habits", ""] + [f"- {h}" for h in p["daily_habits"]] + [""]
    if p["nutrition"]:
        n = p["nutrition"]
        L += ["## Nutrition", "", f"- About {n['target_kcal']} kcal/day ({n['daily_energy_change_kcal']:+d} "
              f"vs maintenance ~{n['estimated_maintenance_kcal']}), protein ~{n['protein_g']} g/day.",
              f"- {n['note']}", ""]
    L += ["## What to expect", "", "Middle 80% of people like you on this plan; ranges narrow after "
          "each 4-weekly check-in.", "", "| Measure | Week 4 | Week 8 | Week 12 | Week 26 |",
          "|---|---|---|---|---|"]
    for f in r["forecasts"]:
        cells = []
        for w in (4, 8, 12, 26):
            lo, mid, hi = f["change_by_week"].get(w) or f["change_by_week"].get(str(w))
            u = "%" if f["unit"] == "%" else f" {f['unit']}"
            cells.append(f"{mid:+g}{u} ({lo:g} to {hi:g})")
        lab = f["label"] + (f" (now {f['baseline']:g} {f['unit']})" if f["baseline"] not in (None, 0, 0.0) else "")
        L.append(f"| {lab} | " + " | ".join(cells) + " |")
    L += [""] + [f"- {f['label']}: {f['note']}" for f in r["forecasts"] if f.get("note")]
    L += ["", "## How the plan progresses", ""] + [f"- {x}" for x in p["progression_rules"]]
    if "today" in r:
        t = r["today"]
        rd = t["readiness"]
        L += ["", f"## Today ({t['weekday']}): readiness {rd['score']}/100, {rd['zone']}", ""]
        if rd["reasons"]:
            L.append("- Why: " + "; ".join(rd["reasons"]) + ".")
        for s in t["sessions"]:
            L.append(f"- {s['session']['name']} ({s['session']['minutes']} min): "
                     f"{'; '.join(s['changes']) or 'no changes'}.")
    return "\n".join(L) + "\n"


# =============================================================================================
# 10. DEMO DATA (rule-generated labels, so the pipeline can be tested before real data exists)
# =============================================================================================
def make_demo_data(n: int = 3000, seed: int = 1) -> list[dict]:
    """Random people + rule-planner labels. The model learns to imitate the rules; real data
    replaces this. Useful as a pretraining set and to check that training works."""
    rng = random.Random(seed)
    goals = ["health", "active", "fit", "strength", "body_shape"]
    equip_opts = [["none"], ["none", "bands"], ["none", "dumbbells"], ["none", "bands", "dumbbells"],
                  ["gym"], ["gym"], ["none", "kettlebell"], ["gym", "pool"]]
    rows = []
    for i in range(n):
        age = int(rng.uniform(18, 75))
        sex = rng.choice(["male", "female"])
        h = rng.gauss(176 if sex == "male" else 163, 7)
        w = rng.gauss(80 if sex == "male" else 66, 12)
        goal = rng.choice(goals)
        sub = rng.choice(["lean_gain", "recomposition", "lean_down"]) if goal == "body_shape" else None
        ta = max(0.0, rng.choice([0, 0, 0.2, 0.5, 1, 2, 4]) + rng.random() * 0.3)
        days = rng.choice([2, 3, 3, 4, 4, 5])
        mins = rng.choice([90, 120, 150, 180, 240, 300])
        pain = rng.sample(["low_back", "knee", "shoulder", "neck", "wrist"], rng.choice([0, 0, 0, 1, 1, 2]))
        prio = rng.sample(["chest", "back", "glutes", "shoulders", "biceps", "quads"], 2) if goal == "body_shape" else []
        p = Profile(f"demo{i}", age, sex, round(h), round(w, 1), goal, sub, prio, round(ta, 1), days, mins,
                    rng.choice([35, 45, 60, 75]), rng.choice(equip_opts), [], [], pain,
                    Screening(chest_pain=rng.random() < 0.03))
        desk = rng.random() < 0.6
        b = Baseline(
            sleep_hours=round(rng.gauss(6.9, 0.8), 2), sleep_regularity_sd_h=round(abs(rng.gauss(0.7, 0.4)), 2),
            hrv_ms=round(rng.gauss(55 - 0.4 * (age - 40), 12), 1), resting_hr=round(rng.gauss(64, 7), 1),
            steps=round(max(1500, rng.gauss(5000 if desk else 8500, 2200))),
            sitting_hours=round(rng.gauss(9 if desk else 6, 1.2), 2),
            longest_sitting_bout_min=round(max(20, rng.gauss(110 if desk else 60, 30))),
            phone_screen_hours=round(max(0.5, rng.gauss(4, 1.5)), 2),
            head_down_minutes=round(max(10, rng.gauss(120, 50))),
            phone_after_23h_minutes=round(max(0, rng.gauss(20, 20))),
            gait_speed_mps=round(rng.gauss(1.35 - 0.006 * max(0, age - 40), 0.12), 2),
            gait_asymmetry_pct=round(abs(rng.gauss(5, 4)), 1),
            glute_to_hamstring_ratio=round(rng.gauss(0.9, 0.2), 2),
            upper_trap_desk_tone=round(abs(rng.gauss(4, 2)), 2),
            muscle_load={m: round(abs(rng.gauss(0.08, 0.04)), 3) for m in EMG_MUSCLES})
        b.moderate_minutes_week = max(0.0, b.steps - 3000) / 110 * 0.5 * 7
        b.flags = coaching_flags(b)
        plan = build_plan(p, b, screen(p), None, seed=rng.randint(0, 10 ** 6))
        labs = []
        for s in plan["sessions"]:
            for x in s["blocks"]:
                if x["exercise_id"] not in labs:
                    labs.append(x["exercise_id"])
        if labs and rng.random() < 0.15:   # label noise, as real data will have
            labs.pop(rng.randrange(len(labs)))
        row = feature_row(p, b)
        row["sample_id"] = f"demo{i}"
        row["exercises"] = ";".join(BY_ID[x].name for x in labs)
        rows.append(row)
    return rows


def write_csv(rows: list[dict], path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    cols = ["sample_id"] + CANONICAL_FEATURES + ["exercises"]
    with open(path, "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        wr.writeheader()
        for r in rows:
            wr.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})


# =============================================================================================
# 11. CLI
# =============================================================================================
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="AI Training Coach: trainable exercise suggestion model")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("make-demo-data"); a.add_argument("--n", type=int, default=3000)
    a.add_argument("--out", default="data/demo_dataset.csv"); a.add_argument("--seed", type=int, default=1)
    a = sub.add_parser("inspect"); a.add_argument("data"); a.add_argument("--label-col")
    a = sub.add_parser("train"); a.add_argument("data"); a.add_argument("--label-col")
    a.add_argument("--out", default="models/coach_model"); a.add_argument("--epochs", type=int, default=80)
    a.add_argument("--hidden", type=int, default=128); a.add_argument("--dim", type=int, default=48)
    a.add_argument("--lr", type=float, default=3e-3); a.add_argument("--batch-size", type=int, default=128)
    a.add_argument("--l2", type=float, default=1e-4); a.add_argument("--dropout", type=float, default=0.1)
    a.add_argument("--seed", type=int, default=0)
    a = sub.add_parser("evaluate"); a.add_argument("data"); a.add_argument("--model", required=True)
    a.add_argument("--label-col")
    a = sub.add_parser("recommend"); a.add_argument("--profile", required=True)
    a.add_argument("--model"); a.add_argument("--top", type=int, default=10)
    a = sub.add_parser("plan"); a.add_argument("--profile", required=True); a.add_argument("--model")
    a.add_argument("--json", action="store_true"); a.add_argument("-o", "--output")
    a = sub.add_parser("catalog"); a.add_argument("--out", default="catalog.csv")
    args = ap.parse_args(argv)

    if args.cmd == "make-demo-data":
        write_csv(make_demo_data(args.n, args.seed), args.out)
        print(f"Wrote {args.n} demo rows to {args.out}")
    elif args.cmd == "inspect":
        ds = load_dataset(args.data, args.label_col)
        enc = FeatureEncoder().fit(ds.rows)
        n_lab = [len(l) for l in ds.labels]
        counts: dict = {}
        for l in ds.labels:
            for eid, _ in l:
                counts[eid] = counts.get(eid, 0) + 1
        print(f"Rows: {len(ds.rows)}  label column: {ds.label_col}")
        print(f"Encoded features: {enc.dim} from {len(enc.spec)} columns")
        for s in enc.spec:
            print(f"  {s['col']:<28} {s['kind']}" + (f" ({len(s['cats'])} values)" if s["kind"] != "num" else ""))
        print(f"Exercises per row: mean {np.mean(n_lab):.1f}, min {min(n_lab)}, max {max(n_lab)}")
        print(f"Distinct exercises used: {len(counts)} (catalog has {len(CATALOG)})")
        print("Most common:", ", ".join(f"{k} ({v})" for k, v in sorted(counts.items(), key=lambda x: -x[1])[:10]))
        if ds.unmatched:
            print(f"Names not in the catalog ({len(ds.unmatched)}), added as new movements:")
            for k, v in list(ds.unmatched.items())[:30]:
                print(f"  '{k}' -> {v}")
    elif args.cmd == "train":
        train_model(args.data, args.out, args.label_col, args.epochs, args.hidden, args.dim, args.lr,
                    args.batch_size, args.l2, args.dropout, seed=args.seed)
    elif args.cmd == "evaluate":
        m = CoachModel.load(args.model)
        ds = load_dataset(args.data, args.label_col or m.info.get("label_col"))
        pos = {e.id: j for j, e in enumerate(m.items)}
        Y = np.zeros((len(ds.labels), len(m.items)))
        for i, l in enumerate(ds.labels):
            for eid, w in l:
                if eid in pos:
                    Y[i, pos[eid]] = w
        print(json.dumps(ranking_metrics(m.score_rows(ds.rows), Y), indent=1))
    elif args.cmd == "recommend":
        d = load_profile_file(args.profile)
        m = CoachModel.load(args.model) if args.model else None
        for r in recommend(m, d["profile"], summarize(d["signals"]), args.top):
            print(f"{r['score']:.3f}  {r['name']:<40} {r['pattern']:<16} {r['equipment']}")
    elif args.cmd == "plan":
        d = load_profile_file(args.profile)
        m = CoachModel.load(args.model) if args.model else None
        res = run(d["profile"], d["signals"], d["checkins"], m, d["today"], d["today_weekday"], d["adherence"])
        txt = json.dumps(res, indent=1, default=str) if args.json else render_markdown(res)
        if args.output:
            Path(args.output).write_text(txt)
            print(f"Wrote {args.output}")
        else:
            print(txt)
    elif args.cmd == "catalog":
        with open(args.out, "w", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(["id", "name", "category", "pattern", "muscles", "equipment", "level",
                         "contraindications"])
            for e in CATALOG:
                wr.writerow([e.id, e.name, e.category, e.pattern, ";".join(e.muscles), e.equipment,
                             e.level, ";".join(e.contraindications)])
        print(f"Wrote {len(CATALOG)} exercises to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
