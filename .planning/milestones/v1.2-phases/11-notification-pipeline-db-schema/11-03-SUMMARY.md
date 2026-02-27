---
phase: 11-notification-pipeline-db-schema
plan: "03"
subsystem: job-status
tags: [db, sqlite, drizzle, github-api, job-status, agent-tools]
dependency_graph:
  requires: ["11-01"]
  provides: ["completed job lookup via get_job_status"]
  affects: ["lib/tools/github.js", "lib/ai/tools.js"]
tech_stack:
  added: []
  patterns: ["DB overlay on live API path", "non-fatal try/catch for DB errors"]
key_files:
  created: []
  modified:
    - lib/tools/github.js
    - lib/ai/tools.js
decisions:
  - "DB overlay fires only when jobId provided AND filteredRuns.length === 0 — live path fully unchanged"
  - "DB errors are non-fatal: caught, logged, and fallthrough to original return"
  - "Completed job return shape adds outcome_status, pr_url, target_repo, log_summary alongside status: 'completed'"
metrics:
  duration: "2 min"
  completed: "2026-02-26"
  tasks: 2
  files: 2
---

# Phase 11 Plan 03: getJobStatus DB Overlay Summary

**One-liner:** Extended getJobStatus() with SQLite DB overlay that returns completed job outcomes (PR URL, target repo) when a specific job_id is not found in live GitHub Actions runs.

## What Was Built

Two targeted changes to close the gap where `get_job_status` returned nothing for completed jobs:

1. **`lib/tools/github.js`** — Added three imports (`getDb`, `jobOutcomes`, `eq`, `desc`) and a DB overlay block inside `getJobStatus()`. The block fires only when `jobId` is provided and `filteredRuns.length === 0` (not found in live runs). It queries `job_outcomes` via Drizzle, ordered by `createdAt desc`, and returns a structured completed-job response including `outcome_status`, `pr_url`, `target_repo`, and `log_summary`. Wrapped in try/catch — DB failures are non-fatal and logged.

2. **`lib/ai/tools.js`** — Updated `getJobStatusTool` description to inform the agent it can retrieve completed job outcomes (not just live runs), including PR URL and target repo. Guides the agent to use this tool for historical job queries.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `grep -n "getDb\|jobOutcomes\|outcome_status\|target_repo"` confirms all fields present in github.js
- `grep -n "completed job"` confirms updated description in tools.js at line 110
- DB overlay block position: after `runningCount`/`queuedCount` computation, before final `return`
- Live job path: untouched — same flow for `jobId=null` or `jobId` found in live runs

## Self-Check: PASSED

- lib/tools/github.js: FOUND
- lib/ai/tools.js: FOUND
- Commit 1c33bed: FOUND
- Commit e5a1554: FOUND
