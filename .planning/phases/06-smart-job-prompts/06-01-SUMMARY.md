---
phase: 06-smart-job-prompts
plan: 01
subsystem: infra
tags: [bash, docker, entrypoint, prompt-engineering, claude-code, gsd]

# Dependency graph
requires:
  - phase: 05-pipeline-hardening
    provides: stable entrypoint.sh with preflight, observability, and zero-commit PR guard that this plan extends
provides:
  - Structured FULL_PROMPT with Target, Repository Documentation (Read-Only Reference), Stack, Task, and GSD Hint sections
  - Automatic CLAUDE.md injection (capped at 8000 chars / ~2000 tokens) with graceful fallback
  - package.json dependencies injected into Stack section with graceful fallback
  - GSD routing hint (quick/plan-phase) derived from task keywords
  - Byte-for-byte template sync of live entrypoint to templates/docker/job/entrypoint.sh
affects: [07-memory-persistence, all future job container runs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "printf '%s' for multi-line variable writes — prevents bash expansion of $() or backtick sequences in injected content"
    - "[ -f path ] gating all file reads in set -e scripts — bare cat on missing file exits the script"
    - "(.dependencies // {}) in jq — safe against repos with no dependencies key"
    - "head -c 8000 for token cap — byte-based truncation acceptable for ASCII-dominant CLAUDE.md files"
    - "Template sync: cp live → template, then diff to verify IDENTICAL — established in Phase 5"

key-files:
  created: []
  modified:
    - docker/job/entrypoint.sh
    - templates/docker/job/entrypoint.sh

key-decisions:
  - "CLAUDE.md injected at entrypoint side (cat /job/CLAUDE.md) not Event Handler pre-fetch — fresher, simpler, confirmed by v1.1 roadmap decision"
  - "8000 char cap (~2000 tokens) on CLAUDE.md injection — prevents prompt bloat for large documentation files"
  - "Dependencies only (not devDependencies) in Stack section — keeps prompt concise for large repos"
  - "GSD hint defaults to 'quick', upgrades to 'plan-phase' on keywords: implement|build|redesign|refactor|migrate|setup|integrate|develop|architect|phase|feature|epic|complex|end.to.end|full.system|multiple"
  - "REPO_SLUG derived from REPO_URL via sed — no additional API call needed"

patterns-established:
  - "Section numbering: new sections get lettered sub-sections (8b, 8c) to avoid renumbering downstream sections"
  - "Read-Only Reference framing: injected docs explicitly instructed not to be modified unless task requires it"

requirements-completed: [PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04]

# Metrics
duration: 5min
completed: 2026-02-25
---

# Phase 6 Plan 01: Smart Job Prompts Summary

**Structured FULL_PROMPT injecting CLAUDE.md docs (8000-char cap), package.json stack, repo slug, and GSD routing hint so every Claude Code agent starts warm with full repo context**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-25T14:08:10Z
- **Completed:** 2026-02-25T14:13:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Replaced bare `# Your Job\n\n{task}` prompt with 5-section structured template (Target, Repository Documentation, Stack, Task, GSD Hint)
- CLAUDE.md is read from `/job/CLAUDE.md`, capped at 8000 chars with [TRUNCATED] marker, wrapped in Read-Only Reference framing
- package.json runtime dependencies (not devDeps) listed in Stack section; both sections fall back gracefully with [not present] messages when files are absent
- GSD routing hint derived from task keywords — defaults to `quick`, upgrades to `plan-phase` on multi-step implementation keywords
- Repo slug extracted from REPO_URL without extra API calls
- Template sync: `templates/docker/job/entrypoint.sh` is byte-for-byte identical to `docker/job/entrypoint.sh`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add repo context reads, GSD hint derivation, and structured FULL_PROMPT template** - `27d2a13` (feat)
2. **Task 2: Sync template entrypoint and verify byte-for-byte match** - `a077f72` (chore)

**Plan metadata:** *(final docs commit to follow)*

## Files Created/Modified

- `docker/job/entrypoint.sh` - Added sections 8b (CLAUDE.md + package.json reads), 8c (GSD hint derivation), replaced section 11 FULL_PROMPT with structured 5-section template
- `templates/docker/job/entrypoint.sh` - Byte-for-byte sync of live entrypoint

## Decisions Made

- CLAUDE.md capped at 8000 chars (not tokens) using `head -c 8000` — byte-based is acceptable for ASCII-dominant CLAUDE.md files
- devDependencies excluded from Stack section — production deps sufficient, keeps prompt concise for large repos
- GSD hint keyword list covers the most common multi-step triggers without being so broad it overrides simple tasks
- `REPO_SLUG:-unknown` safety fallback in case REPO_URL is somehow empty (set -e active, defensive coding)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Changes take effect on next Docker image build.

## Next Phase Readiness

- Phase 6 Plan 01 complete — agents now start warm with full repo context
- Phase 7 (Memory Persistence) can proceed: job_outcomes schema design for thread-scoped memory
- Blocker still active: confirm `notify-pr-complete.yml` live webhook payload field names before generating Drizzle migration (inspect a real webhook payload during Phase 6 testing)

---
*Phase: 06-smart-job-prompts*
*Completed: 2026-02-25*

## Self-Check: PASSED

- FOUND: docker/job/entrypoint.sh
- FOUND: templates/docker/job/entrypoint.sh
- FOUND: .planning/phases/06-smart-job-prompts/06-01-SUMMARY.md
- FOUND: commit 27d2a13 (Task 1)
- FOUND: commit a077f72 (Task 2)
