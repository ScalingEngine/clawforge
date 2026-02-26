# Architecture Research

**Domain:** Cross-repo job targeting integration with ClawForge v1.2
**Researched:** 2026-02-25
**Confidence:** HIGH (direct codebase inspection at line level)

---

## The Core Problem: What Currently Breaks

When a user asks the agent to work on a different repo (e.g., NeuroStory), the current pipeline fails silently:

```
createJob() creates job/* branch in clawforge repo
run-job.yml triggers inside clawforge Actions context
entrypoint.sh:
  REPO_URL = "https://github.com/ScalingEngine/clawforge.git"  ← hardcoded by Actions
  git clone $REPO_URL  ← clones clawforge, NOT NeuroStory
  claude -p  ← operates on clawforge's working tree
  gh pr create  ← creates PR on clawforge  ← WRONG REPO

notify-pr-complete.yml:
  PR_URL = clawforge PR URL  ← reports stale/wrong PR
  User sees "merged" — nothing changed in NeuroStory
```

The bug was discovered 2026-02-25: a NeuroStory README job reported "Merged" but no changes appeared in NeuroStory. Same-repo (clawforge) jobs work correctly throughout.

---

## System Overview (v1.1 Baseline)

```
┌──────────────────────────────────────────────────────────────────┐
│                     Event Handler (Next.js)                       │
│                                                                  │
│  Channel Adapter (Slack/Telegram/Web)                            │
│       ↓ { threadId, text, attachments }                          │
│  LangGraph ReAct Agent (lib/ai/agent.js)                         │
│       ↓ create_job tool call                                      │
│  createJobTool (lib/ai/tools.js)                                 │
│       ↓                                                          │
│  createJob(description) (lib/tools/create-job.js)               │
│       ↓ GitHub API (GH_OWNER/GH_REPO env)                        │
│  Push job/{UUID} branch → logs/{UUID}/job.md                     │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │ job/* branch push event
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (run-job.yml)                   │
│  REPO_URL = github.server_url + github.repository + ".git"       │
│            ← ALWAYS clawforge, no target repo concept            │
│  docker run [job image]                                          │
│    -e REPO_URL=$REPO_URL                                         │
│    -e BRANCH=job/{UUID}                                          │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Job Container (entrypoint.sh)                 │
│                                                                  │
│  git clone $REPO_URL  ← always clawforge                         │
│  read /job/logs/{UUID}/job.md                                    │
│  build FULL_PROMPT (Target, Docs, Stack, Task, GSD Hint)         │
│  claude -p < /tmp/prompt.txt                                     │
│  git commit && gh pr create  ← PR on clawforge                  │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │ PR created on clawforge
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Post-Job Workflows                             │
│  notify-pr-complete.yml                                          │
│    PR_URL = clawforge PR URL (always wrong for cross-repo jobs)  │
│    → /api/github/webhook → summarizeJob → addToThread            │
└──────────────────────────────────────────────────────────────────┘
```

---

## v1.2 Architecture: Cross-Repo Targeting

The solution threads `target_repo` (owner/repo) through every layer of the pipeline. Each layer has a distinct integration point. Below is the complete data flow and the exact changes needed at each layer.

```
┌──────────────────────────────────────────────────────────────────┐
│                     Event Handler (Next.js)                       │
│                                                                  │
│  Channel Adapter (unchanged)                                     │
│       ↓ { threadId, text, attachments }                          │
│  LangGraph ReAct Agent (unchanged)                               │
│       ↓ create_job tool call with NEW target_repo parameter      │
│  createJobTool (lib/ai/tools.js) — MODIFIED                      │
│    • schema adds optional target_repo: "owner/repo"              │
│    • reads ALLOWED_REPOS from config/REPOS.json per instance     │
│    • validates target_repo against allowlist (or defaults to     │
│      GH_OWNER/GH_REPO if omitted)                                │
│       ↓                                                          │
│  createJob(description, { targetOwner, targetRepo })             │
│  (lib/tools/create-job.js) — MODIFIED                            │
│    • still creates job/* branch in clawforge (home repo)         │
│    • writes TARGET_REPO to logs/{UUID}/job.md metadata           │
│       ↓ GitHub API (always uses GH_OWNER/GH_REPO for branch)    │
│  Push job/{UUID} branch → logs/{UUID}/job.md                     │
│  (job.md now includes target repo metadata)                      │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │ job/* branch push in clawforge
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (run-job.yml)                   │
│                                                                  │
│  MODIFIED: read TARGET_REPO from job.md before docker run        │
│  Pass TARGET_REPO_URL as a new env var to the container          │
│                                                                  │
│  docker run [job image]                                          │
│    -e REPO_URL="clawforge.git"    ← unchanged (for job/* clone) │
│    -e TARGET_REPO_URL="neurostory.git"  ← NEW                   │
│    -e BRANCH=job/{UUID}                                          │
│    -e SECRETS (includes PAT scoped to target repo)              │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Job Container (entrypoint.sh)                 │
│                                                                  │
│  MODIFIED two-phase clone:                                       │
│    Phase 1: git clone $REPO_URL /job-meta                        │
│             (clawforge branch — reads job.md, config/)           │
│    Phase 2: git clone $TARGET_REPO_URL /job                      │
│             (target repo — where Claude does actual work)        │
│                                                                  │
│  config/ still read from /job-meta/config/ (SOUL.md, AGENT.md)  │
│  job.md still read from /job-meta/logs/{UUID}/job.md             │
│  CLAUDE.md read from /job/CLAUDE.md (target repo)                │
│  package.json read from /job/package.json (target repo)          │
│  Claude works in /job (target repo)                              │
│                                                                  │
│  gh pr create on TARGET_REPO_URL (not clawforge)                 │
│  git commit and push target repo branch                          │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │ PR created on TARGET REPO
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Post-Job Workflows                             │
│                                                                  │
│  notify-pr-complete.yml — MODIFIED                               │
│    PR_URL = target repo PR URL (correct)                         │
│    Reads job.md from /job-meta to extract target repo slug        │
│    Payload includes target_repo field                            │
│    → /api/github/webhook                                         │
│                                                                  │
│  Event Handler (api/index.js) — MINOR CHANGE                     │
│    saveJobOutcome adds target_repo field                         │
│    summarizeJob displays correct target repo in message          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Integration Points: New vs Modified Components

### 1. Allowed Repos Config — WHERE IT LIVES

**New file:** `config/REPOS.json` (per-instance override in `instances/{name}/config/REPOS.json`)

```json
{
  "allowed": [
    {
      "owner": "ScalingEngine",
      "repo": "clawforge",
      "description": "ClawForge platform (default)"
    },
    {
      "owner": "ScalingEngine",
      "repo": "neurostory",
      "description": "NeuroStory application"
    }
  ]
}
```

**Why this location:** The existing pattern for instance config is `instances/{name}/config/` (SOUL.md, AGENT.md, EVENT_HANDLER.md are all there). REPOS.json follows the same convention. The base `config/REPOS.json` is the fallback (clawforge only). Instances override it by placing their own REPOS.json in `instances/{name}/config/REPOS.json`.

**Read by:** `lib/tools/create-job.js` (or a new `lib/tools/allowed-repos.js`) at job creation time. Load once and validate target_repo against the list.

**PAT per instance:** The existing `GH_TOKEN` env var must be scoped (via GitHub fine-grained PAT) to all repos in the instance's allowed list. No new env var needed — just requires the PAT to have write access to target repos. Documented in `.env.example`.

---

### 2. createJobTool — MODIFIED (`lib/ai/tools.js`)

Current schema:
```javascript
z.object({
  job_description: z.string()
})
```

New schema:
```javascript
z.object({
  job_description: z.string(),
  target_repo: z.string().optional()
    .describe('Target repository slug (owner/repo). Omit for default (clawforge). Must be in allowed list.')
})
```

**Agent behavior:** The agent reads the allowed repos list (available in EVENT_HANDLER.md context) and selects the appropriate repo based on user intent. No tool call needed to list repos — the list is injected into the agent system context via EVENT_HANDLER.md.

**Validation:** `createJobTool` resolves `target_repo` against `REPOS.json`. If not in list, return error string to agent ("Repository not in allowed list"). Agent handles this gracefully by telling the user.

**Default:** If `target_repo` is omitted, use `GH_OWNER`/`GH_REPO` from env (existing behavior — no regression on clawforge jobs).

---

### 3. createJob — MODIFIED (`lib/tools/create-job.js`)

**Current behavior:** Creates `job/{UUID}` branch in `GH_OWNER/GH_REPO`. Writes job description to `logs/{UUID}/job.md`.

**New behavior:** Still creates the branch in the home repo (clawforge). But `job.md` now includes target repo metadata as a structured header:

```markdown
<!-- target_repo: ScalingEngine/neurostory -->
<!-- target_repo_url: https://github.com/ScalingEngine/neurostory.git -->

[rest of job description]
```

HTML comments are machine-readable by `run-job.yml` (via grep) but invisible in rendered GitHub markdown. No format change to the job description visible to Claude.

**Alternative approach:** Write a separate `logs/{UUID}/target.json` file alongside `job.md`:
```json
{ "owner": "ScalingEngine", "repo": "neurostory" }
```

This is cleaner for machine consumption and avoids comment-parsing fragility. The workflow reads `target.json` if present; absent = same-repo job (backward compatible).

**Recommendation:** Use `target.json` — clearer separation of machine metadata from human-readable job description. No risk of comment-stripping or markdown rendering edge cases.

**No change to branch naming.** `job/{UUID}` branch always lives in the home repo (clawforge). The job branch is a dispatch mechanism — it triggers the Actions workflow. The work happens in the target repo.

---

### 4. run-job.yml — MODIFIED

**Current:** Passes `REPO_URL = github.server_url + github.repository + ".git"` as a hardcoded reference to the triggering repo (clawforge).

**New:** Add a step before `docker run` to read `target.json` from the checked-out branch:

```yaml
- name: Resolve target repo
  id: target
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    # Checkout the job branch first (need target.json)
    git clone --single-branch --branch "${{ github.ref_name }}" \
      "${{ github.server_url }}/${{ github.repository }}.git" /tmp/job-meta

    JOB_ID="${{ github.ref_name }#job/}"

    # Read target.json if present (cross-repo job)
    TARGET_JSON="/tmp/job-meta/logs/${JOB_ID}/target.json"
    if [ -f "$TARGET_JSON" ]; then
      TARGET_OWNER=$(jq -r '.owner' "$TARGET_JSON")
      TARGET_REPO=$(jq -r '.repo' "$TARGET_JSON")
      TARGET_REPO_URL="${{ github.server_url }}/${TARGET_OWNER}/${TARGET_REPO}.git"
    else
      # Same-repo job (backward compatible)
      TARGET_REPO_URL="${{ github.server_url }}/${{ github.repository }}.git"
    fi

    echo "target_repo_url=$TARGET_REPO_URL" >> "$GITHUB_OUTPUT"

- name: Run ClawForge Agent
  env:
    REPO_URL: ${{ github.server_url }}/${{ github.repository }}.git
    TARGET_REPO_URL: ${{ steps.target.outputs.target_repo_url }}
    BRANCH: ${{ github.ref_name }}
    ...
  run: |
    docker run --rm \
      -e REPO_URL \
      -e TARGET_REPO_URL \
      -e BRANCH \
      ...
```

**Key constraint:** `run-job.yml` runs inside the **clawforge** Actions context. GitHub token (`${{ github.token }}`) has write access to clawforge but NOT to external repos. This is why the PAT (in `SECRETS` JSON, passed as `GH_TOKEN` to the container) must have cross-repo write access. The workflow itself only reads from the job branch to extract `target.json` — no writes to external repos from the Actions workflow level.

---

### 5. entrypoint.sh — MODIFIED

This is the most significant change. The entrypoint currently does a single clone into `/job`. With cross-repo targeting, it needs a two-location model:

```bash
# Current: single clone
git clone --single-branch --branch "$BRANCH" "$REPO_URL" /job
cd /job

# New: two-phase clone
# Phase 1: Clone home repo (job branch) for metadata and config
git clone --single-branch --branch "$BRANCH" "$REPO_URL" /job-meta

# Phase 2: Clone target repo (default branch) for actual work
if [ -n "$TARGET_REPO_URL" ] && [ "$TARGET_REPO_URL" != "$REPO_URL" ]; then
  IS_CROSS_REPO=true
  git clone --depth 1 "$TARGET_REPO_URL" /job
else
  # Same-repo job: /job is the same as /job-meta
  IS_CROSS_REPO=false
  ln -s /job-meta /job  # symlink avoids duplicate clone
fi

cd /job
```

**Config reads after two-phase clone:**

| Item | Location (current) | Location (v1.2) |
|------|-------------------|-----------------|
| `SOUL.md` | `/job/config/SOUL.md` | `/job-meta/config/SOUL.md` |
| `AGENT.md` | `/job/config/AGENT.md` | `/job-meta/config/AGENT.md` |
| `job.md` | `/job/logs/{UUID}/job.md` | `/job-meta/logs/{UUID}/job.md` |
| `CLAUDE.md` | `/job/CLAUDE.md` | `/job/CLAUDE.md` (target repo) |
| `package.json` | `/job/package.json` | `/job/package.json` (target repo) |
| Work dir | `/job` | `/job` (target repo) |
| Log dir | `/job/logs/{UUID}/` | `/job-meta/logs/{UUID}/` |

**Git operations after work:**

```bash
# For cross-repo: push to target repo (create PR there)
# For same-repo: push to clawforge (existing behavior)

if [ "$IS_CROSS_REPO" = "true" ]; then
  cd /job  # target repo
  git add -A
  git commit -m "clawforge: job ${JOB_ID}"
  git push origin HEAD:job/${JOB_ID}  # push job branch to target repo
  gh pr create \
    --repo "${TARGET_OWNER}/${TARGET_REPO}" \
    --title "clawforge: job ${JOB_ID}" \
    --body "Automated job by ClawForge" \
    --base main

  # Also commit logs to home repo (job-meta)
  cd /job-meta
  git add -A logs/
  git commit -m "clawforge: logs ${JOB_ID}"
  git push origin
else
  # Existing same-repo flow (unchanged)
  cd /job
  git add -A
  git commit -m "clawforge: job ${JOB_ID}"
  git push origin
  gh pr create ...
fi
```

**The log commit to home repo:** Observability artifacts (preflight.md, claude-output.jsonl, gsd-invocations.jsonl, observability.md) live in `/job-meta/logs/{UUID}/`. These are committed to the clawforge job branch and pushed. The post-job workflows (`notify-pr-complete.yml`, `notify-job-failed.yml`) check out the clawforge job branch and read logs from there — this behavior is unchanged.

---

### 6. PR Creation on Target Repo

**How:** `gh pr create --repo "owner/repo"` accepts an explicit `--repo` flag. The `gh` CLI in the job container authenticates via `gh auth setup-git` using the `GH_TOKEN`. If the token has write access to the target repo, `gh pr create --repo owner/neurostory` works.

**Branch on target repo:** Claude's changes need to be on a named branch in the target repo. The container creates `job/{UUID}` branch in the target repo via `git push origin HEAD:job/{UUID}`. The PR is then opened from `job/{UUID}` → `main` in the target repo.

**Auto-merge on target repo:** The existing `auto-merge.yml` workflow lives in clawforge and only acts on clawforge PRs. It will NOT auto-merge PRs in external repos. This is by design — PRs in external repos (NeuroStory, etc.) go through that repo's normal review process. The ClawForge instance owner can optionally add `auto-merge.yml` to target repos if they want auto-merge there too.

**Notification pipeline receives target repo PR URL:** `notify-pr-complete.yml` fires when `auto-merge.yml` completes. For cross-repo jobs, `auto-merge.yml` won't run (no PR in clawforge). This creates a notification gap — see Anti-Patterns section below.

---

### 7. Notification Pipeline — MODIFIED

**The notification gap for cross-repo jobs:** `notify-pr-complete.yml` triggers on `auto-merge.yml` completion. `auto-merge.yml` only fires on PRs against clawforge `main`. For cross-repo jobs, the PR is in the target repo. `auto-merge.yml` never fires. So `notify-pr-complete.yml` never fires.

**Solution:** Add a notification step directly to `run-job.yml` for cross-repo jobs. After `gh pr create` on the target repo succeeds, immediately POST to the Event Handler:

```bash
# In entrypoint.sh, after cross-repo PR creation:
if [ "$IS_CROSS_REPO" = "true" ] && [ -n "$APP_URL" ]; then
  TARGET_PR_URL=$(gh pr view --repo "${TARGET_OWNER}/${TARGET_REPO}" \
    job/${JOB_ID} --json url -q '.url' 2>/dev/null || echo "")

  jq -n \
    --arg job_id "$JOB_ID" \
    --arg branch "job/$JOB_ID" \
    --arg status "completed" \
    --arg pr_url "$TARGET_PR_URL" \
    --arg target_repo "${TARGET_OWNER}/${TARGET_REPO}" \
    ... \
  | curl -s -X POST "$APP_URL/api/github/webhook" \
    -H "X-GitHub-Webhook-Secret-Token: $WEBHOOK_SECRET" \
    -d @-
fi
```

**Alternative (cleaner):** Notify from `run-job.yml` itself (not entrypoint), after the docker run step completes. `run-job.yml` has access to `${{ vars.APP_URL }}` and `${{ secrets.GH_WEBHOOK_SECRET }}` directly — no need to pass them into the container. The entrypoint's exit code determines success/failure.

**Recommendation:** Notify from `run-job.yml` post-docker-run step. Keeps notification logic in the workflow layer (consistent with how same-repo notifications work) rather than entrypoint (container layer). Requires `run-job.yml` to read `target.json` to know the target repo, which it already does in the resolve step.

**`saveJobOutcome` and `job_outcomes` schema:** Add `target_repo TEXT` column (nullable). Same-repo jobs leave it null. Cross-repo jobs populate it. The field appears in notification messages so the user knows which repo was modified.

---

### 8. AGENT.md Update — EVENT HANDLER.MD

**What the agent needs to know:**
1. That cross-repo targeting exists
2. What repos are in the allowed list (so it can select intelligently)
3. To pass `target_repo` to `create_job` when the user's intent is clear

**How to surface this:** The `instances/{name}/config/EVENT_HANDLER.md` is the agent's system instructions. Add a section:

```markdown
## Allowed Target Repositories

When creating jobs, you can target any of these repositories:
- ScalingEngine/clawforge — ClawForge platform (default)
- ScalingEngine/neurostory — NeuroStory application

Detect target from user intent. If the user says "in NeuroStory" or "on the NeuroStory repo", pass `target_repo: "ScalingEngine/neurostory"` to create_job. If the user doesn't specify a repo or says "here", omit target_repo (defaults to clawforge).
```

This is injected into the system prompt at runtime — no tool call required to list repos.

---

## Data Flow: Cross-Repo Job End-to-End

```
User: "Update the README in NeuroStory to add installation instructions"
       ↓
LangGraph Agent — reads allowed repos from EVENT_HANDLER.md context
  detects "NeuroStory" → target_repo = "ScalingEngine/neurostory"
       ↓ create_job tool call
createJobTool({
  job_description: "Update README with installation instructions",
  target_repo: "ScalingEngine/neurostory"
})
       ↓
  Validates against REPOS.json → allowed
  Calls createJob(description, { owner: "ScalingEngine", repo: "neurostory" })
       ↓
createJob():
  1. Creates job/{UUID} branch in ScalingEngine/clawforge (home repo)
  2. Writes logs/{UUID}/job.md (job description)
  3. Writes logs/{UUID}/target.json { owner, repo }
       ↓ branch push triggers run-job.yml
run-job.yml:
  1. Checks out clawforge job branch
  2. Reads logs/{UUID}/target.json → TARGET_REPO_URL = neurostory.git
  3. docker run with REPO_URL=clawforge.git + TARGET_REPO_URL=neurostory.git
       ↓
entrypoint.sh:
  1. git clone clawforge job branch → /job-meta (metadata, config)
  2. git clone neurostory main → /job (work target)
  3. SYSTEM_PROMPT from /job-meta/config/SOUL.md + AGENT.md
  4. JOB_DESCRIPTION from /job-meta/logs/{UUID}/job.md
  5. CLAUDE.md injected from /job/CLAUDE.md (neurostory's docs)
  6. package.json stack from /job/package.json (neurostory's deps)
  7. claude -p operates in /job (neurostory)
  8. git commit + push job/{UUID} branch to neurostory
  9. gh pr create --repo ScalingEngine/neurostory
  10. POST notification to APP_URL/api/github/webhook
       ↓
Event Handler /api/github/webhook:
  summarizeJob({ target_repo: "ScalingEngine/neurostory", pr_url: "neurostory PR URL", ... })
  saveJobOutcome({ ..., target_repo: "ScalingEngine/neurostory" })
  addToThread(origin.threadId, "[Job completed] README updated in NeuroStory: [PR URL]")
  Slack/Telegram notification with correct target repo PR URL
```

---

## Component Responsibilities (v1.2 State)

| Component | Current Responsibility | v1.2 Change | Change Type |
|-----------|----------------------|-------------|-------------|
| `config/REPOS.json` | Does not exist | Allowed repos list (base/fallback) | NEW |
| `instances/{name}/config/REPOS.json` | Does not exist | Per-instance allowed repos override | NEW |
| `lib/tools/create-job.js` | Create branch + write job.md | Also write target.json | MODIFY |
| `lib/ai/tools.js` | createJobTool with job_description | Add target_repo param, validate against allowlist | MODIFY |
| `templates/.github/workflows/run-job.yml` | docker run with REPO_URL | Add resolve-target step, pass TARGET_REPO_URL | MODIFY |
| `templates/docker/job/entrypoint.sh` | Single clone to /job | Two-phase clone (/job-meta + /job), cross-repo PR | MODIFY |
| `templates/.github/workflows/notify-pr-complete.yml` | Fires after auto-merge.yml | Same-repo only — no change to trigger | VERIFY |
| `lib/db/schema.js` | jobOutcomes table | Add target_repo column | MODIFY |
| `lib/db/job-outcomes.js` | saveJobOutcome / getLastMergedJobOutcome | Accept and persist target_repo | MODIFY |
| `api/index.js` (GH webhook) | summarizeJob + notify | Extract target_repo from payload | MODIFY |
| `instances/{name}/config/EVENT_HANDLER.md` | Agent instructions | Add allowed repos list section | MODIFY |
| `instances/{name}/.env.example` | Env var documentation | Document PAT scope requirement | MODIFY |

---

## Recommended Project Structure (v1.2 additions)

```
config/
└── REPOS.json                    NEW — base allowed repos (clawforge only)

instances/
├── noah/
│   └── config/
│       ├── REPOS.json            NEW — Noah's allowed repos (clawforge + all personal repos)
│       └── EVENT_HANDLER.md      MODIFY — add allowed repos section
└── strategyES/
    └── config/
        ├── REPOS.json            NEW — StrategyES allowed repos (strategyes-lab only)
        └── EVENT_HANDLER.md      MODIFY — add allowed repos section

lib/
├── tools/
│   └── create-job.js             MODIFY — write target.json alongside job.md
├── ai/
│   └── tools.js                  MODIFY — target_repo param + validation
└── db/
    ├── schema.js                  MODIFY — add target_repo column to jobOutcomes
    └── job-outcomes.js            MODIFY — accept target_repo in saveJobOutcome

templates/
├── docker/job/
│   └── entrypoint.sh             MODIFY — two-phase clone, cross-repo PR, cross-repo notify
└── .github/workflows/
    └── run-job.yml               MODIFY — resolve-target step, TARGET_REPO_URL env
```

---

## Architectural Patterns

### Pattern 1: Sidecar Metadata File for Cross-Repo Signal

**What:** Write a separate `target.json` file alongside `job.md` in the clawforge job branch when a cross-repo job is created. Keep the job description clean and machine-readable metadata separate.

**When to use:** Any time the entrypoint or workflows need structured data about the job that is not part of the human-readable task description.

**Trade-offs:** Adds one extra file per cross-repo job in the clawforge repo. Same-repo jobs have no `target.json` (absence = same-repo). Backward compatible by design.

```javascript
// lib/tools/create-job.js — addition
if (targetOwner && targetRepo) {
  await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/contents/logs/${jobId}/target.json`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `job: ${jobId} (target: ${targetOwner}/${targetRepo})`,
      content: Buffer.from(JSON.stringify({ owner: targetOwner, repo: targetRepo })).toString('base64'),
      branch: branch,
    }),
  });
}
```

---

### Pattern 2: Symlink for Same-Repo Backward Compatibility

**What:** When `TARGET_REPO_URL` equals `REPO_URL` (same-repo job), create `/job` as a symlink to `/job-meta` instead of a second clone. This preserves the existing directory layout without code duplication.

**When to use:** Same-repo jobs must continue working without any code path change in the sections that reference `/job`.

**Trade-offs:** Symlinks work on Linux containers. Slightly confusing directory layout. But avoids a full clone of clawforge twice.

```bash
if [ "$IS_CROSS_REPO" = "false" ]; then
  ln -s /job-meta /job
fi
cd /job  # works for both cases
```

---

### Pattern 3: Notify at Container Exit for Cross-Repo Jobs

**What:** For cross-repo jobs, the post-job notification cannot come from `notify-pr-complete.yml` (that workflow only fires when `auto-merge.yml` completes on clawforge PRs). Instead, emit the notification directly from `run-job.yml` as a post-docker-run step.

**When to use:** Any job that creates a PR on an external repo (no auto-merge in clawforge context).

**Trade-offs:** Notification arrives before the PR may be reviewed or merged (it fires at PR creation, not PR merge). This is acceptable — the notification tells the user "a PR was created" not "it was merged". For same-repo jobs, the existing notify-pr-complete.yml flow fires on merge. Semantic difference is documented in the agent's response.

```yaml
# run-job.yml — post-docker step for cross-repo
- name: Notify cross-repo job completion
  if: steps.target.outputs.is_cross_repo == 'true'
  env:
    GH_TOKEN: ${{ github.token }}
    APP_URL: ${{ vars.APP_URL }}
    GH_WEBHOOK_SECRET: ${{ secrets.GH_WEBHOOK_SECRET }}
    JOB_ID: ${{ steps.target.outputs.job_id }}
    TARGET_OWNER: ${{ steps.target.outputs.target_owner }}
    TARGET_REPO: ${{ steps.target.outputs.target_repo }}
  run: |
    PR_URL=$(gh pr view "job/${JOB_ID}" \
      --repo "${TARGET_OWNER}/${TARGET_REPO}" \
      --json url -q '.url' 2>/dev/null || echo "")

    RUN_URL="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"

    jq -n \
      --arg job_id "$JOB_ID" \
      --arg pr_url "$PR_URL" \
      --arg target_repo "${TARGET_OWNER}/${TARGET_REPO}" \
      --arg run_url "$RUN_URL" \
      --arg status "completed" \
      --arg merge_result "open" \
      '{job_id: $job_id, pr_url: $pr_url, target_repo: $target_repo,
        run_url: $run_url, status: $status, merge_result: $merge_result,
        changed_files: [], commit_message: "", log: "", job: ""}' \
    | curl -s -X POST "$APP_URL/api/github/webhook" \
      -H "Content-Type: application/json" \
      -H "X-GitHub-Webhook-Secret-Token: $GH_WEBHOOK_SECRET" \
      -d @-
```

---

## Anti-Patterns

### Anti-Pattern 1: Triggering run-job.yml in the Target Repo

**What people do:** Add `run-job.yml` to the target repo (NeuroStory). Push the job branch there directly. Let NeuroStory's Actions run the job.

**Why it's wrong:** The job Docker image, SOUL.md, AGENT.md, and all instance config live in clawforge. The target repo has no knowledge of ClawForge. Installing ClawForge workflows in every target repo creates a tight coupling that breaks instance isolation — StrategyES's Epic agent could not be scoped to specific repos without installing and scoping workflows in each target repo.

**Do this instead:** The job branch always lives in the home repo (clawforge or strategyes-lab). The Actions workflow runs in the home repo's context. The container clones the target repo as a second step.

---

### Anti-Pattern 2: Passing Target Repo as a Workflow Variable

**What people do:** Store the target repo in a GitHub Actions workflow variable or secret (`TARGET_REPO=neurostory`). Set it before triggering the job.

**Why it's wrong:** Workflow variables are static — the same value applies to every job. You can't have different jobs targeting different repos if the target is a workflow variable. Job-level targeting must travel through the job branch itself (`target.json`) so each job is independently scoped.

**Do this instead:** Write `target.json` to the job branch at job creation time. The workflow reads it per-run.

---

### Anti-Pattern 3: Having the Container Write PRs Using the GitHub Actions Token

**What people do:** Pass `${{ github.token }}` (the Actions-generated token) into the container for PR creation on the target repo.

**Why it's wrong:** `${{ github.token }}` is scoped to the repository that owns the Actions workflow (clawforge). It has no write access to external repos (NeuroStory, strategyes-lab). Using it for `gh pr create --repo neurostory` will fail with 403.

**Do this instead:** Use the `GH_TOKEN` from `SECRETS` (a personal access token with fine-grained repo access). This token is set up by the operator to have write access to all repos in the allowed list. It's already passed to the container as part of `AGENT_GH_TOKEN` → exported as `GH_TOKEN` inside the container.

---

### Anti-Pattern 4: Modifying notify-pr-complete.yml to Watch External Repos

**What people do:** Add another `workflow_run` trigger to `notify-pr-complete.yml` that watches PRs in external repos.

**Why it's wrong:** `notify-pr-complete.yml` is a workflow that lives in clawforge and can only watch events in clawforge. GitHub Actions workflows cannot trigger on events in other repositories.

**Do this instead:** Send the completion notification from within `run-job.yml` (which runs in the clawforge context and has full visibility into the job's success/failure). See Pattern 3.

---

### Anti-Pattern 5: Cloning the Target Repo Inside the Event Handler

**What people do:** Have the Event Handler clone the target repo to validate it, fetch its CLAUDE.md, or check access before creating the job.

**Why it's wrong:** The Event Handler is a Next.js server. It doesn't have `git` installed and shouldn't do filesystem operations. GitHub API calls (already used for `create-job.js`) are the correct interface. The container already handles the clone.

**Do this instead:** For access validation, use the GitHub API to check repo visibility and PAT scope. For CLAUDE.md fetching, use the Contents API (already done for repo context injection in v1.1). No git clone needed at the Event Handler layer.

---

## Build Order

Dependencies are explicit — each phase delivers what the next phase depends on.

```
Phase A: Config Layer + createJob Metadata
  ↓ No dependencies on new code
  NEW: config/REPOS.json (base + per-instance)
  MODIFY: lib/tools/create-job.js (write target.json)
  MODIFY: lib/ai/tools.js (target_repo param, REPOS.json validation)
  MODIFY: instances/*/config/EVENT_HANDLER.md (allowed repos list)
  TEST: createJob() writes target.json for cross-repo, not for same-repo
  ─ Verifiable in isolation without touching entrypoint or Actions

       ↓ (requires target.json in job branches)

Phase B: Container Execution (entrypoint.sh + run-job.yml)
  MODIFY: templates/.github/workflows/run-job.yml (resolve-target step)
  MODIFY: templates/docker/job/entrypoint.sh (two-phase clone, cross-repo PR)
  SYNC: live .github/workflows/ files after template changes
  TEST: trigger a cross-repo job, verify Claude operates in target repo working tree
  ─ Requires Phase A to be shipping target.json

       ↓ (requires cross-repo PRs to exist)

Phase C: Notification Pipeline
  MODIFY: templates/.github/workflows/run-job.yml (add cross-repo notify step)
  MODIFY: lib/db/schema.js (add target_repo to jobOutcomes)
  MODIFY: lib/db/job-outcomes.js (persist target_repo)
  MODIFY: api/index.js (extract target_repo from payload, include in message)
  GENERATE: drizzle migration
  TEST: complete a cross-repo job end-to-end, verify Slack/Telegram message has correct PR URL

       ↓ (after full E2E validated)

Phase D: Regression Verification
  TEST: same-repo (clawforge) job — verify no regression
  TEST: both instances (Noah/Archie + StrategyES/Epic) — scoped repo lists respected
  SYNC: instances/*/config/ docs if EVENT_HANDLER.md changed
```

**Rationale:**
- Phase A first because config and tool-layer changes have no runtime risk — they only affect what gets written to the job branch. Verifiable with a unit test of `createJob()`.
- Phase B second because the entrypoint can only be tested with a real Docker run — it's the highest-risk change. Build on a stable config layer.
- Phase C third because it depends on cross-repo PRs existing (Phase B). The notification schema change is small and doesn't block Phase B testing.
- Phase D last as a regression sweep — same-repo jobs must continue working throughout.

---

## Integration Points (Summary Table)

### Event Handler ↔ REPOS.json (new configuration read)

| Trigger | Handler | Data Read |
|---------|---------|-----------|
| `create_job` tool invocation | `lib/ai/tools.js` | `config/REPOS.json` or `instances/{name}/config/REPOS.json` |

### createJob ↔ GitHub API (new file write)

| Call | Where | Notes |
|------|-------|-------|
| `PUT /repos/{home-owner}/{home-repo}/contents/logs/{UUID}/target.json` | `lib/tools/create-job.js` | Only when target_repo is provided |

### run-job.yml ↔ clawforge job branch (new read)

| Read | When | Notes |
|------|------|-------|
| `logs/{UUID}/target.json` | Before docker run | Determines TARGET_REPO_URL |

### entrypoint.sh ↔ target repo (new clone + push)

| Operation | When | Auth |
|-----------|------|------|
| `git clone TARGET_REPO_URL /job` | Cross-repo jobs only | GH_TOKEN (PAT with target repo write) |
| `git push origin HEAD:job/{UUID}` | Cross-repo jobs, after Claude work | GH_TOKEN |
| `gh pr create --repo owner/repo` | Cross-repo jobs | GH_TOKEN |

### run-job.yml ↔ Event Handler (new notification path for cross-repo)

| Trigger | Endpoint | Data |
|---------|----------|------|
| After docker run success (cross-repo) | `POST /api/github/webhook` | `{ job_id, pr_url (target repo), target_repo, status, merge_result: "open" }` |

### job_outcomes ↔ target_repo (schema addition)

| Column | Type | Notes |
|--------|------|-------|
| `target_repo` | `TEXT` (nullable) | `owner/repo` for cross-repo, NULL for same-repo |

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (2 instances, ~50 jobs/day) | No concerns. Second clone adds ~5-10s per cross-repo job. PAT scoping is manual but manageable. |
| 5-10 instances, ~500 jobs/day | REPOS.json management becomes tedious. Consider centralized repo registry in SQLite settings table instead of JSON files. PAT rotation risk increases. |
| 50+ instances | Automated PAT provisioning needed (GitHub App with org-level installation). Move to GitHub App tokens instead of PATs for dynamic repo access. |

---

## Sources

- Direct codebase inspection: `lib/tools/create-job.js` — confirmed branch and job.md creation, `GH_OWNER`/`GH_REPO` hardcoded from env
- Direct codebase inspection: `lib/ai/tools.js` — confirmed current tool schema (job_description only), no target repo parameter exists
- Direct codebase inspection: `templates/docker/job/entrypoint.sh` — confirmed single-clone flow, `REPO_URL` usage, config paths, PR creation with `gh pr create`
- Direct codebase inspection: `templates/.github/workflows/run-job.yml` — confirmed `REPO_URL = github.server_url + github.repository + ".git"`, no mechanism for target repo override
- Direct codebase inspection: `templates/.github/workflows/notify-pr-complete.yml` — confirmed `workflow_run` trigger on `auto-merge.yml` only (same-repo dependency)
- Direct codebase inspection: `api/index.js handleGithubWebhook` — confirmed webhook payload handling, `saveJobOutcome` call, `results` object shape
- Direct codebase inspection: `lib/db/schema.js` — confirmed `jobOutcomes` table schema, no `target_repo` column
- Direct codebase inspection: `lib/db/job-outcomes.js` — confirmed `saveJobOutcome` signature, no `target_repo` parameter
- Direct codebase inspection: `.planning/PROJECT.md` — confirmed cross-repo bug discovery 2026-02-25, NeuroStory example
- Direct codebase inspection: `instances/noah/config/AGENT.md`, `instances/strategyES/.env.example` — confirmed per-instance config pattern
- GitHub Actions docs: `workflow_run` trigger scope — confirmed workflows can only watch events in the same repo
- GitHub Actions docs: `${{ github.token }}` scope — confirmed scoped to triggering repo only, no cross-repo write
- Confidence: HIGH for all integration points (verified against live codebase with line-level precision)

---

*Architecture research for: ClawForge v1.2 — Cross-repo job targeting*
*Researched: 2026-02-25*
