---
phase: 10-actions-workflow-container-execution-cross-repo-pr
verified: 2026-02-26T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 10: Actions Workflow + Container Execution + Cross-Repo PR Verification Report

**Phase Goal:** Container reads target.json, clones the target repo as its working tree, and creates a PR on the target repo with correct branch naming and default branch detection
**Verified:** 2026-02-26
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Sending a job targeting a foreign repo causes Claude to operate on that codebase, not clawforge's | VERIFIED | `WORK_DIR="/job"` default; `WORK_DIR="/workspace"` set when target.json present (line 82); `cd "$WORK_DIR"` at line 94; CLAUDE.md and package.json read from `${WORK_DIR}` (lines 175, 188) |
| 2 | A PR appears in the target repo (not clawforge) with branch name `clawforge/{uuid}` | VERIFIED | `git -C /workspace checkout -b "clawforge/${JOB_ID}"` (line 87); `gh pr create --repo "$TARGET_REPO_SLUG" --head "clawforge/${JOB_ID}"` (lines 361-366) |
| 3 | PR base branch matches the target repo's actual default branch (not hardcoded to main) | VERIFIED | `DEFAULT_BRANCH=$(gh repo view "$TARGET_REPO_SLUG" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || echo "main")` (line 334); double fallback with `${DEFAULT_BRANCH:-main}` (line 335); `--base "$DEFAULT_BRANCH"` in gh pr create |
| 4 | If target repo clone fails, container writes clone-error.md and failure stage surfaces as "clone" | VERIFIED | `set +e/set -e` guard captures `CLONE_EXIT` (lines 57-60); `clone-error.md` written with `**Stage:** clone`, target URL, exit code, and timestamp (lines 64-74); committed and pushed to clawforge job branch before `exit 1` (lines 76-79) |
| 5 | PR body identifies ClawForge as the originating system and includes the job ID | VERIFIED | PR body written via `--body-file /tmp/pr-body.md` containing: attribution banner with ClawForge link and job ID (line 342), `## Job Description` (line 344), `## Originating Job` with CLAWFORGE_REPO + BRANCH + JOB_ID (lines 348-352), `## Changes Summary` placeholder (line 354) |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `templates/docker/job/entrypoint.sh` | Two-phase clone with WORK_DIR routing | VERIFIED | 437 lines; WORK_DIR appears 9 times; target.json read via jq; `cd "$WORK_DIR"` present; `bash -n` exits 0 |
| `templates/docker/job/entrypoint.sh` | clone-error.md artifact on clone failure | VERIFIED | 4 occurrences of `clone-error.md`; stage/target/exit-code/timestamp fields all present |
| `templates/docker/job/entrypoint.sh` | Cross-repo PR creation with pr-result.json sidecar | VERIFIED | `gh pr create --repo` present; pr-result.json written before `git add -A`; 5 required fields: target_repo, pr_url, pr_number, branch, job_id |
| `templates/docker/job/entrypoint.sh` | pr-error.md failure artifact | VERIFIED | 4 occurrences; stage/target/exit-code/output/timestamp fields; committed to clawforge branch before `exit 1` |
| `templates/.github/workflows/notify-pr-complete.yml` | Dual-trigger push on job/** + pr-result.json detection | VERIFIED | Valid YAML; `on: push: branches: ['job/**']` present; `workflow_run` trigger preserved; pr-result.json appears 7 times |
| `.planning/REQUIREMENTS.md` | PR-01 wording corrected to reflect actual implementation | VERIFIED | PR-01 reads: "Entrypoint reads target.json directly from the clawforge job branch (/job/logs/${JOB_ID}/target.json) and derives TARGET_REPO_URL internally; run-job.yml is unchanged" |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `entrypoint.sh` | `/job/logs/${JOB_ID}/target.json` | `jq -r '.repo_url'` | WIRED | Lines 51-52: reads `.repo_url` and `.owner + "/" + .slug` via jq |
| `entrypoint.sh` | `/workspace` | `git clone --single-branch --depth 1 TARGET_REPO_URL /workspace` | WIRED | Line 58; WORK_DIR set to /workspace on success (line 82); `cd "$WORK_DIR"` at line 94 |
| `entrypoint.sh` | target repo on GitHub | `gh pr create --repo TARGET_REPO_SLUG --head clawforge/${JOB_ID} --base DEFAULT_BRANCH` | WIRED | Lines 361-366; `--repo "$TARGET_REPO_SLUG"`, `--head "clawforge/${JOB_ID}"`, `--base "$DEFAULT_BRANCH"`, `--body-file /tmp/pr-body.md` |
| `entrypoint.sh` | `/job/logs/${JOB_ID}/pr-result.json` | `cat > ${LOG_DIR}/pr-result.json` | WIRED | Line 395; written before `git add -A` at line 411; sequencing confirmed |
| `entrypoint.sh` | `notify-pr-complete.yml` | push to job/* branch with pr-result.json triggers `on:push` | WIRED | pr-result.json committed to clawforge job branch before push (line 413); notify-pr-complete.yml has `on: push: branches: ['job/**']` |
| `notify-pr-complete.yml` | Event Handler `/api/github/webhook` | `curl POST` with pr_url and target_repo from pr-result.json | WIRED | Lines 219-221; reads pr_url and target_repo from pr-result.json; POSTs to `${{ vars.APP_URL }}/api/github/webhook` with webhook secret |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PR-01 | 10-01 | Entrypoint reads target.json directly; run-job.yml unchanged | SATISFIED | REQUIREMENTS.md line 30 shows corrected wording; `run-job.yml` has zero references to target.json or TARGET_REPO_URL injection |
| EXEC-01 | 10-01 | Two-phase clone — clawforge for config/metadata, target repo (shallow) for Claude's working tree | SATISFIED | Section 5 (lines 37-43) clones clawforge to /job; section 5b (lines 45-89) clones target to /workspace when target.json present |
| EXEC-03 | 10-01 | Clone failure captured as explicit failure stage with clone-error.md artifact | SATISFIED | Lines 62-79: set+e guard, CLONE_ERROR_FILE written with Stage/Target/Exit code/Timestamp, committed and pushed, exit 1 |
| PR-02 | 10-02 | Entrypoint creates PR on target repo via `gh pr create --repo owner/repo` | SATISFIED | Line 361-366: `gh pr create --repo "$TARGET_REPO_SLUG"` |
| PR-03 | 10-02 | Default branch detected via `gh repo view` (not hardcoded to main) | SATISFIED | Line 334: `gh repo view "$TARGET_REPO_SLUG" --json defaultBranchRef -q '.defaultBranchRef.name'`; double fallback on lines 334-335 |
| PR-04 | 10-02 | PR body includes ClawForge attribution with job ID and originating system | SATISFIED | /tmp/pr-body.md contains attribution banner with ClawForge link + job ID, job description, originating job link (CLAWFORGE_REPO + BRANCH + JOB_ID), changes summary placeholder |
| PR-05 | 10-02 | Cross-repo branches use `clawforge/{uuid}` naming convention in target repos | SATISFIED | Line 87: `git -C /workspace checkout -b "clawforge/${JOB_ID}"`; line 330: push; line 363: `--head "clawforge/${JOB_ID}"` |

**Orphaned requirements check:** REQUIREMENTS.md traceability table lists exactly PR-01, EXEC-01, EXEC-03, PR-02, PR-03, PR-04, PR-05 as Phase 10 — matches plan declarations exactly. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO/FIXME/placeholder comments found. No empty implementations. No stub returns. `bash -n` syntax check passes. YAML parses cleanly.

---

### Human Verification Required

#### 1. End-to-End Cross-Repo Job Execution

**Test:** Send a job via Slack or Telegram targeting a configured target repo (e.g., NeuroStory). Observe the job run in GitHub Actions.
**Expected:** Claude runs with cwd=/workspace (target repo), commits appear on `clawforge/{uuid}` branch of the target repo, a PR is opened on the target repo with the ClawForge attribution body, and a Slack/Telegram notification arrives with the PR URL.
**Why human:** Requires a live GitHub Actions runner, Docker build, real target repo with REPOS.json configured, and live channel credentials. Cannot verify container cwd or actual PR creation programmatically from the template files alone.

#### 2. Clone Failure Path

**Test:** Configure a job with an invalid or inaccessible target repo URL in target.json. Run the job container.
**Expected:** Container writes `clone-error.md` to the clawforge job branch, pushes it, and exits 1. The failure stage field in clone-error.md reads "clone".
**Why human:** Requires a running container with a deliberately invalid REPO_URL or token. Cannot simulate the failure path from static file analysis.

#### 3. notify-pr-complete.yml Dual-Trigger Behavior in GitHub Actions

**Test:** Push a job/* branch with pr-result.json present, then push another job/* branch without pr-result.json.
**Expected:** First push fires the "Notify cross-repo PR complete" step and sends the webhook. Second push fires the workflow but exits via path=skip with no webhook call.
**Why human:** GitHub Actions workflow execution cannot be verified from YAML inspection alone; requires actual workflow runs.

---

### Summary

Phase 10 goal is fully achieved. All five observable truths are verified against the actual codebase:

1. `entrypoint.sh` correctly implements two-phase clone logic: clawforge job branch always to `/job`, target repo conditionally to `/workspace` when `target.json` is detected. Claude's cwd is controlled by `WORK_DIR` with `cd "$WORK_DIR"` before Claude invocation, and an explicit `cd /job` before section 12 git operations preserves working-directory discipline.

2. Cross-repo branch naming (`clawforge/{uuid}`) is enforced via `git -C /workspace checkout -b "clawforge/${JOB_ID}"` before Claude runs, ensuring all commits land on the correct branch, and `gh pr create --repo --head "clawforge/${JOB_ID}"` creates the PR on the target repo.

3. Default branch detection is live: `gh repo view --json defaultBranchRef` with a double fallback (`|| echo "main"` + `${DEFAULT_BRANCH:-main}`) handles both CLI failure and empty string edge cases.

4. Clone failure guard is complete: `set +e/set -e` captures `CLONE_EXIT`, `clone-error.md` is written with all required fields (Stage/Target/Exit code/Timestamp), committed and pushed to the clawforge job branch, then `exit 1`.

5. PR body has all four required elements: ClawForge attribution banner with job ID, job description, originating job link (clawforge repo + branch + job ID), and changes summary placeholder — written safely via `--body-file /tmp/pr-body.md`.

`notify-pr-complete.yml` (Plan 10-03) is fully wired: dual-trigger (`workflow_run` + `push: branches: ['job/**']`), route step sets `path=cross_repo/same_repo/skip`, existing same-repo steps guarded with `steps.route.outputs.path == 'same_repo'`, cross-repo notification step guarded with `steps.route.outputs.path == 'cross_repo'`, payload includes `pr_url`, `target_repo`, `status=cross_repo_pr_open`.

All 7 requirement IDs (PR-01, EXEC-01, EXEC-03, PR-02, PR-03, PR-04, PR-05) are satisfied. No anti-patterns detected. `bash -n` and YAML parse both pass.

---

_Verified: 2026-02-26_
_Verifier: Claude (gsd-verifier)_
