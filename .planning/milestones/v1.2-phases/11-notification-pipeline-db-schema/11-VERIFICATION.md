---
phase: 11-notification-pipeline-db-schema
verified: 2026-02-26T00:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 11: Notification Pipeline + DB Schema Verification Report

**Phase Goal:** Cross-repo job completions reach the user via Slack/Telegram with the correct target repo PR URL, and outcomes are recorded with target repo attribution
**Verified:** 2026-02-26
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | job_outcomes table has a nullable target_repo column | VERIFIED | `lib/db/schema.js` line 58: `targetRepo: text('target_repo'),` — no .notNull(), no .default() |
| 2 | saveJobOutcome() accepts and persists targetRepo without silent field dropping | VERIFIED | `lib/db/job-outcomes.js` line 19: param destructuring includes targetRepo; line 30: `.values()` includes `targetRepo: targetRepo ?? null` |
| 3 | Migration generated via drizzle-kit (not hand-written) | VERIFIED | `drizzle/0003_careful_anthem.sql` exists; contains `ALTER TABLE job_outcomes ADD target_repo text;` — auto-named file confirms drizzle-kit generation |
| 4 | Cross-repo webhook payload flows through: results extraction, saveJobOutcome (with targetRepo), platform notification | VERIFIED | `api/index.js` line 268: `target_repo: payload.target_repo \|\| ''`; line 287: `targetRepo: results.target_repo \|\| null` passed to saveJobOutcome() |
| 5 | Telegram thread-origin routing is wired alongside existing Slack routing | VERIFIED | `api/index.js` lines 314-326: `platform === 'telegram'` guard, TELEGRAM_BOT_TOKEN check, dynamic sendMessage import, try/catch |
| 6 | Same-repo Slack notifications unaffected | VERIFIED | Slack block lines 299-312 unchanged; guarded by `platform === 'slack'` — no interference |
| 7 | getJobStatus() for completed cross-repo job returns target repo PR URL from DB | VERIFIED | `lib/tools/github.js` lines 126-157: DB overlay fires when `jobId && filteredRuns.length === 0`; returns `target_repo: outcome.targetRepo \|\| null` |
| 8 | getJobStatus() for running job still hits GitHub Actions API | VERIFIED | DB overlay block is guarded by `filteredRuns.length === 0` — live path fully unchanged |
| 9 | get_job_status tool description mentions completed job outcomes and target_repo | VERIFIED | `lib/ai/tools.js` line 110: description includes "completed job outcomes", "PR URL", "target repo if applicable" |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/db/schema.js` | jobOutcomes table with nullable targetRepo column | VERIFIED | Line 58: `targetRepo: text('target_repo'),` — nullable, no constraints |
| `lib/db/job-outcomes.js` | saveJobOutcome() with targetRepo in signature and .values() | VERIFIED | Lines 19, 30: both destructuring and .values() include targetRepo |
| `drizzle/0003_careful_anthem.sql` | ALTER TABLE migration adding target_repo column | VERIFIED | Contains `ALTER TABLE job_outcomes ADD target_repo text;` |
| `api/index.js` | handleGithubWebhook() with target_repo passthrough + Telegram routing | VERIFIED | Lines 268, 287, 314-326 all wired correctly |
| `lib/tools/github.js` | getJobStatus() with DB overlay path for completed jobs | VERIFIED | Lines 1-3: imports getDb, jobOutcomes, eq, desc; lines 126-157: DB overlay block |
| `lib/ai/tools.js` | getJobStatusTool with updated description mentioning completed jobs | VERIFIED | Line 110: description updated |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib/db/schema.js` | `drizzle/0003_careful_anthem.sql` | drizzle-kit generate | WIRED | Migration file auto-named (0003_careful_anthem.sql), contains ALTER TABLE — confirms drizzle-kit ran schema and produced the file |
| `lib/db/job-outcomes.js` | `lib/db/schema.js` | import + .values() with targetRepo | WIRED | Line 4: `import { jobOutcomes } from './schema.js'`; line 30: `targetRepo: targetRepo ?? null` in .values() |
| `templates/.github/workflows/notify-pr-complete.yml` | `api/index.js handleGithubWebhook()` | POST with target_repo in payload | WIRED | Workflow reads target_repo from pr-result.json (line 37), sets output (line 41), includes in webhook payload (line 211) |
| `api/index.js handleGithubWebhook()` | `lib/db/job-outcomes.js saveJobOutcome()` | targetRepo: results.target_repo \|\| null | WIRED | api/index.js line 287: `targetRepo: results.target_repo \|\| null` |
| `api/index.js handleGithubWebhook()` | `lib/tools/telegram.js sendMessage()` | dynamic import, platform=telegram guard | WIRED | api/index.js line 319: `const { sendMessage } = await import('../lib/tools/telegram.js')` |
| `lib/tools/github.js getJobStatus()` | `lib/db/schema.js jobOutcomes` | .select().from(jobOutcomes) | WIRED | lib/tools/github.js line 131: `.from(jobOutcomes)` |
| `lib/tools/github.js getJobStatus()` | `lib/db/index.js getDb()` | import + getDb() call | WIRED | lib/tools/github.js line 1: `import { getDb } from '../db/index.js'`; line 128: `const db = getDb()` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| NOTIF-01 | 11-02 | Entrypoint sends completion webhook POST to Event Handler for cross-repo jobs | VERIFIED | notify-pr-complete.yml extracts target_repo and POSTs to webhook; api/index.js handleGithubWebhook() receives and processes it |
| NOTIF-02 | 11-01 | job_outcomes table has nullable target_repo column recording which repo was targeted | VERIFIED | schema.js line 58: nullable targetRepo column; migration 0003_careful_anthem.sql: ALTER TABLE confirmed |
| NOTIF-03 | 11-02 | Success notifications include correct target repo PR URL in Slack/Telegram messages | VERIFIED | results.target_repo extracted from payload (line 268); passed to summarizeJob(results) so LLM message includes PR URL; both Slack and Telegram thread-origin blocks send the message |
| NOTIF-04 | 11-03 | get_job_status tool returns target repo PR URL when available | VERIFIED | lib/tools/github.js DB overlay returns `target_repo: outcome.targetRepo \|\| null` in job response shape |

All 4 required requirement IDs accounted for. No orphaned requirements detected.

---

### Anti-Patterns Found

No blockers or warnings found.

- No placeholder returns (null, {}, []) in modified functions
- No TODO/FIXME/HACK comments in modified files
- DB overlay wrapped in try/catch — non-fatal, logged correctly
- Telegram block wrapped in try/catch — non-fatal, logged correctly
- saveJobOutcome() uses explicit `?? null` not undefined — no silent field drop

---

### Human Verification Required

#### 1. Cross-repo notification message language

**Test:** Trigger a cross-repo job (status=cross_repo_pr_open) through the full flow and observe the Slack/Telegram message content.
**Expected:** Message language reflects "PR open for review" or similar (not "merged") and includes the target repo PR URL from the payload.
**Why human:** LLM summarization behavior (summarizeJob) cannot be verified programmatically — the message is generated by the model from the results object.

#### 2. Telegram sendMessage import path at runtime

**Test:** Trigger a Telegram-originated job and observe whether the notification arrives in the originating thread.
**Expected:** Message delivered via sendMessage(TELEGRAM_BOT_TOKEN, origin.threadId, message).
**Why human:** api/index.js uses path `../lib/tools/telegram.js` — this is a dynamic import inside a Next.js API route. Runtime path resolution from the api/ directory needs to be confirmed in the deployed Next.js environment (monorepo structure vs. compiled output).

---

### Gaps Summary

No gaps. All automated checks passed across all three levels (exists, substantive, wired) for all artifacts and key links. All 4 requirement IDs are satisfied. Phase goal is achieved.

The only items requiring human confirmation are the LLM-generated message language (inherently non-deterministic) and the Telegram dynamic import path at runtime in Next.js — both are low-risk items, not blockers.

---

_Verified: 2026-02-26_
_Verifier: Claude (gsd-verifier)_
