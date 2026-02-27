# Phase 10: Actions Workflow + Container Execution + Cross-Repo PR — Research

**Researched:** 2026-02-26
**Domain:** GitHub Actions workflow modification, bash entrypoint two-phase clone, `gh` CLI cross-repo PR creation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Failure modes:**
- Clone failure → write `clone-error.md` to job branch and exit immediately (no retry)
- PR creation failure → write `pr-error.md` to job branch and exit with failure
- Stage-specific error files (`clone-error.md`, `pr-error.md`) so Phase 11 notification pipeline knows exactly what broke
- Same notification flow as today: `notify-job-failed.yml` fires when job branch has no PR after container exits; failure stage detail (clone vs pr-creation) will surface via error files read in Phase 11

**PR body content:**
All four elements required:
1. Original job description (the text the user sent)
2. ClawForge attribution + AI-generated disclaimer banner
3. Link back to originating clawforge job branch (traceability)
4. Summary/checklist of what Claude did (files changed, approach)
- PR created as regular open PR (not draft)
- No labels applied (too fragile — labels may not exist on target repo)
- PR author = AGENT_GH_TOKEN owner (same identity as same-repo PRs)

**Cross-repo PR fate:**
- Cross-repo PRs are always open for human review — never auto-merged (ClawForge can't auto-merge on a foreign repo)
- User is notified at PR creation time: "PR opened on [target-repo]: [url]"
- Container writes `pr-result.json` sidecar to the clawforge job branch upon PR creation: `{ target_repo, pr_url, pr_number }`
- `notify-pr-complete.yml` (or equivalent) triggers on push to `job/*` and checks for `pr-result.json` to fire the cross-repo completion notification

**GitHub Actions workflow:**
- `run-job.yml` stays unchanged — entrypoint reads `target.json` and handles same-repo vs cross-repo logic internally
- No new workflow file for cross-repo jobs
- No new GitHub secret — AGENT_GH_TOKEN is used for everything; document that it must have `repo` scope for any target repos (setup documentation, not code change)
- Notification trigger: extend `notify-pr-complete.yml` to trigger on `push` to `job/*` branches and detect `pr-result.json` (cross-repo path) vs PR merge on clawforge (same-repo path)

### Claude's Discretion
- Exact entrypoint bash logic for two-phase clone (clone clawforge to read target.json, then clone target repo as working directory)
- Exact structure of pr-result.json and error file contents
- How Claude Code's working directory is set to the target repo root
- git commit identity for commits pushed to the target repo (GitHub Actions bot or AGENT_GH_TOKEN user)

### Deferred Ideas (OUT OF SCOPE)
- Watching cross-repo PRs for merge events (would require target repo to send webhooks back to ClawForge) — potential future phase
- Auto-merge on cross-repo PRs (too aggressive for now, flagged for later consideration)
- Dedicated ClawForge bot GitHub account for cleaner PR attribution — out of scope for v1.2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PR-01 | `run-job.yml` reads `target.json` from job branch and injects `TARGET_REPO_URL` into container env | Workflow checkout step pattern: `actions/checkout@v4` with `ref: ${{ github.ref_name }}`, then `jq` to read target.json, then `$GITHUB_OUTPUT` to pass to docker run step |
| EXEC-01 | Entrypoint performs two-phase clone — clawforge for config/metadata, target repo (shallow) for Claude's working tree | `/job` = clawforge clone (metadata/config source); `/workspace` = target repo clone (Claude's cwd); `cd /workspace` before Claude invocation |
| EXEC-03 | Clone failure captured as explicit failure stage with `clone-error.md` artifact | `set -e` must be disabled around clone; catch clone exit code, write error file, push to clawforge branch, then exit 1 |
| PR-02 | Entrypoint creates PR on target repo via `gh pr create --repo owner/repo` | `gh pr create --repo owner/slug --head clawforge/{uuid} --base {default_branch}` — works when run from inside target repo clone and `gh auth setup-git` already called |
| PR-03 | Default branch detected via `gh repo view` (not hardcoded to main) | `gh repo view owner/slug --json defaultBranchRef -q '.defaultBranchRef.name'` — HIGH confidence, official CLI docs |
| PR-04 | PR body includes ClawForge attribution with job ID and originating system | Heredoc PR body with all four required elements; `--body-file` flag alternative for multi-line safety |
| PR-05 | Cross-repo branches use `clawforge/{uuid}` naming convention in target repos | Branch created in target repo at clone time: `git checkout -b clawforge/${JOB_ID}` after cloning target repo |
</phase_requirements>

---

## Summary

Phase 10 modifies two files: `templates/docker/job/entrypoint.sh` and `templates/.github/workflows/notify-pr-complete.yml`. The `run-job.yml` workflow stays unchanged per locked decisions — the entrypoint reads `target.json` internally. The key architectural change is the entrypoint's two-phase clone: the current single clone (`/job`) becomes the clawforge metadata clone, and a second shallow clone of the target repo becomes Claude's actual working tree (`/workspace`).

The `gh` CLI's `gh pr create --repo owner/slug` command works correctly for this use case because ClawForge pushes a branch directly to the target repo (not a fork-based PR). When run from inside the target repo clone, `gh` can determine the repo context automatically. The `--head` flag isn't needed for same-repo-push scenarios. Default branch detection uses `gh repo view owner/slug --json defaultBranchRef -q '.defaultBranchRef.name'` — verified against official CLI docs.

The `notify-pr-complete.yml` extension adds a `push` trigger on `job/**` branches to handle the cross-repo path: when `pr-result.json` is present on the job branch after a container push, a cross-repo PR was created and the workflow fires the completion notification. The existing workflow_run trigger path (same-repo, auto-merge flow) is preserved.

**Primary recommendation:** Two-phase clone with `/job` as clawforge metadata clone and `/workspace` as target repo working tree. Detect `target.json`, branch to `clawforge/{uuid}`, run Claude with cwd `/workspace`, push branch, create PR via `gh pr create --repo`, write `pr-result.json` sidecar back to clawforge job branch, then push sidecar to trigger `notify-pr-complete.yml`.

---

## Standard Stack

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `gh` CLI | bundled in Docker image | PR creation, repo view, auth setup | Already used in entrypoint; `gh auth setup-git` on line 26 |
| `git` | system | Clone, branch, commit, push | Already used throughout entrypoint |
| `jq` | system | Parse target.json, build PR body JSON | Already used in entrypoint and run-job.yml |
| `actions/checkout@v4` | v4 | Checkout job branch in workflow | Already used in notify workflows |

### No New Dependencies

All tools are already present in the Docker image and workflow runners. Phase 10 is purely a logic change to existing files — no new packages, no new GitHub secrets, no new workflow files.

---

## Architecture Patterns

### Recommended Entrypoint Structure (Two-Phase Clone)

```
/job/         ← Phase 1: clawforge repo clone (metadata/config/logs source)
  logs/{uuid}/
    job.md          ← job description
    target.json     ← target repo metadata (if cross-repo)
    clone-error.md  ← written on clone failure
    pr-error.md     ← written on PR creation failure
    pr-result.json  ← written on successful PR creation
  config/
    SOUL.md / AGENT.md   ← per-instance config (fallback to /defaults/)
/workspace/   ← Phase 2: target repo clone (Claude's cwd)
  [target repo contents]
```

### Pattern 1: Two-Phase Clone with Failure Guard

**What:** Clone clawforge first to read target.json, then conditionally clone target repo. Failure at either clone stage writes an error artifact and exits.

**When to use:** Always — this is the entrypoint's new main path.

```bash
# Phase 1: always clone clawforge job branch (metadata/config source)
# existing: git clone --single-branch --branch "$BRANCH" --depth 1 "$REPO_URL" /job
# (unchanged — this is line 39 in existing entrypoint)

cd /job

# Read target.json if present
TARGET_REPO_URL=""
TARGET_REPO_SLUG=""
if [ -f "/job/logs/${JOB_ID}/target.json" ]; then
    TARGET_REPO_URL=$(jq -r '.repo_url' "/job/logs/${JOB_ID}/target.json")
    TARGET_REPO_SLUG=$(jq -r '.owner + "/" + .slug' "/job/logs/${JOB_ID}/target.json")
fi

# Phase 2: clone target repo if cross-repo job
WORK_DIR="/job"
if [ -n "$TARGET_REPO_URL" ]; then
    # Disable set -e around clone to capture exit code
    set +e
    git clone --single-branch --depth 1 "$TARGET_REPO_URL" /workspace 2>&1
    CLONE_EXIT=$?
    set -e

    if [ "$CLONE_EXIT" -ne 0 ]; then
        # Write clone-error.md to clawforge job branch and exit
        cat > "${LOG_DIR}/clone-error.md" << EOF
# Clone Failure — Job ${JOB_ID}

**Stage:** clone
**Target:** ${TARGET_REPO_URL}
**Exit code:** ${CLONE_EXIT}
**Timestamp:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
        git add -A
        git commit -m "clawforge: job ${JOB_ID} clone-error" || true
        git push origin || true
        exit 1
    fi

    WORK_DIR="/workspace"
fi

cd "$WORK_DIR"
```

**Source:** Derived from existing entrypoint pattern; `set +e`/`set -e` around clone to capture error code without aborting.

### Pattern 2: Cross-Repo Branch Creation

**What:** After cloning target repo, create the `clawforge/{uuid}` branch before running Claude.

```bash
if [ -n "$TARGET_REPO_URL" ]; then
    cd /workspace
    git checkout -b "clawforge/${JOB_ID}"
fi
```

**Critical detail:** Branch is created locally before Claude runs. Claude's commits go onto this branch. Push at end creates the branch in the remote target repo.

### Pattern 3: Default Branch Detection

**What:** Use `gh repo view` to get the target repo's actual default branch before creating a PR.

```bash
DEFAULT_BRANCH=$(gh repo view "$TARGET_REPO_SLUG" --json defaultBranchRef -q '.defaultBranchRef.name')
# Falls back to "main" if detection fails
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
```

**Source:** Official GitHub CLI docs — `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` (HIGH confidence, verified against https://cli.github.com/manual/gh_repo_view).

### Pattern 4: PR Creation on Target Repo

**What:** When run from inside the target repo clone, `gh pr create --repo` creates a PR in that repo with the pushed branch as head.

```bash
# Push the clawforge branch to target repo
git push origin "clawforge/${JOB_ID}"

# Detect default branch
DEFAULT_BRANCH=$(gh repo view "$TARGET_REPO_SLUG" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || echo "main")

# Build PR body (write to file for multi-line safety)
cat > /tmp/pr-body.md << EOF
## ${JOB_DESCRIPTION_FIRST_LINE}

> **ClawForge AI-Generated PR** — This pull request was created autonomously by [ClawForge](https://github.com/ScalingEngine/clawforge) (job \`${JOB_ID}\`). Review all changes carefully before merging.

### Job Description

${JOB_DESCRIPTION}

### Originating Job

Clawforge job branch: \`${BRANCH}\`
Run: ${GITHUB_SERVER_URL}/${CLAWFORGE_REPO}/tree/${BRANCH}

### Changes Summary

_Claude Code completed the task above. Review the diff for details._
EOF

# Create PR on target repo
set +e
PR_OUTPUT=$(gh pr create \
    --repo "$TARGET_REPO_SLUG" \
    --head "clawforge/${JOB_ID}" \
    --base "$DEFAULT_BRANCH" \
    --title "clawforge: ${JOB_DESCRIPTION_FIRST_LINE}" \
    --body-file /tmp/pr-body.md 2>&1)
PR_EXIT=$?
set -e

if [ "$PR_EXIT" -ne 0 ]; then
    cat > "${LOG_DIR}/pr-error.md" << EOF
# PR Creation Failure — Job ${JOB_ID}

**Stage:** pr-creation
**Target:** ${TARGET_REPO_SLUG}
**Exit code:** ${PR_EXIT}
**Output:** ${PR_OUTPUT}
**Timestamp:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
    cd /job
    git add -A && git commit -m "clawforge: job ${JOB_ID} pr-error" || true
    git push origin || true
    exit 1
fi

# Extract PR URL from gh output (last line)
PR_URL=$(echo "$PR_OUTPUT" | tail -1)
PR_NUMBER=$(gh pr view "$PR_URL" --json number -q '.number' 2>/dev/null || echo "")
```

**Source:** `gh pr create --repo` flag — verified against https://cli.github.com/manual/gh_pr_create. The `--body-file` flag avoids shell quoting issues with multi-line bodies.

### Pattern 5: pr-result.json Sidecar Write

**What:** After successful PR creation, write `pr-result.json` to the clawforge job branch to trigger `notify-pr-complete.yml`.

```bash
# Write pr-result.json back to clawforge job branch
cd /job
cat > "${LOG_DIR}/pr-result.json" << EOF
{
  "target_repo": "${TARGET_REPO_SLUG}",
  "pr_url": "${PR_URL}",
  "pr_number": "${PR_NUMBER}",
  "branch": "clawforge/${JOB_ID}",
  "job_id": "${JOB_ID}"
}
EOF
git add -A
git commit -m "clawforge: job ${JOB_ID} cross-repo PR created" || true
git push origin || true
```

**Key detail:** Pushing `pr-result.json` to the clawforge job branch triggers the `on: push` trigger in `notify-pr-complete.yml`. This is the notification dispatch mechanism for cross-repo jobs.

### Pattern 6: notify-pr-complete.yml Extension

**What:** Add `push` trigger on `job/**` branches. Detect `pr-result.json` to distinguish cross-repo path from same-repo (auto-merge) path.

```yaml
on:
  workflow_run:
    workflows: ["Auto-Merge ClawForge PR"]
    types: [completed]
  push:
    branches:
      - 'job/**'
```

Then in the job, add a condition that handles both paths:

```yaml
jobs:
  notify:
    runs-on: ${{ vars.RUNS_ON || 'ubuntu-latest' }}
    if: startsWith(github.event.workflow_run.head_branch, 'job/') || startsWith(github.ref_name, 'job/')
```

With a step that detects which path triggered the notification:
```bash
# Determine notification path
if [ "${{ github.event_name }}" = "push" ]; then
    # Cross-repo path: check for pr-result.json
    BRANCH="${{ github.ref_name }}"
    JOB_ID="${BRANCH#job/}"
    if [ -f "logs/${JOB_ID}/pr-result.json" ]; then
        PR_URL=$(jq -r '.pr_url' "logs/${JOB_ID}/pr-result.json")
        TARGET_REPO=$(jq -r '.target_repo' "logs/${JOB_ID}/pr-result.json")
        STATUS="cross_repo_pr_open"
    else
        # Push but no pr-result.json — skip
        exit 0
    fi
else
    # Same-repo path: existing auto-merge workflow_run logic
    # ... existing logic ...
fi
```

**Source:** GitHub Actions docs — `on: push` with `branches: ['job/**']` pattern confirmed HIGH confidence (https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows).

### Anti-Patterns to Avoid

- **Hardcoding `main` as base branch:** Always use `gh repo view --json defaultBranchRef` — target repos may use `master`, `develop`, or custom defaults.
- **Using `--head owner:branch` syntax for non-fork PRs:** ClawForge pushes directly to the target repo, so `--head clawforge/{uuid}` (no owner prefix) is correct when run from inside the target repo clone. The fork-based `owner:branch` syntax is for fork PRs.
- **Piping multi-line PR body through `--body`:** Shell quoting breaks multi-line strings. Use `--body-file /tmp/pr-body.md` instead.
- **Running `gh pr create` from /job instead of /workspace:** Must run from inside the target repo's working directory OR use `--repo` flag. Both work; `--repo` flag is more explicit and doesn't depend on cwd.
- **Not disabling `set -e` before clone/PR commands:** Both clone and `gh pr create` can exit non-zero for legitimate reasons (bad credentials, not found, etc.). Wrap with `set +e`/`set -e` to capture exit codes before writing error artifacts.
- **Forgetting to `cd /job` before writing error files on cross-repo failures:** After entering `/workspace` or `/tmp`, git add/commit/push must happen from `/job` (the clawforge clone).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detect target repo's default branch | Hardcode `main`, parse README, use GitHub API | `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` | Single command, official API, handles renames |
| Create PR with attribution | Custom curl to GitHub REST API | `gh pr create --repo ... --body-file` | Handles auth, retry-safe, readable |
| Parse target.json | Custom awk/grep | `jq -r '.repo_url'` | Already present in container image; safe with special chars |
| Multi-line PR body | Escape strings, echo heredoc | `--body-file /tmp/pr-body.md` | Shell quoting of multi-line strings is a reliability hazard |
| Extract PR URL/number after creation | Parse git output | `gh pr create` prints PR URL on last line; `gh pr view $URL --json number` | Official output format, stable |

**Key insight:** The `gh` CLI abstracts every cross-repo operation needed. No raw GitHub API calls, no manual auth header construction. The entire Phase 10 is `gh` commands + bash control flow.

---

## Common Pitfalls

### Pitfall 1: Cross-Repo PR via `--head owner:branch` Instead of Direct Push

**What goes wrong:** Attempting `gh pr create --repo target/repo --head clawforge-owner:clawforge-branch` fails because the `owner:branch` head syntax is for fork-based PRs (where the branch lives in a fork). ClawForge pushes the branch directly to the target repo.

**Why it happens:** Confusion between fork-based cross-repo PRs (fork → upstream) and direct push cross-repo PRs (push branch to target, create PR in target).

**How to avoid:** Push the `clawforge/{uuid}` branch directly to the target repo via `git push origin clawforge/${JOB_ID}`. Then `gh pr create --repo owner/slug --head clawforge/${JOB_ID} --base ${DEFAULT_BRANCH}` — the `--head` is just the branch name, no owner prefix.

**Warning signs:** `gh` error messages about "could not find repository for head branch" or "invalid head ref".

### Pitfall 2: `set -e` Causes Silent Exit on Clone Failure

**What goes wrong:** `set -e` at top of entrypoint causes the script to exit immediately when clone fails, before the error artifact can be written and committed.

**Why it happens:** `set -e` is global and applies to all commands including the target repo clone.

**How to avoid:** Wrap the clone command with `set +e` / `set -e` and capture `$?` explicitly. Write the error file, commit, push, then `exit 1`.

**Warning signs:** Container exits non-zero, no `clone-error.md` on the job branch, failure stage shows as "docker_pull" instead of "clone" in Phase 11 notifications.

### Pitfall 3: Working Directory Confusion Between /job and /workspace

**What goes wrong:** After cloning target repo to `/workspace` and `cd /workspace`, the entrypoint forgets to `cd /job` before committing error artifacts or `pr-result.json` to the clawforge branch.

**Why it happens:** `set -e` + cwd changes compound. Git commands run from `/workspace` operate on the target repo's git index, not the clawforge job branch.

**How to avoid:** Use explicit `cd /job` before every git add/commit/push to the clawforge branch. Keep the two git working trees cleanly separated.

**Warning signs:** `git: not a git repository` errors, or worse, accidentally committing to the target repo's branch instead of the clawforge job branch.

### Pitfall 4: `gh auth setup-git` Covers Both Repos

**What goes wrong:** Assuming `gh auth setup-git` (line 26) only configures credentials for REPO_URL, not for TARGET_REPO_URL.

**Why it happens:** Misunderstanding of how `gh auth setup-git` works — it configures git's credential helper globally for all GitHub repositories accessible by the authenticated token.

**How to avoid:** Nothing extra needed. `gh auth setup-git` is called once at line 26 and covers all subsequent git operations against any GitHub repo the token can access. The AGENT_GH_TOKEN must have `repo` scope on the target repos (operator setup documented in .env.example).

**Warning signs:** Clone or push 403/authentication errors on target repo when token has correct scopes in theory.

### Pitfall 5: PR Body Shell Quoting with Multi-Line Strings

**What goes wrong:** Using `--body "$(cat /tmp/pr-body.md)"` fails when the job description contains single quotes, backticks, or special characters that break shell interpolation.

**Why it happens:** Shell expansion of `$(cat file)` inside double quotes is vulnerable to content of the file.

**How to avoid:** Always use `--body-file /tmp/pr-body.md` instead of `--body`. Write the body to a temp file first, then pass the file path.

**Warning signs:** `gh` error about malformed input, truncated PR bodies, or syntax errors in workflow log.

### Pitfall 6: notify-pr-complete.yml Fires on Every job/* Push

**What goes wrong:** Adding `on: push: branches: ['job/**']` causes the notification workflow to fire on every push to a job branch, including the initial job.md commit (before Claude runs).

**Why it happens:** `on: push` is not filtered to only fire when `pr-result.json` exists — that check happens inside the job's steps.

**How to avoid:** Early-exit in the workflow step when `pr-result.json` is not found on the branch. The workflow fires but does nothing for non-result pushes. Add an `if:` condition or explicit `exit 0` when no `pr-result.json`.

**Warning signs:** Notification webhook fires multiple times per job, or fires on failed jobs.

---

## Code Examples

Verified patterns from official sources:

### Detect Default Branch

```bash
# Source: https://cli.github.com/manual/gh_repo_view
DEFAULT_BRANCH=$(gh repo view "owner/slug" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || echo "main")
```

### Create PR on Target Repo

```bash
# Source: https://cli.github.com/manual/gh_pr_create
# Run from inside target repo clone OR use --repo flag
gh pr create \
    --repo "owner/slug" \
    --head "clawforge/${JOB_ID}" \
    --base "${DEFAULT_BRANCH}" \
    --title "clawforge: ${TITLE}" \
    --body-file /tmp/pr-body.md
```

### Pass Step Output to Docker Run in run-job.yml

```yaml
# Source: GitHub Actions docs — $GITHUB_OUTPUT and step outputs
- name: Read target.json
  id: read-target
  run: |
    if [ -f "logs/${JOB_ID}/target.json" ]; then
      TARGET_REPO_URL=$(jq -r '.repo_url' "logs/${JOB_ID}/target.json")
      echo "target_repo_url=${TARGET_REPO_URL}" >> "$GITHUB_OUTPUT"
    fi

- name: Run ClawForge Agent
  run: |
    docker run --rm \
      -e TARGET_REPO_URL="${{ steps.read-target.outputs.target_repo_url }}" \
      ...
```

**NOTE:** Per locked decision, `run-job.yml` stays unchanged and the entrypoint reads `target.json` internally. This pattern is shown for reference only — the entrypoint approach is preferred.

### on: push Trigger for job/* Branches

```yaml
# Source: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
on:
  workflow_run:
    workflows: ["Auto-Merge ClawForge PR"]
    types: [completed]
  push:
    branches:
      - 'job/**'
```

### Clone with Error Capture (set -e safe)

```bash
# Pattern: disable set -e, capture exit, re-enable
set +e
git clone --single-branch --depth 1 "$TARGET_REPO_URL" /workspace 2>&1
CLONE_EXIT=$?
set -e

if [ "$CLONE_EXIT" -ne 0 ]; then
    echo "Clone failed with exit ${CLONE_EXIT}" > "${LOG_DIR}/clone-error.md"
    git -C /job add -A
    git -C /job commit -m "clawforge: job ${JOB_ID} clone-error" || true
    git -C /job push origin || true
    exit 1
fi
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single clone (`/job`) for both metadata and work | Two-phase clone: `/job` for metadata, `/workspace` for work | Phase 10 | Claude operates on target repo codebase, not clawforge |
| PR always on clawforge | PR on target repo via `gh pr create --repo` | Phase 10 | Target repo owners get the PR, not clawforge maintainers |
| Hardcoded `--base main` | `gh repo view --json defaultBranchRef` | Phase 10 | Works on repos with `master`, `develop`, or custom default branches |
| `notify-pr-complete.yml` only on workflow_run | Also on push to `job/**` for cross-repo path | Phase 10 | Cross-repo PR notifications don't require auto-merge trigger |

**Not changing:**
- `run-job.yml` — entrypoint handles all cross-repo logic internally
- `auto-merge.yml` — only applies to same-repo PRs (PRs on clawforge)
- `notify-job-failed.yml` — unchanged; reads error artifacts committed to job branch
- Existing same-repo PR path in entrypoint — preserved when no `target.json` present

---

## Open Questions

1. **AGENT_GH_TOKEN scope on target repos**
   - What we know: AGENT_GH_TOKEN must have `repo` scope (contents:write + pull_requests:write) on target repos
   - What's unclear: Whether the existing token already has this scope, or if operators need to update it
   - Recommendation: Write documentation note in `.env.example` (locked decision says no code change — operator action)

2. **git identity for commits on target repo**
   - What we know: `gh api user` resolves the token owner's name/email at entrypoint startup (line 27-29)
   - What's unclear: Whether this is the right identity for commits pushed to target repos (vs. a bot account)
   - Recommendation: Use the same identity already resolved at startup — consistent with same-repo behavior. Claude's Discretion per CONTEXT.md.

3. **notify-pr-complete.yml push trigger — double-fire on same-repo path**
   - What we know: Adding `on: push` to `notify-pr-complete.yml` could fire for same-repo job branch pushes too
   - What's unclear: Whether the existing `workflow_run` path fires fast enough that `push` also firing is harmless or causes duplicate notifications
   - Recommendation: Guard the push-path step with `[ -f "logs/${JOB_ID}/pr-result.json" ] || exit 0` to make it a no-op for same-repo pushes. The `workflow_run` path handles same-repo completions.

4. **JOB_ID availability in run-job.yml for target.json path**
   - What we know: JOB_ID is derived from branch name as `${BRANCH#job/}` in the entrypoint
   - What's unclear: Whether the entrypoint can reliably read `logs/${JOB_ID}/target.json` from `/job` when target.json is in a shallow clone
   - Recommendation: Shallow clone with `--depth 1` includes all files at HEAD — target.json will be present since it was committed before the branch triggered the workflow. Confirmed safe.

---

## Sources

### Primary (HIGH confidence)
- https://cli.github.com/manual/gh_pr_create — `--repo`, `--head`, `--base`, `--body-file` flags verified
- https://cli.github.com/manual/gh_repo_view — `--json defaultBranchRef -q '.defaultBranchRef.name'` verified
- https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows — `on: push` with `branches: ['job/**']` glob pattern verified

### Secondary (MEDIUM confidence)
- https://github.com/cli/cli/issues/10093 — Cross-repo PR limitation for org-to-org fork PRs. Not applicable here (ClawForge pushes directly to target repo, not fork-based). Issue open as of Jan 2025.
- https://mikefrobbins.com/2025/08/21/how-to-open-a-pr-in-a-different-fork-with-the-github-cli/ — Fork-based cross-repo PR pattern using `--head owner:branch`. Useful for understanding the distinction.
- GitHub Actions step output passing (`$GITHUB_OUTPUT`) — verified across multiple official doc sources

### Tertiary (LOW confidence — not needed for implementation)
- WebSearch results on general Docker + GitHub Actions env var passing patterns

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools (`gh`, `git`, `jq`) already in Docker image and workflows; no new dependencies
- Architecture: HIGH — two-phase clone pattern is straightforward bash; `gh` CLI flags verified against official docs
- Pitfalls: HIGH — identified from code review of existing entrypoint (`set -e` global scope, cwd switching, multi-line quoting)
- notify-pr-complete.yml extension: MEDIUM — push trigger pattern is documented; double-fire guard needs care

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (30 days — `gh` CLI stable, GitHub Actions push trigger syntax stable)
