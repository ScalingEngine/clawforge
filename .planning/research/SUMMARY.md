# Project Research Summary

**Project:** ClawForge v1.2 — Cross-Repo Job Targeting
**Domain:** Claude Code agent gateway — GitHub Actions orchestration with multi-repo support
**Researched:** 2026-02-25
**Confidence:** HIGH

## Executive Summary

ClawForge v1.2 fixes a confirmed silent failure bug: when a user asks the agent to work on a repo other than clawforge, the container has always cloned clawforge anyway (because `run-job.yml` hardcodes `REPO_URL = github.repository` — the workflow-owning repo), operated on the wrong codebase, and opened a PR against clawforge. The job reports success, but nothing lands in the target repo. The fix is a threading problem: `target_repo` must travel from the agent tool call, through job.md metadata, through the Actions workflow, and into the entrypoint — which then performs a two-phase clone (clawforge for config and metadata, target repo for actual work).

The recommended implementation requires no new npm dependencies and no new infrastructure. All five affected layers (agent tool schema, job creation, Actions workflow, entrypoint, notification pipeline) compose on existing patterns. The core approach: the clawforge job branch remains the Actions trigger and audit log carrier; a `target.json` sidecar file written alongside `job.md` carries machine-readable target repo metadata; the entrypoint reads this and conditionally performs a second clone; `gh pr create --repo owner/repo` targets the correct repo; and the entrypoint (not `notify-pr-complete.yml`) sends the completion webhook for cross-repo jobs because GitHub Actions workflows cannot observe events across repos.

The highest-risk change is the entrypoint refactor — it is a bash script where incorrect conditional logic silently produces wrong behavior (cloning clawforge when target is intended, or vice versa). Same-repo regression must be gated before cross-repo work is considered done. The SOUL.md/AGENT.md system prompt sourcing is a blocking correctness issue: these files currently read from `/job/config/`, which works for same-repo jobs but produces an empty system prompt for cross-repo jobs where the target repo has no ClawForge config. They must be baked into the Docker image or injected via env var. Token security is the third risk: PATs must not be embedded in clone URLs as they appear in Actions logs; `gh auth setup-git` must be used for all clones.

## Key Findings

### Recommended Stack

No new npm packages or infrastructure are required. All v1.2 features compose on the existing stack: `zod` 4.3.6 (already installed) for `target_repo` enum validation in the tool schema, the existing `githubApi()` fetch wrapper for job branch and file creation, `gh` CLI 2.x (already in the Docker image) with `--repo OWNER/REPO` flag for cross-repo PR creation, and standard `git clone` for the second clone in the entrypoint.

The key architectural constraint governing all implementation choices: the GitHub Actions `on: create` trigger fires only in the repo that owns the workflow (clawforge). Creating a job branch on the target repo would not trigger clawforge's `run-job.yml`. Therefore, the job branch must always live in clawforge, and `TARGET_REPO` must be conveyed through a `target.json` sidecar file rather than through the Actions trigger mechanism.

**Core technologies:**
- `zod` 4.3.6 (existing): `target_repo` parameter validation with `.refine()` against `ALLOWED_REPOS` list — already used in codebase
- `githubApi()` in `lib/tools/github.js` (existing): extend with parameterized owner/repo for file writes — do not replace
- `gh` CLI 2.x (existing in Docker image): `gh pr create --repo OWNER/REPO` for cross-repo PR creation — verified from official docs
- `git clone` (existing): two sequential clones in one entrypoint; `gh auth setup-git` handles auth for both without token-in-URL
- `GH_TOKEN` PAT (existing, scope update required): single fine-grained PAT with `contents: write` + `pull_requests: write` on all allowed repos; no new secret keys

### Expected Features

The five surfaces that must work together for v1.2 to be usable — failure in any one produces silent wrong behavior end-to-end.

**Must have (table stakes — v1.2 launch blockers):**
- `ALLOWED_REPOS` config per instance (`config/REPOS.json` with per-instance override) — agent needs canonical list to select from; used for both tool validation and system prompt injection
- `create_job` tool: optional `target_repo` parameter (Zod-validated against allowed list) — load-bearing change; all downstream components depend on this being present
- `target.json` sidecar written to clawforge job branch alongside `job.md` — only reliable channel to carry `TARGET_REPO` into the container given the `on: create` trigger constraint
- `run-job.yml`: resolve-target step reads `target.json`, injects `TARGET_REPO_URL` into docker run — bridges the Actions layer to container without changing trigger mechanism
- Entrypoint: two-phase clone (`/job-meta` for clawforge config/metadata, `/job` for target repo work) with symlink fallback for same-repo jobs
- SOUL.md/AGENT.md baked into Docker image (`/defaults/`) or injected via env var — blocking correctness issue; without this, cross-repo jobs run with empty system prompt
- `gh pr create --repo TARGET_OWNER/TARGET_REPO` in entrypoint for cross-repo PRs
- Entrypoint-side completion webhook POST for cross-repo jobs — `notify-pr-complete.yml` fires on `auto-merge.yml` completion which only happens for clawforge PRs; cross-repo notifications must come from the entrypoint directly
- Same-repo regression guard: absence of `TARGET_REPO_URL` (or equality with `REPO_URL`) falls through to existing logic unchanged
- Fine-grained PAT updated with target repo access (operator action, not code change)
- Clone failure captured as explicit failure stage (`clone-error.md`) rather than silently swallowed by `|| true`

**Should have (v1.2.x — after 3+ cross-repo jobs confirmed working):**
- `get_job_status` tool returns target repo PR URL (requires nullable `target_repo TEXT` column in `job_outcomes`)
- PR body with ClawForge attribution and job ID — makes PRs readable to target repo maintainers
- Per-target-repo merge policy in `ALLOWED_REPOS` config (`auto_merge: true/false`) — enables entrypoint to auto-merge if configured; today cross-repo PRs always stay open

**Defer (v2+):**
- Multi-repo fan-out jobs (one job touching multiple repos) — requires transaction model, no infrastructure exists
- GitHub App tokens replacing PATs — not justified for 2 instances, 1 org
- Dynamic allowed repo discovery via GitHub API — security risk, no UX benefit at current scale

### Architecture Approach

The architecture is a threaded metadata pipeline. Each layer has exactly one integration point where `target_repo` is either read or written. The clawforge repo remains the single orchestration hub: job branches always live there (to trigger Actions), audit logs always commit there, and config files always read from there. The target repo is touched only inside the Docker container — never by the Event Handler or the Actions workflow steps.

**Major components and v1.2 changes:**
1. `config/REPOS.json` (NEW) — per-instance allowed repos list with owner, repo, description; base fallback + per-instance override in `instances/{name}/config/REPOS.json`
2. `lib/ai/tools.js` (MODIFY) — add optional `target_repo` param to `create_job` schema; validate against REPOS.json allowlist
3. `lib/tools/create-job.js` (MODIFY) — write `target.json` to clawforge job branch when target repo is specified; branch creation always stays in clawforge
4. `templates/.github/workflows/run-job.yml` (MODIFY) — add resolve-target step: checkout job branch, read `target.json`, inject `TARGET_REPO_URL` and cross-repo flag into docker run
5. `templates/docker/job/entrypoint.sh` (MODIFY) — two-phase clone; config reads from `/job-meta`; work in `/job`; cross-repo PR via `--repo` flag; cross-repo notification via direct webhook POST to Event Handler
6. `lib/db/schema.js` + `lib/db/job-outcomes.js` (MODIFY) — add nullable `target_repo TEXT` column; include in saveJobOutcome
7. `api/index.js` (MODIFY) — extract `target_repo` from webhook payload; include in summarizeJob message
8. `instances/*/config/EVENT_HANDLER.md` (MODIFY) — add allowed repos section so agent can resolve natural language to repo slugs

**Key notification architecture decision:** `notify-pr-complete.yml` fires on `workflow_run` (auto-merge completion in clawforge). For cross-repo jobs, no PR exists in clawforge, so auto-merge never fires, so `notify-pr-complete.yml` never fires. The entrypoint must send the completion webhook directly after `gh pr create`. This creates a semantic difference: same-repo notifications fire at merge, cross-repo notifications fire at PR creation. The user sees "PR open for review" rather than "merged" for cross-repo jobs unless `auto_merge: true` is configured in the target repo's REPOS.json entry.

### Critical Pitfalls

1. **SOUL.md/AGENT.md absent for cross-repo jobs** — The entrypoint reads system prompt files from `/job/config/`. For cross-repo jobs, `/job` is the target repo with no ClawForge config structure. Result: empty system prompt, Claude runs without persona or GSD instructions. Fix: bake SOUL.md/AGENT.md into Docker image as `/defaults/`; entrypoint always loads from image with optional override if cloned repo has them. Blocking correctness issue that must ship in Phase 1.

2. **`|| true` on git push and gh pr create silently swallows auth failures** — If the PAT lacks target repo access, clone or push fails silently. Container exits without writing `preflight.md`; failure stage in notification is wrong or absent. Fix: add explicit exit code tracking around all clone/push/PR-create operations; add `clone` and `push_failed` as new failure stages alongside existing `docker_pull` / `auth` / `claude`.

3. **`notify-pr-complete.yml` never fires for cross-repo jobs** — GitHub Actions `workflow_run` can only observe events in the same repo. A PR merge in NeuroStory does not trigger any workflow in clawforge. Fix: entrypoint sends completion webhook directly after `gh pr create` for cross-repo jobs. Installing ClawForge workflows in target repos is rejected as creating tight coupling that breaks instance isolation.

4. **Token embedded in clone URLs leaks to Actions logs** — Developers extending the entrypoint may embed the PAT in the clone URL (`https://x-access-token:${GH_TOKEN}@github.com/...`). This prints the token to stdout, captured by GitHub Actions logs — exposed publicly for public repos. Fix: always use `gh auth setup-git` before any git clone; never interpolate PAT into URL strings.

5. **Same-repo regression from entrypoint conditional logic** — The cross-repo/same-repo conditional in bash is error-prone. A wrong variable name or missing fallback causes same-repo jobs to clone the wrong repo, fail to read job.md, or produce malformed FULL_PROMPT. Fix: run same-repo test harness before and after entrypoint changes; gate phase completion on same-repo test passing.

## Implications for Roadmap

Research identifies a clear 4-phase build order based on strict dependency flow. Each phase delivers what the next phase depends on. No parallel execution — the chain is sequential.

### Phase 1: Config Layer + Tool Schema + Entrypoint Foundation

**Rationale:** Everything else depends on `target_repo` being threaded through the system. The tool schema change is the load-bearing change — no downstream component can be built without it. The entrypoint clone fix and SOUL.md sourcing fix must ship together because both are correctness blockers that affect every cross-repo job.

**Delivers:** Agent can accept and validate `target_repo`; job creation writes `target.json` to clawforge job branch; entrypoint performs two-phase clone and reads config from correct location; SOUL.md/AGENT.md loaded from Docker image for all jobs; same-repo jobs unaffected by any change.

**Addresses (from FEATURES.md):** Allowed repos config (formal), `create_job` tool with `target_repo` field, `target.json` sidecar file, same-repo regression guard, SOUL.md/AGENT.md sourcing fix, clone failure as fourth failure stage.

**Avoids (from PITFALLS.md):** Pitfall 10 (empty system prompt for cross-repo), Pitfall 6 (same-repo regression), Pitfall 1 (entrypoint clones wrong repo), Pitfall 11 (token in clone URL), Pitfall 7 (createJob() misunderstood as needing to change target).

**Files changed:** `config/REPOS.json` (new), `instances/*/config/REPOS.json` (new), `lib/ai/tools.js`, `lib/tools/create-job.js`, `instances/*/config/EVENT_HANDLER.md`, `templates/docker/job/Dockerfile` (bake SOUL.md), `templates/docker/job/entrypoint.sh` (two-phase clone, config from /job-meta, SOUL.md from image).

**Research flag:** SKIP — all implementation details fully specified in STACK.md and ARCHITECTURE.md with direct codebase inspection. Standard patterns throughout.

### Phase 2: Actions Workflow + Cross-Repo PR Creation

**Rationale:** Depends on Phase 1 producing `target.json` in job branches. This phase makes the container actually operate in the target repo and create a PR there. It is the highest-risk phase because it involves bash conditional logic in the entrypoint and the `gh pr create --repo` behavior. Build on a stable Phase 1 foundation.

**Delivers:** Container clones target repo, Claude operates in correct working tree, PR created on target repo, default branch detected (not hardcoded to `main`), branch naming convention set for target repos, per-repo merge policy implemented.

**Implements:** `run-job.yml` resolve-target step, entrypoint cross-repo push + `gh pr create --repo`, default branch detection via `gh repo view --json defaultBranchRef`, branch cleanup after PR creation, per-repo merge policy from REPOS.json.

**Avoids (from PITFALLS.md):** Pitfall 3 (PR on wrong repo), Pitfall 2 (PAT scope not confirmed before clone), Pitfall 5 (auto-merge not applicable to cross-repo — handle via entrypoint merge if configured), Pitfall 9 (branch pollution in target repo).

**Research flag:** SKIP — `gh pr create --repo` flag verified against official gh CLI docs (HIGH confidence). Default branch detection via `gh repo view` is documented. No novel patterns.

### Phase 3: Notification Pipeline + DB Schema

**Rationale:** Depends on Phase 2 producing PRs in target repos. The notification gap (`notify-pr-complete.yml` never fires for cross-repo) cannot be addressed until cross-repo PRs exist to reference. DB schema change is small and should ship with notifications so `target_repo` is recorded from day one of cross-repo jobs running.

**Delivers:** Cross-repo job completions trigger Slack/Telegram notifications via entrypoint webhook POST; `job_outcomes` table records `target_repo`; `summarizeJob` message identifies which repo was modified and whether the PR is open for review or merged.

**Implements:** Entrypoint cross-repo notification POST to `/api/github/webhook` with correct payload schema, nullable `target_repo TEXT` column in `job_outcomes`, `saveJobOutcome` update, `api/index.js` webhook handler update, Drizzle migration.

**Avoids (from PITFALLS.md):** Pitfall 4 (notification never fires for cross-repo), Pitfall 8 (wrong thread routing or missing job_outcomes record), Anti-pattern 4 (modifying notify-pr-complete.yml to watch external repos).

**Research flag:** SKIP — notification schema and entrypoint webhook POST pattern fully specified in ARCHITECTURE.md Pattern 3.

### Phase 4: Regression Verification

**Rationale:** After all changes are deployed, both instances must be verified end-to-end. This is not optional cleanup — the "Looks Done But Isn't" checklist in PITFALLS.md identifies 10 specific verification points that silent-failure scenarios require. Same-repo jobs must continue working correctly.

**Delivers:** Confirmed same-repo regression-free behavior; at least one cross-repo job per instance completed successfully; ALLOWED_REPOS enforcement verified (unauthorized repo rejected before job creation); token security confirmed (no PAT in Actions logs); `get_job_status` unaffected.

**Addresses (from FEATURES.md):** Same-repo regression test, PAT updated with cross-repo scopes (operator), ALLOWED_REPOS enforcement verification.

**Research flag:** SKIP — verification against the 10-point checklist in PITFALLS.md covers all scenarios.

### Phase Ordering Rationale

- **Config and schema before container:** `target.json` must exist in job branches before `run-job.yml` can read it. Tool schema must change before any job can carry target repo metadata.
- **Container before notifications:** Cross-repo PR must exist in target repo before notification can reference its URL.
- **System prompt fix in Phase 1 (not Phase 2):** SOUL.md sourcing is a correctness blocker, not an enhancement. If it shipped after Phase 2 opened cross-repo PRs, all those PRs would have been generated by Claude running without persona or GSD instructions.
- **Regression sweep throughout + final gate in Phase 4:** Same-repo behavior must be continuously validated in Phases 1-3, with a comprehensive final verification in Phase 4.

### Research Flags

Phases likely needing deeper research during planning:
- **None identified.** All four research files are based on direct codebase inspection (HIGH confidence) and official GitHub/gh CLI documentation. The implementation is fully specified at the code level. No novel technology, sparse documentation, or uncharted integration patterns.

Phases with standard patterns (skip research-phase):
- **All four phases.** The implementation pattern (sidecar metadata file, two-phase clone, `gh` CLI cross-repo flags, webhook notification from container, Zod enum validation) is thoroughly documented in STACK.md and ARCHITECTURE.md with verified examples from direct codebase inspection.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct codebase inspection + official GitHub REST API and gh CLI docs. No new dependencies. Implementation examples verified against live code. All version compatibility confirmed. |
| Features | HIGH | Pipeline mechanics verified against live code. UX patterns informed by analog system analysis (GitHub Actions native, Buildkite, Devin/SWE-agent). Security/token scoping from official GitHub docs + community confirmation. |
| Architecture | HIGH | Line-level codebase inspection for all affected files. Component responsibilities and data flow verified against live production code. Anti-patterns confirmed with specific file/line references. Build order grounded in verified dependency relationships. |
| Pitfalls | HIGH (primary) / MEDIUM (secondary) | Primary pitfalls from direct codebase inspection — root causes confirmed line-by-line. GITHUB_TOKEN scoping from official docs + confirmed community discussions. Security exposure patterns from CVE research (flagged as LOW confidence, not blocking). |

**Overall confidence: HIGH**

### Gaps to Address

- **Fine-grained PAT configuration:** The existing `AGENT_GH_TOKEN` is likely a classic PAT. For v1.2, a fine-grained PAT scoped to allowed repos is recommended. This is an operator action — but must be documented clearly in `.env.example` for both instances before any cross-repo job runs. If a classic PAT with org-wide access is used instead, cross-repo operations will work but with elevated security exposure (documented tradeoff in STACK.md Alternatives section).

- **Default branch assumption:** All implementation examples assume `main` as the default branch of target repos. PITFALLS.md flags `--base main` as a hardcoded assumption that breaks for repos with `master` or other default branches. Add default branch detection via `gh repo view --json defaultBranchRef` in Phase 2 — do not defer this as known debt since it causes silent PR creation failure.

- **StrategyES instance allowed repos:** StrategyES currently targets `strategyes-lab` repo only. Its `REPOS.json` content needs operator confirmation before Phase 1 ships. The architecture supports this via per-instance `instances/strategyES/config/REPOS.json` override, but the specific repo list must be set by the operator.

- **Cross-repo merge semantics communication:** Same-repo jobs notify at merge; cross-repo jobs notify at PR creation (unless `auto_merge: true` is configured). This semantic difference must be surfaced clearly to the user in the agent's confirmation message. Validate the UX language during Phase 3 to ensure users understand "PR open for review" vs "merged."

## Sources

### Primary (HIGH confidence — direct codebase inspection)

- `templates/docker/job/entrypoint.sh` — single-clone flow, SOUL.md/AGENT.md sourcing (confirmed reads from /job/config/), CLAUDE.md injection, PR creation without `--repo` flag
- `templates/.github/workflows/run-job.yml` — `REPO_URL` hardcoded to `github.repository`; no target repo mechanism
- `templates/.github/workflows/notify-pr-complete.yml` — `workflow_run` trigger on auto-merge (same-repo only); `--repo github.repository` scope for all PR lookups
- `templates/.github/workflows/auto-merge.yml` — `GITHUB_TOKEN` used; clawforge-scoped only; `ALLOWED_PATHS` guard specific to clawforge
- `lib/tools/create-job.js` — `GH_OWNER`/`GH_REPO` always clawforge; branch and job.md creation pattern
- `lib/ai/tools.js` — `create_job` schema (job_description only; confirmed no target_repo parameter)
- `lib/db/schema.js` + `lib/db/job-outcomes.js` — jobOutcomes table schema; confirmed no target_repo column
- `api/index.js` — webhook handler; saveJobOutcome call; results object shape
- `.planning/PROJECT.md` — cross-repo bug discovery 2026-02-25; v1.2 requirements; NeuroStory example

### Secondary (MEDIUM confidence — official docs + community confirmation)

- `https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28` — `on: create` trigger only fires in repo owning workflow; cross-repo branch push does not trigger foreign repo workflows
- `https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28` — Git refs API; same endpoints work with different owner/repo path params
- `https://cli.github.com/manual/gh_pr_create` — `--repo OWNER/REPO` flag confirmed for cross-repo PR creation; stable since gh 2.0
- `https://docs.github.com/en/actions/security-guides/automatic-token-authentication` — GITHUB_TOKEN is repo-scoped; cross-repo operations require PAT or GitHub App token
- `https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens` — fine-grained PAT: `contents: write` + `pull_requests: write` required for clone + PR
- GitHub Community discussions (orgs/community/discussions/46566, 65321, 59488) — GITHUB_TOKEN cross-repo clone limitation confirmed; PAT required for cross-repo checkout
- `https://some-natalie.dev/blog/multi-repo-actions/` — cross-repo push pattern with PAT; token not in URL; confirmed pattern

### Tertiary (LOW confidence — single source, security awareness)

- Wiz Blog: tj-actions supply chain attack CVE-2025-30066 — token-in-URL exposure via workflow logs; informs anti-pattern
- Unit42 Palo Alto: ArtiPACKED — token exposure patterns in GitHub Actions artifacts; general awareness for log hygiene

---
*Research completed: 2026-02-25*
*Ready for roadmap: yes*
