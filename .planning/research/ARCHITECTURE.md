# Architecture Research

**Domain:** Smart job prompts, pipeline hardening, and previous job context injection for ClawForge v1.1
**Researched:** 2026-02-24
**Confidence:** HIGH (based on direct codebase inspection) / MEDIUM (for context injection patterns)

---

## System Overview — Existing Architecture (v1.0)

Understanding the full pipeline is required before identifying what changes for v1.1.

```
┌──────────────────────────────────────────────────────────────────┐
│                     Event Handler (Next.js)                       │
│                                                                  │
│  Channel Adapter Layer (Slack/Telegram/Web)                      │
│       ↓ normalized { threadId, text, attachments }               │
│  LangGraph ReAct Agent (lib/ai/agent.js)                         │
│       ↓ tool invocation                                          │
│  createJobTool (lib/ai/tools.js)                                 │
│       ↓ calls                                                    │
│  createJob() (lib/tools/create-job.js)                           │
│       ↓ GitHub API                                               │
│  Push job/* branch with logs/{jobId}/job.md                      │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │ job/* branch push event
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (run-job.yml)                   │
│  docker run [job image] with SECRETS, LLM_SECRETS, REPO_URL,    │
│             BRANCH, LLM_MODEL, LLM_PROVIDER                     │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Job Container (Docker)                        │
│                                                                  │
│  entrypoint.sh:                                                  │
│  1. Export SECRETS and LLM_SECRETS as env vars                   │
│  2. Git auth + clone job/* branch                                │
│  3. [PREFLIGHT] verify HOME, claude, GSD paths                   │
│  4. Build SYSTEM_PROMPT from /job/config/SOUL.md + AGENT.md      │
│  5. Read JOB_DESCRIPTION from /job/logs/{jobId}/job.md           │
│  6. Run: claude -p --append-system-prompt ... < /tmp/prompt.txt  │
│  7. PostToolUse hook writes gsd-invocations.jsonl                │
│  8. Generate observability.md from gsd-invocations.jsonl         │
│  9. git add -A && git commit && git push                         │
│  10. gh pr create (only if Claude exit 0)                        │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │ PR created
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Post-Job Workflows                             │
│                                                                  │
│  auto-merge.yml — path-restricted auto-merge                     │
│       ↓ on merge complete                                        │
│  notify-pr-complete.yml — reads logs/{jobId}/*.jsonl, POSTs      │
│       to /api/github/webhook                                     │
│       OR                                                         │
│  notify-job-failed.yml — on run-job.yml failure, POSTs to       │
│       /api/github/webhook                                        │
│                                                                  │
│       ↓ webhook received                                         │
│                                                                  │
│  Event Handler: summarizeJob() + createNotification()            │
│       ↓                                                          │
│  Channel adapter sends completion message to originating thread   │
└──────────────────────────────────────────────────────────────────┘
```

---

## v1.1 Feature Architecture

Three independent features, each with distinct integration points. They can be built in parallel after scoping, but have internal dependencies described below.

---

### Feature 1: Smart Job Prompts (Repo Context Injection)

**What it does:** Before creating a job, the Event Handler fetches context from the target repo (CLAUDE.md, package.json, directory structure) and injects it into the job description sent to the job container.

**Where it lives:** Event Handler — specifically `lib/tools/create-job.js` and `lib/ai/tools.js`.

**Data flow (current vs. new):**

```
CURRENT:
  Agent calls createJobTool(job_description)
       ↓
  createJob(jobDescription) writes job_description to logs/{jobId}/job.md
       ↓
  Job container reads job.md, builds SYSTEM_PROMPT from SOUL.md + AGENT.md
  Agent starts COLD — no knowledge of target repo

NEW:
  Agent calls createJobTool(job_description, target_repo?)
       ↓
  createJob() fetches context from target repo via GitHub API:
    - CLAUDE.md (architecture/conventions)
    - package.json (stack, deps, scripts)
    - Directory listing (top-level structure)
       ↓
  createJob() enriches job.md:
    # Your Job
    {job_description}

    # Repo Context
    ## CLAUDE.md
    {claude_md_content}

    ## package.json
    {package_json_content}

    ## Directory Structure
    {top_level_ls}
       ↓
  Job container reads enriched job.md — agent starts WARM
```

**Component changes:**

| Component | Change Type | What Changes |
|-----------|-------------|--------------|
| `lib/tools/create-job.js` | MODIFY | Add `fetchRepoContext(owner, repo, branch)` that calls GitHub contents API. Append context block to `jobDescription` before writing `job.md`. |
| `lib/ai/tools.js` | MODIFY | Extend `createJobTool` schema with optional `target_repo` parameter (owner/repo string). Pass to `createJob()`. Fallback to `GH_OWNER/GH_REPO` env if not provided. |
| `lib/tools/github.js` | MODIFY | Add `getFileContents(owner, repo, path, branch)` helper. Add `getRepoStructure(owner, repo)` returning top-level tree. |

**New component:**

```
lib/tools/repo-context.js     NEW — context fetcher
  fetchRepoContext(owner, repo, branch?)
    → getFileContents(CLAUDE.md)   [silent fail if missing]
    → getFileContents(package.json) [silent fail if missing]
    → getRepoTree()                [top-level only, not recursive]
    → returns formatted markdown block
```

**Key design decisions:**

- Repo context fetching is **best-effort**: if CLAUDE.md is absent, skip it. Never block job creation because context fetch fails.
- Context is injected into `job.md`, not into `SYSTEM_PROMPT`. The system prompt (`SOUL.md + AGENT.md`) is instance configuration. Job-specific context belongs in the job description.
- GitHub API rate limit concern: 3 API calls per job creation (CLAUDE.md, package.json, tree). At 5,000 req/hour limit, this is safe for <1,600 jobs/hour — well above current volume.
- Context is capped. CLAUDE.md and package.json should be truncated at 8KB each to prevent `job.md` from exceeding reasonable size.

**Integration boundary:**

```
lib/ai/tools.js (createJobTool)
    → lib/tools/create-job.js (createJob)
        → lib/tools/repo-context.js (fetchRepoContext)   [NEW]
            → lib/tools/github.js (getFileContents, getRepoTree)  [EXTEND]
```

No changes to entrypoint.sh, GitHub Actions workflows, or the job container. The enrichment is transparent from the container's perspective — it just reads a richer `job.md`.

---

### Feature 2: Pipeline Hardening

**What it does:** Prevents silent failures and incorrect notifications in the GitHub Actions pipeline. Targets: conditional PR creation (already done in v1.0), error propagation from failed Claude runs, notification accuracy (merge state detection).

**Current state (post v1.0):** The pipeline already has:
- Conditional `gh pr create` — only runs if `CLAUDE_EXIT -eq 0`
- `notify-job-failed.yml` — fires on `run-job.yml` failure
- `notify-pr-complete.yml` — fires after `auto-merge.yml` completes

**Known gaps to harden:**

```
Gap 1: Claude non-zero exit propagates but container exits 0
  - entrypoint.sh line 137: logs CLAUDE_EXIT but always exits with CLAUDE_EXIT (line 184)
  - This is CORRECT — container exits with Claude's exit code
  - Verify: run-job.yml must not suppress non-zero exit; currently has no error masking
  - Action: Audit run-job.yml step exit codes; confirm container failure reaches workflow failure

Gap 2: notify-pr-complete.yml merge state detection is brittle
  - Uses `gh pr view --json mergedAt` to check merge state
  - If auto-merge hasn't completed when workflow fires, mergedAt is null
  - The workflow fires on auto-merge.yml completion, not on PR merge directly
  - Action: Use workflow_run.conclusion to determine merge outcome, not just mergedAt poll

Gap 3: notify-job-failed.yml branch checkout on failed jobs
  - Failed jobs may not have committed logs (entrypoint commits with `|| true`)
  - `git commit ... || true` means job.md may be absent from branch if commit failed
  - Action: Ensure job.md is always readable from branch before container runs (it is — job.md is written to the branch before run-job.yml fires, not by the container)

Gap 4: No timeout on job containers
  - Containers run until GitHub Actions 6-hour timeout if Claude hangs
  - Relevant for pipeline hardening: a hung container blocks the runner
  - Action: Add `timeout-minutes` to run-job.yml job definition
```

**Component changes:**

| Component | Change Type | What Changes |
|-----------|-------------|--------------|
| `.github/workflows/run-job.yml` | MODIFY | Add `timeout-minutes: 30` to job definition. Verify no step-level exit code masking. |
| `.github/workflows/notify-pr-complete.yml` | MODIFY | Improve merge state detection logic. Add error handling for missing PR. |
| `.github/workflows/notify-job-failed.yml` | MODIFY | Verify checkout ref fallback when container hasn't committed. |
| `templates/.github/workflows/` | MODIFY | Sync all three workflow templates after live changes. |

**No Event Handler changes required.** Pipeline hardening is GitHub Actions-layer only.

---

### Feature 3: Previous Job Context Injection

**What it does:** When a user asks Archie/Epic to do something related to a previous job, the agent has access to what that job produced — what files changed, what the PR contained, what succeeded or failed. Agent starts conversations with warm context rather than rediscovering state.

**Where it lives:** Event Handler — specifically `lib/ai/index.js`, `lib/db/`, and potentially `lib/ai/tools.js`.

**Two distinct sub-problems:**

**Sub-problem A: Same-thread job continuity (already partially solved)**

The LangGraph SQLite checkpointer (`SqliteSaver`) persists the full conversation history per `thread_id`. When a job completes, `addToThread(threadId, message)` injects the job result back into the conversation. The agent already has the job result in its message history for follow-up questions in the same thread.

Gap: The injected message from `notify-pr-complete.yml` contains `changed_files`, `commit_message`, `pr_url`, and `log` (GSD invocations). This is sufficient for same-thread continuity. **No architectural change needed here** — v1.0 already handles this.

**Sub-problem B: Cross-thread or cross-session job recall (new capability)**

When a user starts a new conversation and references a previous job by description ("remember that refactor you did last week"), the agent has no context. The `jobOrigins` table links `jobId` to `threadId` but contains no job outcome data.

**New data flow:**

```
Job completes → notify-pr-complete.yml → /api/github/webhook
       ↓
Event Handler receives webhook payload:
  { job_id, status, job (description), changed_files, commit_message, pr_url, log }
       ↓
Currently: createNotification() saves for UI display
NEW: Also persist job outcome to job_outcomes table (or extend jobOrigins)
       ↓
Agent tools: new getRecentJobsTool or enhanced getJobStatusTool
  → queries job_outcomes for completed jobs
  → returns: job_id, description, changed_files, pr_url, outcome_summary
       ↓
Agent uses this in conversation: "The last job I ran on repo X changed Y files..."
```

**Schema addition:**

```sql
-- New table: job_outcomes
CREATE TABLE job_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT UNIQUE NOT NULL,
  thread_id TEXT,
  platform TEXT,
  status TEXT,          -- completed, failed, open
  description TEXT,     -- original job.md content
  changed_files TEXT,   -- JSON array
  commit_message TEXT,
  pr_url TEXT,
  merge_result TEXT,
  log_summary TEXT,     -- truncated gsd-invocations content
  created_at INTEGER DEFAULT (unixepoch())
);
```

**Component changes:**

| Component | Change Type | What Changes |
|-----------|-------------|--------------|
| `lib/db/schema.js` | MODIFY | Add `jobOutcomes` table definition. |
| `lib/db/job-outcomes.js` | NEW | `saveJobOutcome(payload)`, `getJobOutcomes(limit)`, `getJobOutcome(jobId)` |
| `api/index.js` (GitHub webhook handler) | MODIFY | After `createNotification()`, also call `saveJobOutcome()` with webhook payload. |
| `lib/ai/tools.js` | MODIFY | Add `getRecentJobsTool` that queries `jobOutcomes` for the last N completed jobs. |
| `drizzle/` | GENERATE | Run `npm run db:generate` to create migration SQL. |

**Important scope clarification:** This feature is about the Event Handler having job history for conversational context. It does NOT require changes to the job container, entrypoint, or GitHub Actions workflows. The webhook payload already contains all needed data — it just isn't being persisted for agent retrieval.

---

## Component Responsibilities (v1.1 State)

| Component | Responsibility | v1.0 State | v1.1 Changes |
|-----------|---------------|------------|--------------|
| `lib/tools/repo-context.js` | Fetch CLAUDE.md, package.json, tree from target repo | Does not exist | NEW |
| `lib/tools/create-job.js` | Create job branch, write enriched job.md | Creates bare job.md | MODIFY: inject repo context |
| `lib/ai/tools.js` | LangGraph tool definitions | 3 tools | MODIFY: extend createJobTool, add getRecentJobsTool |
| `lib/tools/github.js` | GitHub REST API client | Read-focused | MODIFY: add getFileContents, getRepoTree |
| `lib/db/job-outcomes.js` | Persist job completion data | Does not exist | NEW |
| `lib/db/schema.js` | Drizzle table definitions | 6 tables | MODIFY: add jobOutcomes |
| `api/index.js` (GH webhook) | Handle job completion webhook | Notifies + summarizes | MODIFY: also saveJobOutcome |
| `.github/workflows/run-job.yml` | Trigger job container | Functional | MODIFY: add timeout |
| `.github/workflows/notify-*.yml` | Notify Event Handler | Functional | MODIFY: harden edge cases |

---

## Data Flow: Smart Job Creation (v1.1)

```
User: "Refactor the auth module in strategyes-lab"
       ↓
LangGraph Agent (EVENT_HANDLER.md context)
       ↓ tool call: create_job
createJobTool({ job_description: "Refactor auth module", target_repo: "owner/strategyes-lab" })
       ↓
createJob(jobDescription, { owner, repo })
       ↓ parallel GitHub API calls
fetchRepoContext(owner, repo)
  ├── GET /repos/{owner}/{repo}/contents/CLAUDE.md   → architecture docs
  ├── GET /repos/{owner}/{repo}/contents/package.json → stack/scripts
  └── GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=false → top-level tree
       ↓
Enrich job.md:
  "# Your Job\nRefactor auth module\n\n# Repo Context\n## CLAUDE.md\n..."
       ↓
Push job/* branch with enriched job.md
       ↓
GitHub Actions triggers run-job.yml
       ↓
Job container reads enriched job.md → claude -p starts WARM with repo context
```

---

## Data Flow: Previous Job Context (v1.1)

```
Job completes → /api/github/webhook receives:
  { job_id, status: "completed", job: "Refactor auth module",
    changed_files: ["src/auth.js", "tests/auth.test.js"],
    commit_message: "feat: extract auth middleware",
    pr_url: "https://github.com/...", merge_result: "merged" }
       ↓
Event Handler:
  summarizeJob() → LLM summary
  createNotification() → save for UI
  saveJobOutcome() → persist to job_outcomes table  [NEW]
       ↓
Later conversation (new thread):
User: "What did you change in strategyes-lab last week?"
       ↓
Agent: getRecentJobsTool({ limit: 5 })
  → query job_outcomes ORDER BY created_at DESC
  → returns: [{ job_id, description, changed_files, pr_url, ... }]
       ↓
Agent answers with actual PR data, not hallucination
```

---

## Recommended Project Structure (additions/changes for v1.1)

```
lib/
├── tools/
│   ├── create-job.js         MODIFY — inject repo context into job.md
│   ├── github.js             MODIFY — add getFileContents, getRepoTree
│   └── repo-context.js       NEW — fetchRepoContext() orchestrator
├── ai/
│   └── tools.js              MODIFY — extend createJobTool + add getRecentJobsTool
├── db/
│   ├── schema.js             MODIFY — add jobOutcomes table
│   └── job-outcomes.js       NEW — CRUD for job completion data

drizzle/
└── [new migration].sql       GENERATE — via npm run db:generate

.github/workflows/
├── run-job.yml               MODIFY — add timeout-minutes
├── notify-pr-complete.yml    MODIFY — harden merge detection
└── notify-job-failed.yml     VERIFY — audit for edge cases

templates/.github/workflows/
├── run-job.yml               SYNC — after live changes
├── notify-pr-complete.yml    SYNC — after live changes
└── notify-job-failed.yml     SYNC — after live changes
```

---

## Architectural Patterns

### Pattern 1: Best-Effort Context Enrichment

**What:** Wrap all repo context fetches in try-catch. Return partial context if some fetches fail. Never block job creation because a file doesn't exist in the target repo.

**When to use:** Any time the Event Handler fetches external data as enrichment (not as a requirement).

**Trade-offs:** Jobs may occasionally start with less context than expected if GitHub API returns a 404 for CLAUDE.md. This is acceptable — the job still runs. The alternative (blocking job creation) is worse.

```javascript
// repo-context.js pattern
async function fetchRepoContext(owner, repo, branch = 'main') {
  const parts = [];

  try {
    const claudeMd = await getFileContents(owner, repo, 'CLAUDE.md', branch);
    if (claudeMd) parts.push(`## CLAUDE.md\n${claudeMd.slice(0, 8000)}`);
  } catch { /* absent — skip */ }

  try {
    const pkg = await getFileContents(owner, repo, 'package.json', branch);
    if (pkg) parts.push(`## package.json\n${pkg.slice(0, 4000)}`);
  } catch { /* absent — skip */ }

  if (parts.length === 0) return '';
  return `\n\n# Repo Context\n\n${parts.join('\n\n')}`;
}
```

---

### Pattern 2: Webhook Payload as Source of Truth for Job History

**What:** The `notify-pr-complete.yml` webhook payload already contains all job outcome data needed for conversational context: `changed_files`, `commit_message`, `pr_url`, `log`, `merge_result`. Persist this payload verbatim to the database rather than re-fetching from GitHub later.

**When to use:** Any time job completion data needs to be queryable from the Event Handler.

**Trade-offs:** The payload is captured once at completion. If a PR is later reverted or edited, the persisted data is stale. This is acceptable — the record represents what the job produced, not the current state of main.

```javascript
// api/index.js — GitHub webhook handler (addition)
async function handleJobComplete(payload) {
  const { job_id, status, job, changed_files, commit_message, pr_url, log, merge_result } = payload;

  // existing
  await summarizeJob(payload);
  await createNotification({ job_id, ... });

  // new — persist for agent retrieval
  try {
    await saveJobOutcome({
      jobId: job_id,
      threadId: getJobOrigin(job_id)?.threadId,
      status,
      description: job,
      changedFiles: JSON.stringify(changed_files),
      commitMessage: commit_message,
      prUrl: pr_url,
      mergeResult: merge_result,
      logSummary: log?.slice(0, 2000),
    });
  } catch (err) {
    console.error('[github-webhook] Failed to save job outcome:', err);
    // non-blocking
  }
}
```

---

### Pattern 3: Extend Existing Tools Before Adding New Ones

**What:** For `getRecentJobsTool` — check whether `getJobStatusTool` can be extended to include historical jobs before creating a parallel tool. `getJobStatusTool` currently queries `run-job.yml` workflow runs from GitHub, which is the wrong data source for historical context (GitHub Actions only keeps runs for ~90 days; job outcomes table is permanent).

**When to use:** This is a case where a new tool IS warranted, because the data source is different (SQLite vs GitHub API) and the query intent is different (historical context vs live status).

**Trade-offs:** Two tools instead of one, but clean separation of concerns. `get_job_status` = live running jobs (GitHub API). `get_recent_jobs` = completed job history (SQLite). Agent understands the distinction.

---

## Anti-Patterns

### Anti-Pattern 1: Injecting Repo Context into the System Prompt

**What people do:** Add CLAUDE.md and package.json to `SOUL.md` or `AGENT.md` inside the instance config.

**Why it's wrong:** `SOUL.md` and `AGENT.md` are static instance configuration that applies to all jobs. Repo-specific context must be job-specific. Putting it in the system prompt makes all jobs for an instance share the same repo context — Epic (strategyes-lab only) would have the wrong context if it gets a generic job.

**Do this instead:** Inject repo context into `job.md` (the job description file written by `createJob()`). The entrypoint reads this file and feeds it to `claude -p` as the user prompt, not the system prompt. Each job has its own context.

---

### Anti-Pattern 2: Fetching Repo Context Inside the Job Container

**What people do:** Add a step to `entrypoint.sh` that clones or fetches CLAUDE.md from the target repo.

**Why it's wrong:** The job container clones only the ClawForge job repo (the branch containing `job.md`), not the target repo being modified. Adding GitHub API calls inside the container adds complexity, adds a network dependency inside Docker, and duplicates the GitHub token usage pattern already present in the Event Handler.

**Do this instead:** Fetch repo context in the Event Handler before creating the job branch. The data travels through `job.md` as plain text — no container-side networking required.

---

### Anti-Pattern 3: Blocking Job Creation When Context Fetch Fails

**What people do:** `await fetchRepoContext()` and throw if GitHub returns 404 or rate limit.

**Why it's wrong:** Most target repos will eventually lack a CLAUDE.md or have private files. A failing context fetch should never prevent a job from being created. The job runs with less context — the agent still works, just starts colder.

**Do this instead:** Wrap context fetching in try-catch per file. Return an empty string if all fetches fail. `createJob()` appends context only when it's non-empty.

---

### Anti-Pattern 4: Storing Full Job Output in SQLite

**What people do:** Persist the full `claude-output.json` (can be megabytes) into the `job_outcomes` table.

**Why it's wrong:** SQLite is not appropriate for large blob storage. The full job output is already committed to the job branch in Git — it doesn't need to live in the database.

**Do this instead:** Store only the summary fields from the webhook payload: `changed_files` (array), `commit_message` (string), `pr_url` (string), `merge_result` (string), and a truncated `log_summary` (first 2KB of GSD invocations). Link to the PR URL for full output.

---

## Build Order

Dependencies determine order within the milestone. Features 1 and 3 touch different parts of the stack and can be phased, but have no hard dependency on each other.

```
[Feature 2: Pipeline Hardening]
  → No deps on Features 1 or 3
  → Pure GitHub Actions changes
  → Do this first — lowest risk, unblocks validation of the other features
  → MODIFY: run-job.yml (timeout), notify-pr-complete.yml (hardening)
  → SYNC: templates/.github/workflows/

       ↓ (parallel or sequential)

[Feature 1: Smart Job Prompts]
  → Depends on nothing except GitHub API access (already exists)
  → NEW: lib/tools/repo-context.js
  → MODIFY: lib/tools/create-job.js, lib/tools/github.js, lib/ai/tools.js
  → Test: trigger a job, inspect job.md for repo context block

       ↓ (after Feature 1 validated)

[Feature 3: Previous Job Context]
  → Depends on jobs completing successfully (Feature 2 hardening helps)
  → NEW: lib/db/job-outcomes.js
  → MODIFY: lib/db/schema.js, api/index.js (webhook handler), lib/ai/tools.js
  → GENERATE: drizzle migration
  → Test: complete a job, query job_outcomes, verify agent can retrieve it

       ↓ (after Feature 3 schema exists)

[Feature 3b: Agent Routing Improvements — quick vs. plan-phase thresholds]
  → Depends on: agent having job history context (Feature 3)
  → MODIFY: EVENT_HANDLER.md prompt language for routing decisions
  → MODIFY: instances/*/config/EVENT_HANDLER.md
  → Test: send simple vs. complex tasks, verify routing
```

**Rationale for this order:**
- Pipeline hardening first because it doesn't require any new code paths, just fixes to existing workflows. Reduces risk of flaky tests when validating new features.
- Repo context injection second because it's purely additive to `createJob()` with no schema changes or new infrastructure. Fastest to validate (just inspect `job.md` on the next test job).
- Job outcomes third because it requires a schema migration, a new DB module, webhook handler changes, and a new LangGraph tool — more moving parts that should be built on a stable foundation.
- Routing improvements last because they depend on the agent having job history context to make informed routing decisions.

---

## Integration Points

### Event Handler ↔ GitHub API (new calls for repo context)

| Call | Where | Rate Limit Impact |
|------|-------|-------------------|
| `GET /repos/{owner}/{repo}/contents/CLAUDE.md` | `repo-context.js` | 1 req per job |
| `GET /repos/{owner}/{repo}/contents/package.json` | `repo-context.js` | 1 req per job |
| `GET /repos/{owner}/{repo}/git/trees/HEAD` | `repo-context.js` | 1 req per job |

Total: 3 additional GitHub API calls per job. At 5,000 req/hour authenticated limit: safe up to ~1,600 jobs/hour (current volume is well under 100/day).

### Webhook Handler ↔ job_outcomes table (new write path)

| Trigger | Handler | Data Written |
|---------|---------|-------------|
| `notify-pr-complete.yml` POST to `/api/github/webhook` | `api/index.js` GitHub webhook handler | `saveJobOutcome(payload)` |
| `notify-job-failed.yml` POST to `/api/github/webhook` | Same handler, `status: "failed"` | `saveJobOutcome(payload)` |

Both workflows POST to the same endpoint. The handler distinguishes success vs failure by the `status` field in the payload.

### Agent ↔ job_outcomes table (new read path)

| Tool | Data Source | Query |
|------|------------|-------|
| `get_recent_jobs` (new) | `lib/db/job-outcomes.js` | `SELECT * FROM job_outcomes ORDER BY created_at DESC LIMIT ?` |
| `get_job_status` (existing) | `lib/tools/github.js` | GitHub Actions API (unchanged) |

These two tools cover different time horizons: `get_job_status` is for live/running jobs; `get_recent_jobs` is for completed history.

### Internal Boundary: createJob ↔ repo-context

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `createJob()` → `fetchRepoContext()` | Direct function call, returns string | Best-effort: empty string if all fetches fail. `createJob()` appends to jobDescription only if non-empty. |
| `fetchRepoContext()` → `githubApi()` | Direct calls to existing REST helper | Uses same `GH_TOKEN` as all other GitHub calls. No new auth. |

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (~50 jobs/day) | No concerns. 3 extra GitHub API calls per job is negligible. SQLite handles job_outcomes easily. |
| 1,000 jobs/day | GitHub API calls still well within 5,000/hour. job_outcomes table grows but SQLite handles 1M rows without indexes. Add created_at index if queries slow down. |
| 10,000+ jobs/day | GitHub API rate limiting becomes real concern for repo context fetches. Implement per-repo caching of CLAUDE.md with 5-minute TTL in Event Handler memory. SQLite may need migration to PostgreSQL for job_outcomes if write contention increases. |

The job_outcomes table is append-only with no concurrent writes (GitHub webhooks are serialized through a single server process). No write contention concern at current scale.

---

## Sources

- Direct codebase inspection: `lib/tools/create-job.js` — confirmed job.md creation flow
- Direct codebase inspection: `lib/ai/tools.js` — confirmed createJobTool schema and current parameters
- Direct codebase inspection: `lib/tools/github.js` — confirmed githubApi() helper, confirmed GitHub API call patterns
- Direct codebase inspection: `api/index.js` — confirmed webhook handler flow and notification creation
- Direct codebase inspection: `.github/workflows/notify-pr-complete.yml` — confirmed webhook payload fields
- Direct codebase inspection: `.github/workflows/notify-job-failed.yml` — confirmed failure notification flow
- Direct codebase inspection: `.github/workflows/run-job.yml` — confirmed no timeout is set
- Direct codebase inspection: `lib/db/schema.js` and `lib/db/job-origins.js` — confirmed existing schema and jobOrigins pattern to follow for job_outcomes
- Direct codebase inspection: `lib/ai/agent.js` — confirmed LangGraph agent structure and tool registration
- GitHub REST API docs: Contents API `GET /repos/{owner}/{repo}/contents/{path}` — confirmed response includes `content` (base64 encoded)
- GitHub REST API docs: Trees API `GET /repos/{owner}/{repo}/git/trees/{tree_sha}` — confirmed recursive=false returns only root tree entries
- Confidence: HIGH for all integration points (verified against live codebase with line-level precision)
- Confidence: MEDIUM for job_outcomes schema design (pattern borrowed from job-origins.js, not directly validated)

---

*Architecture research for: ClawForge v1.1 — Smart job prompts, pipeline hardening, previous job context*
*Researched: 2026-02-24*
