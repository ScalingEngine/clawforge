---
phase: 01-foundation-fix
plan: 01
subsystem: infra
tags: [docker, entrypoint, bash, claude-cli, gitignore, security]

# Dependency graph
requires:
  - phase: none
    provides: first plan in project
provides:
  - "Fixed claude -p stdin pipe invocation (no more 'Input must be provided' error)"
  - "Preflight diagnostics block writing preflight.md to job logs"
  - "GSD runtime verification with fail-fast exit 1"
  - ".env.vps excluded from git tracking"
affects: [01-02, phase-2-observability]

# Tech tracking
tech-stack:
  added: []
  patterns: ["stdin pipe for claude -p prompt delivery", "preflight.md diagnostic artifact per job", "fail-fast GSD directory check"]

key-files:
  created: []
  modified: [".gitignore", "docker/job/entrypoint.sh"]

key-decisions:
  - "Use printf stdin pipe instead of positional argument for claude -p prompt delivery"
  - "Fail-fast exit 1 on missing GSD rather than running claude without GSD capabilities"
  - "Use ${HOME} not /root/ in entrypoint for future-proofing against USER directive changes"

patterns-established:
  - "stdin pipe: printf '%s' \"${FULL_PROMPT}\" | claude -p (avoids shell parsing of multi-line strings)"
  - "preflight artifact: every job writes preflight.md to LOG_DIR before execution"
  - "diagnostic logging: FULL_PROMPT length logged before invocation for debugging empty prompts"

requirements-completed: [SECR-01, FOUND-01, FOUND-02, OBSV-01]

# Metrics
duration: 1min
completed: 2026-02-24
---

# Phase 1 Plan 1: Fix Prompt Delivery Summary

**Fixed claude -p prompt delivery via stdin pipe, added preflight diagnostics writing preflight.md, GSD runtime fail-fast check, and locked .env.vps out of git**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-24T04:32:44Z
- **Completed:** 2026-02-24T04:34:09Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed the critical "Input must be provided" bug by switching from positional argument to stdin pipe for claude -p
- Added preflight diagnostic block that logs HOME, claude path, GSD directory, and working directory to both Actions log and preflight.md artifact
- Added GSD runtime verification that exits 1 immediately if GSD is not installed, preventing wasted tokens
- Locked .env.vps out of git tracking in the credentials block of .gitignore

## Task Commits

Each task was committed atomically:

1. **Task 1: Add .env.vps to .gitignore and fix prompt delivery via stdin pipe** - `2412049` (fix)
2. **Task 2: Add preflight diagnostic block and GSD runtime verification** - `c38b737` (feat)

## Files Created/Modified
- `.gitignore` - Added .env.vps to credentials exclusion block
- `docker/job/entrypoint.sh` - Fixed claude -p stdin pipe, added preflight block with diagnostics and GSD verification

## Decisions Made
- Used printf stdin pipe instead of positional argument for claude -p prompt delivery - this avoids shell parsing issues with multi-line strings that caused the "Input must be provided" error
- Chose fail-fast exit 1 on missing GSD directory rather than continuing without GSD capabilities - prevents wasting API tokens on jobs that cannot use GSD workflows
- Used ${HOME} instead of /root/ throughout the preflight block for future-proofing against Docker USER directive changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Prompt delivery is fixed; jobs should no longer produce "Input must be provided" errors
- Preflight diagnostics will make every job self-documenting via preflight.md
- Ready for 01-02 (build-time GSD verification in Dockerfile and template sync)
- The entrypoint.sh changes here will need to be synced to templates/docker/job/entrypoint.sh in plan 01-02

## Self-Check: PASSED

- [x] .gitignore exists and contains .env.vps
- [x] docker/job/entrypoint.sh exists with stdin pipe and preflight block
- [x] 01-01-SUMMARY.md created
- [x] Commit 2412049 exists (Task 1)
- [x] Commit c38b737 exists (Task 2)

---
*Phase: 01-foundation-fix*
*Completed: 2026-02-24*
