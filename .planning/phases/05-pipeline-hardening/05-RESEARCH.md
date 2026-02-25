# Phase 5: Pipeline Hardening - Research

**Researched:** 2026-02-24
**Domain:** GitHub Actions workflow hardening, shell scripting, CI failure classification
**Confidence:** HIGH

## Summary

Phase 5 is a pure workflow-and-shell-script fix phase — no new code paths, no new libraries. All five requirements are surgical changes to files that already exist: `docker/job/entrypoint.sh`, `.github/workflows/run-job.yml`, and `.github/workflows/notify-job-failed.yml`. The template counterparts in `templates/.github/workflows/` and `templates/docker/job/` must be synced after every live file edit.

The most important discovery: as of the start of this phase, the live workflow files and their template counterparts are byte-for-byte identical (confirmed by `diff`). PIPE-05 (template sync) is therefore not a pre-existing gap — it is a maintenance requirement that must be honored at the end of the phase after all other changes land.

The second important discovery: the output file naming issue (PIPE-03) is a consistency problem between `notify-job-failed.yml` (reads `claude-output.json`) and the requirement spec (says `.jsonl`). The entrypoint currently writes `claude-output.json` via `--output-format json`. The simplest fix that satisfies the requirement without touching Claude's output format is to rename the tee target from `.json` to `.jsonl` in the entrypoint and update the workflow reader to match. This is consistent with the `.jsonl` naming already used for `gsd-invocations.jsonl`.

**Primary recommendation:** Five targeted edits across three files, with a final template sync step. No external dependencies, no new libraries, no schema changes.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bash | n/a | Shell logic in entrypoint and workflows | Already used throughout; no alternative |
| GitHub Actions YAML | v2 syntax | Workflow definition | Platform-native; the only option |
| `gh` CLI | bundled in GH Actions | Git operations, PR creation, log fetching | Already used in all workflows |
| `jq` | bundled in ubuntu-latest | JSON manipulation in shell | Already used in all workflows |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `git log --oneline` | built-in | Detect commits on branch vs base | Used in PIPE-01 zero-commit check |
| `git rev-parse` | built-in | Count commits ahead of remote | Alternative to log for zero-commit check |
| `timeout` (GNU coreutils) | built-in | Shell-side timeout for subprocesses | Not needed — GitHub Actions `timeout-minutes` handles it at job level |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `timeout-minutes` on job | `timeout-minutes` on individual step | Job-level is simpler and catches all hung steps including docker pull |
| Renaming output to `.jsonl` | Switching to `--output-format stream-json` | Stream-json is a future requirement (OBSV-06); `.jsonl` rename is minimal and keeps format identical |
| Inline failure stage detection in bash | External script | Inline is simpler for a single-file workflow step |

**Installation:** None required.

## Architecture Patterns

### Recommended Project Structure

No structural changes. All edits are in-place to existing files:

```
docker/job/
└── entrypoint.sh          # PIPE-01 (zero-commit guard), PIPE-03 (rename output file)

.github/workflows/
├── run-job.yml            # PIPE-04 (add timeout-minutes)
└── notify-job-failed.yml  # PIPE-02 (failure stage label), PIPE-03 (read .jsonl)

templates/.github/workflows/
├── run-job.yml            # PIPE-05 (sync from live)
└── notify-job-failed.yml  # PIPE-05 (sync from live)

templates/docker/job/
└── entrypoint.sh          # PIPE-05 (sync from live)
```

### Pattern 1: Zero-Commit Guard (PIPE-01)

**What:** Before calling `gh pr create`, check whether any commits beyond the starting state exist on the branch.
**When to use:** After `git commit` / `git push` but before `gh pr create`.
**Current state:** Entrypoint guards on `CLAUDE_EXIT -eq 0` only. Does not check for zero commits.
**Gap:** A job where Claude succeeds (exit 0) but makes no file changes will still attempt to open a PR. The `git commit` line uses `|| true` so a no-op commit does not fail the script. The PR creation then runs on a branch with no new commits beyond the initial `job.md`.

```bash
# Source: entrypoint.sh lines 169-181 (current state)
# Commit all changes (even on failure — logs are useful for debugging)
git add -A
git add -f "${LOG_DIR}" || true
git commit -m "clawforge: job ${JOB_ID}" || true
git push origin || true

# Create PR only if Claude succeeded
if [ "$CLAUDE_EXIT" -eq 0 ]; then
    gh pr create \
        --title "clawforge: job ${JOB_ID}" \
        --body "Automated job by ClawForge" \
        --base main || true
fi
```

**Required change:** Count commits on job branch that are not in `main` (or `origin/main`). Use `git rev-list --count origin/main..HEAD` after the commit+push. If count is 0, skip PR creation.

```bash
# Pattern: zero-commit check after push
COMMIT_COUNT=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "0")

if [ "$CLAUDE_EXIT" -eq 0 ] && [ "$COMMIT_COUNT" -gt 0 ]; then
    gh pr create \
        --title "clawforge: job ${JOB_ID}" \
        --body "Automated job by ClawForge" \
        --base main || true
else
    echo "Skipping PR: CLAUDE_EXIT=${CLAUDE_EXIT}, COMMIT_COUNT=${COMMIT_COUNT}"
fi
```

**Caveat:** The branch is created with `job.md` already committed by the Event Handler before the container runs. So `origin/main..HEAD` will include that initial commit. The check should count commits *added by the container* — i.e., commits beyond what was on the branch when the container started. Use `git stash`/`git diff` approach or count against the branch's first commit. Better: count commits added since the container's clone (depth 1). Since `--depth 1` means only one commit on local history, we can use `git log --oneline` after our `git commit` to count lines. Alternatively: check `git diff origin/<branch>..HEAD` before commit is pushed — but we already pushed. Simplest reliable approach: check if `git commit` produced a new commit (track exit code from commit separately, not swallowed by `|| true`).

**Revised pattern (cleaner):**
```bash
git add -A
git add -f "${LOG_DIR}" || true

# Track whether the commit produced real changes
COMMIT_EXIT=0
git commit -m "clawforge: job ${JOB_ID}" || COMMIT_EXIT=$?
# COMMIT_EXIT=1 means "nothing to commit" on most git versions
# Use git status to confirm
HAS_NEW_COMMIT=false
if [ "$COMMIT_EXIT" -eq 0 ]; then
    HAS_NEW_COMMIT=true
fi

git push origin || true

if [ "$CLAUDE_EXIT" -eq 0 ] && [ "$HAS_NEW_COMMIT" = "true" ]; then
    gh pr create ...
fi
```

**Note for planner:** The `git commit` exit code approach is fragile because some git versions exit 1 for "nothing to commit" and others exit 0. The `git rev-list --count origin/main..HEAD` approach is more reliable but requires accounting for the initial `job.md` commit. The safest approach is to record the HEAD SHA before `git add` and compare after `git commit`. This is a decision for the planner/implementer.

### Pattern 2: Failure Stage Categorization (PIPE-02)

**What:** Classify which stage of `run-job.yml` caused the failure (docker_pull / auth / claude) and include that label plus a log excerpt in the failure webhook payload.
**When to use:** In `notify-job-failed.yml`, after reading `claude-output.jsonl`.
**Current state:** `notify-job-failed.yml` sends `status` (the workflow conclusion: `failure`/`cancelled`/`timed_out`) but has no stage classification. The log excerpt comes from `claude-output.json` or GH run log tail.

**Stage detection logic:** The `notify-job-failed.yml` reads the GH Actions run log via `gh run view "$RUN_ID" --log`. The log contains step names. Parse the log to determine which step last produced output before failure:

```bash
# Stage detection from GH Actions log output
RUN_LOG=$(gh run view "$RUN_ID" --repo "${{ github.repository }}" --log 2>/dev/null || echo "")

FAILURE_STAGE="unknown"
if echo "$RUN_LOG" | grep -q "docker pull"; then
    if echo "$RUN_LOG" | grep -qi "error\|failed\|denied\|unauthorized" | head -1; then
        FAILURE_STAGE="docker_pull"
    fi
fi
if echo "$RUN_LOG" | grep -q "gh auth setup-git\|GH_USER_JSON"; then
    FAILURE_STAGE="auth"
fi
if echo "$RUN_LOG" | grep -q "Running Claude Code\|claude -p\|CLAUDE_EXIT"; then
    FAILURE_STAGE="claude"
fi
```

**Better approach:** Since `gh run view --log` returns step-annotated output, check which step name prefix appears in the last lines before the failure. GH Actions log format prefixes each line with `step_name\t{timestamp}\t{message}`. Parse step names from the log tail.

**Recommended approach for the planner:** Use the GH API to get the job's steps and their conclusions. The `gh run view` JSON output includes step-level status. This is more reliable than log parsing:

```bash
STEPS_JSON=$(gh api "repos/${{ github.repository }}/actions/runs/${RUN_ID}/jobs" \
  --jq '.jobs[0].steps[] | {name: .name, conclusion: .conclusion}' 2>/dev/null || echo "[]")

FAILURE_STAGE="unknown"
# Check steps in order; last failed step determines stage
if echo "$STEPS_JSON" | jq -e '.[] | select(.name == "Login to GHCR" and .conclusion == "failure")' > /dev/null 2>&1; then
  FAILURE_STAGE="docker_pull"
elif echo "$STEPS_JSON" | jq -e '.[] | select(.name | contains("Run ClawForge Agent") and .conclusion == "failure")' > /dev/null 2>&1; then
  # Distinguish auth vs claude within the single "Run ClawForge Agent" step via log content
  if echo "$RUN_LOG" | grep -q "gh auth setup-git"; then
    FAILURE_STAGE="auth"
  else
    FAILURE_STAGE="claude"
  fi
fi
```

**Simpler approach:** Since `run-job.yml` has only two steps (Login to GHCR and Run ClawForge Agent), and the Run ClawForge Agent step contains all the docker pull + auth + claude execution, stage detection within a single step requires log parsing. The simplest viable approach: look at what appeared in `claude-output.jsonl`. If the file is non-empty, Claude at least started (stage = claude). If the file is missing/empty and the run failed, it's docker_pull or auth.

```bash
FAILURE_STAGE="unknown"
if [ -f "logs/${JOB_ID}/claude-output.jsonl" ] && [ -s "logs/${JOB_ID}/claude-output.jsonl" ]; then
    FAILURE_STAGE="claude"
elif [ -f "logs/${JOB_ID}/preflight.md" ]; then
    FAILURE_STAGE="auth"   # auth succeeded (gh api user worked), docker succeeded
else
    FAILURE_STAGE="docker_pull"  # nothing committed to branch at all
fi
```

**This is the recommended implementation pattern** — use artifact presence as stage proxy, since artifacts are committed at each stage.

### Pattern 3: Output File Naming (PIPE-03)

**What:** Rename `claude-output.json` to `claude-output.jsonl` in entrypoint.sh, and update `notify-job-failed.yml` to read the new name.
**Why `.jsonl`:** The `--output-format json` from `claude -p` produces a single JSON object (not JSONL). However, the requirement specifies `.jsonl`. The intent is consistency with the project's `.jsonl` naming convention for append-style log files, and pre-alignment with OBSV-06 (future `stream-json` format switch which will produce true JSONL). The content is written via `tee` to a single file, so format doesn't change — just the extension.
**Files to change:**
  1. `docker/job/entrypoint.sh` line 135: `tee "${LOG_DIR}/claude-output.json"` → `tee "${LOG_DIR}/claude-output.jsonl"`
  2. `.github/workflows/notify-job-failed.yml` lines 40-41: `claude-output.json` → `claude-output.jsonl`
  3. `tests/test-entrypoint.sh` line 72 and `tests/validate-output.sh` lines 29-30 (if they reference `claude-output.json`)

**Tests file state (verified):**
- `tests/test-entrypoint.sh` line 72: references `claude-output.json`
- `tests/validate-output.sh` lines 29-30: references `claude-output.json`
These also need updating for consistency.

### Pattern 4: Runner Timeout (PIPE-04)

**What:** Add `timeout-minutes` to the `run-agent` job in `run-job.yml` to prevent hung jobs from locking the CI runner indefinitely.
**GitHub Actions docs:** `timeout-minutes` is a job-level property in GitHub Actions YAML. Default is 360 minutes (6 hours). Setting it to a lower value terminates the job if it exceeds that threshold and marks the workflow run as `timed_out` (not `failure`). The `notify-job-failed.yml` already handles `conclusion != 'success'`, which includes `timed_out`.

```yaml
# Source: GitHub Actions docs (job-level timeout)
jobs:
  run-agent:
    runs-on: ${{ vars.RUNS_ON || 'ubuntu-latest' }}
    timeout-minutes: ${{ vars.JOB_TIMEOUT_MINUTES || 30 }}  # Option A: configurable via repo var
    # OR
    timeout-minutes: 30  # Option B: hardcoded sensible default
```

**Recommended value:** 30 minutes. A Claude Code job doing real work should complete in under 20 minutes. 30 gives headroom while preventing multi-hour lockups. Making it configurable via `vars.JOB_TIMEOUT_MINUTES` adds flexibility for instances with longer-running jobs.

**What happens on timeout:** GitHub Actions sends SIGTERM to the runner process, marks the job as `timed_out`, which triggers `notify-job-failed.yml` (since conclusion != 'success'). No special handling needed in `notify-job-failed.yml` — it already reads `conclusion` from `github.event.workflow_run.conclusion`.

### Pattern 5: Template Sync (PIPE-05)

**What:** After all live file edits are complete, copy the changed files to their template counterparts.
**Current state:** All live workflow files and template workflow files are byte-for-byte identical (verified by `diff` for all four pairs). The template sync is not a pre-existing gap — it is a process step to honor after each live edit.
**Files that will need syncing after Phase 5 work:**
  - `docker/job/entrypoint.sh` → `templates/docker/job/entrypoint.sh`
  - `.github/workflows/run-job.yml` → `templates/.github/workflows/run-job.yml`
  - `.github/workflows/notify-job-failed.yml` → `templates/.github/workflows/notify-job-failed.yml`
**Files not affected by Phase 5:**
  - `auto-merge.yml` — not touched
  - `notify-pr-complete.yml` — not touched
  - Other workflow files

**Sync command pattern:**
```bash
cp docker/job/entrypoint.sh templates/docker/job/entrypoint.sh
cp .github/workflows/run-job.yml templates/.github/workflows/run-job.yml
cp .github/workflows/notify-job-failed.yml templates/.github/workflows/notify-job-failed.yml
diff .github/workflows/run-job.yml templates/.github/workflows/run-job.yml && echo "IDENTICAL"
```

### Anti-Patterns to Avoid

- **Swallowing all exit codes with `|| true`:** The current `git commit || true` means a zero-commit scenario is silent. Keep the `|| true` for push (push may fail on clean branch), but capture the commit exit code separately.
- **Hardcoding `.json` extension in new code:** Future OBSV-06 will switch to `stream-json` which naturally produces `.jsonl`. All new references should use `.jsonl`.
- **Step-level `timeout-minutes` instead of job-level:** Step-level timeout only terminates that step, not the full job. A hung `docker run` needs a job-level timeout to actually kill the runner.
- **Stage detection via log string parsing alone:** Log output formats can change. Prefer artifact presence checks (file exists on committed branch) as the primary signal; log parsing as secondary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runner timeout | Custom watchdog script | `timeout-minutes` on job | Native GitHub Actions feature; handles SIGTERM correctly |
| Commit detection | Custom git history traversal | `git rev-list --count origin/branch..HEAD` or SHA comparison | Built-in git primitives are reliable |
| JSON log parsing in workflow | Custom parser | `jq` (already present) | Already in use, no new dependency |
| Failure notification | New webhook endpoint | Existing `/api/github/webhook` | Already handles all job outcomes; just add new fields |

**Key insight:** This phase is surgical shell scripting. Every problem has a built-in solution (git primitives, GitHub Actions features, existing workflow infrastructure). No new libraries, no new services.

## Common Pitfalls

### Pitfall 1: Zero-Commit Check Against Wrong Base

**What goes wrong:** `git rev-list --count origin/main..HEAD` counts commits since `main`, but the job branch already has the initial `job.md` commit when the container starts. This commit was made by the Event Handler, not Claude. The check would always return >= 1 even for a zero-work job.
**Why it happens:** The branch is pre-populated with `logs/{jobId}/job.md` before the container runs.
**How to avoid:** Record `HEAD_BEFORE` SHA at the start of the entrypoint (after clone), then after commit compare `git rev-list --count HEAD_BEFORE..HEAD`. Or: capture the git commit exit code to detect a "nothing to commit" result.
**Warning signs:** Every job opens a PR even when Claude made no changes.

### Pitfall 2: `timed_out` Conclusion Not Caught by notify-job-failed

**What goes wrong:** `notify-job-failed.yml` condition: `github.event.workflow_run.conclusion != 'success'`. This correctly catches `timed_out` as well as `failure` and `cancelled`. No change needed.
**Why it happens (if not careful):** Testing only `conclusion == 'failure'` misses timeout events.
**How to avoid:** Already handled — just verify the existing condition is not narrowed during edits.

### Pitfall 3: Template Drift After Live Edits

**What goes wrong:** Developer edits the live workflow but forgets to sync the template. Over time, templates diverge from live files.
**Why it happens:** There's no automated sync check in CI.
**How to avoid:** Make template sync the final step of every plan that touches live workflow or docker files. The planner should make sync an explicit task in every plan, not an afterthought.
**Warning signs:** `diff .github/workflows/X templates/.github/workflows/X` exits non-zero.

### Pitfall 4: `--depth 1` Clone Breaks `git rev-list`

**What goes wrong:** The entrypoint uses `git clone --depth 1`. Shallow clones have limited history. Commands like `git rev-list origin/main..HEAD` may not work correctly without the full history of `origin/main`.
**Why it happens:** Shallow clone only fetches the tip of the branch, not `origin/main` history.
**How to avoid:** Use SHA comparison pattern instead:
```bash
HEAD_BEFORE=$(git rev-parse HEAD)
# ... git add, git commit ...
HEAD_AFTER=$(git rev-parse HEAD)
if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    HAS_NEW_COMMIT=true
fi
```
This does not require `origin/main` history.
**Warning signs:** `git rev-list` errors like "not a valid object" or returns unexpected counts.

### Pitfall 5: Failure Stage "auth" vs "claude" Ambiguity

**What goes wrong:** The entire docker run (docker pull, auth, claude) happens in a single `Run ClawForge Agent` step. If that step fails, the GH Actions job conclusion is `failure` but we can't easily tell which sub-stage failed.
**Why it happens:** Monolithic step design — all logic in one bash block.
**How to avoid:** Use artifact presence as proxy (as described in Pattern 2 above). If `preflight.md` was committed to the branch, auth succeeded. If `claude-output.jsonl` exists and is non-empty, Claude at least started.
**Warning signs:** Stage label always reads `unknown` or `docker_pull` even for Claude failures.

## Code Examples

Verified patterns from existing codebase and GitHub Actions docs:

### SHA-Based Zero-Commit Detection

```bash
# Source: entrypoint.sh (adapted)
# Record HEAD before commit
HEAD_BEFORE=$(git rev-parse HEAD)

git add -A
git add -f "${LOG_DIR}" || true
git commit -m "clawforge: job ${JOB_ID}" || true
git push origin || true

# Detect if commit actually created a new SHA
HEAD_AFTER=$(git rev-parse HEAD)
HAS_NEW_COMMIT=false
if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    HAS_NEW_COMMIT=true
fi

if [ "$CLAUDE_EXIT" -eq 0 ] && [ "$HAS_NEW_COMMIT" = "true" ]; then
    gh pr create \
        --title "clawforge: job ${JOB_ID}" \
        --body "Automated job by ClawForge" \
        --base main || true
else
    echo "Skipping PR: CLAUDE_EXIT=${CLAUDE_EXIT}, HAS_NEW_COMMIT=${HAS_NEW_COMMIT}"
fi
```

### Job-Level Timeout in GitHub Actions YAML

```yaml
# Source: GitHub Actions workflow syntax documentation
jobs:
  run-agent:
    runs-on: ${{ vars.RUNS_ON || 'ubuntu-latest' }}
    timeout-minutes: ${{ fromJSON(vars.JOB_TIMEOUT_MINUTES || '30') }}
    if: github.ref_type == 'branch' && startsWith(github.ref_name, 'job/')
```

**Note:** `vars.JOB_TIMEOUT_MINUTES` is a repo variable, not a secret. `fromJSON()` is needed to cast string var to number. Alternative: hardcode `30`.

### Failure Stage Detection via Artifact Presence

```bash
# Source: notify-job-failed.yml (proposed pattern)
FAILURE_STAGE="docker_pull"
if [ -f "logs/${JOB_ID}/preflight.md" ]; then
    FAILURE_STAGE="auth"  # preflight exists → docker ran, auth may have worked
fi
if [ -f "logs/${JOB_ID}/claude-output.jsonl" ] && [ -s "logs/${JOB_ID}/claude-output.jsonl" ]; then
    FAILURE_STAGE="claude"  # output exists → Claude at least started
fi
```

### Rename Output File (PIPE-03)

```bash
# In entrypoint.sh — change line 135 from:
2>&1 | tee "${LOG_DIR}/claude-output.json" || CLAUDE_EXIT=$?
# to:
2>&1 | tee "${LOG_DIR}/claude-output.jsonl" || CLAUDE_EXIT=$?
```

```bash
# In notify-job-failed.yml — change lines 40-41 from:
if [ -f "logs/${JOB_ID}/claude-output.json" ]; then
    CLAUDE_OUTPUT=$(head -c 4000 "logs/${JOB_ID}/claude-output.json")
# to:
if [ -f "logs/${JOB_ID}/claude-output.jsonl" ]; then
    CLAUDE_OUTPUT=$(head -c 4000 "logs/${JOB_ID}/claude-output.jsonl")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No runner timeout | Add `timeout-minutes: 30` | Phase 5 | Prevents runner lockup on hung jobs |
| PR opened on exit 0 only | PR opened on exit 0 AND commits exist | Phase 5 | Prevents empty PRs |
| No failure stage label | Stage label in webhook payload | Phase 5 | Operators can debug failures without reading full logs |
| `claude-output.json` | `claude-output.jsonl` | Phase 5 | Consistent naming, aligned with future stream-json switch |

**Deprecated/outdated:**
- `.json` extension for claude output file: being renamed to `.jsonl` in Phase 5 to match naming convention and prepare for OBSV-06.

## Open Questions

1. **Configurable vs hardcoded timeout for PIPE-04**
   - What we know: `timeout-minutes` must be added; reasonable default is 30 minutes
   - What's unclear: Should it be a repo variable (`vars.JOB_TIMEOUT_MINUTES`) for per-instance tuning, or hardcoded?
   - Recommendation: Hardcode 30 minutes. The `fromJSON()` workaround needed for numeric repo vars adds complexity. A static value is simpler and sufficient for 2 instances. Can be made configurable later if needed.

2. **Which files in `tests/` reference `claude-output.json` and need updating for PIPE-03?**
   - What we know: `tests/test-entrypoint.sh` and `tests/validate-output.sh` reference `claude-output.json`
   - What's unclear: The requirement says "notify-job-failed.yml reads .jsonl without error" — does PIPE-03 scope include updating test files?
   - Recommendation: Yes — update test files for consistency, since they are directly exercising the entrypoint. Inconsistent naming across test and production files creates confusion.

3. **Zero-commit detection: SHA comparison vs commit exit code?**
   - What we know: The shallow clone (`--depth 1`) makes `git rev-list` against `origin/main` unreliable
   - What's unclear: `git commit` exit code behavior across git versions for "nothing to commit"
   - Recommendation: Use SHA comparison (`HEAD_BEFORE` vs `HEAD_AFTER`). This works with shallow clones and is portable across git versions.

4. **PIPE-05 scope: which three workflow files?**
   - What we know: The success criterion says "All three workflow files in `templates/.github/workflows/`" — but there are actually 6 files in `templates/.github/workflows/` (auto-merge, build-image, notify-job-failed, notify-pr-complete, rebuild-event-handler, run-job, upgrade-event-handler)
   - What's unclear: Which three? The three affected by Phase 5 changes are: `run-job.yml`, `notify-job-failed.yml`, and `entrypoint.sh` (in `templates/docker/job/`)
   - Recommendation: Interpret "three workflow files" as the three files touched during Phase 5: `run-job.yml`, `notify-job-failed.yml`, and `entrypoint.sh`. Sync all changed files at end of phase.

## Sources

### Primary (HIGH confidence)

- Live codebase inspection — `.github/workflows/run-job.yml`, `notify-job-failed.yml`, `auto-merge.yml`, `notify-pr-complete.yml`, `docker/job/entrypoint.sh` — read directly
- Template codebase inspection — `templates/.github/workflows/` and `templates/docker/job/entrypoint.sh` — read directly and diffed against live
- `diff` results — all four workflow pairs and entrypoint confirmed byte-for-byte identical at phase start

### Secondary (MEDIUM confidence)

- GitHub Actions `timeout-minutes` documentation — job-level timeout, `timed_out` conclusion value, interaction with `workflow_run` trigger — from training data (HIGH confidence based on stable documented feature)
- `git rev-parse HEAD` for SHA comparison — portable bash pattern well-established across git versions

### Tertiary (LOW confidence)

- `git commit` exit code behavior for "nothing to commit" — varies by git version; SHA comparison recommended instead

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-01 | Job container creates PR only when Claude exits successfully AND commits exist on the job branch | Pattern 1 (SHA-based zero-commit detection); SHA comparison pattern handles shallow clone safely |
| PIPE-02 | Failed job notifications include failure stage categorization (docker_pull/auth/claude) with relevant log excerpt | Pattern 2 (artifact-presence stage detection); `preflight.md` and `claude-output.jsonl` as stage proxies |
| PIPE-03 | `notify-job-failed.yml` reads `claude-output.jsonl` (not `.json`) without a file-not-found error | Pattern 3 (rename tee target in entrypoint + update workflow reader); also update test files |
| PIPE-04 | `run-job.yml` enforces `timeout-minutes` to prevent runner lock-up on hung jobs | Pattern 4 (job-level `timeout-minutes: 30`; `timed_out` conclusion already caught by notify-job-failed) |
| PIPE-05 | All workflow templates in `templates/.github/workflows/` are byte-for-byte synced with live workflows | Pattern 5 (cp + diff verification); currently identical, will need sync after Phases 5 edits land |
</phase_requirements>

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools already in use, no new dependencies
- Architecture: HIGH — surgical in-place edits to known files, patterns verified against actual code
- Pitfalls: HIGH — derived from reading actual code and understanding `--depth 1` git behavior

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (GitHub Actions syntax is stable; git behavior is stable)
