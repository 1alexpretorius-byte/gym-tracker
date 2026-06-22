// Reads recent logs → calls Claude API → writes next week's 6 plan files.
// Runs via GitHub Actions every Sunday at 16:00 UTC.
// Requires: ANTHROPIC_API_KEY environment variable.

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '../..');
const LOGS_DIR  = path.join(ROOT, 'logs');
const PLANS_DIR = path.join(ROOT, 'plans');

const PPL_ROTATION = ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'];

// ── helpers ──────────────────────────────────────────────────────────────────

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
    .filter(Boolean);
}

// Get next Monday's date (script runs on Sunday so +1 day)
function getNextMonday() {
  const d = new Date();
  const daysToAdd = d.getDay() === 0 ? 1 : 8 - d.getDay();
  d.setDate(d.getDate() + daysToAdd);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
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

  const data = await resp.json();
  return data.content[0].text;
}

function extractJSON(text) {
  const m = text.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(m ? m[1] : text.trim());
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY secret is not set. See SETUP_GITHUB_ACTIONS.md.');
  }

  const logs      = readLogs();
  const lastLog   = logs[logs.length - 1];
  const nextWeek  = (lastLog?.week ?? 0) + 1;
  const nextPhase = getPhase(nextWeek);
  const isDeload  = nextPhase === 'Deload';

  // 6 training dates: Mon–Sat
  const nextMonday = getNextMonday();
  const dates = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(nextMonday);
    d.setDate(nextMonday.getDate() + i);
    return isoDate(d);
  });

  // Session order picks up from where the last log left off
  const lastType = lastLog?.session_type ?? 'Legs B';
  const lastIdx  = PPL_ROTATION.indexOf(lastType);
  const sessions = dates.map((_, i) =>
    PPL_ROTATION[(lastIdx + 1 + i) % PPL_ROTATION.length]
  );

  // Check if plans already exist for all 6 days
  const existing = dates.filter(d => fs.existsSync(path.join(PLANS_DIR, `${d}.json`)));
  if (existing.length === 6) {
    console.log('Plans already exist for all 6 days next week — nothing to do.');
    console.log('To regenerate, delete the relevant plan files first.');
    process.exit(0);
  }

  // Last 12 sessions for context (progressive overload reference)
  const recentLogs = logs.slice(-12);

  console.log(`Generating week ${nextWeek} (${nextPhase}): ${dates[0]} – ${dates[5]}`);
  console.log('Sessions:', sessions.map((s, i) => `${dates[i]} ${s}`).join(', '));

  const prompt = `You are generating a week of PPL strength training plans for Alex Pretorius.

## Athlete profile
- Body weight: ${lastLog?.body_weight_kg ?? 73} kg (lean bulk, target +0.5 kg/month)
- Program: 6-day PPL split, intermediate lifter (~6 months lifting history)
- Equipment: Full commercial gym (barbells, cables, machines, dumbbells)

## Next week to generate
- Week number: ${nextWeek}
- Phase: ${nextPhase}${isDeload ? '\n- DELOAD WEEK: reduce all weights to 70% of current, increase target reps by 2, reduce sets by 1' : ''}
- Dates and session types:
${sessions.map((s, i) => `  ${dates[i]}: ${s}`).join('\n')}

## Recent training logs (for progressive overload reference)
${JSON.stringify(recentLogs, null, 2)}

## Progressive overload rules (non-deload weeks)
- All sets hit target reps → increase weight: barbell +2.5 kg, dumbbell +1 kg per hand, cable/machine +2.5 kg
- Any set missed target reps by >2 → keep same weight
- >20% total reps missed across the session → reduce by 2.5 kg
- Do not increase more than one exercise per muscle group per week
- Dumbbell weights are always per hand

## Required output schema (must match exactly — this is read by index.html)
{
  "date": "YYYY-MM-DD",
  "session_type": "Push A",
  "week": ${nextWeek},
  "phase": "${nextPhase}",
  "exercises": [
    {
      "name": "Exercise Name",
      "equipment": "barbell|dumbbell|cable|machine",
      "sets": 3,
      "target_reps": [10, 10, 10],
      "target_weight_kg": 60,
      "rest_seconds": 120,
      "notes": "One concise coaching cue (form, breathing, or tempo).",
      "previous": {
        "date": "YYYY-MM-DD",
        "sets": [{ "weight_kg": 60, "reps": 10 }]
      }
    }
  ]
}

## Session design — A vs B must use meaningfully different exercises

### Push A (horizontal press focus)
- Lead with flat or low-incline barbell/dumbbell press (chest primary)
- Include one overhead isolation (OHT cable extension or skull crushers)
- Include one triceps pushdown variation
- Include lateral raises
- Do NOT lead with shoulder press

### Push B (vertical/overhead press focus)
- Lead with seated barbell or dumbbell overhead press (shoulder primary)
- Include a chest fly variation (cable crossover, pec deck, or incline DB fly) — NOT another press
- Include lateral raises (cable preferred for variety)
- Include ONE triceps exercise only (dips, close-grip bench, or a variation not used in Push A that week)
- Do NOT repeat flat bench press

### Pull A (vertical pull focus)
- Lead with lat pulldown (wide overhand grip)
- Include seated cable row
- Include face pull (rear delts / rotator cuff health — never skip)
- Include two bicep variations (one supinating curl, one neutral/hammer)

### Pull B (horizontal pull focus)
- Lead with a row (bent-over barbell row, chest-supported row, or T-bar row)
- Include single-arm DB row or cable row variation
- Include rear delt fly (cable or pec deck reverse) — NOT face pull again
- Include lat pulldown (underhand or neutral grip for variety)
- Include ONE bicep exercise (choose a different variation to Pull A: preacher, incline, EZ-bar, or cable curl)

### Legs A (quad focus)
- Lead with leg press or hack squat
- Include a hip-hinge movement (dumbbell RDL or stiff-leg deadlift)
- Include leg extension (quad isolation)
- Include leg curl (hamstring isolation)
- Include a calf raise variation (standing preferred)

### Legs B (posterior chain focus)
- Lead with barbell RDL or Romanian deadlift (heavier hip-hinge as primary)
- Include a unilateral leg movement (walking lunges, Bulgarian split squat, or step-ups)
- Include leg curl
- Include leg extension
- Include a calf raise variation (seated preferred for soleus variety)

## Exercise rotation rules
- If an isolation exercise (curl, triceps, lateral raise, calf) appeared in the SAME session type last week, swap it for a different variation targeting the same muscle.
- Never programme the same primary compound in both A and B of the same muscle group in the same week.
- Prioritise exercises for which recent logs show good form signals (clean reps, no notes about failure). Deprioritise exercises where the athlete has been consistently missing reps.

## Progressive overload and previous field
- Populate "previous" for each exercise using the most recent log entry for that exercise by name.
  If no previous log exists for that exercise, set "previous": null.
- Apply overload rules to each exercise independently based on its own log history.
- target_reps array length must equal sets count.
- rest_seconds: compound lifts 120–180 s, isolation 60–90 s.
- notes: one short sentence. Be specific — mention grip, tempo, or a common error to avoid.

## Output
Return a JSON array of exactly 6 plan objects (one per day) inside a \`\`\`json code block.
Double-check that every exercise has all required fields before responding.`;

  const raw = await callClaude(prompt);
  let plans;
  try {
    plans = extractJSON(raw);
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${e.message}\n\nResponse:\n${raw.slice(0, 500)}`);
  }

  if (!Array.isArray(plans) || plans.length !== 6) {
    throw new Error(`Expected array of 6 plans, got: ${JSON.stringify(plans).slice(0, 200)}`);
  }

  for (const plan of plans) {
    if (!plan.date || !plan.session_type || !Array.isArray(plan.exercises)) {
      throw new Error(`Invalid plan structure: ${JSON.stringify(plan).slice(0, 200)}`);
    }
    const file = path.join(PLANS_DIR, `${plan.date}.json`);
    fs.writeFileSync(file, JSON.stringify(plan, null, 2));
    console.log(`✓ Written: plans/${plan.date}.json (${plan.session_type})`);
  }

  console.log('\nDone. Plans committed by workflow.');
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
