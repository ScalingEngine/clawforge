---
phase: 04-instruction-hardening
plan: 01
subsystem: infra
tags: [gsd, agent-instructions, claude-code, docker, imperative-language]

# Dependency graph
requires:
  - phase: 03-test-harness
    provides: fixture AGENT.md with imperative MUST language pattern proven to produce reliable GSD invocations
provides:
  - instances/noah/config/AGENT.md updated with imperative GSD usage block
  - instances/strategyES/config/AGENT.md updated with imperative GSD usage block
  - PROJECT.md Key Decisions table entry documenting the advisory-to-imperative change and TEST-02 baseline
affects: [phase 04 verification runs, any future AGENT.md edits, TEST-02 requirement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Imperative MUST language in AGENT.md GSD sections — hard requirement, not advisory default"
    - "Dedicated 'GSD Usage — Required Behavior' section separates required behavior from command reference"

key-files:
  created: []
  modified:
    - instances/noah/config/AGENT.md
    - instances/strategyES/config/AGENT.md
    - .planning/PROJECT.md

key-decisions:
  - "Use 'MUST use the Skill tool' imperative phrasing from Phase 3 test fixture pattern — matches what produced consistent invocations in harness"
  - "Add explicit 'GSD Usage — Required Behavior' section as a named structural block, not inline text — makes the requirement visually distinct"
  - "Preserve full /gsd:* command reference verbatim — the listing is the reference, the new section is the behavioral mandate"
  - "Baseline documented as untested against live runs — honest about ~50% figure being community research (LOW confidence), not measured production data"

patterns-established:
  - "Imperative block pattern: 'You MUST use the Skill tool to invoke GSD commands for all substantial tasks. Do NOT use Write, Edit, or Bash directly.'"
  - "Structural separation: command reference (what exists) vs required behavior block (how to use it)"

requirements-completed: [TEST-02]

# Metrics
duration: 1min
completed: 2026-02-24
---

# Phase 4 Plan 01: Instruction Hardening Summary

**Imperative "MUST use Skill tool" GSD language replacing advisory "Default choice" text in both production AGENT.md files, with TEST-02 baseline documented in PROJECT.md**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-24T17:54:00Z
- **Completed:** 2026-02-24T17:55:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Both `instances/noah/config/AGENT.md` and `instances/strategyES/config/AGENT.md` now use imperative "MUST use the Skill tool" language in a dedicated "GSD Usage — Required Behavior" section
- The advisory "Default choice:" line that produced ~50% GSD invocation reliability per Phase 3 research is removed from both files
- Full `/gsd:*` command reference (all 7 ### subsections, 20+ commands) preserved verbatim in both files
- PROJECT.md Key Decisions table extended with 4th row documenting the Phase 4 change, the ~50% baseline rationale, and TEST-02 satisfaction

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace advisory GSD language with imperative in both AGENT.md files** - `1ed557b` (feat)
2. **Task 2: Document baseline and imperative language decision in PROJECT.md** - `6041c04` (feat)

## Files Created/Modified

- `instances/noah/config/AGENT.md` - GSD section header strengthened with MUST, advisory closing line replaced with imperative "GSD Usage — Required Behavior" block
- `instances/strategyES/config/AGENT.md` - Same two edits as noah; Tech Stack and Scope sections above GSD section left untouched
- `.planning/PROJECT.md` - 4th row added to Key Decisions table: advisory-to-imperative change with ~50% baseline, TEST-02 outcome

## Decisions Made

- Used the exact imperative pattern from `tests/fixtures/AGENT.md` (the Phase 3 test fixture that produced consistent invocations): "You MUST use the Skill tool to invoke GSD commands for all substantial tasks. Do NOT use Write, Edit, or Bash directly to accomplish multi-step work."
- Added a named structural section "GSD Usage — Required Behavior" to make the mandate visually distinct from the command reference listing
- Documented baseline as "untested against live production runs" — honest about the ~50% figure being community research (LOW confidence), not measured production data from this project's actual runs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both production AGENT.md files now contain the imperative GSD pattern that the Phase 3 test fixture used
- TEST-02 requirement is satisfied (imperative language applied)
- Ready for Phase 4 live verification: run a real job against one instance to confirm GSD invocations appear in gsd-invocations.jsonl
- No blockers

## Self-Check: PASSED

- FOUND: instances/noah/config/AGENT.md
- FOUND: instances/strategyES/config/AGENT.md
- FOUND: .planning/PROJECT.md
- FOUND: .planning/phases/04-instruction-hardening/04-01-SUMMARY.md
- FOUND commit: 1ed557b
- FOUND commit: 6041c04

---
*Phase: 04-instruction-hardening*
*Completed: 2026-02-24*
