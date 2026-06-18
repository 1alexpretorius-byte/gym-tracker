# GitHub Actions Setup — Auto-generate Weekly Training Plans

## What this does
Every Sunday at 18:00 SAST, a GitHub Action automatically:
1. Reads the recent workout logs from the repo
2. Calls the Claude API to generate next week's 6 training plans (Mon–Sat)
3. Applies progressive overload based on last week's actual performance
4. Commits the new plan files to `plans/` in the repo

After this is set up, **no manual plan generation is needed ever again**.

The code is already in the repo:
- `.github/workflows/generate-plans.yml` — the scheduled workflow
- `.github/scripts/generate-plans.js` — the plan generation script

The only thing left to do is add the Anthropic API key as a GitHub secret. That requires a browser.

---

## Step 1 — Get your Anthropic API key

1. Go to **https://console.anthropic.com**
2. Log in (or create a free account — you only need it for the API key)
3. Click **API Keys** in the left sidebar
4. Click **Create Key**
5. Name it `gym-tracker-github-actions`
6. Copy the key — it starts with `sk-ant-api03-...`
7. **Save it somewhere safe** — you won't be able to see it again after closing the dialog

---

## Step 2 — Add the key as a GitHub secret

1. Go to **https://github.com/1alexpretorius-byte/gym-tracker**
2. Click **Settings** (top nav, rightmost tab)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Fill in:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Secret:** paste the key from Step 1
6. Click **Add secret**

You should now see `ANTHROPIC_API_KEY` listed under Repository secrets.

---

## Step 3 — Create the workflow file in GitHub

The workflow file cannot be pushed via git with the current token scope, so create it directly in GitHub's web editor:

1. Go to **https://github.com/1alexpretorius-byte/gym-tracker/new/main**
2. In the filename box at the top, type exactly: `.github/workflows/generate-plans.yml`
   (GitHub will auto-create the folders)
3. Paste the following content into the editor:

```yaml
name: Generate Weekly Training Plans

on:
  schedule:
    - cron: '0 16 * * 0'   # Every Sunday at 16:00 UTC = 18:00 SAST
  workflow_dispatch:         # Also triggerable manually from GitHub UI

permissions:
  contents: write            # Required to commit plan files back to the repo

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Generate training plans
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node .github/scripts/generate-plans.js

      - name: Commit and push new plans
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add plans/
          git diff --staged --quiet \
            && echo "No new plans to commit — plans already exist for next week." \
            || git commit -m "chore: auto-generate training plans $(date +%Y-%m-%d)" && git push
```

4. Scroll down, set commit message to `chore: add GitHub Actions workflow for plan generation`
5. Click **Commit new file**

---

## Step 4 — Test it with a manual run

1. Go to **https://github.com/1alexpretorius-byte/gym-tracker/actions**
2. Click **Generate Weekly Training Plans** in the left sidebar
3. Click **Run workflow** (top right of the workflow page)
4. Click the green **Run workflow** button to confirm
5. Wait ~30 seconds for it to complete

**What to check:**
- The workflow run should show a green tick
- Go to the `plans/` folder in the repo — you should see new plan files for next week
- If the workflow shows a red X, click into it and read the error log

---

## Step 4 — Verify the plans look correct

Open one of the new plan files in `plans/` and confirm:
- Correct session type and date
- Exercises match the usual lineup for that session
- Weights reflect progressive overload from the most recent log
- `previous` field contains the actual sets from the last matching session

---

## Ongoing schedule

The action fires **every Sunday at 18:00 SAST** automatically. No action needed.

If a plan already exists for all 6 days of next week, the script exits without making changes.
To force a regeneration, delete the relevant `plans/YYYY-MM-DD.json` files and re-run manually.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `ANTHROPIC_API_KEY is not set` | Secret not added | Redo Step 2 |
| `Claude API 401` | API key is wrong or expired | Generate a new key, update the secret |
| `Expected array of 6 plans` | Claude returned malformed JSON | Re-run the workflow — transient LLM issue |
| `No new plans to commit` | Plans already exist for next week | Expected behaviour — nothing is wrong |

---

## Cost

Each Sunday run calls the Claude API once with ~5,000 tokens input and ~3,000 tokens output.
At current pricing this is approximately **$0.05–$0.10 per week**.
