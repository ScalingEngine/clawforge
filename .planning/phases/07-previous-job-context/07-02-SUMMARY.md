---
phase: 07-previous-job-context
plan: "02"
subsystem: ai
tags: [langchain, tools, context-enrichment, sqlite, drizzle, job-description]

requires:
  - phase: 07-previous-job-context/07-01
    provides: [job_outcomes table, getLastMergedJobOutcome helper]
provides:
  - Prior context enrichment in createJobTool — follow-up jobs get ## Prior Job Context prepended
affects: [lib/ai/tools.js, job pipeline]

tech-stack:
  added: []
  patterns: [prior-context enrichment before job creation, non-fatal DB lookup with try/catch, enriched description passthrough]

key-files:
  created: []
  modified:
    - lib/ai/tools.js

key-decisions:
  - "threadId extracted before createJob call so enrichment can run before job is dispatched"
  - "Non-fatal try/catch around prior context lookup — DB errors never block job creation"
  - "Prior context prepended as markdown section with ---  separator for clear delineation"
  - "changedFiles parsed with JSON.parse(prior.changedFiles || '[]') — handles empty string and valid JSON safely"

patterns-established:
  - "Enrichment pattern: lookup → build section → prepend to description → pass enrichedDescription to createJob"
  - "filter(Boolean) on context array removes empty lines when changedFiles or logSummary are absent"

requirements-completed: [HIST-02, HIST-03, HIST-04]

duration: 3min
completed: 2026-02-25
---

# Phase 7 Plan 02: Agent Context Injection Summary

**Prior merged job outcome injected into follow-up job descriptions via ## Prior Job Context markdown section, scoped by thread_id, with non-fatal fallback**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-25T00:00:00Z
- **Completed:** 2026-02-25T00:03:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Modified `createJobTool` in `lib/ai/tools.js` to look up the most recent merged job outcome for the current thread before creating a new job
- Built prior context markdown section with PR URL, status, merge result, changed files list, and log summary
- Enriched description passed to `createJob` so every follow-up job in a thread starts warm — agents know what the previous agent accomplished
- Non-fatal try/catch ensures DB lookup errors never block job creation; falls back to original description silently
- `saveJobOrigin` flow preserved unchanged — notifications still route correctly after the job is created

## Task Commits

Each task was committed atomically:

1. **Task 1: Add prior context lookup and injection to createJobTool** - `a0d8842` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `lib/ai/tools.js` — Added `getLastMergedJobOutcome` import, moved `threadId` extraction before `createJob`, added enrichment block, changed `createJob` call to use `enrichedDescription`

## Decisions Made

- Moved `threadId` extraction to before `createJob` so enrichment can use it without duplicating the variable declaration
- Non-fatal try/catch is the right pattern here — same as `saveJobOrigin` below it; DB failures should never block the user's job
- Prior context uses markdown with `---` separator so the LLM clearly delineates context from actual task description
- `filter(Boolean)` on context array keeps output clean when changedFiles is empty or logSummary is absent

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 7 (Previous Job Context) is now complete — both plans delivered
- 07-01 built the persistence layer (jobOutcomes table, saveJobOutcome, getLastMergedJobOutcome)
- 07-02 closed the continuity loop — follow-up jobs now receive prior context automatically
- Milestone v1.1 (Agent Intelligence & Pipeline Hardening) is complete across all 7 phases

---
*Phase: 07-previous-job-context*
*Completed: 2026-02-25*

## Self-Check: PASSED
