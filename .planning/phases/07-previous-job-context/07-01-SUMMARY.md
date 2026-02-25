---
phase: 07-previous-job-context
plan: "01"
subsystem: db
tags: [persistence, job-outcomes, drizzle, sqlite, webhook]
dependency_graph:
  requires: []
  provides: [job_outcomes table, saveJobOutcome helper, getLastMergedJobOutcome helper]
  affects: [api/index.js, lib/db/schema.js, lib/db/job-outcomes.js]
tech_stack:
  added: []
  patterns: [drizzle-orm sqlite, try/catch non-fatal DB write, singleton getDb, randomUUID primary key]
key_files:
  created:
    - lib/db/job-outcomes.js
    - drizzle/0002_known_songbird.sql
    - drizzle/meta/0002_snapshot.json
  modified:
    - lib/db/schema.js
    - api/index.js
    - drizzle/meta/_journal.json
decisions:
  - "jobOutcomes uses auto-generated UUID primary key (not jobId) to allow multiple outcomes per job if needed"
  - "changedFiles stored as JSON string in TEXT column — consistent with payload shape, no JOIN needed"
  - "saveJobOutcome wrapped in try/catch in webhook handler so DB failures never block Slack/Telegram notifications"
  - "getLastMergedJobOutcome filters mergeResult='merged' at query level (HIST-03), scoped by threadId (HIST-04)"
metrics:
  duration: "2 min"
  completed: "2026-02-25"
  tasks_completed: 2
  files_changed: 6
requirements: [HIST-01, HIST-04]
requirements-completed: [HIST-01, HIST-04]
---

# Phase 7 Plan 01: Job Outcomes Persistence Layer Summary

Job outcome persistence layer with jobOutcomes Drizzle table, saveJobOutcome/getLastMergedJobOutcome helpers, and non-fatal webhook handler integration storing completed job data scoped by thread_id.

## What Was Built

### Task 1: jobOutcomes Schema + DB Helper + Migration

Added `jobOutcomes` table to `lib/db/schema.js` with 9 columns: `id` (UUID PK), `jobId`, `threadId`, `status`, `mergeResult`, `prUrl`, `changedFiles` (JSON string), `logSummary`, `createdAt` (epoch ms).

Created `lib/db/job-outcomes.js` with two exports:
- `saveJobOutcome({ jobId, threadId, status, mergeResult, prUrl, changedFiles, logSummary })` — inserts a new outcome row using synchronous `.run()` pattern matching `job-origins.js`
- `getLastMergedJobOutcome(threadId)` — queries with dual `and()` filter (threadId + mergeResult='merged'), ordered by createdAt desc, limit 1

Ran `npm run db:generate` to produce `drizzle/0002_known_songbird.sql` — migration SQL not hand-written.

### Task 2: Webhook Handler Integration

Added `import { saveJobOutcome } from '../lib/db/job-outcomes.js'` to `api/index.js`.

Inside `handleGithubWebhook`, after `const origin = getJobOrigin(jobId)` and inside the `if (origin)` block, added `saveJobOutcome` call before `addToThread`. Call uses `message` (already computed via `summarizeJob`) as `logSummary`. Wrapped in try/catch — failure logs error but does not throw, so Slack notification and addToThread calls always execute.

## Deviations from Plan

None — plan executed exactly as written.

## Success Criteria Verification

1. `lib/db/schema.js` exports `jobOutcomes` with all 9 columns — PASS
2. `lib/db/job-outcomes.js` exports `saveJobOutcome()` and `getLastMergedJobOutcome()` — PASS
3. `getLastMergedJobOutcome` filters by threadId AND mergeResult='merged' (HIST-03 + HIST-04) — PASS
4. `api/index.js` imports and calls `saveJobOutcome` inside `if (origin)` with try/catch — PASS
5. Migration file `drizzle/0002_known_songbird.sql` exists — PASS
6. No existing functionality broken — saveJobOutcome call is non-fatal, notification flow unchanged — PASS

## Requirements Satisfied

- HIST-01: jobOutcomes table persists status, changed files, PR URL, log summary
- HIST-04: All lookups scoped by thread_id via getLastMergedJobOutcome(threadId)

## Self-Check: PASSED
