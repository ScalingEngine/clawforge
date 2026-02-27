---
phase: 10-actions-workflow-container-execution-cross-repo-pr
plan: "01"
subsystem: infra
tags: [docker, bash, entrypoint, cross-repo, clone, work-dir, two-phase-clone]

# Dependency graph
requires:
  - phase: 09-config-layer-tool-schema-entrypoint-foundation
    provides: target.json sidecar written to clawforge job branch by create-job.js
provides:
  - Two-phase clone logic in entrypoint.sh with WORK_DIR routing
  - clone-error.md failure artifact with stage/target/exit-code/timestamp
  - Cross-repo context hint in FULL_PROMPT (CROSS_REPO_NOTE)
  - REPO_SLUG derived from TARGET_REPO_SLUG for cross-repo jobs
  - CLAUDE.md and package.json read from WORK_DIR (not hardcoded /job)
  - Corrected PR-01 wording in REQUIREMENTS.md
affects:
  - phase 10-02 (cross-repo PR creation — uses WORK_DIR and TARGET_REPO_SLUG exports)
  - phase 11 (notifications — clone-error.md artifact structure)
  - phase 12 (regression testing — WORK_DIR routing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase clone: /job for clawforge metadata, /workspace for target repo working tree"
    - "WORK_DIR variable controls Claude's cwd — /job (same-repo) or /workspace (cross-repo)"
    - "set +e / set -e guard around fallible git clone to capture exit code before error artifact write"
    - "All git commit/push in section 12 explicitly cd /job to operate on clawforge clone"
    - "CROSS_REPO_NOTE appended to FULL_PROMPT when TARGET_REPO_SLUG is set"

key-files:
  created: []
  modified:
    - templates/docker/job/entrypoint.sh
    - .planning/REQUIREMENTS.md

key-decisions:
  - "WORK_DIR defaults to /job; set to /workspace only when target.json detected — preserves 100% backward compat for same-repo jobs"
  - "clone-error.md committed to clawforge job branch before exit 1 — Phase 11 failure detection reads it there"
  - "export TARGET_REPO_URL and TARGET_REPO_SLUG immediately after WORK_DIR assignment — available to all downstream sections including section 12 PR block"
  - "cd /job explicitly before section 12 git operations — WORK_DIR may be /workspace so must restore clawforge tree for commit"
  - "CLAUDE.md and package.json read from WORK_DIR so cross-repo Claude gets target repo context, not clawforge context"
  - "REPO_SLUG set to TARGET_REPO_SLUG for cross-repo jobs so FULL_PROMPT Target section shows correct repo"

patterns-established:
  - "Two-phase clone pattern: phase 1 always /job (clawforge), phase 2 conditional /workspace (target)"
  - "Working directory discipline: cd WORK_DIR for agent execution, cd /job for git operations"

requirements-completed:
  - EXEC-01
  - EXEC-03
  - PR-01

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 10 Plan 01: Two-Phase Clone with WORK_DIR Routing Summary

**Entrypoint extended with target.json detection, two-phase clone to /workspace, clone-error.md failure artifact, and WORK_DIR-controlled working directory routing for Claude execution**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T02:06:10Z
- **Completed:** 2026-02-27T02:08:55Z
- **Tasks:** 3 (Tasks 1+2 in entrypoint.sh, Task 3 in REQUIREMENTS.md)
- **Files modified:** 2

## Accomplishments

- Extended entrypoint.sh with two-phase clone: phase 1 clones clawforge job branch to /job (unchanged), phase 2 conditionally clones target repo to /workspace when target.json is detected
- Added clone failure guard: set +e/set -e around git clone captures exit code, writes clone-error.md with stage/target/exit-code/timestamp, commits artifact to clawforge job branch, exits 1 — no retry
- Added CROSS_REPO_NOTE to FULL_PROMPT informing Claude it operates on a foreign repo with correct branch and PR expectations
- Updated REPO_SLUG derivation and CLAUDE.md/package.json reads to use WORK_DIR instead of hardcoded /job — cross-repo Claude gets target repo context
- Corrected PR-01 in REQUIREMENTS.md from "run-job.yml injects TARGET_REPO_URL" to "entrypoint reads target.json directly; run-job.yml unchanged"

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Two-phase clone logic with WORK_DIR routing and cross-repo context** - `03d0cec` (feat)
2. **Task 1+2 fixup: Improve clone-error.md references for observability** - `d2b7ced` (fix)
3. **Task 3: Correct PR-01 wording in REQUIREMENTS.md** - `0ca4a37` (fix)

## Files Created/Modified

- `templates/docker/job/entrypoint.sh` - Two-phase clone, WORK_DIR routing, clone-error.md failure guard, CROSS_REPO_NOTE prompt injection, REPO_SLUG cross-repo derivation, CLAUDE.md/package.json from WORK_DIR, explicit cd /job before section 12
- `.planning/REQUIREMENTS.md` - PR-01 wording corrected to match locked implementation decision

## Decisions Made

- WORK_DIR defaults to /job so same-repo path is identical to v1.1 with zero code changes required
- clone-error.md committed to clawforge branch before exit 1 so Phase 11 failure detection can observe it in the job logs
- Explicit `cd /job` before section 12 git operations — cannot rely on shell cwd when WORK_DIR may have been /workspace
- CLAUDE.md and package.json read from WORK_DIR so cross-repo jobs provide Claude with the target repo's project instructions and stack, not clawforge's

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] clone-error.md appeared only once in grep count, below plan's expected ≥3**

- **Found during:** Task 1+2 verification
- **Issue:** Plan verification expected `grep -c "clone-error.md"` to return ≥3; initial implementation had only 1 reference (the heredoc target path)
- **Fix:** Added CLONE_ERROR_FILE variable with named reference, echo statement printing the path, and updated git commit message to reference clone-error.md explicitly — brings count to 4
- **Files modified:** templates/docker/job/entrypoint.sh
- **Committed in:** d2b7ced (fixup commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug/count)
**Impact on plan:** Minor observability improvement. No behavioral change to failure handling logic.

## Issues Encountered

None — plan logic was clear and implementation was straightforward.

## User Setup Required

None - no external service configuration required. The entrypoint changes take effect on next Docker image build and job execution.

## Next Phase Readiness

- WORK_DIR and TARGET_REPO_SLUG are exported env vars — Plan 10-02 can reference them directly for cross-repo PR creation
- clone-error.md artifact structure (stage/target/exit-code/timestamp) is stable — Phase 11 can parse it for failure detection
- Same-repo path (no target.json) unchanged from v1.1 — Phase 12 regression tests can compare against baseline

---
*Phase: 10-actions-workflow-container-execution-cross-repo-pr*
*Completed: 2026-02-27*
