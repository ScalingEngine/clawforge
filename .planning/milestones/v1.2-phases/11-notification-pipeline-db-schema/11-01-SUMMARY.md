---
phase: 11-notification-pipeline-db-schema
plan: "01"
subsystem: db
tags: [sqlite, drizzle, schema, migration, job-outcomes]
dependency_graph:
  requires: []
  provides: [job_outcomes.target_repo column, saveJobOutcome targetRepo param]
  affects: [lib/db/schema.js, lib/db/job-outcomes.js, drizzle migrations]
tech_stack:
  added: []
  patterns: [drizzle-kit generate for migrations, nullable column with explicit ?? null in .values()]
key_files:
  created:
    - drizzle/0003_careful_anthem.sql
    - drizzle/meta/0003_snapshot.json
  modified:
    - lib/db/schema.js
    - lib/db/job-outcomes.js
    - drizzle/meta/_journal.json
decisions:
  - "Migration generated via drizzle-kit (not hand-written) to keep journal consistent"
  - "targetRepo stored as explicit null (not undefined) in .values() to avoid silent field drop"
metrics:
  duration: 3
  completed: 2026-02-26
---

# Phase 11 Plan 01: DB Schema — target_repo Column Summary

**One-liner:** Added nullable target_repo column to job_outcomes SQLite table via drizzle-kit migration and updated saveJobOutcome() to persist it.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add targetRepo column to schema and generate migration | 41ae706 | lib/db/schema.js, drizzle/0003_careful_anthem.sql, drizzle/meta/* |
| 2 | Update saveJobOutcome() to persist targetRepo | cf0f22c | lib/db/job-outcomes.js |

## What Was Built

- `lib/db/schema.js`: Added `targetRepo: text('target_repo')` to jobOutcomes table after prUrl — no .notNull(), no .default(), fully nullable
- `drizzle/0003_careful_anthem.sql`: Generated migration containing `ALTER TABLE job_outcomes ADD target_repo text;`
- `lib/db/job-outcomes.js`: Updated saveJobOutcome() with targetRepo in JSDoc, parameter destructuring, and .values() as `targetRepo: targetRepo ?? null`
- `getLastMergedJobOutcome()` unchanged — intentional, cross-repo outcomes should not feed prior job context

## Verification

1. `npm run db:generate` ran successfully — produced drizzle/0003_careful_anthem.sql (not hand-written)
2. drizzle/meta/_journal.json now has 4 entries (idx 0-3)
3. lib/db/schema.js shows `targetRepo: text('target_repo')` — no .notNull(), no .default()
4. lib/db/job-outcomes.js saveJobOutcome() signature and .values() both include targetRepo
5. getLastMergedJobOutcome() unchanged

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- lib/db/schema.js: targetRepo column present
- drizzle/0003_careful_anthem.sql: exists, contains ALTER TABLE
- lib/db/job-outcomes.js: targetRepo in destructuring and .values()
- Commits 41ae706 and cf0f22c verified
