---
phase: 11-notification-pipeline-db-schema
plan: "02"
subsystem: api
tags: [webhook, notification, telegram, slack, cross-repo]
dependency_graph:
  requires: [11-01]
  provides: [cross-repo-notification-routing]
  affects: [api/index.js]
tech_stack:
  added: []
  patterns: [thread-origin routing, dynamic import, platform guard]
key_files:
  created: []
  modified:
    - api/index.js
decisions:
  - "Dynamic import of sendMessage mirrors existing Slack WebClient pattern — no top-level import added"
  - "Telegram block placed after Slack block — both guarded by platform === check and token presence"
  - "targetRepo passed as null (not undefined) to saveJobOutcome() — consistent with Phase 11 P01 decision"
metrics:
  duration: 3
  completed: 2026-02-26
---

# Phase 11 Plan 02: Webhook target_repo Passthrough and Telegram Thread-Origin Routing Summary

**One-liner:** Added target_repo extraction from GitHub webhook payload, passed it to saveJobOutcome(), and wired Telegram thread-origin reply alongside existing Slack routing.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract target_repo from payload + pass to saveJobOutcome() | b793513 | api/index.js |
| 2 | Add Telegram thread-origin routing for job completions | b793513 | api/index.js |

## What Was Built

`handleGithubWebhook()` in `api/index.js` now:

1. Extracts `target_repo` from the webhook payload into the `results` object (`results.target_repo = payload.target_repo || ''`)
2. Passes `targetRepo: results.target_repo || null` to `saveJobOutcome()` so the value persists to the `job_outcomes.target_repo` column added in Plan 01
3. Routes job completion notifications to Telegram originating threads via `sendMessage()` — mirrors the existing Slack `postMessage()` pattern with identical guards (platform check, token presence, try/catch)

## Verification

- `target_repo` present in results object at line 268
- `targetRepo` present in `saveJobOutcome()` call at line 287
- Telegram block at lines 315-325: `platform === 'telegram'` guard, `TELEGRAM_BOT_TOKEN` check, dynamic `sendMessage` import, try/catch error handling
- Same-repo Slack flow unchanged

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `api/index.js` modified: confirmed
- Commit b793513: confirmed
