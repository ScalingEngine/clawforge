---
phase: 05-pipeline-hardening
status: passed
verified: 2026-02-25
verifier: automated
requirements: [PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05]
---

# Phase 5: Pipeline Hardening — Verification

## Phase Goal

> The pipeline handles failure and success states correctly — jobs only open PRs when work was done, failures notify with enough context to debug, and runner timeouts prevent hung jobs from locking CI

## Success Criteria Verification

### SC1: Zero-commit PR guard
> A job that exits with a non-zero Claude exit code or produces zero commits does not create a PR

**Status: PASSED**

Evidence from `docker/job/entrypoint.sh` (lines 169-193):
- `HEAD_BEFORE=$(git rev-parse HEAD)` records SHA before commit
- `HEAD_AFTER=$(git rev-parse HEAD)` records SHA after commit
- `HAS_NEW_COMMIT=false` / comparison sets to `true` only if SHAs differ
- PR created only when `CLAUDE_EXIT -eq 0 AND HAS_NEW_COMMIT = true`
- Otherwise prints `Skipping PR: CLAUDE_EXIT=${CLAUDE_EXIT}, HAS_NEW_COMMIT=${HAS_NEW_COMMIT}`

Requirement: **PIPE-01** - Complete

### SC2: Failure stage categorization
> A failed job notification includes a failure stage label (docker_pull / auth / claude) and a relevant log excerpt

**Status: PASSED**

Evidence from `.github/workflows/notify-job-failed.yml` (lines 44-53):
- `FAILURE_STAGE="docker_pull"` (default)
- Escalates to `"auth"` if `preflight.md` exists
- Escalates to `"claude"` if `claude-output.jsonl` exists and is non-empty
- `--arg failure_stage "$FAILURE_STAGE"` passed to jq payload builder
- `failure_stage: $failure_stage` in webhook JSON payload
- Log excerpt via `CLAUDE_OUTPUT` (head -c 4000) or fallback `RUN_LOG` (tail -c 2000)

Requirement: **PIPE-02** - Complete

### SC3: .jsonl file reference
> The `notify-job-failed.yml` workflow reads `claude-output.jsonl` (not `.json`) without a file-not-found error

**Status: PASSED**

Evidence:
- `notify-job-failed.yml` line 40: `if [ -f "logs/${JOB_ID}/claude-output.jsonl" ]`
- `notify-job-failed.yml` line 41: `CLAUDE_OUTPUT=$(head -c 4000 "logs/${JOB_ID}/claude-output.jsonl")`
- `docker/job/entrypoint.sh` line 135: `tee "${LOG_DIR}/claude-output.jsonl"`
- `tests/test-entrypoint.sh` line 72: `tee "${LOG_DIR}/claude-output.jsonl"`
- `tests/validate-output.sh` lines 29-30: `claude-output.jsonl`
- Zero references to `claude-output.json` (without `l`) in any of these files

Requirement: **PIPE-03** - Complete

### SC4: Runner timeout
> A job that runs indefinitely is terminated after the configured timeout and triggers failure notification

**Status: PASSED**

Evidence from `.github/workflows/run-job.yml` line 9:
- `timeout-minutes: 30` on the `run-agent` job
- GitHub Actions terminates the job after 30 minutes with `conclusion: timed_out`
- `notify-job-failed.yml` condition `conclusion != 'success'` catches `timed_out`

Requirement: **PIPE-04** - Complete

### SC5: Template sync
> All three workflow files in `templates/.github/workflows/` are byte-for-byte identical to their live counterparts

**Status: PASSED**

Evidence (diff commands return empty output):
- `diff docker/job/entrypoint.sh templates/docker/job/entrypoint.sh` — identical
- `diff .github/workflows/run-job.yml templates/.github/workflows/run-job.yml` — identical
- `diff .github/workflows/notify-job-failed.yml templates/.github/workflows/notify-job-failed.yml` — identical

Requirement: **PIPE-05** - Complete

## Requirements Cross-Reference

| Requirement | Plan | Success Criteria | Status |
|-------------|------|------------------|--------|
| PIPE-01 | 05-01 | SC1 | Complete |
| PIPE-02 | 05-02 | SC2 | Complete |
| PIPE-03 | 05-01, 05-02 | SC3 | Complete |
| PIPE-04 | 05-01 | SC4 | Complete |
| PIPE-05 | 05-02 | SC5 | Complete |

## Verdict

**5/5 must-haves verified. Phase 5 goal achieved.**

The pipeline now correctly handles:
1. Success with changes → PR created (existing behavior preserved)
2. Success with no changes → PR skipped, logged
3. Failure → PR skipped, failure notification with stage label and log excerpt
4. Timeout → Job terminated at 30 min, failure notification triggered
5. All changes reflected in templates for new instance scaffolding
