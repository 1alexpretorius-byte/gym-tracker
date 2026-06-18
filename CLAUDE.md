# Gym Tracker — Claude Code Instructions

## Repo overview
- `index.html` — the workout tracker (loads today's plan, saves completed logs to GitHub)
- `progress.html` — the progress dashboard (fetches all logs live from GitHub API on page load)
- `plans/YYYY-MM-DD.json` — daily workout plans
- `logs/log-YYYY-MM-DD.json` — completed workout logs written by index.html
- `manifest.json` + `icon-192.png` + `icon-512.png` — PWA assets
- Hosted on GitHub Pages: https://1alexpretorius-byte.github.io/gym-tracker/

---

## Log file format (source of truth)

Logs are written by `index.html` directly to GitHub via the Contents API (PUT). They are
JSON files with this structure:

```json
{
  "date": "YYYY-MM-DD",
  "session_type": "Push A",
  "week": 1,
  "phase": "Ramp-up",
  "body_weight_kg": 73,
  "session_rpe": 7,
  "exercises": [
    {
      "name": "Flat Bench Press",
      "equipment": "barbell",
      "sets": [
        { "set": 1, "weight_kg": 60, "reps": 10 }
      ]
    }
  ]
}
```

**Field notes:**
- `body_weight_kg` — optional today, will be logged per session going forward. Read from here; never from a separate file.
- `session_rpe` — optional, integer 1–10. Overall session difficulty. Will be logged going forward.
- `equipment` — optional field on exercises (`"barbell"`, `"dumbbell"`, `"cable"`, `"machine"`).
- `weight_kg` on dumbbell exercises = per-hand weight.
- `week` and `phase` are metadata for periodisation tracking, not required for dashboard rendering.
- GitHub stores these files as plain JSON blobs — it has no schema awareness. Correctness is enforced only by whatever writes the file (`index.html` or a Claude agent). Always validate JSON before writing.

---

## Plan file format (source of truth)

Plans are written by Claude Code or Cowork and read by `index.html` at page load. They are
JSON files at `plans/YYYY-MM-DD.json` with this structure:

```json
{
  "date": "YYYY-MM-DD",
  "session_type": "Pull A",
  "week": 1,
  "phase": "Ramp-up",
  "exercises": [
    {
      "name": "Lat Pulldown",
      "equipment": "cable",
      "sets": 3,
      "target_reps": [10, 10, 10],
      "target_weight_kg": 52,
      "rest_seconds": 120,
      "notes": "Coaching cue for the exercise.",
      "previous": null
    }
  ]
}
```

**Field notes:**
- `target_reps` — array with one entry per set. Length must equal `sets`.
- `target_weight_kg` — single target weight for all sets. Dumbbell = per-hand weight.
- `rest_seconds` — rest period between sets in seconds.
- `notes` — coaching cue shown in `index.html` during the session. Keep concise.
- `previous` — reserved for displaying last session's actual weight/reps. Currently `null`; do not populate until `index.html` supports it.
- `equipment` — same values as log format: `"barbell"`, `"dumbbell"`, `"cable"`, `"machine"`.

---

## Schema change ownership

When a new field is added to either the log or plan format (e.g. `session_rpe`, `body_weight_kg`):
1. **Claude Code** updates `progress.html` to read and render the new field.
2. **Claude Code** updates `index.html` (if asked) to write the new field.
3. **Both agents** treat new fields as optional/nullable — old logs without them must not break anything.
4. **CLAUDE.md** (this file) must be updated to document the new field before any code is written.
   This file is the schema contract. If it's not here, it doesn't exist.

---

## Data flow and sync — critical

```
index.html (GitHub Pages, phone/browser)
    │
    │  PUT via GitHub Contents API
    ▼
GitHub repo (source of truth)
    │
    ├── progress.html reads via GitHub API on every page load (live, no cache)
    │
    └── C:\Users\Alex\Claude\Gym\logs\ — LOCAL COPY, only current as of last `git pull`
```

**What this means in practice:**
- When a workout is logged on the phone, it lands on GitHub immediately.
- The local `logs/` folder on the desktop does NOT auto-update. It is a git working tree snapshot.
- To sync local logs with GitHub, run `git pull` manually.
- Claude Cowork reads logs via the GitHub API directly (live data), not from the local folder.
- Claude Code reads logs from the local folder. Run `git pull` before any analysis session to ensure logs are current.
- Neither agent pushes log files — logs are always written by `index.html` via the GitHub API.

---

## Plan generation — automated via GitHub Actions

Plans are generated automatically every Sunday at 18:00 SAST by a GitHub Action.

- Workflow: `.github/workflows/generate-plans.yml`
- Script: `.github/scripts/generate-plans.js`
- Setup guide (browser steps for cowork): `SETUP_GITHUB_ACTIONS.md`

The script reads recent logs, calls the Claude API (`claude-opus-4-8`), and commits 6 plan files
(`plans/YYYY-MM-DD.json`, Mon–Sat) to the repo. No manual plan generation is required once set up.

**Requires:** `ANTHROPIC_API_KEY` set as a GitHub repository secret (see `SETUP_GITHUB_ACTIONS.md`).

---

## Ownership boundaries

| Task | Owner |
|---|---|
| Dashboard code (`progress.html`) | Claude Code (iterative coding) |
| Workout plan files (`plans/`) | Claude Code or Cowork |
| Log analysis, chart fixes, new metrics | Claude Code |
| File management, one-off scripts | Claude Cowork |
| Writing log files | `index.html` via GitHub API only |
| Git commit + push | Claude Code (or push2.bat as fallback) |

---

## Rules
- **Do not touch `index.html`** unless explicitly asked.
- `progress.html` is the primary build target for dashboard work.
- The GitHub token is already embedded in the page — do not move, change, or log it.
- The dashboard fetches all logs live from the GitHub API on page load. Do not add hardcoded data.
- Always run `git pull` before reading or analysing logs locally — the local copy may be stale.
- Validate JSON structure before writing any log or plan file.

---

## Git
- Before any git operation, delete stale lock files: `del /f .git\index.lock .git\HEAD.lock .git\ORIG_HEAD.lock` (ignore errors if they don't exist).
- Commit message format: `feat:`, `fix:`, or `chore:` prefix.
- Push after every commit.

---

## Working style
- Before editing an existing file, show a brief summary of what will change and why.
- For new files, create them directly.
- Keep the dark theme consistent: `--bg: #0a0a0f`, `--card: #13131a`, `--accent: #6366f1`.
