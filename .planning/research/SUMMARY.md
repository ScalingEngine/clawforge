# Project Research Summary

**Project:** ClawForge v1.1 — Smart Job Prompts, Pipeline Hardening, Previous Job Context
**Domain:** Claude Code CLI agent orchestration — context injection, pipeline reliability, job history
**Researched:** 2026-02-24
**Confidence:** HIGH

## Executive Summary

ClawForge v1.1 is an enhancement milestone for an existing, working agentic pipeline. The v1.0 foundation (LangGraph Event Handler, Claude Code job containers, GitHub Actions orchestration, SQLite/Drizzle for job tracking) is validated and stable. The three v1.1 capabilities — smart job prompts, pipeline hardening, and previous job context injection — are additive to this foundation and require no new runtime dependencies, no new channels, and no new infrastructure. All implementation lands in existing modules (`lib/tools/`, `lib/db/`, `lib/ai/`, GitHub Actions workflows), with one new module (`lib/tools/repo-context.js`) and one new DB table (`job_outcomes`).

The recommended build sequence is fixed by dependency: pipeline hardening first (lowest risk, establishes reliable test outcomes for the other two features), repo context injection second (purely additive, no schema changes, fastest to validate by inspecting `job.md`), and previous job context third (requires schema migration, new DB module, and webhook handler coordination — highest moving-part count). The most consequential architectural decision in the milestone is where repo context is fetched: inside the job container after clone (reading from `/job/CLAUDE.md` on disk) is the safe, fresh approach; Event Handler pre-fetching before branch creation risks serving stale context if the target repo advances during the job queue delay. Research recommends entrypoint-side reading as the primary mechanism.

The top security concern is indirect prompt injection via CLAUDE.md fetched from target repos — confirmed as an active attack vector by Snyk ToxicSkills research and CVE-2025-54794. Mitigations are required before smart prompts ship: wrap injected CLAUDE.md in explicit "read-only reference" framing, strip second-person imperatives, and limit fetching to repos within `GH_OWNER`. The top operational concern across all three features is that context fetching must be best-effort — a missing CLAUDE.md, GitHub API timeout, or rate limit response must never block job creation. Timeout wrappers with graceful empty-string fallbacks are mandatory.

---

## Key Findings

### Recommended Stack

No new npm dependencies are required for any of the three feature areas. All new capabilities compose on the existing stack. The GitHub Contents API (`/repos/{owner}/{repo}/contents/{path}`) is accessed via the existing `githubApi()` helper in `lib/tools/github.js` — no new SDK needed. Drizzle ORM with `better-sqlite3` handles the new `job_outcomes` table using the same `desc()`/`limit()`/`where()` pattern already in `lib/db/chats.js`. Conditional PR creation is a one-line bash guard using `git rev-list --count origin/main..HEAD`, already available in the Docker image.

**Core technologies (all pre-existing):**
- **GitHub REST API v2022-11-28**: Fetch CLAUDE.md and package.json from target repos — extend existing `githubApi()` helper; no new SDK; base64 decode via `Buffer.from(response.content, 'base64').toString('utf8')`
- **Drizzle ORM 0.44.0 + better-sqlite3 12.6.2**: New `job_outcomes` table using exact same patterns as `lib/db/chats.js` and `lib/db/job-origins.js`
- **bash + git + gh CLI (already in Docker image)**: `git rev-list --count origin/main..HEAD` for conditional PR guard; `cat /job/CLAUDE.md` for entrypoint-side context reading
- **Node.js `Buffer` (built-in, Node 22)**: Base64 decode for GitHub Contents API responses

**Key stack decision — where to fetch context:** STACK.md recommends fetching in `createJob()` (Event Handler). PITFALLS.md (Pitfall 1) identifies that this produces stale context if the target repo advances between job creation and container execution. Resolution: read CLAUDE.md and package.json from the cloned repo inside `entrypoint.sh` as the authoritative source; Event Handler pre-fetching is a warm-start supplement only. For initial v1.1 implementation, entrypoint-side reads are the recommended approach.

### Expected Features

**Must have (table stakes for v1.1):**
- **Pipeline hardening — conditional PR on success only**: Verify end-to-end `CLAUDE_EXIT != 0` suppresses PR; `notify-job-failed.yml` fires correctly for real failures
- **Pipeline hardening — failure notification to originating channel**: Failed Slack-dispatched jobs notify in the originating Slack thread
- **Pipeline hardening — failure stage categorization**: Notification distinguishes `docker_pull_failed` / `auth_failed` / `claude_failed` so operators debug the right layer
- **Repo context in job description**: CLAUDE.md + package.json embedded in `job.md` before container execution; agent starts warm, not cold-discovering the stack
- **Structured job description template**: Consistent sections (Target, Context, Stack, Task, GSD Hint) for reliable agent anchoring
- **Quick vs plan-phase routing heuristic**: Keyword-based GSD command suggestion in job description

**Should have (add after v1.1 validation):**
- **Previous job context injection**: Prior job PR summary and changed files injected when follow-up messages reference a completed job; HIGH value, HIGH complexity (requires `job_outcomes` schema, webhook handler, new agent tool)
- **Repo context cache with 60-second TTL**: In-memory Map per repo to prevent GitHub API rate exhaustion on burst job creation
- **Notification accuracy audit**: Review 10+ real job outcomes to find routing gaps

**Defer to v2+:**
- Agent learning from job history (requires significant job volume to be meaningful)
- Multi-repo single-job model (conflicts with single-repo-per-container isolation)
- Automatic retry with corrected prompt (complex orchestration; most failures are prompt-related, not transient)

### Architecture Approach

The architecture strictly preserves the Event Handler / Job Container boundary. All new logic for repo context lives in the Event Handler layer (`lib/tools/repo-context.js` as a best-effort context orchestrator, or alternatively in `entrypoint.sh` for freshness). Job completion history lives in a new SQLite table (`job_outcomes`) populated at webhook receipt time. The job container reads what it needs from the already-cloned repo. No new channels, no new process boundaries, no changes to container isolation.

**Major components and v1.1 changes:**
1. **`lib/tools/repo-context.js` (NEW)** — best-effort fetcher for CLAUDE.md + package.json; wraps each call in try-catch with 5-second `Promise.race()` timeout; returns formatted markdown or empty string on failure
2. **`lib/tools/create-job.js` (MODIFY)** — calls `fetchRepoContext()` before writing `job.md`; appends non-empty context blocks to job description; calls `getRecentJobOriginsByThread()` for previous-job section
3. **`lib/tools/github.js` (MODIFY)** — add `getFileContents(owner, repo, path, branch)` and `getRepoTree()` helpers
4. **`lib/db/job-outcomes.js` (NEW)** — `saveJobOutcome()`, `getJobOutcomes()`, `getJobOutcome()` for persisting webhook payload at completion time
5. **`lib/db/schema.js` (MODIFY)** — add `jobOutcomes` table: `job_id`, `thread_id`, `status`, `description`, `changed_files`, `pr_url`, `merge_result`, `log_summary` (truncated 2KB)
6. **`api/index.js` GitHub webhook handler (MODIFY)** — after `createNotification()`, also call `saveJobOutcome()` (non-blocking, try-catch)
7. **`lib/ai/tools.js` (MODIFY)** — extend `createJobTool` with optional `target_repo`; add `getRecentJobsTool` querying `job_outcomes`
8. **`.github/workflows/run-job.yml` (MODIFY)** — add `timeout-minutes: 30`; verify no exit code masking
9. **`.github/workflows/notify-pr-complete.yml` (MODIFY)** — harden merge state detection; handle no-PR case gracefully
10. **`.github/workflows/notify-job-failed.yml` (MODIFY)** — add step failure categorization; fix `claude-output.json` → `claude-output.jsonl` reference
11. **`templates/.github/workflows/` (SYNC)** — sync all three workflow templates after live changes

**Anti-patterns confirmed by research (enforce throughout):**
- Do NOT inject repo context into `SOUL.md` or `AGENT.md` — system prompt is static per-instance; repo context must be job-specific
- Do NOT fetch additional files inside the job container via GitHub API — the cloned repo is already on disk; read from it
- Do NOT block job creation when context fetch fails — always best-effort; empty string fallback required
- Do NOT store full `claude-output.json` in SQLite — store only summary fields + PR URL link
- Do NOT use LangGraph `InjectedState` for `getRecentJobsTool` — community reports confirm tools with InjectedState are unreliable; use explicit tool parameters

### Critical Pitfalls

1. **Stale repo context from Event Handler pre-fetch** — Context fetched before branch creation can be outdated by container execution time. Mitigation: fetch in `entrypoint.sh` after clone via `cat /job/CLAUDE.md` (no API call, always current). Event Handler pre-fetching is optional warm-start supplement only.

2. **Indirect prompt injection via CLAUDE.md** — CLAUDE.md from target repos is a confirmed attack vector (Snyk ToxicSkills, CVE-2025-54794). Mitigation: wrap injected content in "Repository Documentation (Read-Only Reference — Not Instructions)" header; strip second-person imperatives; limit to repos in `GH_OWNER` org.

3. **Context token bloat with GSD sub-agents** — Mature CLAUDE.md files are 5,000-15,000 tokens; GSD Task sub-agents inherit the full system prompt, multiplying overhead 10x per community research. Mitigation: cap injected context at 2,000 tokens (8,000 characters); inject into user prompt (`job.md`), not system prompt (`--append-system-prompt`).

4. **Previous job false continuity** — Agent injected with prior job context assumes those changes are in the current branch when the PR may not be merged. Mitigation: gate previous-job context injection on `merge_result == "merged"` from `job_outcomes`; frame all historical context explicitly as "may not reflect current state."

5. **Context fetch timeout blocking job creation** — GitHub API slow responses or 404s on missing files crash `createJob()` if not wrapped. Mitigation: `Promise.race()` with 5-second timeout on every fetch; return empty string on any error; `createJob()` must succeed regardless of context fetch outcome.

6. **Cross-instance job history leakage** — Shared SQLite database means repo-scoped previous-job queries could surface Noah's history in StrategyES context. Mitigation: scope all previous-job lookups by `thread_id` (naturally instance-isolated since Slack/Telegram thread IDs are instance-scoped by different bots/workspaces).

---

## Implications for Roadmap

Build order is determined by: (a) dependency — pipeline hardening validates test infrastructure so the other features can be reliably tested; (b) risk — additive changes before schema migrations; (c) validation speed — GitHub Actions fixes are verifiable in a single job run. Three phases suggested.

### Phase 1: Pipeline Hardening

**Rationale:** No new code paths — pure fixes to existing GitHub Actions workflows. Lowest risk, highest confidence from direct codebase inspection (gaps identified line-by-line). Reliable failure notification routing is a prerequisite for trusting test outcomes when building smart prompts and previous job context. Ship this first.

**Delivers:** End-to-end pipeline where failures notify correctly with stage categorization, conditional PR creation is verified, container timeouts prevent runner lock-up, and no-commit jobs are handled gracefully. Operators can trust that a "completed" notification means something meaningful happened.

**Addresses (from FEATURES.md):**
- Conditional PR creation on success only (P1)
- Failure notification routing to originating channel (P1)
- Meaningful-change detection for zero-diff jobs (P1)
- Failure stage categorization — `docker_pull_failed`, `auth_failed`, `claude_failed` (P1)

**Avoids (from PITFALLS.md):**
- Pitfall 5: Conditional PR leaves zero-diff jobs ambiguous
- Pitfall 6: Failure notification fires for wrong failure causes
- Reduces blast radius for Pitfall 8 (solid job creation foundation before adding context fetch latency)

**Files changed:** `.github/workflows/run-job.yml`, `notify-pr-complete.yml`, `notify-job-failed.yml`, `templates/.github/workflows/` (sync all three)

**Research flag:** SKIP — standard GitHub Actions patterns verified against live code. No phase research needed.

---

### Phase 2: Smart Job Prompts

**Rationale:** Purely additive changes to `createJob()` with no schema changes or new infrastructure. One new file (`lib/tools/repo-context.js`). Fastest to validate: inspect the generated `job.md` on the next test job. Security mitigations (prompt injection framing, size budget) must ship with the feature — they are not a follow-up.

**Delivers:** Job containers start with CLAUDE.md and package.json context already in `job.md`, plus a structured job description template with GSD command routing hints. Agent produces better first-pass output because it knows the stack, conventions, and project structure before writing a single line of code.

**Uses (from STACK.md):**
- GitHub Contents API via existing `githubApi()` helper — no new SDK
- `Promise.race()` with 5-second timeout for resilience
- In-memory Map cache with 60-second TTL for rate limit protection
- `cat /job/CLAUDE.md` in `entrypoint.sh` as primary (fresh) context source

**Implements (from ARCHITECTURE.md):**
- `lib/tools/repo-context.js` (NEW) — best-effort fetcher, 5-second timeout per file, empty-string fallback
- `lib/tools/create-job.js` (MODIFY) — append context block to job description
- `lib/tools/github.js` (MODIFY) — add `getFileContents()` and `getRepoTree()`
- `lib/ai/tools.js` (MODIFY) — extend `createJobTool` with optional `target_repo` parameter

**Avoids (from PITFALLS.md):**
- Pitfall 1: Prefer entrypoint-side reads; if Event Handler pre-fetching is added, treat as supplement only
- Pitfall 2: Cap at 2,000 tokens; inject into user prompt not system prompt
- Pitfall 4: Wrap CLAUDE.md in "Read-Only Reference" framing; strip imperatives; whitelist to `GH_OWNER` org
- Pitfall 7: 60-second per-repo cache before enabling smart prompts
- Pitfall 8: `Promise.race()` timeout on all fetch calls; `createJob()` never fails due to context fetch

**Research flag:** SKIP — implementation patterns fully documented in STACK.md and ARCHITECTURE.md from direct codebase inspection. Security mitigations documented from Snyk/CVE sources.

---

### Phase 3: Previous Job Context Injection

**Rationale:** Highest coordination cost: schema migration with Drizzle codegen, new DB module, webhook handler change, and a new LangGraph agent tool. Building on a tested pipeline (Phase 1) and validated context injection (Phase 2) reduces debugging surface. The `job_outcomes` table can be informed by real webhook payloads observed in Phase 1 testing before writing the DDL.

**Delivers:** Agent can reference prior job outcomes in conversation — what files changed, whether the PR was merged, what the job accomplished. New `job_outcomes` table persists completion webhook payload. New `getRecentJobsTool` lets the LangGraph agent retrieve completed job history on demand. Follow-up job descriptions include prior job summary when the previous PR was merged and the current branch was created after that merge.

**Uses (from STACK.md):**
- Drizzle ORM `desc()`/`limit()`/`where()` — same pattern as `lib/db/chats.js`
- `drizzle-kit` migration generation via `npm run db:generate`
- Explicit tool parameters (not InjectedState) for `getRecentJobsTool`

**Implements (from ARCHITECTURE.md):**
- `lib/db/schema.js` (MODIFY) — add `jobOutcomes` table
- `lib/db/job-outcomes.js` (NEW) — CRUD for job completion data
- `api/index.js` (MODIFY) — `saveJobOutcome()` called after `createNotification()`; non-blocking try-catch
- `lib/ai/tools.js` (MODIFY) — add `getRecentJobsTool`
- `drizzle/` — generate migration SQL

**Avoids (from PITFALLS.md):**
- Pitfall 3: Gate injection on `merge_result == "merged"`; frame all historical context explicitly
- Pitfall 9: Scope all lookups by `thread_id`, not by repo — natural instance isolation
- Anti-pattern: Store only summary fields + truncated `log_summary` (2KB max); full output stays in job branch

**Research flag:** LOW — confirm `notify-pr-complete.yml` webhook payload field names against a real run before writing `job_outcomes` DDL. ARCHITECTURE.md documents expected fields, but live validation before migration generation avoids a schema re-do.

---

### Phase Ordering Rationale

- **Hardening before features:** Pipeline hardening is the safest starting point — no new code paths, just fixes. It establishes a reliable test baseline so smart prompts and previous job context can be validated trustworthily.
- **Smart prompts before job history:** Smart prompts are purely additive with no schema changes; job history requires Drizzle migration, new module, and webhook coordination. Build on a stable foundation.
- **Prompt injection mitigation is non-negotiable:** Security framing for CLAUDE.md injection ships with Phase 2, not as a follow-up. Research confirms active exploitation in agent systems; this is not a nice-to-have.
- **Context fetch location is the key design decision:** Entrypoint-side reading of cloned files is fresher and simpler than Event Handler pre-fetching. This decision affects Phases 2 and 3. Confirm approach during Phase 2 scoping before writing code.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Previous Job Context):** Quick review of live `notify-pr-complete.yml` webhook payload field names before generating the Drizzle migration. Architecture doc documents expected fields, but live validation before DDL avoids a re-migration.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Pipeline Hardening):** GitHub Actions conditional job patterns are well-documented; all gaps identified line-by-line from direct codebase inspection.
- **Phase 2 (Smart Job Prompts):** Fully documented from codebase inspection + official GitHub API docs + Snyk/CVE security research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct codebase inspection. No new dependencies. GitHub API patterns verified from official docs. Version compatibility confirmed for all existing packages. |
| Features | HIGH (P1 features) / MEDIUM (P2/P3 features) | P1 pipeline hardening features verified against live code. Previous job context injection involves LangGraph tool patterns where InjectedState reliability is MEDIUM confidence from community sources. |
| Architecture | HIGH | Integration points identified line-by-line from codebase. Component changes are small and additive. `job_outcomes` schema design borrows directly from `job-origins.js`. Webhook payload fields confirmed from live workflow inspection. |
| Pitfalls | HIGH (pipeline + API) / MEDIUM (security mitigations) / LOW (prompt injection bypass specifics) | Pipeline pitfalls verified from direct code inspection. Security mitigations from Snyk/CVE (MEDIUM). Specific bypass technique details are LOW confidence single-source community research. |

**Overall confidence:** HIGH

### Gaps to Address

- **Context fetch location (Pitfall 1 vs. Event Handler pre-fetch):** STACK.md and PITFALLS.md are in mild conflict. Resolution: entrypoint-side reading of cloned files is the primary mechanism; Event Handler pre-fetching is optional warm-start supplement. Confirm this approach during Phase 2 scoping before writing code. Do not implement both without a clear decision.

- **`job_outcomes` schema field names:** ARCHITECTURE.md documents the expected webhook payload fields, but these should be confirmed against a real `notify-pr-complete.yml` run before generating the Drizzle migration. Resolve during Phase 3 scoping by inspecting a live webhook payload.

- **LangGraph `getRecentJobsTool` design:** Avoid `InjectedState` — implement as a standard tool with explicit parameters the agent calls directly. Confirm tool call pattern aligns with how `getJobStatusTool` is registered before writing the new tool.

- **Token budget validation:** Research recommends capping injected context at 2,000 tokens (roughly 8,000 characters). Validate empirically on the first smart prompt test job by comparing token counts before and after injection. Adjust cap if the budget causes agent context issues.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `lib/tools/create-job.js` — job creation flow, injection point, GitHub API call patterns
- `lib/tools/github.js` — `githubApi()` helper pattern to extend
- `lib/db/schema.js`, `lib/db/job-origins.js`, `lib/db/chats.js` — existing Drizzle schema and query patterns
- `lib/ai/tools.js` — LangGraph tool definitions, `createJobTool` schema
- `lib/ai/agent.js` — LangGraph agent structure and tool registration
- `api/index.js` — GitHub webhook handler flow
- `docker/job/entrypoint.sh` — job container execution, conditional PR logic, bash patterns
- `.github/workflows/run-job.yml`, `notify-pr-complete.yml`, `notify-job-failed.yml` — pipeline workflows
- `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md` — existing concerns and architecture analysis

### Secondary (MEDIUM confidence — official docs)
- GitHub REST API: `https://docs.github.com/en/rest/repos/contents` — Contents API, base64 encoding, 404 behavior, 1MB limit
- GitHub REST API: `https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api` — 5,000 req/hour authenticated
- Claude Code headless mode: `https://code.claude.com/docs/en/headless` — `-p` mode, `--append-system-prompt` behavior
- Claude Code GitHub Actions: `https://code.claude.com/docs/en/github-actions` — CLAUDE.md auto-loading at container runtime
- Anthropic context engineering: `https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents` — smallest set of high-signal tokens principle
- LangGraph JS docs — `InjectedState` tool reliability; `getState()` / `getStateHistory()` API
- Anthropic long-running agent harnesses: `https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents` — previous job context failure modes
- Snyk ToxicSkills: `https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/` — indirect prompt injection via config files; 18% of agent skills fetch untrusted content
- CVE-2025-54794: `https://cymulate.com/blog/cve-2025-547954-54795-claude-inverseprompt/` — confirmed prompt injection via formatted content

### Tertiary (LOW confidence — community, single source)
- DEV community: Claude Code subagents waste 50K tokens per turn — 10x token overhead from system prompt injection in sub-agents
- Lasso Security: repository-based prompt injection via documentation files
- Community reports on LangGraph InjectedState tool reliability — agent stops calling tools with hidden state injection

---
*Research completed: 2026-02-24*
*Ready for roadmap: yes*
