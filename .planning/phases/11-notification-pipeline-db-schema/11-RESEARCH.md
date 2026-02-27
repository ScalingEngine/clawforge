# Phase 11: Notification Pipeline + DB Schema — Research

**Researched:** 2026-02-26
**Domain:** GitHub webhook handler, Drizzle ORM SQLite migration, Slack/Telegram notification routing, LangChain tool schema
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NOTIF-01 | Entrypoint sends completion webhook POST to Event Handler for cross-repo jobs | Phase 10 COMPLETE — notify-pr-complete.yml cross-repo path already fires with `status=cross_repo_pr_open`; Phase 11 must handle that status in `handleGithubWebhook()` |
| NOTIF-02 | job_outcomes table has nullable target_repo column recording which repo was targeted | Drizzle migration required — add `target_repo text` nullable column to `job_outcomes`; `saveJobOutcome()` and `getLastMergedJobOutcome()` need updating |
| NOTIF-03 | Success notifications include correct target repo PR URL in Slack/Telegram messages | `handleGithubWebhook()` must pass `target_repo` in payload to `summarizeJob()`; Slack postMessage and Telegram channel notification already wired — just needs correct URL and UX language |
| NOTIF-04 | get_job_status tool returns target repo PR URL when available | `getJobStatus()` in `lib/tools/github.js` is GitHub-API-only (live runs); completed job outcome lookup must come from `job_outcomes` DB — requires a new DB query path in the tool |
</phase_requirements>

---

## Summary

Phase 11 closes the final v1.2 notification loop. All four requirements are changes to existing Node.js/JavaScript files — no new libraries are needed. The webhook pipeline from GitHub Actions into the Event Handler is already complete (Phase 10 shipped `notify-pr-complete.yml` with the cross-repo push path). Phase 11's job is to make the Event Handler correctly process the `cross_repo_pr_open` status it now receives, persist it with target repo attribution, and surface the right PR URL in Slack/Telegram notifications.

The work spans four files: `api/index.js` (webhook handler), `lib/db/job-outcomes.js` (DB reads/writes), `lib/db/schema.js` + a new Drizzle migration (DB schema), and `lib/ai/tools.js` (get_job_status tool). A fifth concern is the `lib/tools/github.js` `getJobStatus` function, which currently only queries GitHub Actions live runs — for NOTIF-04 it must also consult the `job_outcomes` table for completed outcomes including `target_repo` and the cross-repo PR URL.

The only subtle design challenge is `get_job_status` (NOTIF-04): the existing implementation hits the GitHub Actions API for live/running jobs. A completed cross-repo job has no GitHub Actions representation the tool can surface — the PR URL is in SQLite. The fix is to overlay DB outcomes on top of live runs when a specific `job_id` is queried.

**Primary recommendation:** Implement all four requirements in a single wave. DB migration first, then webhook handler, then notification routing, then tool update — each task is independent after the migration lands.

---

## Standard Stack

All libraries are already installed. No new dependencies required.

### Core (already in package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.44.0 | SQLite ORM — schema, queries, migrations | Project standard; all existing tables use it |
| better-sqlite3 | ^12.6.2 | SQLite driver | Synchronous API; project standard |
| @slack/web-api | ^7.8.0 | Slack `chat.postMessage` | Already used in `handleGithubWebhook` for Slack routing |
| grammy | ^1.39.3 | Telegram send (via `lib/tools/telegram.js`) | Already used for Telegram subscription distribution |
| drizzle-kit | ^0.31.9 | Migration generation (`db:generate` script) | Project standard for schema migrations |

### No New Libraries Needed

All notification channels, DB access patterns, and webhook handling already exist. This phase is purely additive changes to existing files.

---

## Architecture Patterns

### Existing File Locations (do not move)

```
lib/
├── db/
│   ├── schema.js              # Add target_repo column to jobOutcomes table
│   ├── job-outcomes.js        # Update saveJobOutcome() + getLastMergedJobOutcome()
│   └── index.js               # No change — migration runs at startup via initDatabase()
├── tools/
│   └── github.js              # Update getJobStatus() to overlay DB outcomes for specific job_id queries
├── ai/
│   └── tools.js               # get_job_status tool wraps getJobStatus() — may need minor schema update
api/
└── index.js                   # Update handleGithubWebhook() to handle cross_repo_pr_open status
drizzle/
└── 0003_phase11_target_repo.sql  # New Drizzle migration (generated via npm run db:generate)
```

### Pattern 1: Drizzle Schema Change + Migration

**What:** Add nullable `target_repo text` column to `jobOutcomes` table in `schema.js`, then generate a SQL migration with `npm run db:generate`.
**When to use:** Any time the SQLite schema needs a structural change.
**Example:**

```javascript
// lib/db/schema.js — add to jobOutcomes table
export const jobOutcomes = sqliteTable('job_outcomes', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  threadId: text('thread_id').notNull(),
  status: text('status').notNull(),
  mergeResult: text('merge_result').notNull(),
  prUrl: text('pr_url').notNull().default(''),
  targetRepo: text('target_repo'),              // NEW: nullable — null for same-repo jobs
  changedFiles: text('changed_files').notNull().default('[]'),
  logSummary: text('log_summary').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});
```

Drizzle migration generation command (run from project root):
```bash
npm run db:generate
```

This produces a new `drizzle/000X_....sql` file with `ALTER TABLE job_outcomes ADD COLUMN target_repo text;`. The migration runs automatically at server startup via `initDatabase()` in `lib/db/index.js`. **Do not hand-write the SQL migration file** — always generate it via drizzle-kit so the journal stays consistent.

**CRITICAL:** The existing `migrate()` call in `initDatabase()` already handles `ALTER TABLE` statements in new migration files. No changes to `lib/db/index.js` are needed.

### Pattern 2: Webhook Handler — Status Branching

**What:** `handleGithubWebhook()` in `api/index.js` currently handles `status=completed`, `status=open`, etc. Phase 10 added `cross_repo_pr_open` as a new status value. The handler must branch on this.
**When to use:** When the same webhook endpoint receives payloads with distinct behavioral semantics.

```javascript
// api/index.js — inside handleGithubWebhook()

// Existing payload extraction already captures target_repo from Phase 10:
const results = {
  // ... existing fields ...
  target_repo: payload.target_repo || '',      // NEW: pass through from Phase 10 payload
};

// When saving outcome, pass target_repo:
saveJobOutcome({
  jobId,
  threadId: origin.threadId,
  status: results.status,
  mergeResult: results.merge_result,
  prUrl: results.pr_url,
  targetRepo: results.target_repo || null,    // NEW: nullable
  changedFiles: results.changed_files,
  logSummary: message,
});

// For cross-repo, Slack notification logic is identical — pr_url is already the target PR URL
// The UX distinction comes from summarizeJob() receiving status='cross_repo_pr_open'
```

**UX language decision** (from STATE.md): "PR open for review" for cross-repo, "merged" for same-repo. The `summarizeJob()` AI call receives the full `results` object including `status` — the AI will naturally produce different language if the system prompt or status value signals this. No separate code path is needed for message text; the `status` field is sufficient signal.

### Pattern 3: Telegram Notification — Already Wired

**What:** `distributeNotification()` in `lib/db/notifications.js` handles Telegram channel subscriptions. `handleGithubWebhook()` handles thread-origin Slack routing. Both are already called.
**Finding:** The existing `handleGithubWebhook()` already sends to the correct Slack thread via `origin.platform === 'slack'` and correct `threadId`. Telegram thread-origin routing is NOT implemented for job outcomes — only subscription-based broadcast is. This is consistent with existing behavior and is not in scope for Phase 11.

### Pattern 4: get_job_status Tool — DB Overlay for Completed Jobs

**What:** `getJobStatus()` in `lib/tools/github.js` only queries GitHub Actions API (live/running jobs). Completed cross-repo jobs disappear from the live run list. NOTIF-04 requires `get_job_status` to return the target repo PR URL.
**Approach:** When a specific `job_id` is provided and NOT found in live runs, look it up in `job_outcomes` DB and include the outcome.

```javascript
// lib/tools/github.js — extend getJobStatus()
import { getDb } from '../db/index.js';        // add import
import { jobOutcomes } from '../db/schema.js'; // add import
import { eq } from 'drizzle-orm';              // add import

async function getJobStatus(jobId) {
  // ... existing live run query logic ...

  // Overlay: if specific job_id was requested and not found in live runs, check DB
  if (jobId && filteredRuns.length === 0) {
    const db = getDb();
    const outcome = db.select().from(jobOutcomes)
      .where(eq(jobOutcomes.jobId, jobId))
      .orderBy(desc(jobOutcomes.createdAt))
      .limit(1)
      .get();

    if (outcome) {
      return {
        jobs: [{
          job_id: jobId,
          status: 'completed',
          outcome_status: outcome.status,
          pr_url: outcome.prUrl,
          target_repo: outcome.targetRepo || null,
          log_summary: outcome.logSummary,
        }],
        queued: 0,
        running: 0,
      };
    }
  }

  return { jobs, queued: queuedCount, running: runningCount };
}
```

**IMPORTANT:** `lib/tools/github.js` is a pure ESM module. It can import from `lib/db/` directly — both are within the same package. The `getDb()` singleton is safe for concurrent calls.

### Anti-Patterns to Avoid

- **Do not create a new route for cross-repo notifications.** The existing `/api/github/webhook` already receives the `cross_repo_pr_open` payload from Phase 10. Adding a second route would duplicate auth logic.
- **Do not hardcode the Drizzle migration SQL.** Always use `npm run db:generate` to produce migration files — the `_journal.json` must stay consistent.
- **Do not modify `initDatabase()` to handle the new column.** The migration system handles this automatically.
- **Do not add `target_repo` to `getLastMergedJobOutcome()` filter criteria.** The function finds the last merged job outcome for a thread regardless of target — this is correct for prior job context enrichment.
- **Do not send duplicate notifications.** The cross-repo path in `handleGithubWebhook()` should follow the same single-send pattern as the same-repo path.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite column addition | Raw SQL string in initDatabase() | drizzle-kit migration | Journal consistency, prevents replay on fresh installs |
| Slack message sending | Custom HTTP fetch to Slack | Existing `@slack/web-api` WebClient in handler | Already instantiated and authenticated in handleGithubWebhook |
| Telegram message sending | Custom fetch to Bot API | Existing `lib/tools/telegram.js` sendMessage() | Already handles errors; used by distributeNotification() |
| Job outcome lookup | GitHub API polling for completed jobs | `job_outcomes` SQLite table | GitHub API doesn't retain completed run details indefinitely; DB is authoritative |

**Key insight:** Every piece of infrastructure this phase needs already exists and is wired. The work is connecting signals (`target_repo` from payload) through the existing data flow, not building new flows.

---

## Common Pitfalls

### Pitfall 1: Drizzle Migration Not Generated — Schema and DB Out of Sync

**What goes wrong:** Developer edits `schema.js` but forgets to run `npm run db:generate`. The `jobOutcomes` insert then fails at runtime with "table job_outcomes has no column named target_repo".
**Why it happens:** Drizzle ORM uses the schema for type inference but does NOT auto-migrate. The actual SQLite schema only changes when a migration SQL file is applied.
**How to avoid:** After editing `schema.js`, immediately run `npm run db:generate` and commit the resulting `drizzle/000X_....sql` file alongside the schema change.
**Warning signs:** Server starts without error (migration is empty/no-op), but first insert with `targetRepo` field throws SQLite constraint error.

### Pitfall 2: saveJobOutcome() Called with targetRepo but Column Not in Drizzle Values

**What goes wrong:** `saveJobOutcome()` is updated to accept `targetRepo` parameter but the Drizzle `.values({...})` call doesn't include it — the field is silently dropped.
**Why it happens:** Drizzle's `.values()` requires explicit field inclusion; it does not auto-map object properties.
**How to avoid:** When adding `targetRepo` to `saveJobOutcome()`, verify it appears in both the function parameter destructuring AND the `.values({...})` object.

### Pitfall 3: cross_repo_pr_open Status Not Handled — Notification Silently Dropped

**What goes wrong:** `handleGithubWebhook()` receives the cross-repo payload, calls `summarizeJob()` and `createNotification()` successfully, but then tries to call `saveJobOutcome()` with `mergeResult: 'cross_repo_pr_open'` — the existing schema has `merge_result NOT NULL`. This will succeed (it's just a string), but `getLastMergedJobOutcome()` filters `mergeResult='merged'`, so cross-repo outcomes will never surface as prior context. This is correct behavior but must be understood.
**Why it happens:** `getLastMergedJobOutcome()` intentionally only returns same-repo merged outcomes for job context enrichment.
**How to avoid:** Accept this behavior — cross-repo outcomes should not feed back as prior job context (they're in a different repo). Document this explicitly.

### Pitfall 4: get_job_status DB Import Causes Circular Dependency

**What goes wrong:** `lib/tools/github.js` imports from `lib/db/index.js`. If the DB index imports from `tools/`, a circular dependency results in an empty module error at runtime.
**Why it happens:** ESM circular dependency detection is at module level — `lib/db/index.js` does NOT import from `lib/tools/`, so no circle exists. This is safe.
**How to avoid:** Verify by checking: `lib/db/index.js` imports only `lib/paths.js` and `lib/db/schema.js`. No cycle.

### Pitfall 5: Slack Thread Routing — Wrong Platform Branch

**What goes wrong:** Cross-repo jobs originated from Telegram — but the existing `handleGithubWebhook()` only has a Slack branch for platform-specific routing. Telegram thread-origin routing is absent.
**Why it happens:** Telegram thread-origin routing was never implemented (only subscription broadcast). Cross-repo jobs are currently only tested with Slack.
**How to avoid:** Add a Telegram thread-origin branch in the same pattern as Slack, or explicitly document that Telegram thread routing is out of scope for this phase (subscription broadcast covers it).

---

## Code Examples

### Adding nullable column in Drizzle schema

```javascript
// lib/db/schema.js — jobOutcomes table update
// Source: project pattern — matches existing nullable pattern for optional fields
export const jobOutcomes = sqliteTable('job_outcomes', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  threadId: text('thread_id').notNull(),
  status: text('status').notNull(),
  mergeResult: text('merge_result').notNull(),
  prUrl: text('pr_url').notNull().default(''),
  targetRepo: text('target_repo'),              // nullable — no .notNull(), no .default()
  changedFiles: text('changed_files').notNull().default('[]'),
  logSummary: text('log_summary').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});
```

### Updated saveJobOutcome() signature

```javascript
// lib/db/job-outcomes.js
export function saveJobOutcome({ jobId, threadId, status, mergeResult, prUrl, targetRepo, changedFiles, logSummary }) {
  const db = getDb();
  const id = randomUUID();
  db.insert(jobOutcomes)
    .values({
      id,
      jobId,
      threadId,
      status,
      mergeResult,
      prUrl: prUrl ?? '',
      targetRepo: targetRepo ?? null,           // NEW: nullable
      changedFiles: JSON.stringify(Array.isArray(changedFiles) ? changedFiles : []),
      logSummary: logSummary ?? '',
      createdAt: Date.now(),
    })
    .run();
}
```

### handleGithubWebhook() — extract and pass target_repo

```javascript
// api/index.js — inside handleGithubWebhook()
const results = {
  job: payload.job || '',
  pr_url: payload.pr_url || payload.run_url || '',
  run_url: payload.run_url || '',
  status: payload.status || '',
  failure_stage: payload.failure_stage || '',
  merge_result: payload.merge_result || '',
  log: payload.log || '',
  changed_files: payload.changed_files || [],
  commit_message: payload.commit_message || '',
  target_repo: payload.target_repo || '',       // NEW: passthrough from Phase 10 payload
};

// ... summarizeJob(results) — AI receives target_repo and status='cross_repo_pr_open'
// ... createNotification(message, payload)

// When saving outcome:
saveJobOutcome({
  jobId,
  threadId: origin.threadId,
  status: results.status,
  mergeResult: results.merge_result,
  prUrl: results.pr_url,
  targetRepo: results.target_repo || null,      // NEW
  changedFiles: results.changed_files,
  logSummary: message,
});
```

### notify-pr-complete.yml cross-repo payload (already shipped in Phase 10)

The workflow already sends this payload shape to `/api/github/webhook`:
```json
{
  "job_id": "...",
  "branch": "job/...",
  "status": "cross_repo_pr_open",
  "job": "...",
  "run_url": "...",
  "pr_url": "https://github.com/owner/target-repo/pull/42",
  "target_repo": "owner/target-repo",
  "changed_files": [],
  "commit_message": "",
  "log": "...",
  "merge_result": "cross_repo_pr_open"
}
```

Phase 11 only needs to correctly handle this in `handleGithubWebhook()` — no workflow changes needed.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| notify-pr-complete.yml only fires on workflow_run (auto-merge) | Dual trigger: workflow_run + push to job/** | Phase 10 | Cross-repo jobs now reach the handler |
| job_outcomes table has no target_repo | job_outcomes gains nullable target_repo | Phase 11 | Enables cross-repo attribution |
| get_job_status only queries live GitHub Actions runs | get_job_status overlays DB outcomes for completed jobs | Phase 11 | Agent can report cross-repo PR URL after job completion |

**Deprecated/outdated approaches:**
- Checking `merge_result === 'merged'` as the only success indicator: Phase 11 introduces `cross_repo_pr_open` as a distinct successful-but-not-merged state. Code that assumes "success = merged" must handle this new state.

---

## Open Questions

1. **Telegram thread-origin routing for cross-repo completions**
   - What we know: `distributeNotification()` broadcasts to Telegram subscriptions. Thread-origin routing exists for Slack in `handleGithubWebhook()` but NOT Telegram.
   - What's unclear: Is Telegram thread-origin routing expected for Phase 11 or is subscription broadcast sufficient?
   - Recommendation: Add a Telegram thread-origin branch in `handleGithubWebhook()` mirroring the Slack pattern. The `lib/tools/telegram.js` `sendMessage()` function is available. Pattern: `if (origin.platform === 'telegram') { await sendMessage(botToken, origin.threadId, message); }`. This is low-risk (5-10 lines) and closes the same user-experience gap as Slack routing.

2. **UX language for cross-repo notification messages**
   - What we know: STATE.md documents the decision: "PR open for review" (cross-repo) vs "merged" (same-repo).
   - What's unclear: Does `summarizeJob()` (the AI call) need an explicit system-prompt hint to use this language, or does `status='cross_repo_pr_open'` in the payload provide enough signal?
   - Recommendation: `summarizeJob()` receives the full `results` object. The `status` and `target_repo` fields are sufficient for the LLM to produce appropriate language. No explicit system prompt change needed — validate in UAT.

3. **get_job_status tool output schema for target_repo**
   - What we know: The tool currently returns `{ jobs, queued, running }` with jobs having `{ job_id, branch, status, ... }`.
   - What's unclear: Should the DB-overlay path return the same shape or a distinct `{ outcome: {...} }` shape?
   - Recommendation: Return a compatible shape with additional `target_repo` and `pr_url` fields. The agent's LLM can interpret either shape; keeping a consistent outer structure avoids downstream parsing issues.

---

## Sources

### Primary (HIGH confidence)
- Project codebase: `api/index.js` — full `handleGithubWebhook()` implementation, Slack routing pattern
- Project codebase: `lib/db/schema.js` — current `jobOutcomes` schema
- Project codebase: `lib/db/job-outcomes.js` — current `saveJobOutcome()` and `getLastMergedJobOutcome()`
- Project codebase: `lib/tools/github.js` — current `getJobStatus()` implementation
- Project codebase: `templates/.github/workflows/notify-pr-complete.yml` — Phase 10 cross-repo payload shape
- Project codebase: `drizzle/` folder — migration pattern, journal format, drizzle-kit version
- `.planning/STATE.md` — locked decisions including "PR open for review" UX language

### Secondary (MEDIUM confidence)
- `package.json` — confirmed all libraries already installed; versions verified against package.json
- `lib/db/index.js` — migration runner pattern; `initDatabase()` already handles ALTER TABLE via Drizzle Kit

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all packages present in package.json
- Architecture: HIGH — all patterns are direct extensions of existing code in the same files
- Pitfalls: HIGH — derived from close reading of actual code (migration journal, schema, handler)

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable codebase — no fast-moving external dependencies)
