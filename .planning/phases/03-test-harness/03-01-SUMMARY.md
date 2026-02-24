---
phase: 03-test-harness
plan: 01
subsystem: testing
tags: [docker, bash, gsd, test-harness, jsonl, claude-code]

# Dependency graph
requires:
  - phase: 02-output-observability
    provides: gsd-invocations.jsonl PostToolUse hook and LOG_DIR export pattern
provides:
  - Local Docker test harness that proves GSD chain end-to-end without production credentials
  - tests/test-job.sh single-command operator runner
  - tests/test-entrypoint.sh bypass entrypoint (no git clone/push/PR)
  - tests/validate-output.sh assertion against gsd-invocations.jsonl
  - Fixture files with imperative GSD invocation language
affects: [04-polish, future-phases]

# Tech tracking
tech-stack:
  added: []
  patterns: [test-entrypoint-bypass, bind-mount-fixtures, jsonl-assertion]

key-files:
  created:
    - tests/test-job.sh
    - tests/test-entrypoint.sh
    - tests/validate-output.sh
    - tests/fixtures/gsd-test-job.md
    - tests/fixtures/AGENT.md
    - tests/fixtures/SOUL.md
  modified:
    - .gitignore

key-decisions:
  - "Use dedicated test-entrypoint.sh bypass rather than modifying production entrypoint with test-mode flags"
  - "Bind-mount test-entrypoint.sh at runtime (-v) rather than copying into Docker image to avoid Dockerfile changes"
  - "Assert against gsd-invocations.jsonl (Phase 2 PostToolUse hook output) not tool-usage.json (never built)"
  - "Fixture AGENT.md uses imperative MUST language to maximize GSD invocation reliability (~50% without it)"

patterns-established:
  - "Test entrypoint bypass: replicate production steps 6-12a without git clone/push/PR"
  - "LOG_DIR export must precede claude -p in any entrypoint variant (hook reads process.env.LOG_DIR)"
  - "Fixture imperative language: MUST use Skill tool / MUST use Skill('gsd:quick') for reliable invocation"

requirements-completed: [TEST-01]

# Metrics
duration: 2min
completed: 2026-02-24
---

# Phase 3 Plan 1: Test Harness Summary

**Local Docker test harness with 6 new files: bash runner, bypass entrypoint, JSONL asserter, and 3 imperative fixtures proving GSD chain without GitHub credentials**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-24T14:12:02Z
- **Completed:** 2026-02-24T14:14:35Z
- **Tasks:** 2
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments

- Created `tests/test-job.sh` — single operator command that builds Docker image, runs test container with bind mounts, validates output
- Created `tests/test-entrypoint.sh` — bypass entrypoint that replicates production steps 6-12a (setup LOG_DIR, preflight, run claude -p, generate observability.md) without any git clone/push/PR operations
- Created `tests/validate-output.sh` — assertion script that exits 1 when gsd-invocations.jsonl missing or empty, exits 0 with skill listing when records found
- Created 3 fixture files with imperative "MUST use Skill tool" language to maximize GSD invocation reliability
- Added `tests/output/` to .gitignore so test artifacts are never committed

## Task Commits

Each task was committed atomically:

1. **Task 1: Create fixture files and test-entrypoint.sh bypass** - `ac6b1e2` (feat)
2. **Task 2: Create test-job.sh runner, validate-output.sh, and update .gitignore** - `1ce2edc` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `tests/test-job.sh` - Operator-facing runner: docker build + docker run with bind mounts + validate-output.sh call
- `tests/test-entrypoint.sh` - Bypass entrypoint: exports LOG_DIR, reads fixtures from /fixtures/, runs claude -p with full tool whitelist, generates observability.md
- `tests/validate-output.sh` - Assertion script: checks gsd-invocations.jsonl, exits 1 on empty/missing, exits 0 with invocation list on success
- `tests/fixtures/gsd-test-job.md` - Synthetic job requiring Skill("gsd:quick") with imperative MUST language
- `tests/fixtures/AGENT.md` - Minimal agent instructions with imperative "MUST use Skill tool" directive
- `tests/fixtures/SOUL.md` - Minimal test agent identity
- `.gitignore` - Added `tests/output/` entry

## Decisions Made

- **test-entrypoint.sh bypass over production entrypoint modification:** Adding test-mode flags to entrypoint.sh creates maintenance burden. The bypass script proves Docker image configuration works without contaminating production code.
- **Bind-mount test-entrypoint.sh at runtime:** Avoids Dockerfile changes — operator can iterate on the test entrypoint without rebuilding the image.
- **Assert against gsd-invocations.jsonl:** The ROADMAP says "tool-usage.json" but Phase 2 delivered gsd-invocations.jsonl via PostToolUse hook. tool-usage.json was never built. Asserting against gsd-invocations.jsonl is correct per Phase 2 implementation.
- **Imperative fixture language:** Research shows ~50% GSD invocation rate with advisory language. MUST language in both AGENT.md and gsd-test-job.md is required for deterministic test behavior.

## Deviations from Plan

One minor deviation:

**1. [Rule 1 - Bug] Fixed AGENT.md wording to match verify check**
- **Found during:** Task 1 verification
- **Issue:** AGENT.md said "MUST use the Skill tool" but the plan's automated verify check uses `grep -q "MUST use Skill tool"` (without "the") — grep would not match
- **Fix:** Changed "MUST use the Skill tool" to "MUST use Skill tool" — both are grammatically acceptable and the imperative intent is preserved
- **Files modified:** tests/fixtures/AGENT.md
- **Verification:** `grep -q "MUST use Skill tool" tests/fixtures/AGENT.md` returns match; full Task 1 verify check returns PASS
- **Committed in:** ac6b1e2 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix required for verification to pass; no scope creep.

## Issues Encountered

None beyond the AGENT.md wording fix documented above.

## User Setup Required

**Running the test requires a real ANTHROPIC_API_KEY.** No other production credentials needed.

```bash
ANTHROPIC_API_KEY=sk-... bash tests/test-job.sh
```

The test consumes approximately $0.01-0.05 in API credits per run. No GitHub token, Slack webhook, or repo access required.

## Next Phase Readiness

- Full GSD chain can now be validated locally without Slack round-trips or GitHub Actions runs
- Test harness ready to run: `ANTHROPIC_API_KEY=sk-... bash tests/test-job.sh`
- Phase 3 complete — TEST-01 requirement satisfied

## Self-Check: PASSED

All created files verified present on disk:
- FOUND: tests/test-job.sh
- FOUND: tests/test-entrypoint.sh
- FOUND: tests/validate-output.sh
- FOUND: tests/fixtures/gsd-test-job.md
- FOUND: tests/fixtures/AGENT.md
- FOUND: tests/fixtures/SOUL.md
- FOUND: .planning/phases/03-test-harness/03-01-SUMMARY.md

All task commits verified in git log:
- FOUND: ac6b1e2 (Task 1)
- FOUND: 1ce2edc (Task 2)

---
*Phase: 03-test-harness*
*Completed: 2026-02-24*
