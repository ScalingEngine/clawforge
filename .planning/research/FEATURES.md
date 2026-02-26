# Feature Research

**Domain:** Cross-repo job targeting — CI/CD agent gateway dispatching Claude Code to arbitrary GitHub repositories
**Researched:** 2026-02-25
**Milestone:** v1.2 Cross-Repo Job Targeting
**Confidence:** HIGH for pipeline mechanics (verified against live code + GitHub docs); MEDIUM for UX patterns (informed by community research + analog systems); HIGH for security/token scoping (official GitHub docs)

---

## Context: The Problem Being Solved

v1.1 ships with the bug documented in PROJECT.md: when Noah asks Archie to do work in a repo other than clawforge, the container clones clawforge (because `REPO_URL` is always `github.repository` — the Actions workflow repo), Claude Code reads clawforge files, and the resulting PR is created on clawforge. The job appears to succeed, but nothing lands in the target repo.

This milestone adds a real cross-repo targeting mechanism. The five surfaces that must change:

1. **Repo selection** — how the agent knows which repo the user intends
2. **Container cloning** — how the entrypoint clones the right repo at runtime
3. **PR creation** — how the PR is opened on the target repo, not clawforge
4. **Notification routing** — how the success notification carries the correct PR URL
5. **Fallback** — what happens when the target repo is unavailable or misconfigured

All five must work together end-to-end. A failure in any one produces silent wrong behavior.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must work for the milestone to be usable. Missing any of these = cross-repo jobs are broken or unreliable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Allowed repos list per instance | Without a list, the agent has no canonical source to resolve "the portal" to `ScalingEngine/scaling-engine-portal`. The list is the contract between operator configuration and agent behavior. | LOW | Already documented in EVENT_HANDLER.md as prose — needs programmatic form. A JSON map `{name: [aliases], owner, repo}` is enough. No DB needed; config file at instance level. Dependency: agent repo selection reads from this config. |
| Agent resolves target repo from user message | "Do X in the portal" requires the agent to identify `scaling-engine-portal` before calling `create_job`. Without resolution, the job description is ambiguous and the container defaults to clawforge. | MEDIUM | The LangGraph agent already has EVENT_HANDLER.md with a repo mapping table in prose. Resolution can happen in the LLM's natural language understanding, confirmed via a `target_repo` field added to the `create_job` tool schema. No separate NLP pipeline needed — the LLM is the router. |
| `create_job` tool accepts `target_repo` parameter | Today `create_job` always uses `GH_OWNER`/`GH_REPO` env vars (clawforge). A `target_repo` field (`owner/repo` string) lets the Event Handler signal to the job creation layer which repo to target. This field must flow through to the job branch so the container knows what to clone. | LOW | Schema change in `lib/ai/tools.js` + `lib/tools/create-job.js`. The field must be stored on the job branch — simplest approach: write `TARGET_REPO` to `logs/{JOB_ID}/meta.json` alongside `job.md`. No DB schema change needed. |
| Entrypoint clones target repo (not Actions repo) | The current entrypoint clones `$REPO_URL` which is always the clawforge repo injected by `run-job.yml`. For cross-repo jobs, a different URL must be used. | MEDIUM | Two sub-problems: (1) passing target repo URL into the container (via env var `TARGET_REPO_URL`), (2) the entrypoint reads this env var and uses it instead of `REPO_URL` when present. The job branch lives on clawforge; the working directory becomes the cloned target repo. Logs still commit back to the clawforge job branch. |
| PR created on target repo, not clawforge | Today the entrypoint calls `gh pr create` against the clawforge repo. Cross-repo jobs must push a branch to the target repo and open a PR there. | MEDIUM | The `gh` CLI authenticates via `AGENT_GH_TOKEN` (the PAT). The PAT must have `contents: write` + `pull_requests: write` on the target repo. The entrypoint `git push` target and `gh pr create --repo owner/repo` with the `--repo` flag. The PR URL returned is from the target repo. |
| Success notification includes target repo PR URL | `notify-pr-complete.yml` currently looks up the PR from `github.repository` (clawforge). For cross-repo jobs, there is no PR on clawforge. The notification must receive the PR URL from the job branch artifact, not by querying the Actions repo. | MEDIUM | The entrypoint must write the created PR URL to a log artifact (e.g., `logs/{JOB_ID}/pr.json`). The notification workflow reads this artifact from the checked-out clawforge branch rather than querying GitHub API for a PR that doesn't exist on clawforge. |
| Same-repo (clawforge) jobs continue working | Any change to entrypoint or create-job must not break the existing same-repo flow. Regression here means the Noah instance stops working entirely. | LOW | Guard with `if [ -n "$TARGET_REPO_URL" ] && [ "$TARGET_REPO_URL" != "$REPO_URL" ]` — fall through to existing logic when not set. The absence of `TARGET_REPO_URL` is the same-repo case. All existing tests must still pass. |
| PAT with target repo access per instance | The container authenticates with `AGENT_GH_TOKEN`. For cross-repo jobs this token must have access to the target repos. A single PAT scoped to allowed repos is the simplest model. | LOW | Fine-grained PAT: `contents: write`, `pull_requests: write`, set to "selected repositories" covering the allowed list. Stored as `AGENT_GH_TOKEN` GitHub secret (same key, different token value). No code change — already plumbed through the SECRETS mechanism in `run-job.yml`. |
| Failure notification fires for cross-repo failures | `notify-job-failed.yml` currently reads artifacts from `github.repository` branch checkout. For cross-repo jobs that fail during clone, preflight, or Claude, the failure log still lives on the clawforge job branch. Notification must still fire correctly. | LOW | Already correct — the job branch is always on clawforge. The container commits preflight.md, claude-output.jsonl back to the clawforge branch regardless of target repo. `notify-job-failed.yml` does not need changes for failure notification accuracy. Only the PR URL in success notifications is affected. |

### Differentiators (Competitive Advantage)

Features that make cross-repo targeting noticeably better than a minimal implementation.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Target repo resolved automatically from context (no explicit selection needed) | Noah can say "update the portal" and Archie dispatches to `scaling-engine-portal` without Noah ever typing the repo slug. Other CI/CD bots (Buddy, Buildkite Slack) require explicit slash commands: `/build portal-repo branch`. Automatic resolution from natural language is meaningfully better UX. | LOW | The LLM agent already resolves names via EVENT_HANDLER.md prose. Formalizing the `target_repo` field in the tool schema makes this explicit and auditable. Incremental cost: one extra field in `create_job` call. |
| CLAUDE.md + package.json from target repo injected into prompt | The container already reads these from the checked-out repo (v1.1 smart prompts). For cross-repo jobs, the same mechanism works automatically once the container clones the target repo. No additional work — this is a free differentiator from the v1.1 investment. | NONE | Just works. The entrypoint's `REPO_CLAUDE_MD` and `REPO_STACK` derivation reads from `/job/` which is the cloned target. As long as the target repo has CLAUDE.md, the agent starts warm. Flag this as "cross-repo context injection" in documentation. |
| PR body includes target repo context | The PR description on the target repo should indicate it was created by ClawForge and reference the original job ID. This is tracing — useful for operators doing code review on the target repo who need to understand the context. | LOW | Add `--body "ClawForge job ${JOB_ID}\n\nOriginating system: ${EVENT_HANDLER_URL}"` to `gh pr create` call. One-line change. |
| `get_job_status` returns target repo PR URLs | Today `get_job_status` returns GitHub Actions run URLs for clawforge. For cross-repo jobs, the PR lives elsewhere. The agent should be able to report where the work landed. | LOW | Add `target_repo_pr_url` to `pr.json` artifact; include it in the notification webhook payload so the Event Handler can store it in `job_outcomes` table. The `get_job_status` tool can then surface it from the DB. Requires: `job_outcomes` schema to store target repo URL as a separate column. |
| Fallback message when target repo clone fails | If the PAT lacks access to the target repo, the container's `git clone` fails immediately. Without a specific error message, Noah sees a generic "job failed" notification with confusing output. A targeted error ("Could not clone target repo — check PAT scopes or repo access") surfaces the problem faster. | LOW | Wrap the target repo clone in explicit error handling in the entrypoint: `if ! git clone ...; then echo "ERROR: failed to clone target repo ${TARGET_REPO_URL}" | tee "${LOG_DIR}/clone-error.md"; exit 1; fi`. The `preflight.md` pattern already handles this detection in `notify-job-failed.yml`. Add "clone" as a fourth failure stage alongside docker_pull/auth/claude. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like natural extensions of cross-repo targeting but create real problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| One PAT with org-wide access | "Simpler to manage one token for the whole org" | A compromised or overly-permissioned token exposes every repo in the org. The blast radius of a leaked token scales with the number of repos it can push to. The allowed repos list is a security boundary — honor it with scoped tokens. | Fine-grained PAT scoped to the exact repos in the allowed list. Add repos to the list explicitly. Separate PAT per instance (Noah/Archie vs. Epic/StrategyES). |
| Support arbitrary repos not on the allowed list | "What if I want to target a repo we haven't listed?" | Without a constraint, any repo Noah can access becomes a valid target. The allowed list is both a UX feature (surfaces choices) and a security feature (limits blast radius). Dynamic permission expansion defeats the security model. | Keep the allowed list as a hard boundary. If a new repo needs access, add it to the list explicitly and update the PAT. This is an intentional friction point. |
| Auto-merge on target repo | "If auto-merge works on clawforge, extend it to target repos" | Auto-merge rules on target repos are configured per-repo by their maintainers. ClawForge should create the PR and let the target repo's own merge policies apply. Extending auto-merge to external repos requires write access to branch protection settings on those repos — excessive permissions scope. | Create the PR; don't merge it. Let `auto-merge.yml` remain clawforge-scoped. Notify Noah when the PR is open. |
| Store target repo working tree on clawforge job branch | "Commit the full clone to the job branch for debugging" | Target repos can be gigabytes. Committing a full clone to a job branch on clawforge would bloat the repo, exhaust GitHub storage quotas, and make the job branch useless as a diff vehicle. | Only commit job logs (preflight.md, claude-output.jsonl, observability.md) to the clawforge branch. All source changes live as a PR on the target repo. |
| Dynamic repo discovery (agent discovers repos it can access) | "Why maintain an explicit list? Let the agent query the org's repos" | GitHub API lists org repos (up to 100 per page, paginated). The agent would need to enumerate, then match user intent to repo names. This is slow, unreliable for name resolution, and surfaces repos that should not be agent targets. Also exposes the full org repo surface area in the agent's context. | Explicit allowed list. Small enough to fit in EVENT_HANDLER.md. Agent uses this as the canonical enumeration. Fast, reliable, auditable. |
| Cross-repo jobs that touch multiple repos in one run | "Build the portal, then update the SDK, then update the docs" | A single job touching multiple repos requires multiple clones, multiple auth contexts, multiple PR creations, and a transaction model (what if repo 2 fails after repo 1 PR is created?). Complexity compounds. The current model is one-job-one-repo for a reason. | Multi-repo tasks should be multiple jobs, each targeting one repo. The Event Handler can dispatch them in sequence with context injection between jobs. |

---

## Feature Dependencies

```
[Allowed repos config (EVENT_HANDLER.md formal list)]
    └──required by──> [Agent resolves target repo]
    └──required by──> [PAT scoped to allowed repos]

[create_job tool: target_repo parameter]
    └──required by──> [create-job.js: meta.json with target repo]
    └──required by──> [run-job.yml: TARGET_REPO_URL env injection]
        └──required by──> [Entrypoint: clone target repo]
            └──required by──> [Entrypoint: push branch to target repo]
                └──required by──> [Entrypoint: gh pr create on target repo]
                    └──required by──> [pr.json artifact with target PR URL]
                        └──required by──> [notify-pr-complete.yml: read pr.json]
                            └──required by──> [Correct PR URL in success notification]

[PAT with target repo access]
    └──required by──> [Entrypoint: clone target repo] (must have contents:read)
    └──required by──> [Entrypoint: push branch to target repo] (must have contents:write)
    └──required by──> [Entrypoint: gh pr create on target repo] (must have pull_requests:write)

[Same-repo guard (TARGET_REPO_URL absent = same-repo mode)]
    └──ensures──> [Clawforge jobs unaffected by cross-repo changes]

[Clone failure error handling]
    └──enhances──> [notify-job-failed.yml: clone as fourth failure stage]
```

### Dependency Notes

- **The create_job schema change is the load-bearing change.** Every downstream component (meta.json, run-job.yml, entrypoint, pr.json, notification) chains from the agent's ability to pass a `target_repo` field. This must land first.
- **run-job.yml must inject `TARGET_REPO_URL` before the container starts.** The workflow reads `meta.json` from the job branch and exports it as an env var. This is a new step in `run-job.yml` that does not exist today.
- **The PAT must be updated before any cross-repo job can run.** New token with cross-repo scopes replaces the existing `AGENT_GH_TOKEN` secret. This is a one-time operator action per instance, not a code change.
- **pr.json is the linking artifact.** It decouples `notify-pr-complete.yml` from assuming the PR is on clawforge. Without pr.json, the notification workflow has no way to find the target repo PR URL.
- **Same-repo guard prevents regression.** The absence of `TARGET_REPO_URL` (or when it equals `REPO_URL`) falls through to existing entrypoint logic verbatim. No same-repo code paths change.

---

## MVP Definition

### Launch With (v1.2 — this milestone)

The minimum set to ship cross-repo job targeting end-to-end.

- [ ] **Allowed repos config formalized** — structured `ALLOWED_REPOS` config (JSON or structured section in EVENT_HANDLER.md) with `{display_name, aliases[], owner, repo}` entries; used by agent for name resolution and by documentation for PAT scope audit
- [ ] **`create_job` tool: add `target_repo` field** — optional `owner/repo` string; when present, create-job.js writes it to `logs/{JOB_ID}/meta.json` on the job branch alongside job.md
- [ ] **`run-job.yml`: read meta.json, inject `TARGET_REPO_URL`** — new step reads `logs/${JOB_ID}/meta.json` and exports `TARGET_REPO_URL=https://github.com/${target_repo}.git` into the container env
- [ ] **Entrypoint: cross-repo clone logic** — when `TARGET_REPO_URL` is set and differs from `REPO_URL`, clone target repo to `/job` instead of clawforge; push changes back to target repo; `gh pr create --repo ${TARGET_OWNER}/${TARGET_REPO}`; write PR URL to `logs/{JOB_ID}/pr.json`
- [ ] **`notify-pr-complete.yml`: read pr.json for PR URL** — instead of looking up the PR from `github.repository`, read `pr.json` artifact from the checked-out clawforge branch; include `target_repo_pr_url` in the webhook payload
- [ ] **PAT updated with cross-repo scopes** — fine-grained PAT with `contents: write`, `pull_requests: write` across allowed repos; updated as `AGENT_GH_TOKEN` secret on both instances (operator action, not code)
- [ ] **Clone failure as fourth failure stage** — entrypoint wraps target clone in error handler; writes `clone-error.md`; `notify-job-failed.yml` detects clone-error.md and reports `failure_stage: clone`
- [ ] **Same-repo regression test** — verify a clawforge-targeting job still completes correctly end-to-end after all changes; existing test harness covers this

### Add After Validation (v1.2.x)

Once at least 3 cross-repo jobs complete successfully.

- [ ] **`get_job_status` surfaces target repo PR URL** — store in job_outcomes table; return in tool response so agent can tell Noah "your NeuroStory PR is at ..."
- [ ] **PR body template with ClawForge attribution** — standard PR body format with job ID, originating system URL, and user request summary; small but makes PRs more readable to target repo maintainers who receive them

### Future Consideration (v2+)

Defer until there is demonstrated need.

- [ ] **Multiple simultaneous cross-repo jobs** — today each job is one repo; a "multi-repo task" that fans out to several repos and waits for all PRs; requires job orchestration layer that doesn't exist
- [ ] **GitHub App instead of PAT** — GitHub App installation per org gives finer control and removes user-tied tokens; complexity and setup cost not justified for 2 instances
- [ ] **Automatic allowed repos discovery** — query org repos and surface to agent dynamically; security risk outweighs convenience benefit at this scale

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Allowed repos config (formal) | HIGH | LOW | P1 |
| `create_job` tool: target_repo field | HIGH | LOW | P1 |
| `run-job.yml`: meta.json → TARGET_REPO_URL injection | HIGH | LOW | P1 |
| Entrypoint: cross-repo clone + push + PR | HIGH | MEDIUM | P1 |
| `notify-pr-complete.yml`: pr.json for PR URL | HIGH | LOW | P1 |
| PAT with cross-repo scopes (operator action) | HIGH | LOW (ops, not code) | P1 |
| Clone failure as fourth failure stage | MEDIUM | LOW | P1 |
| Same-repo regression guard + test | HIGH | LOW | P1 |
| `get_job_status` surfaces target PR URL | MEDIUM | LOW | P2 |
| PR body attribution template | LOW | LOW | P2 |
| Multi-repo fan-out jobs | LOW | HIGH | P3 |
| GitHub App authentication | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.2 milestone goal (cross-repo jobs work end-to-end, no regression)
- P2: Should have once v1.2 is confirmed working with real jobs
- P3: Future milestone consideration

---

## Analog System Analysis

This is an internal platform, not a consumer product. The comparison is against how similar cross-repo CI/CD and agent systems handle the five UX surfaces.

| Surface | GitHub Actions (native) | Buildkite Slack Bot | Devin / SWE-agent | ClawForge v1.2 Approach |
|---------|------------------------|--------------------|--------------------|-------------------------|
| Repo selection | Explicit `--repo` CLI flag or workflow file per repo | Slash command with explicit repo param: `/build my-repo` | User types natural language; agent resolves repo from file path context | LangGraph agent resolves from natural language via EVENT_HANDLER.md allowed list; `target_repo` added to create_job schema |
| Cross-repo cloning | `actions/checkout` with `repository:` + PAT | Buildkite clones the selected repo via PAT | Agent clones target repo in its container | Entrypoint reads `TARGET_REPO_URL` env var; clones with AGENT_GH_TOKEN PAT |
| PR creation | `gh pr create --repo owner/repo` with PAT | Creates PR via GitHub API with PAT | Creates PR on target repo; can be reviewed | `gh pr create --repo` flag; PR URL written to `pr.json` artifact |
| Notification routing | GitHub-native email/Slack notifications | Slack thread update with PR link | UI-based result display | Webhook to Event Handler; reads pr.json from job branch; routes to originating Slack/Telegram thread |
| Fallback on unavailable repo | Workflow step failure with log output | Error message in Slack thread | Error displayed in agent UI | Clone error captured in `clone-error.md`; failure notification with `failure_stage: clone` |

**Key UX insight from analogs:** Every system that supports cross-repo targeting requires explicit repo resolution — either via a CLI flag, a configuration list, or NLP disambiguation. ClawForge's allowed list in EVENT_HANDLER.md + LLM resolution is the highest-UX approach (no explicit flags) but requires the LLM to resolve correctly. The `target_repo` field in the tool call is the audit trail for whether it resolved correctly before the job fires.

---

## Existing v1.1 Dependencies (What v1.2 Builds On)

These are v1.1 features that v1.2 requires to function correctly. None need to change — they just need to work end-to-end with the new cross-repo path.

| v1.1 Feature | v1.2 Dependency |
|--------------|-----------------|
| CLAUDE.md + package.json injection in entrypoint | Works automatically for cross-repo target once container clones target repo — the same file read logic applies |
| GSD routing hint from job keywords | Applies to cross-repo jobs identically — no change needed |
| Previous job context (job_outcomes table + thread scoping) | Works for cross-repo jobs — job_outcomes row written per job_id regardless of target repo; thread scoping unchanged |
| `preflight.md` / `claude-output.jsonl` failure stage detection | Works for cross-repo jobs — these artifacts live on the clawforge job branch; `notify-job-failed.yml` reads from there |
| 30-minute timeout in `run-job.yml` | Applies to cross-repo jobs; timeout fires at workflow level regardless of what repo the container clones |
| SHA-based zero-commit PR guard | Applies to target repo PR creation — if Claude makes no commits, no PR is created on the target repo either |

---

## Sources

- Live codebase inspection: `lib/ai/tools.js`, `lib/tools/create-job.js`, `templates/docker/job/entrypoint.sh`, `templates/.github/workflows/run-job.yml`, `notify-pr-complete.yml`, `notify-job-failed.yml`, `instances/noah/config/EVENT_HANDLER.md` (HIGH confidence — live production code)
- PROJECT.md v1.2 milestone definition and cross-repo bug documentation (HIGH confidence — operator-authored, specific)
- GitHub Actions cross-repo PR creation patterns: https://github.com/orgs/community/discussions/73719 (MEDIUM confidence — community discussion, cross-validated with official docs)
- Fine-grained PAT permission scopes for clone + PR: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens (HIGH confidence — official docs; `contents: write` + `pull_requests: write` required)
- GitHub fine-grained token PR creation limitations: https://github.com/orgs/community/discussions/106661 (MEDIUM confidence — community verified: fine-grained tokens can create PRs when owner of target org; classic PATs work more broadly)
- Push commits to another repository via GitHub Actions: https://some-natalie.dev/blog/multi-repo-actions/ (MEDIUM confidence — community blog, pattern verified against live codebase approach)
- GitHub Agentic Workflows multi-repo patterns: https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/ (MEDIUM confidence — official GitHub blog; confirms per-repo PAT scoping is best practice)
- Intent routing in multi-agent systems: https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa (LOW confidence — single source; general pattern, not ClawForge-specific; confirms LLM-based routing is preferred over rule-based for NLP intent extraction)

---

*Feature research for: ClawForge v1.2 — Cross-Repo Job Targeting*
*Researched: 2026-02-25*
