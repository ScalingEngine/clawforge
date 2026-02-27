---
phase: 10-actions-workflow-container-execution-cross-repo-pr
plan: "03"
subsystem: infra
tags: [github-actions, yaml, cross-repo, webhook, notifications]

# Dependency graph
requires:
  - phase: 10-actions-workflow-container-execution-cross-repo-pr
    provides: entrypoint.sh writes pr-result.json sidecar to job branch on cross-repo PR creation (plan 10-01/10-02)
provides:
  - notify-pr-complete.yml with dual-trigger support: workflow_run (same-repo) and push on job/** (cross-repo)
  - Cross-repo notification path: push to job/* with pr-result.json fires curl POST to /api/github/webhook
  - Silent skip path: push to job/* without pr-result.json exits cleanly with no notification
  - Preserved same-repo path: workflow_run/auto-merge trigger continues unchanged
affects:
  - phase-11-notification-pipeline
  - phase-12-regression-verification

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-trigger GitHub Actions workflow: workflow_run + push on job/** branches"
    - "Route-output gating: steps.route.outputs.path controls which notification path executes"
    - "pr-result.json sidecar convention: cross-repo PR metadata read from checked-out job branch"
    - "Unified checkout step: github.event_name == 'push' && github.sha || head_sha conditional ref"

key-files:
  created: []
  modified:
    - templates/.github/workflows/notify-pr-complete.yml

key-decisions:
  - "Cross-repo notification fires on push to job/* branch when pr-result.json is present — push is the only observable event in clawforge Actions when a cross-repo PR is created on a foreign repo"
  - "Silent exit (path=skip) when push has no pr-result.json — early job.md commit pushes must not trigger spurious notifications"
  - "Unified checkout step handles both trigger paths: github.sha for push, head_sha for workflow_run — avoids empty context.workflow_run on push events"
  - "Cross-repo payload status field is cross_repo_pr_open (distinct from same-repo completed/merged) — semantic difference surfaces in Phase 11 UX"

patterns-established:
  - "Route step pattern: id: route sets path output, subsequent steps gated by steps.route.outputs.path == 'value'"
  - "GITHUB_OUTPUT env-file syntax for all step outputs (no ::set-output deprecated form)"

requirements-completed: [PR-01, PR-02, PR-03, PR-04, PR-05]

# Metrics
duration: 1min
completed: 2026-02-26
---

# Phase 10 Plan 03: Notify-PR-Complete Dual-Trigger Summary

**notify-pr-complete.yml extended with push trigger on job/** + pr-result.json detection for cross-repo PR notification alongside preserved same-repo workflow_run path**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-27T02:06:13Z
- **Completed:** 2026-02-27T02:07:46Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `on: push: branches: ['job/**']` trigger to notify-pr-complete.yml so cross-repo PR creation (signaled via pr-result.json push) fires the notification workflow
- Added "Detect trigger path" step (route) that reads pr-result.json on push events and outputs path=cross_repo/same_repo/skip, enabling clean conditional branching
- Added "Notify cross-repo PR complete" step that sends a payload with pr_url, target_repo, status=cross_repo_pr_open, job description, and GSD invocation log to the Event Handler webhook
- Guarded existing "Get PR number" and "Gather job results and notify" steps with `if: steps.route.outputs.path == 'same_repo'` to preserve same-repo path exactly
- Replaced standalone `Checkout PR branch` step with unified checkout that resolves the correct ref for both trigger types via `github.event_name == 'push' && github.sha || github.event.workflow_run.head_sha`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add push trigger on job/** branches** - `0512204` (feat)
2. **Task 2: Add cross-repo detection step and dual-path notification** - `5b7fe74` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `templates/.github/workflows/notify-pr-complete.yml` - Extended with dual-trigger support, route detection step, cross-repo notification step, and same-repo path guards

## Decisions Made

- Used step output gating (`steps.route.outputs.path`) rather than explicit `exit 0` for the skip path — GitHub Actions skips steps with non-matching `if:` conditions cleanly, which is the correct pattern
- Cross-repo payload `status=cross_repo_pr_open` and `merge_result=cross_repo_pr_open` chosen to be semantically distinct from same-repo `completed`/`merged` — Phase 11 UX can differentiate "PR open for review on another repo" vs "merged here"
- `target_repo` included in cross-repo payload so Event Handler can display the destination repo name in the notification message

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - YAML was valid on first write. Python pyyaml represents the `on:` key as Python boolean `True` (YAML spec quirk) but the file is structurally correct and GitHub Actions parses it correctly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- notify-pr-complete.yml now handles both same-repo and cross-repo completion events
- Phase 11 (notification pipeline) can rely on `status=cross_repo_pr_open` and `target_repo` fields in the webhook payload to build UX-appropriate messages
- Phase 12 regression verification can confirm both trigger paths produce correct payloads

---
*Phase: 10-actions-workflow-container-execution-cross-repo-pr*
*Completed: 2026-02-26*
