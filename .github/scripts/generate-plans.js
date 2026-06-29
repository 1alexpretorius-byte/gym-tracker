// generate-plans.js
// Reads recent logs → pre-computes progression → calls Claude API with strict
// slot-based session templates → validates output → writes 6 plan files.
// Runs via GitHub Actions every Sunday at 16:00 UTC.
// Requires: ANTHROPIC_API_KEY environment variable.

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '../..');
const LOGS_DIR  = path.join(ROOT, 'logs');
const PLANS_DIR = path.join(ROOT, 'plans');

const PPL_ROTATION = ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'];

const INCREMENTS = { barbell: 2.5, dumbbell: 1.0, cable: 2.5, machine: 2.5, bodyweight: 0 };

// ── SESSION TEMPLATES ────────────────────────────────────────────────────────
// Each slot defines a required movement pattern. Claude must pick one exercise
// from the options list. This enforces A/B differentiation, squats, flies, etc.

const SESSION_TEMPLATES = {
  'Push A': {
    focus: 'Horizontal press — chest primary, shoulders secondary, triceps tertiary',
    slots: [
      {
        id: 'horizontal_press', required: true, order: 1,
        label: 'Horizontal press (chest lead)',
        options: ['Flat Bench Press (barbell)', 'Low Incline Barbell Press (barbell)'],
        sets: 4, rep_range: [8, 10], rest: 180,
        note: 'Lead with this. Heavy compound. Full ROM, controlled eccentric.'
      },
      {
        id: 'upper_chest_press', required: true, order: 2,
        label: 'Upper chest accessory press',
        options: ['Incline DB Press (dumbbell)', 'Incline Barbell Press (barbell)', 'Incline Cable Press (cable)'],
        sets: 3, rep_range: [10, 12], rest: 120,
        note: 'Acceptable second press in Push A. Push B chest slot must be a FLY, not this.'
      },
      {
        id: 'overhead_press', required: true, order: 3,
        label: 'Shoulder overhead press',
        options: ['Seated DB Shoulder Press (dumbbell)', 'Seated Barbell OHP (barbell)', 'Arnold Press (dumbbell)'],
        sets: 3, rep_range: [10, 12], rest: 120
      },
      {
        id: 'lateral_delt', required: true, order: 4,
        label: 'Lateral deltoid isolation',
        options: ['Lateral Raises (dumbbell)', 'Cable Lateral Raise (cable)', 'Leaning Cable Lateral Raise (cable)'],
        sets: 3, rep_range: [12, 15], rest: 60
      },
      {
        id: 'triceps_pushdown', required: true, order: 5,
        label: 'Triceps pushdown variation',
        options: ['Triceps Pushdown (cable)', 'Rope Pushdown (cable)', 'Reverse Grip Pushdown (cable)'],
        sets: 3, rep_range: [10, 12], rest: 75
      },
      {
        id: 'triceps_overhead', required: true, order: 6,
        label: 'Triceps overhead stretch',
        options: ['Overhead Triceps Extension (cable)', 'Skull Crushers (barbell)', 'DB Overhead Extension (dumbbell)'],
        sets: 3, rep_range: [10, 12], rest: 75
      }
    ]
  },

  'Push B': {
    focus: 'Vertical press — shoulders primary, chest fly isolation (NO second press), single triceps movement',
    slots: [
      {
        id: 'overhead_press_lead', required: true, order: 1,
        label: 'Overhead press (must lead)',
        options: ['Seated DB Shoulder Press (dumbbell)', 'Seated Barbell OHP (barbell)', 'Standing Barbell OHP (barbell)', 'Arnold Press (dumbbell)'],
        sets: 4, rep_range: [8, 10], rest: 180,
        note: 'Lead with this. Never flat bench press in Push B.'
      },
      {
        id: 'chest_fly', required: true, order: 2,
        label: 'CHEST FLY ONLY — absolutely no press allowed here',
        options: ['Cable Crossover (cable)', 'Pec Deck Fly (machine)', 'Incline DB Fly (dumbbell)', 'Low Cable Fly (cable)', 'High Cable Fly (cable)'],
        sets: 3, rep_range: [12, 15], rest: 90,
        note: 'CRITICAL: must be a fly or crossover. Incline DB Press is FORBIDDEN in this slot.'
      },
      {
        id: 'lateral_delt_variety', required: true, order: 3,
        label: 'Lateral deltoid — prefer cable to vary from Push A',
        options: ['Cable Lateral Raise (cable)', 'Leaning Cable Lateral Raise (cable)', 'Lateral Raises (dumbbell)'],
        sets: 3, rep_range: [12, 15], rest: 60,
        note: 'Prefer cable if Push A used dumbbell lateral raises.'
      },
      {
        id: 'triceps_unique', required: true, order: 4,
        label: 'ONE triceps exercise — must differ from Push A triceps',
        options: ['Dips (bodyweight)', 'Close-Grip Bench Press (barbell)', 'Cable Kickback (cable)', 'Tate Press (dumbbell)', 'JM Press (barbell)'],
        sets: 3, rep_range: [8, 12], rest: 90,
        note: 'ONE triceps only. Triceps Pushdown and OHT Extension are Push A movements — do NOT use here.'
      }
    ]
  },

  'Pull A': {
    focus: 'Vertical pull — lats primary, mid-back, rotator cuff health, biceps (two variations)',
    slots: [
      {
        id: 'vertical_pull', required: true, order: 1,
        label: 'Vertical pull — wide overhand grip',
        options: ['Lat Pulldown (cable)', 'Wide-Grip Pulldown (cable)', 'Pull-Up (bodyweight)'],
        sets: 3, rep_range: [8, 12], rest: 150,
        note: 'Wide overhand grip. Primary lat builder.'
      },
      {
        id: 'horizontal_row', required: true, order: 2,
        label: 'Horizontal row — mid-back/rhomboids',
        options: ['Seated Cable Row (cable)', 'Cable Row with V-Bar (cable)', 'Machine Row (machine)'],
        sets: 3, rep_range: [10, 12], rest: 120
      },
      {
        id: 'face_pull', required: true, order: 3,
        label: 'Face Pull — REQUIRED every Pull A, never skip',
        options: ['Face Pull (cable)'],
        sets: 3, rep_range: [15, 20], rest: 60,
        note: 'Rope at upper chest height. Essential for rotator cuff health with heavy pressing.'
      },
      {
        id: 'bicep_supinating', required: true, order: 4,
        label: 'Bicep curl — supinating grip',
        options: ['DB Bicep Curl (dumbbell)', 'Barbell Curl (barbell)', 'EZ-Bar Curl (barbell)', 'Cable Curl (cable)'],
        sets: 3, rep_range: [10, 12], rest: 75
      },
      {
        id: 'bicep_neutral', required: true, order: 5,
        label: 'Bicep curl — neutral/hammer grip',
        options: ['Hammer Curl (dumbbell)', 'Rope Hammer Curl (cable)', 'Cross-Body Hammer Curl (dumbbell)'],
        sets: 2, rep_range: [12, 15], rest: 60
      }
    ]
  },

  'Pull B': {
    focus: 'Horizontal pull — upper back primary, rear delt isolation, single bicep different from Pull A',
    slots: [
      {
        id: 'horizontal_row_compound', required: true, order: 1,
        label: 'Heavy horizontal row compound (lead)',
        options: ['Bent-Over Barbell Row (barbell)', 'Chest-Supported DB Row (dumbbell)', 'T-Bar Row (barbell)', 'Pendlay Row (barbell)'],
        sets: 3, rep_range: [8, 10], rest: 180,
        note: 'Lead with this. Heavy compound. Retract scapula at the top.'
      },
      {
        id: 'unilateral_row', required: true, order: 2,
        label: 'Unilateral row — corrects left/right imbalances',
        options: ['Single Arm DB Row (dumbbell)', 'Single Arm Cable Row (cable)', 'Meadows Row (barbell)'],
        sets: 3, rep_range: [10, 12], rest: 90
      },
      {
        id: 'vertical_pull_variety', required: true, order: 3,
        label: 'Lat pulldown — underhand or neutral grip (different from Pull A overhand)',
        options: ['Underhand Lat Pulldown (cable)', 'Neutral Grip Pulldown (cable)', 'Close-Grip Pulldown (cable)'],
        sets: 3, rep_range: [10, 12], rest: 120,
        note: 'Must be underhand or neutral — Pull A covers wide overhand.'
      },
      {
        id: 'rear_delt_isolation', required: true, order: 4,
        label: 'Rear delt fly isolation — NOT face pull (that belongs to Pull A)',
        options: ['Rear Delt Fly (cable)', 'Reverse Pec Deck (machine)', 'Bent-Over DB Rear Delt Fly (dumbbell)'],
        sets: 3, rep_range: [15, 20], rest: 60,
        note: 'Do NOT use Face Pull here. It belongs to Pull A only.'
      },
      {
        id: 'bicep_variety', required: true, order: 5,
        label: 'ONE bicep exercise — must differ from Pull A biceps this week',
        options: ['Preacher Curl (machine)', 'Incline DB Curl (dumbbell)', 'EZ-Bar Curl (barbell)', 'Spider Curl (dumbbell)', 'Cable Curl (cable)'],
        sets: 3, rep_range: [10, 12], rest: 75,
        note: 'One bicep only. Must not be DB Bicep Curl or Hammer Curl (those are Pull A).'
      }
    ]
  },

  'Legs A': {
    focus: 'Quad dominant — squat pattern leads (NO leg press), moderate hip hinge, full isolation',
    slots: [
      {
        id: 'squat_compound', required: true, order: 1,
        label: 'SQUAT PATTERN — leg press is FORBIDDEN here',
        options: ['Barbell Back Squat (barbell)', 'Hack Squat (machine)', 'Front Squat (barbell)', 'Goblet Squat (dumbbell)'],
        sets: 4, rep_range: [6, 10], rest: 180,
        note: 'Must be a squat movement. Leg Press does not count.'
      },
      {
        id: 'hip_hinge_moderate', required: true, order: 2,
        label: 'Moderate hip hinge (lighter than Legs B barbell RDL)',
        options: ['Romanian Deadlift (dumbbell)', 'Stiff-Leg Deadlift (dumbbell)', 'Single-Leg RDL (dumbbell)'],
        sets: 3, rep_range: [10, 12], rest: 120,
        note: 'Accessory hip hinge. Keep lighter than Legs B.'
      },
      {
        id: 'quad_isolation', required: true, order: 3,
        label: 'Quad isolation',
        options: ['Leg Extension (machine)'],
        sets: 3, rep_range: [12, 15], rest: 75
      },
      {
        id: 'hamstring_isolation', required: true, order: 4,
        label: 'Hamstring isolation',
        options: ['Leg Curl (machine)', 'Seated Leg Curl (machine)'],
        sets: 3, rep_range: [10, 12], rest: 90
      },
      {
        id: 'calf_gastrocnemius', required: true, order: 5,
        label: 'Calf — standing (gastrocnemius focus)',
        options: ['Standing Calf Raise (machine)', 'Calf Press on Leg Press (machine)', 'Single-Leg Calf Raise (bodyweight)'],
        sets: 4, rep_range: [15, 20], rest: 60
      }
    ]
  },

  'Legs B': {
    focus: 'Posterior chain dominant — heavy barbell RDL leads, unilateral movement, soleus calf',
    slots: [
      {
        id: 'hip_hinge_heavy', required: true, order: 1,
        label: 'Heavy barbell RDL (posterior chain lead)',
        options: ['Romanian Deadlift (barbell)', 'Barbell Stiff-Leg Deadlift (barbell)', 'Deficit Romanian Deadlift (barbell)'],
        sets: 4, rep_range: [8, 10], rest: 180,
        note: 'Lead compound. Heavier than Legs A. Drive hips back, neutral spine.'
      },
      {
        id: 'unilateral_leg', required: true, order: 2,
        label: 'Unilateral leg movement',
        options: ['Bulgarian Split Squat (dumbbell)', 'Walking Lunges (dumbbell)', 'Step-Ups (dumbbell)', 'Reverse Lunges (dumbbell)'],
        sets: 3, rep_range: [10, 12], rest: 120,
        note: 'Reps are per leg. Develops balance and corrects asymmetry.'
      },
      {
        id: 'hamstring_isolation', required: true, order: 3,
        label: 'Hamstring isolation',
        options: ['Leg Curl (machine)', 'Seated Leg Curl (machine)'],
        sets: 3, rep_range: [10, 12], rest: 90
      },
      {
        id: 'quad_isolation', required: true, order: 4,
        label: 'Quad isolation',
        options: ['Leg Extension (machine)'],
        sets: 3, rep_range: [12, 15], rest: 75
      },
      {
        id: 'calf_soleus', required: true, order: 5,
        label: 'Calf — seated (soleus focus, different from Legs A standing)',
        options: ['Seated Calf Raise (machine)'],
        sets: 4, rep_range: [15, 20], rest: 60,
        note: 'Bent knee isolates soleus. Complements standing calf in Legs A.'
      }
    ]
  }
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

function getPhase(week) {
  if (week % 4 === 0) return 'Deload';
  if (week <= 2)      return 'Ramp-up';
  if (week <= 6)      return 'Building';
  return 'Peak';
}

function readLogs() {
  if (!fs.existsSync(LOGS_DIR)) return [];
  return fs.readdirSync(LOGS_DIR)
    .filter(f => /^log-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), 'utf8')); }
      catch (e) { console.warn(`Skipping malformed log: ${f}`); return null; }
    })
    // Only include logs that actually have exercises logged (ignore skipped/empty sessions)
    .filter(l => l && Array.isArray(l.exercises) && l.exercises.length > 0);
}

function readPlan(date) {
  const f = path.join(PLANS_DIR, `${date}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function getNextMonday() {
  const d    = new Date();
  const day  = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── PROGRESSIVE OVERLOAD PRE-COMPUTATION ────────────────────────────────────
// Computes weight recommendations in JS so Claude receives a single number
// per exercise rather than having to interpret raw log data.

function computeProgression(logs) {
  const byExercise = {};

  for (const log of logs) {
    if (!log.exercises) continue;
    const plan = readPlan(log.date);

    for (const ex of log.exercises) {
      if (!ex.name || !ex.sets || ex.sets.length === 0) continue;

      let targetWeight = null;
      let targetReps   = null;
      if (plan) {
        const planEx = plan.exercises?.find(p => p.name === ex.name);
        if (planEx) { targetWeight = planEx.target_weight_kg; targetReps = planEx.target_reps; }
      }

      const actualWeight = ex.sets[0]?.weight_kg ?? 0;
      const equip        = ex.equipment || 'cable';
      const increment    = INCREMENTS[equip] ?? 2.5;

      let rule = 'hold';
      if (targetReps && ex.sets.length > 0) {
        let totalTarget = 0, totalMissed = 0, anyMissedByMore2 = false;
        for (let i = 0; i < Math.min(targetReps.length, ex.sets.length); i++) {
          const missed = Math.max(0, targetReps[i] - (ex.sets[i]?.reps ?? 0));
          totalTarget += targetReps[i];
          totalMissed += missed;
          if (missed > 2) anyMissedByMore2 = true;
        }
        const missedPct = totalMissed / Math.max(1, totalTarget);
        if (missedPct > 0.2) {
          rule = 'reduce';
        } else if (!anyMissedByMore2 && ex.sets.length >= targetReps.length) {
          rule = 'increase';
        }
      }

      let recommended = actualWeight;
      if (rule === 'increase') recommended = actualWeight + increment;
      if (rule === 'reduce')   recommended = Math.max(increment, actualWeight - increment);
      recommended = Math.round(recommended * 2) / 2; // round to nearest 0.5kg

      // Always overwrite with the most recent entry (logs are sorted ascending)
      byExercise[ex.name] = {
        date:               log.date,
        session_type:       log.session_type,
        equipment:          equip,
        actual_weight:      actualWeight,
        target_weight:      targetWeight,
        rule,
        recommended_weight: recommended,
        last_sets:          ex.sets
      };
    }
  }

  return byExercise;
}

// ── PREVIOUS FIELD INJECTION ─────────────────────────────────────────────────
// After Claude generates plans, inject `previous` from actual log data.
// More reliable than asking Claude to populate it.

function getExercisePrevious(exerciseName, logs) {
  for (const log of [...logs].reverse()) {
    if (!log.exercises) continue;
    const ex = log.exercises.find(e => e.name === exerciseName);
    if (ex && ex.sets?.length > 0) {
      return {
        date: log.date,
        sets: ex.sets.map(s => ({ weight_kg: s.weight_kg, reps: s.reps }))
      };
    }
  }
  return null;
}

function injectPreviousData(plans, logs) {
  for (const plan of plans) {
    for (const ex of plan.exercises) {
      ex.previous = getExercisePrevious(ex.name, logs);
    }
  }
}

// ── PROMPT BUILDER ───────────────────────────────────────────────────────────

function buildPrompt(sessions, dates, week, phase, isDeload, progression, athleteBW, attempt) {
  const retryHeader = attempt > 1
    ? `⚠️  RETRY ATTEMPT ${attempt} — a previous attempt failed validation. Follow slot rules exactly.\n\n`
    : '';

  const progressionText = Object.entries(progression).length > 0
    ? Object.entries(progression).map(([name, p]) => {
        const symbol = p.rule === 'increase' ? '↑' : p.rule === 'reduce' ? '↓' : '→';
        return `  ${name}: last ${p.actual_weight}kg ${symbol} USE ${p.recommended_weight}kg (${p.rule})`;
      }).join('\n')
    : '  (No history — use conservative intermediate starting weights)';

  const sessionBlocks = sessions.map((sessionType, i) => {
    const tmpl = SESSION_TEMPLATES[sessionType];
    const slotsText = tmpl.slots.map(slot => {
      const req   = slot.required ? '[REQUIRED]' : '[OPTIONAL]';
      const warn  = slot.note ? `\n     ⚠️  ${slot.note}` : '';
      return `  Slot ${slot.order} ${req} — ${slot.label}
     Options: ${slot.options.join(' | ')}
     Sets: ${slot.sets} | Reps: ${slot.rep_range[0]}–${slot.rep_range[1]} | Rest: ${slot.rest}s${warn}`;
    }).join('\n\n');

    return `### ${dates[i]}: ${sessionType}
Focus: ${tmpl.focus}

${slotsText}`;
  }).join('\n\n---\n\n');

  return `${retryHeader}Generate exactly 6 PPL training plan JSON files for Alex Pretorius.

## Athlete Profile
- Body weight: ${athleteBW}kg | Goal: hypertrophy + lean bulk (+0.5kg/month)
- Experience: Intermediate (~20 months lifting)
- Equipment: Full commercial gym
- Week: ${week} | Phase: ${phase}${isDeload ? '\n- ⚠️ DELOAD WEEK: 70% of all weights, +2 reps per set, -1 set per exercise' : ''}

## Pre-computed Progressive Overload
Use these weights directly. They are calculated from actual performance logs.
${progressionText}

## Session Templates
For each session, fill every REQUIRED slot with exactly one exercise from its options list.
Use the slot's Sets/Reps/Rest values. Apply the pre-computed weight when the exercise appears above.
For any exercise with no history, estimate a conservative intermediate weight.

${sessionBlocks}

## Absolute rules (violations cause rejection and retry)
1. Push B Slot 2 MUST be a fly or cable crossover — Incline DB Press is FORBIDDEN.
2. Push B Slot 4 triceps MUST NOT be Triceps Pushdown or Overhead Triceps Extension.
3. Pull B Slot 5 bicep MUST NOT be DB Bicep Curl or Hammer Curl (those are Pull A).
4. Legs A Slot 1 MUST be a squat movement — Leg Press is FORBIDDEN.
5. All exercises must come from the listed options — do not invent new exercises.
6. Dumbbell weights are always per hand.
7. target_reps array length must exactly equal the sets count.
8. Set "previous": null for every exercise (the script injects real data afterward).

## Required JSON schema per exercise
{
  "name": "Exercise Name",
  "equipment": "barbell|dumbbell|cable|machine|bodyweight",
  "sets": N,
  "target_reps": [N, N, ...],
  "target_weight_kg": N,
  "rest_seconds": N,
  "notes": "One specific coaching cue.",
  "previous": null
}

## Output
Return a JSON array of exactly 6 plan objects inside a \`\`\`json code block.
Verify every REQUIRED slot is filled before responding.`;
}

// ── VALIDATION ───────────────────────────────────────────────────────────────

function validatePlans(plans, sessions) {
  const errors = [];

  if (!Array.isArray(plans) || plans.length !== 6) {
    return [`Expected array of 6 plans, got ${Array.isArray(plans) ? plans.length : typeof plans}`];
  }

  for (let i = 0; i < 6; i++) {
    const plan = plans[i];
    const sessionType = sessions[i];
    const tmpl = SESSION_TEMPLATES[sessionType];
    const tag  = `[${sessionType} ${plan?.date}]`;

    if (!plan?.exercises?.length) {
      errors.push(`${tag}: no exercises`); continue;
    }

    const names = plan.exercises.map(e => (e.name || '').toLowerCase());

    // Each required slot must be filled by at least one matching option
    for (const slot of tmpl.slots.filter(s => s.required)) {
      const optKeywords = slot.options.map(o => o.split(' (')[0].toLowerCase().split(' ')[0]);
      const filled = names.some(n => optKeywords.some(kw => n.startsWith(kw) || n.includes(kw)));
      if (!filled) {
        errors.push(`${tag} Slot ${slot.order} (${slot.label}): not filled. Expected one of: ${slot.options.join(', ')}`);
      }
    }

    // Push B: must have fly, must NOT have incline press or Push A triceps
    if (sessionType === 'Push B') {
      const hasFly = names.some(n => n.includes('fly') || n.includes('crossover') || n.includes('pec deck'));
      if (!hasFly) {
        errors.push(`${tag}: MISSING chest fly. Got: ${plan.exercises.map(e => e.name).join(', ')}`);
      }
      const forbiddenPress = plan.exercises.find(e => {
        const n = e.name.toLowerCase();
        return (n.includes('incline') && n.includes('press')) || n.includes('flat bench');
      });
      if (forbiddenPress) {
        errors.push(`${tag}: Forbidden press "${forbiddenPress.name}" — Push B chest slot must be a fly.`);
      }
      const pushATriceps = plan.exercises.find(e => {
        const n = e.name.toLowerCase();
        return n.includes('pushdown') || (n.includes('overhead') && n.includes('extension')) || n.includes('skull');
      });
      if (pushATriceps) {
        errors.push(`${tag}: Contains Push A triceps exercise "${pushATriceps.name}" — must use a different triceps movement.`);
      }
    }

    // Legs A: must have squat, must NOT have leg press
    if (sessionType === 'Legs A') {
      const hasSquat = names.some(n => n.includes('squat'));
      if (!hasSquat) {
        errors.push(`${tag}: MISSING squat pattern. Got: ${plan.exercises.map(e => e.name).join(', ')}`);
      }
      const legPress = plan.exercises.find(e => e.name.toLowerCase().includes('leg press'));
      if (legPress) {
        errors.push(`${tag}: Leg Press found — Legs A must use a squat movement.`);
      }
    }

    // Schema validation per exercise
    for (const ex of plan.exercises) {
      if (!ex.name) { errors.push(`${tag}: exercise missing name`); continue; }
      if (!ex.sets || ex.sets < 1) errors.push(`${tag} "${ex.name}": invalid sets (${ex.sets})`);
      if (!Array.isArray(ex.target_reps) || ex.target_reps.length !== ex.sets) {
        errors.push(`${tag} "${ex.name}": target_reps length ${ex.target_reps?.length} ≠ sets ${ex.sets}`);
      }
      if (ex.target_weight_kg == null || ex.target_weight_kg < 0) {
        errors.push(`${tag} "${ex.name}": invalid target_weight_kg (${ex.target_weight_kg})`);
      }
    }
  }

  return errors;
}

// ── API ──────────────────────────────────────────────────────────────────────

function extractJSON(text) {
  const m = text.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(m ? m[1] : text.trim());
}

async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-opus-4-8',
      max_tokens: 8192,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Claude API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }

  return (await resp.json()).content[0].text;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. See SETUP_GITHUB_ACTIONS.md.');
  }

  // 1. Load only logs with actual exercises (skip empty/skipped sessions)
  const logs    = readLogs();
  const lastLog = logs[logs.length - 1];

  // 2. Determine next week metadata
  const nextWeek  = (lastLog?.week ?? 0) + 1;
  const nextPhase = getPhase(nextWeek);
  const isDeload  = nextPhase === 'Deload';

  // 3. Build Mon–Sat dates for next week
  const nextMonday = getNextMonday();
  const dates = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(nextMonday);
    d.setDate(nextMonday.getDate() + i);
    return isoDate(d);
  });

  // 4. Session rotation picks up from last completed session type
  const lastType = lastLog?.session_type ?? 'Legs B';
  const lastIdx  = PPL_ROTATION.indexOf(lastType);
  const sessions = dates.map((_, i) =>
    PPL_ROTATION[(lastIdx + 1 + i) % PPL_ROTATION.length]
  );

  // 5. Skip entirely if all 6 plans already exist
  const missing = dates.filter(d => !fs.existsSync(path.join(PLANS_DIR, `${d}.json`)));
  if (missing.length === 0) {
    console.log('All 6 plans already exist — nothing to do.');
    console.log('Delete plan files to regenerate.');
    process.exit(0);
  }

  // 6. Pre-compute progressive overload from last 12 completed sessions
  const recentLogs  = logs.slice(-12);
  const progression = computeProgression(recentLogs);

  // Athlete body weight: most recent log that recorded it
  const athleteBW = [...logs].reverse().find(l => l.body_weight_kg)?.body_weight_kg ?? 73;

  console.log(`Generating week ${nextWeek} (${nextPhase}): ${dates[0]} – ${dates[5]}`);
  console.log('Sessions:', sessions.map((s, i) => `${dates[i]} ${s}`).join(', '));
  console.log(`Progression data for ${Object.keys(progression).length} exercises.`);
  if (isDeload) console.log('⚠️  DELOAD WEEK');

  // 7. Call Claude with up to 3 attempts; retry on validation failure
  const MAX_ATTEMPTS = 3;
  let plans = null;
  let lastErrors = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      console.log(`\nRetry attempt ${attempt}. Previous validation errors:`);
      lastErrors.forEach(e => console.log(`  ✗ ${e}`));
    }

    const prompt = buildPrompt(sessions, dates, nextWeek, nextPhase, isDeload, progression, athleteBW, attempt);
    console.log(`\nCalling Claude (attempt ${attempt})…`);

    let raw;
    try { raw = await callClaude(prompt); }
    catch (e) { console.warn(`  API error: ${e.message}`); lastErrors = [e.message]; continue; }

    let parsed;
    try { parsed = extractJSON(raw); }
    catch (e) { console.warn(`  JSON parse error: ${e.message}`); lastErrors = [`JSON parse: ${e.message}`]; continue; }

    const errors = validatePlans(parsed, sessions);
    if (errors.length === 0) {
      plans = parsed;
      console.log(`  ✓ Validation passed on attempt ${attempt}.`);
      break;
    }
    lastErrors = errors;
  }

  if (!plans) {
    throw new Error(
      `Plan generation failed after ${MAX_ATTEMPTS} attempts.\nLast errors:\n` +
      lastErrors.map(e => `  ✗ ${e}`).join('\n')
    );
  }

  // 8. Inject `previous` field from actual log data
  injectPreviousData(plans, logs);

  // 9. Write only missing plan files
  let written = 0;
  for (const plan of plans) {
    const file = path.join(PLANS_DIR, `${plan.date}.json`);
    if (fs.existsSync(file)) {
      console.log(`  → Skipping ${plan.date}.json (already exists)`);
      continue;
    }
    fs.writeFileSync(file, JSON.stringify(plan, null, 2));
    console.log(`  ✓ Written: plans/${plan.date}.json (${plan.session_type}, ${plan.exercises.length} exercises)`);
    written++;
  }

  console.log(`\nDone. ${written} plan(s) written. Plans committed by workflow.`);
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
