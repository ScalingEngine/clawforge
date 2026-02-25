# Feature Research

**Domain:** Agent orchestration — smart job prompts, pipeline hardening, and previous job context injection
**Researched:** 2026-02-24
**Confidence:** HIGH for pipeline hardening patterns (well-understood GitHub Actions); MEDIUM for repo context injection design (verified against live codebase + GitHub API docs); MEDIUM for previous job context (LangGraph checkpoint patterns verified, Skill-specific schemas still LOW from prior research)

---

## Context: What "Smart Job Prompts" Means Here

This milestone is NOT about building a general observability platform or adding new channels. It is about three specific improvements to an existing working pipeline:

1. **Smart job prompts** — the Event Handler (LangGraph dispatcher) fetches repo-specific context (CLAUDE.md, package.json, tech stack) via GitHub API *before* calling `create_job`, embedding that context into the job description so the container agent starts informed rather than cold-discovering the codebase.

2. **Pipeline hardening** — the GitHub Actions + entrypoint + notification chain has known failure modes (silent failures, incorrect PR creation on errors, notification routing gaps). These need systematic fixes.

3. **Previous job context injection** — when Noah sends follow-up messages about an existing job (corrections, clarifications, additional requirements), the dispatcher should be able to reference prior job output when creating the new job, rather than starting from zero.

All features are scoped to what changes are needed *on top of* the v1.0 baseline (working entrypoint, GSD observability, imperative AGENT.md). The container execution model does not change.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must exist for the milestone to be usable. Missing these = the system feels broken or requires constant babysitting.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Job prompt includes target repo context | Without this, the container agent spends its first tool calls discovering what language/framework the repo uses — wasted tokens, slower results, no awareness of project-specific conventions | MEDIUM | Requires: GitHub API call to fetch CLAUDE.md + package.json from target repo before `create_job` fires; Event Handler must resolve repo owner/name from job description text; result embedded in job description |
| Pipeline fails loudly on entrypoint errors | Silent failures produce a commit + PR with nothing meaningful in it; operator wastes time reviewing an empty-output PR thinking the job worked | LOW | Requires: `set -e` already exists; add explicit exit code propagation in `run-job.yml`; `notify-job-failed.yml` must fire on non-zero exit, not just on cancelled runs |
| Conditional PR creation (only on success) | Creating a PR after a failed job pollutes the PR queue with noise and triggers auto-merge candidates that should not be merged | LOW | Already partially implemented in entrypoint: `if [ "$CLAUDE_EXIT" -eq 0 ]`; the gap is that `run-job.yml` may not correctly distinguish zero vs non-zero Claude exit; verify end-to-end |
| Failure notification reaches originating channel | If a Slack-dispatched job fails, Noah needs a notification in that Slack thread — not just a GitHub Actions status badge he has to go check | MEDIUM | Requires: `notify-job-failed.yml` correctly reads job origin from DB (via webhook to Event Handler); `getJobOrigin(jobId)` lookup must succeed; channel routing must match the originating adapter |
| Notification accuracy — success vs failure routing | Current code paths exist for both outcomes but haven't been validated against real failed jobs with origin tracking in place | LOW | Mechanical verification + test job exercise |

### Differentiators (Competitive Advantage)

Features that make the system meaningfully smarter than a basic "describe task, run container" dispatcher.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dispatcher fetches CLAUDE.md before job creation | The container agent already reads the target repo's CLAUDE.md at runtime (it's in the repo). The dispatcher reading it *before* dispatch means the job description can reference specific patterns, file locations, and conventions — making the job description much more actionable than "add a feature to strategyes-lab" | MEDIUM | GitHub API: `GET /repos/{owner}/{repo}/contents/CLAUDE.md` with `Accept: application/vnd.github.raw+json`; decode base64 response; inject into job description template; cache per-session to avoid redundant API calls |
| Dispatcher infers tech stack from package.json | Knowing "this is a Next.js 14 app with Supabase and Tailwind" lets the dispatcher write a job description that includes framework-specific instructions, avoiding the agent discovering this itself or making wrong assumptions | MEDIUM | Same API call pattern as CLAUDE.md; parse `dependencies` + `devDependencies`; produce a one-paragraph tech stack summary injected into job description header; handle repos with no package.json gracefully |
| Previous job output injected on follow-up | When Noah says "actually, also do X in that job" or "the job finished but there's a bug", the dispatcher has the prior job's PR summary and can construct a follow-up job description that references specific files changed, errors encountered, and prior context — instead of starting cold | HIGH | Requires: retrieve PR body + merged files from GitHub API using stored job_id; or read `gsd-invocations.jsonl` + `observability.md` from the job branch; inject as "Prior job context" section in new job description; complexity is in knowing *which* prior job is relevant |
| Quick vs plan-phase routing threshold in dispatcher | The Event Handler currently creates all jobs with the same generic job description. A routing heuristic (task size estimate based on message complexity) can automatically suggest `/gsd:quick` for small tasks and `/gsd:plan-phase` + `/gsd:execute-phase` for complex ones — saving the container agent from using the wrong GSD workflow | MEDIUM | Pattern match on job description complexity signals: file count mentioned, "refactor" / "implement" / "add a feature" → plan-phase; "fix" / "update" / "add a comment" → quick; configurable thresholds in EVENT_HANDLER.md |
| Repo context cached per-session | Fetching CLAUDE.md + package.json on every message creates latency and GitHub API quota pressure. A 15-minute in-memory cache per repo eliminates redundant fetches when Noah is working on one project across multiple messages | LOW | Simple Map() with TTL; keyed by `{owner}/{repo}`; no persistence needed; lives in Event Handler process memory |
| Job description template with structured sections | Today job descriptions are free-form text. A structured template (Target Repo, Tech Stack, Prior Context, Task Description, GSD Command Hint) gives the container agent consistent anchors to read — reducing hallucination about what repo to target or what framework to use | LOW | Entrypoint already reads `job.md` as raw text; no format requirement; template is a prompt engineering improvement, not a schema change |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like good ideas for this milestone but create real problems when built.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fetch entire repository tree before dispatch | "More context = better job" | GitHub API rate limits hit fast for large repos; cloning context window with file paths adds noise, not signal; the container agent already has the entire repo checked out and can explore it | Fetch only high-signal files: CLAUDE.md, package.json, README.md (first 100 lines). Agent handles exploration |
| Previous job context from conversation history | "Just re-read the LangGraph thread" | LangGraph checkpointer stores the full conversation; including it in job descriptions creates circular context that confuses the container agent; conversation history is for the dispatcher, not the container | Fetch specific job artifacts (PR body, observability.md) from GitHub API instead of replaying conversation |
| Auto-approve jobs without user confirmation | "Noah is typing 'do X' and you should just do it" | The Event Handler's approval gate (present description → wait → create) is a safety mechanism, not just UX. Auto-approve means a misunderstood request fires without correction. Already identified as CRITICAL in EVENT_HANDLER.md | Keep approval gate; reduce friction by pre-filling the proposed description with repo context so Noah sees a concrete well-formed plan and can approve faster |
| Retry failed jobs automatically | "If the container fails, just try again" | Without diagnosing why it failed, retry loops waste API tokens and GitHub Actions minutes. Most failures are prompt-related (wrong task), not transient. | Notify with failure context; let Noah decide whether to retry with a corrected description |
| Per-request GitHub API calls without caching | "Always get fresh context" | GitHub API: 5,000 requests/hour (authenticated). A conversation with 20 job proposals already burns 40-60 API calls for CLAUDE.md + package.json. Without caching, a busy session exhausts quota. | Cache per repo with 15-minute TTL; acceptable staleness for in-session context |
| Dispatcher summarizes job output by re-reading the transcript | "Get the full picture of what happened" | The claude-output.json in job branches can be megabytes of stream-json. Re-reading it from GitHub API is slow, expensive, and the full transcript is too noisy for the dispatcher. | Use the `observability.md` file (already generated by entrypoint) which contains the curated GSD invocation summary — small, structured, human-readable |

---

## Feature Dependencies

```
[Repo Context Fetching (GitHub API)]
    └──required by──> [Job description includes CLAUDE.md context]
    └──required by──> [Job description includes tech stack summary]
    └──enhances──> [Quick vs plan-phase routing threshold]

[Repo context cache (in-memory TTL)]
    └──required by──> [Repo Context Fetching] (prevents quota exhaustion)

[Previous job context injection]
    └──requires──> [Job origin tracking (job_id → thread_id)] (already in DB from v1.0)
    └──requires──> [observability.md in job branch] (produced by v1.0 entrypoint)
    └──requires──> [GitHub API to fetch job branch artifacts]

[Conditional PR on success only]
    └──required by──> [Failure notification accuracy] (PR absence = failure signal)
    └──requires──> [Claude exit code propagation through run-job.yml]

[Failure notification to originating channel]
    └──requires──> [Conditional PR (so failure path is distinct)]
    └──requires──> [Job origin tracking] (already in DB from v1.0)
    └──requires──> [notify-job-failed.yml webhook fires correctly]

[Job description template]
    └──enhances──> [All context injection features] (provides structure for injected sections)
    └──enhances──> [Quick vs plan-phase routing] (routing hint has a consistent location to appear)

[Quick vs plan-phase routing threshold]
    └──enhances──> [Job description template] (routing hint added as a section)
    └──requires──> [Repo context] (larger context helps routing decision)
```

### Dependency Notes

- **Repo context fetching requires knowing the target repo:** The dispatcher must resolve "the portal" → `ScalingEngine/scaling-engine-portal` from EVENT_HANDLER.md's repo mapping table before making the GitHub API call. This mapping already exists in EVENT_HANDLER.md but is not currently used programmatically.
- **Previous job context requires the job to be complete:** If Noah sends a follow-up while a job is still running, the artifact files do not exist yet. The dispatcher must check job status before attempting artifact fetch; fall back gracefully if not complete.
- **Pipeline hardening is a prerequisite for all other features:** If conditional PR creation and failure notification are broken, the system cannot be trusted. These fixes must land before investing in smart prompts — otherwise smart prompts succeed but the pipeline misreports outcomes.
- **Repo context cache does not need persistence:** In-memory TTL is sufficient for a session. Cache lives in the Event Handler process and is lost on restart (which is acceptable — next request simply re-fetches).

---

## MVP Definition

### Launch With (v1.1 — this milestone)

Minimum set to ship smart prompts and pipeline reliability.

- [ ] **Pipeline hardening: conditional PR on success only** — verify end-to-end that `CLAUDE_EXIT != 0` suppresses PR creation; check that `notify-job-failed.yml` fires correctly for real failed jobs; this is the safety foundation
- [ ] **Pipeline hardening: failure notification to originating channel** — validate that a failed job triggers a Slack/Telegram notification in the originating thread; requires testing with a real failure scenario
- [ ] **Repo context fetching: CLAUDE.md + package.json** — add a `getRepoContext(owner, repo)` function to the Event Handler tool layer that fetches both files via GitHub API; returns parsed tech stack summary + CLAUDE.md content; called by `create_job` tool before firing
- [ ] **Job description template** — structured template with clear sections (Target, Context, Stack, Task, GSD Hint); dispatcher populates it; ensures container agent has consistent anchors
- [ ] **Quick vs plan-phase routing heuristic** — keyword-based routing suggestion in the job description (not a hard rule, a hint the container agent can follow); simple regex patterns in dispatcher

### Add After Validation (v1.1.x)

Once v1.1 ships and at least 5 real jobs confirm repo context improves output quality.

- [ ] **Previous job context injection** — trigger: Noah sends a follow-up message that references a prior job; dispatcher detects this via job_id in conversation, fetches observability.md from job branch, injects as "Prior Job Context" section
- [ ] **Repo context cache with TTL** — trigger: session produces more than 5 job proposals targeting the same repo; add simple Map() cache to avoid redundant API calls
- [ ] **Notification accuracy audit** — review 10+ real job outcomes against notification records; fix any routing gaps found

### Future Consideration (v2+)

Defer until demonstrated need and after product-market fit is clearer.

- [ ] **Agent learns from job history** — a cron that reads recent observability.md files and adjusts dispatcher routing thresholds based on which GSD commands were actually used; complex, requires significant job volume to be meaningful
- [ ] **Multi-repo awareness in single job** — a job that touches multiple repos simultaneously; conflicts with the single-repo-per-job model; defer until there is a real use case
- [ ] **Automatic retry with corrected prompt** — if a job fails and the failure message contains specific error patterns, auto-generate a corrected job description and present to user; complex orchestration, low priority

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Pipeline hardening: conditional PR + failure notification | HIGH | LOW | P1 |
| Repo context fetching (CLAUDE.md + package.json) | HIGH | MEDIUM | P1 |
| Job description template | HIGH | LOW | P1 |
| Quick vs plan-phase routing heuristic | MEDIUM | LOW | P1 |
| Previous job context injection | HIGH | HIGH | P2 |
| Repo context cache | MEDIUM | LOW | P2 |
| Notification accuracy audit | MEDIUM | LOW | P2 |
| Agent learns from job history | MEDIUM | HIGH | P3 |
| Multi-repo single job | LOW | HIGH | P3 |
| Auto-retry with corrected prompt | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.1 milestone goal (smart prompts + pipeline reliability)
- P2: Should have, add once v1.1 is confirmed working
- P3: Nice to have, future milestone

---

## Competitor Feature Analysis

This is an internal platform, not a market product. The comparison is against how other Claude Code / GitHub Actions agent orchestration systems handle context injection:

| Pattern | How Other Systems Do It | ClawForge Approach |
|---------|------------------------|-------------------|
| Repo context at agent start | Anthropic's official `claude-code-action` reads `CLAUDE.md` automatically at runtime (it's in the repo it clones) | ClawForge container also reads CLAUDE.md at runtime — but the dispatcher currently knows nothing about the target repo when composing the job description. Add dispatcher-side fetch so job description arrives pre-enriched. |
| Previous context across runs | Most systems have no cross-run memory; each job is stateless | ClawForge has job origin tracking and observability artifacts committed to branches. Previous job context injection leverages this existing artifact trail — no new infrastructure. |
| Task routing (quick vs complex) | GitHub Copilot and Devin use model-level task classification; not configurable | ClawForge uses keyword heuristics in dispatcher prompt + explicit GSD command hints — simpler but controllable; dispatcher can be overridden by Noah |
| Pipeline failure routing | Claude Code GitHub Action relies on GitHub's built-in Actions failure UI | ClawForge has a channel notification system — failures should route back to Slack/Telegram. This is the core value prop. It must work reliably. |

---

## Existing Dependencies (What This Milestone Builds On)

These are v1.0 features that v1.1 requires to function correctly:

| v1.0 Feature | v1.1 Dependency |
|-------------|-----------------|
| Job origin tracking (job_id → threadId in DB) | Previous job context injection + failure notification routing |
| `gsd-invocations.jsonl` + `observability.md` in job branch | Previous job context injection (reads these artifacts) |
| Imperative AGENT.md GSD instructions | Smart job prompts build on this — context injection only helps if the agent follows GSD; imperative language ensures it does |
| PostToolUse hook for GSD logging | Failure/success signal validation (if hook fires, agent ran; if not, agent may have failed silently) |
| `notify-job-failed.yml` workflow file | Pipeline hardening tests and validates this workflow |
| `run-job.yml` exit code handling | Conditional PR feature depends on correct exit code propagation |

---

## Sources

- Anthropic Effective Context Engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (MEDIUM confidence — general agent context principles; confirms "smallest set of high-signal tokens" approach; supports fetching CLAUDE.md + package.json only, not full tree)
- Claude Code GitHub Actions docs: https://code.claude.com/docs/en/github-actions (HIGH confidence — confirms CLAUDE.md is read automatically by the container at runtime; confirms `--append-system-prompt` and `prompt` parameter patterns)
- GitHub REST API contents endpoint: https://docs.github.com/en/rest/repos/contents (HIGH confidence — `GET /repos/{owner}/{repo}/contents/{path}` with `Accept: application/vnd.github.raw+json` returns raw file content; verified pattern for CLAUDE.md + package.json fetch)
- GitHub Actions conditional jobs: https://dev.to/github/conditional-workflows-and-failures-in-github-actions-2okk (MEDIUM confidence — `if: needs.build.result == 'failure'` pattern; `continue-on-error` behavior)
- LangGraph context engineering: https://docs.langchain.com/oss/python/langchain/context-engineering (MEDIUM confidence — confirms structured note-taking pattern; supports "pull back job artifacts into context" approach for previous job context injection)
- Direct codebase inspection: `lib/ai/tools.js` (create_job, getJobStatus, getSystemTechnicalSpecs), `lib/tools/create-job.js`, `lib/tools/github.js`, `docker/job/entrypoint.sh`, `instances/noah/config/EVENT_HANDLER.md`, `instances/noah/config/AGENT.md` (HIGH confidence — live code, verified line-by-line)
- Agent READMEs empirical study: https://arxiv.org/html/2511.12884v1 (MEDIUM confidence — confirms CLAUDE.md is the most impactful per-repo context file; supports fetching it specifically rather than generic README)

---
*Feature research for: ClawForge v1.1 — Smart Job Prompts, Pipeline Hardening, Previous Job Context*
*Researched: 2026-02-24*
