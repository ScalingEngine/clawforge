---
phase: 08-polish-test-sync
plan: 01
subsystem: notification-pipeline
tags: [notifications, failure-stage, workflow, template-sync]
dependency_graph:
  requires: []
  provides: [failure_stage_in_notifications, explicit_jsonl_lookup]
  affects: [api/index.js, lib/ai/index.js, .github/workflows/notify-pr-complete.yml, templates/.github/workflows/notify-pr-complete.yml]
tech_stack:
  added: []
  patterns: [conditional-filter-boolean, explicit-filename-lookup]
key_files:
  created: []
  modified:
    - api/index.js
    - lib/ai/index.js
    - .github/workflows/notify-pr-complete.yml
    - templates/.github/workflows/notify-pr-complete.yml
decisions:
  - "failure_stage surfaced in summarizeJob userMessage using existing .filter(Boolean) pattern — no system prompt changes needed"
  - "Template synced byte-for-byte via cp, not manually — eliminates drift risk"
metrics:
  duration: 72s
  completed: 2026-02-25
  tasks: 2
  files: 4
---

# Phase 08 Plan 01: Failure Stage Notification and JSONL Wildcard Fix Summary

**One-liner:** failure_stage field flows from webhook payload through results object into summarizeJob LLM context, and notify-pr-complete.yml now uses explicit gsd-invocations.jsonl lookup instead of fragile *.jsonl wildcard.

## What Was Built

Two targeted runtime behaviour fixes addressing FINDING-1 from the v1.1 milestone audit:

1. **failure_stage in notifications** — `failure_stage` (docker_pull/auth/claude) was correctly computed and transmitted in the webhook payload but never rendered in Slack/Telegram notifications. The field now flows from the webhook payload into the `results` object in `handleGithubWebhook`, then into the LLM's `userMessage` as a `## Failure Stage` section. The model now has explicit context to include the failure stage in its summary.

2. **Explicit JSONL lookup** — `notify-pr-complete.yml` used `find -name "*.jsonl"` which depends on inode creation order. When both `gsd-invocations.jsonl` and `claude-output.jsonl` exist in the log directory, the wrong file could be selected. Changed to `find -name "gsd-invocations.jsonl"` with `head -1` guard retained. Template synced byte-for-byte.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Surface failure_stage in notification messages | dbee7b4 | api/index.js, lib/ai/index.js |
| 2 | Fix JSONL wildcard and sync template | 8a01e47 | .github/workflows/notify-pr-complete.yml, templates/.github/workflows/notify-pr-complete.yml |

## Decisions Made

- **failure_stage field placement:** Added after `status` in the results object — consistent with payload field ordering. In `summarizeJob` userMessage, placed after `## Status` section so the LLM sees failure context immediately after the overall status.
- **No system prompt modification:** Field names are self-explanatory to the LLM. `## Failure Stage\ndocker_pull` is sufficient for the model to incorporate the stage into its summary narrative.
- **Template sync via cp:** Used `cp` rather than manual edit to guarantee byte-for-byte identity and eliminate future drift risk.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

All four verification checks passed:
1. `grep -n "failure_stage" api/index.js` — line 263: `failure_stage: payload.failure_stage || '',`
2. `grep -n "failure_stage" lib/ai/index.js` — line 250: conditional `## Failure Stage` section
3. `grep "gsd-invocations.jsonl" .github/workflows/notify-pr-complete.yml` — explicit filename in find command
4. `diff .github/workflows/notify-pr-complete.yml templates/.github/workflows/notify-pr-complete.yml` — empty (identical)

## Self-Check: PASSED

Files exist:
- FOUND: api/index.js (modified)
- FOUND: lib/ai/index.js (modified)
- FOUND: .github/workflows/notify-pr-complete.yml (modified)
- FOUND: templates/.github/workflows/notify-pr-complete.yml (modified)

Commits exist:
- FOUND: dbee7b4 (feat(08-01): surface failure_stage in job failure notifications)
- FOUND: 8a01e47 (fix(08-01): use explicit gsd-invocations.jsonl name instead of fragile *.jsonl wildcard)
