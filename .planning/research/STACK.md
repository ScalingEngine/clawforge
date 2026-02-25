# Stack Research

**Domain:** Claude Code agent platform — smart job prompts, pipeline hardening, previous job context injection
**Researched:** 2026-02-24
**Confidence:** HIGH — all findings grounded in direct codebase inspection + official API docs

---

## Scope

This research covers ONLY the new capabilities in milestone v1.1:

1. **Smart job prompts** — Event Handler fetches CLAUDE.md, package.json, and tech stack from target repo before dispatching
2. **Pipeline hardening** — Conditional PR creation, better error handling, notification accuracy
3. **Previous job context injection** — Agent starts with awareness of recent completed jobs

The v1.0 stack (LangGraph, Claude Code CLI, GSD, Docker, GitHub Actions, SQLite/Drizzle) is validated and NOT re-researched here.

---

## Recommended Stack

### Core Technologies

No new core framework additions are needed. The three new feature areas map cleanly onto existing infrastructure.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| GitHub REST API `/repos/{owner}/{repo}/contents/{path}` | v2022-11-28 (current) | Fetch CLAUDE.md, package.json from target repo before dispatching a job | Already used in `lib/tools/github.js` via native `fetch()` with Bearer auth. The `/contents/` endpoint returns base64-encoded file content. No new SDK needed — extend the existing `githubApi()` helper. |
| Drizzle ORM (`drizzle-orm` 0.44.0) | already installed | Query `job_origins` table for recent jobs to inject as previous-job context | Already installed. Add `getRecentJobOrigins(threadId, limit)` to `lib/db/job-origins.js`. Uses existing `desc()`, `limit()`, `where()` pattern. No new library. |
| `better-sqlite3` 12.6.2 | already installed | Back Drizzle queries for job history | Already installed. No change. |
| Node.js `Buffer` (built-in) | Node 22 (already in Dockerfile) | Decode base64 content from GitHub Contents API response | Standard: `Buffer.from(response.content, 'base64').toString('utf8')`. No additional dependency. |
| Bash (already in entrypoint) | bash 5.x (bookworm) | Conditional PR creation — check git diff before `gh pr create` | Already the entrypoint shell. `git diff --quiet HEAD` exits non-zero if there are commits beyond main; used to skip PR creation when Claude made no commits. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new | — | — | All new features compose on existing infrastructure |

No new npm dependencies are needed for any of the three feature areas.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `jq` (already in Docker image) | Parse `package.json` fields (name, description, scripts) in entrypoint.sh before dispatch | Can extract `name`, `description`, `engines.node`, `scripts` keys from package.json in bash without Node.js |
| `gh` CLI (already in Docker image) | Conditional PR creation via `gh pr create` with `--skip-if-empty` | `gh pr create` already used in entrypoint; add guard before calling it |

---

## Feature-by-Feature Stack Analysis

### Feature 1: Smart Job Prompts (Repo Context Injection)

**What it does:** Before dispatching a job, the Event Handler reads CLAUDE.md, package.json, and any relevant context from the target repo, then injects it into the job description sent to Claude Code.

**Where it lives:** `lib/tools/create-job.js` — the `createJob(jobDescription)` function.

**What to add:** A new helper `getRepoContext(owner, repo, ref)` in `lib/tools/github.js` that calls the GitHub Contents API for each file. The function returns an object with `claudeMd`, `packageJson` (parsed), and `techStack` (derived from package.json `dependencies`). `createJob()` calls this before writing `logs/{jobId}/job.md`, then prepends a `## Repo Context` section to the job description.

**GitHub Contents API — verified behavior:**
```
GET /repos/{owner}/{repo}/contents/{path}
Authorization: Bearer {GH_TOKEN}
Accept: application/vnd.github+json
```
Response: `{ content: "<base64>", encoding: "base64", size: <bytes> }`
File not found: HTTP 404 — does NOT throw, `fetch()` returns `res.ok = false` silently. Must check `res.ok` before calling `res.json()`.
Size limit: Up to 1MB in standard response. CLAUDE.md and package.json are well within this.

**Pattern for graceful 404 handling (fits codebase conventions):**
```javascript
async function getRepoFileContent(owner, repo, path, ref = 'main') {
  const { GH_TOKEN } = process.env;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    {
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  if (!res.ok) return null; // 404 = file doesn't exist, not an error
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf8');
}
```

**Target repo lookup:** The Event Handler already has `GH_OWNER` and `GH_REPO` env vars scoped to the ClawForge/StrategyES repo. For smart prompts, the target repo context is the same repo the job will execute in — so `GH_OWNER`/`GH_REPO` correctly identifies the right repo for fetching context. No new env vars needed.

**Rate limit consideration:** Each `createJob()` call adds 2 GitHub API calls (CLAUDE.md + package.json). Existing `getJobStatus()` already does multiple calls per invocation. At the current volume (< 50 jobs/day), this is well within the 5,000 req/hour authenticated limit. No caching needed yet.

**Confidence: HIGH** — verified from official GitHub Docs for `/repos/{owner}/{repo}/contents/{path}` and direct inspection of `lib/tools/github.js` (the `githubApi()` helper pattern to extend).

---

### Feature 2: Pipeline Hardening

**Conditional PR creation (entrypoint.sh):**

Current: `gh pr create` runs if `CLAUDE_EXIT -eq 0` regardless of whether Claude committed anything.
Problem: Claude may succeed (exit 0) but make no commits (e.g., read-only job, or task completed in a single response). Empty PRs pollute auto-merge queue and confuse notifications.

**Fix:** Check for commits beyond main before calling `gh pr create`:

```bash
# Count commits on this branch that aren't on main
COMMITS_AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

if [ "$CLAUDE_EXIT" -eq 0 ] && [ "$COMMITS_AHEAD" -gt 0 ]; then
    gh pr create \
        --title "clawforge: job ${JOB_ID}" \
        --body "Automated job by ClawForge" \
        --base main || true
elif [ "$CLAUDE_EXIT" -eq 0 ] && [ "$COMMITS_AHEAD" -eq 0 ]; then
    echo "Job succeeded but made no commits — skipping PR creation"
fi
```

This uses standard Git CLI already in the Docker image. No new tools.

**Notification accuracy (`notify-job-failed.yml`):**

Current problem: `notify-job-failed.yml` references `logs/${JOB_ID}/claude-output.json` but Phase 2 switched the output file to `.jsonl`. This causes the failure notification to send empty log content.

Fix: Update the file reference from `claude-output.json` to `claude-output.jsonl`. This is a one-line YAML change — no library addition.

**GitHub webhook `notify-pr-complete.yml` — silent PR-not-found failure:**

Current: If no PR was created (e.g., no commits), the `notify-pr-complete.yml` step fails with "No PR found for branch" and exits 1, causing a missed notification. This propagates a pipeline failure when the job actually succeeded.

Fix: Add `continue-on-error: true` to the "Get PR number" step, OR restructure to check PR existence before attempting notification. Preferred: skip notification gracefully if no PR found, send a lightweight "job completed, no changes" payload instead.

**Confidence: HIGH** — verified from direct inspection of `entrypoint.sh`, `notify-job-failed.yml`, and `notify-pr-complete.yml`.

---

### Feature 3: Previous Job Context Injection

**What it does:** When the agent dispatches a job for a thread, it retrieves the last N completed jobs for that thread and includes a summary in the job prompt, so Claude Code starts warm.

**Where context lives:** Two sources:
1. `job_origins` table: maps `jobId → threadId`. Has `createdAt` timestamp. Queryable with Drizzle.
2. `notifications` table: contains the summarized job result for each completed job (stored in `notification` column).

**Data model gap:** The `job_origins` table tracks job creation but NOT job completion status or result. The `notifications` table stores results but is NOT indexed by `threadId` or `jobId` — it stores the full JSON payload in `payload` (text). To join previous jobs to their results requires either:
  - A: Querying `job_origins` by `threadId`, then looking up each `jobId` in notifications.payload (JSON substring match — fragile)
  - B: Adding a `threadId` column to `notifications` at completion time
  - C: Storing the last N job summaries in the `settings` table keyed by `threadId`
  - **Recommended: Option A for now** — query `job_origins` for recent jobs in this thread, then for each `jobId` scan `notifications.payload` for a match. At < 50 jobs total this is acceptable. When payload grows, add a `jobId` index.

**Query pattern for recent jobs (uses existing Drizzle pattern in codebase):**
```javascript
// lib/db/job-origins.js — new function
import { eq, desc } from 'drizzle-orm';

export function getRecentJobOriginsByThread(threadId, limit = 3) {
  const db = getDb();
  return db
    .select()
    .from(jobOrigins)
    .where(eq(jobOrigins.threadId, threadId))
    .orderBy(desc(jobOrigins.createdAt))
    .limit(limit)
    .all();
}
```

**Agent injection mechanism:** The existing `addToThread()` function in `lib/ai/index.js` injects AI messages into thread memory. However, for previous-job context, the better approach is injecting it into the job description itself (in `createJob()`), not into the agent's conversation state. Reason: the job container runs in isolation and doesn't share LangGraph state. The job prompt is the only communication channel into the container.

**Implementation:** `createJob()` calls `getRecentJobOriginsByThread(threadId, 3)`, queries `notifications` for each `jobId`, extracts the `notification` summary text, and prepends a `## Previous Jobs` section to the job description.

**Confidence: HIGH** — based on direct inspection of `lib/db/schema.js`, `lib/db/job-origins.js`, `lib/db/notifications.js`, and `lib/tools/create-job.js`.

---

## Installation

No new packages to install. All three features use existing infrastructure.

```bash
# No new npm install required
# All features compose on:
# - lib/tools/github.js (githubApi helper)
# - lib/db/job-origins.js (Drizzle + better-sqlite3)
# - lib/db/notifications.js (Drizzle + better-sqlite3)
# - docker/job/entrypoint.sh (bash + git + gh CLI)
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Extend `githubApi()` in `github.js` | Add `@octokit/rest` SDK | Use Octokit if you need pagination, GraphQL, retry logic, or type safety. At current scale, the existing `fetch()` wrapper is sufficient and adds no dependency. |
| Query `job_origins` + `notifications` via Drizzle | LangGraph `getStateHistory()` | Use `getStateHistory()` only if you need the full conversation replay (all message turns). For "last N job summaries," `notifications` table is simpler and already stores the right data. |
| Inject repo context into job description (job.md) | Inject via `--append-system-prompt` | Use `--append-system-prompt` if context is static per-instance (like SOUL.md). Dynamic per-repo context belongs in the job prompt, not the system prompt, because it changes per job. |
| `git rev-list --count origin/main..HEAD` for conditional PR | `git status --porcelain` | `git status --porcelain` checks for uncommitted changes; `rev-list --count` checks for commits beyond main. Use `rev-list` — Claude Code commits changes before exiting, so the question is "did commits happen?" not "are there uncommitted files?". |
| Graceful 404 return `null` from `getRepoFileContent()` | Throw on 404 | Throw only if CLAUDE.md is required. Since CLAUDE.md may not exist in every target repo, returning `null` and skipping that context section is correct. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@octokit/rest` or `@octokit/graphql` | Zero marginal benefit vs. the existing `githubApi()` pattern. Adds 300KB+ to the bundle and a new dep to maintain. | `githubApi()` in `lib/tools/github.js` — the existing `fetch()`-based helper with `X-GitHub-Api-Version: 2022-11-28` |
| Injecting repo context via agent system prompt (`EVENT_HANDLER.md`) | System prompt is static at agent startup. Repo context must be dynamic per-job (different repos, different CLAUDE.md). | Inject via `createJob()` into `job.md` — the job description is the dynamic payload. |
| Caching GitHub Contents API responses in SQLite | Premature optimization at current volume. A stale CLAUDE.md is worse than a fresh API call. | No cache. The GitHub API call adds ~100ms to job dispatch — acceptable latency. |
| LangGraph `InjectedState` for passing previous job context to `create_job` tool | Community finding: tools using `InjectedState` are frequently ignored by the LLM. The agent stops calling the tool reliably. | Pass context directly into `job_description` argument — the agent sends it explicitly, no hidden state injection. |
| Adding a `completed_at` or `result` column to `job_origins` table | Premature schema expansion. Completion data already lives in `notifications`. | Join `job_origins` + `notifications` at query time. Add schema columns only if query becomes slow. |
| Empty commit guard with `git commit --allow-empty` | Creates noise in git history. The auto-merge + notification pipeline treats any commit as work done. | Skip the commit step if `git status --porcelain` is empty after claude runs. |

---

## Stack Patterns by Variant

**If target repo has no CLAUDE.md:**
- `getRepoFileContent()` returns `null` for that path
- Skip the `## Repo Context` section in the job description
- Still include package.json context if available

**If target repo is private and `GH_TOKEN` has read access:**
- No change — `GH_TOKEN` already scoped to the instance repo (which may be private)
- For cross-repo context (e.g., Noah's agent reading a client repo), would need a new token scope — defer to future milestone

**If job thread has no previous jobs:**
- `getRecentJobOriginsByThread(threadId, 3)` returns `[]`
- Skip the `## Previous Jobs` section entirely
- No error, no fallback needed

**If Claude exit code is non-zero but commits were made:**
- Still push commits (current behavior)
- Skip PR creation (current behavior is correct — failure notified via `notify-job-failed.yml`)
- The new `COMMITS_AHEAD` check only applies within the success branch

---

## Version Compatibility

| Component | Current Version | Notes |
|-----------|-----------------|-------|
| `drizzle-orm` 0.44.0 | Node 22, better-sqlite3 12.6.2 | `desc()`, `limit()`, `where()` chaining confirmed working in existing `lib/db/chats.js`. The new `getRecentJobOriginsByThread()` uses the same pattern. |
| GitHub API `v2022-11-28` | Current (no deprecation announced as of 2026-02) | Contents endpoint is stable. Base64 encoding is the default and only option for files ≤ 1MB. |
| `Buffer.from(content, 'base64')` | Node 22 | Built-in. No polyfill. Works identically to Node 18+. |
| `git rev-list --count` | git 2.x (bookworm includes 2.39) | Standard git command. `--count` flag stable since git 1.9. |

---

## Integration Points (Where Code Changes Land)

| File | What Changes | Why |
|------|-------------|-----|
| `lib/tools/github.js` | Add `getRepoContext(owner, repo, ref)` and `getRepoFileContent(owner, repo, path, ref)` | Smart job prompts — fetch CLAUDE.md + package.json before dispatch |
| `lib/tools/create-job.js` | Call `getRepoContext()` and `getRecentJobOriginsByThread()`, prepend context sections to job description | Smart job prompts + previous job context injection |
| `lib/db/job-origins.js` | Add `getRecentJobOriginsByThread(threadId, limit)` | Previous job context: query recent jobs for this thread |
| `lib/db/notifications.js` | Add `getNotificationByJobId(jobId)` — scan notifications.payload for jobId match | Previous job context: retrieve job result summaries |
| `docker/job/entrypoint.sh` | Add `git rev-list --count origin/main..HEAD` guard before `gh pr create` | Conditional PR — avoid empty PRs when Claude makes no commits |
| `.github/workflows/notify-job-failed.yml` | Change `claude-output.json` reference to `claude-output.jsonl` | Fix silent empty log in failure notifications |
| `.github/workflows/notify-pr-complete.yml` | Add graceful handling when no PR found (job succeeded with no changes) | Pipeline accuracy — don't fail notification on no-PR jobs |

---

## Sources

- GitHub Docs: `https://docs.github.com/en/rest/repos/contents` — Contents API endpoint structure, base64 encoding, 404 behavior, 1MB size limit (HIGH confidence, verified from official docs)
- Direct codebase inspection: `lib/tools/github.js` — `githubApi()` pattern, existing fetch wrapper with `X-GitHub-Api-Version: 2022-11-28` header (HIGH confidence)
- Direct codebase inspection: `lib/tools/create-job.js` — Job creation flow, where to inject context (HIGH confidence)
- Direct codebase inspection: `lib/db/schema.js` — Schema for `job_origins`, `notifications`, `messages` — confirms no `threadId` on notifications (HIGH confidence)
- Direct codebase inspection: `lib/db/chats.js` — Drizzle `desc()` + `limit()` + `orderBy()` pattern to replicate (HIGH confidence)
- Direct codebase inspection: `lib/db/notifications.js` — `notification` column stores LLM-generated summary text (HIGH confidence)
- Direct codebase inspection: `docker/job/entrypoint.sh` — Current PR creation logic, git setup, bash patterns (HIGH confidence)
- Direct codebase inspection: `.github/workflows/notify-job-failed.yml` — `claude-output.json` reference bug (HIGH confidence)
- LangGraph JS docs: `https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph.CompiledStateGraph.html` — `getState()` / `getStateHistory()` API (MEDIUM confidence — confirmed InjectedState reliability issue from community reports)
- Community finding on `InjectedState`: `https://langchain-ai.github.io/langgraphjs/` — tools using InjectedState ignored by LLM (MEDIUM confidence — community source, aligns with known LangGraph tool behavior)
- `git rev-list --count` — standard git documentation (HIGH confidence — stable flag since git 1.9)

---

*Stack research for: ClawForge v1.1 — Smart job prompts, pipeline hardening, previous job context*
*Researched: 2026-02-24*
