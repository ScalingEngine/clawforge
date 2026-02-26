# Stack Research

**Domain:** Claude Code agent platform — cross-repo job targeting (v1.2)
**Researched:** 2026-02-25
**Confidence:** HIGH — all findings grounded in direct codebase inspection + official GitHub API and gh CLI docs

---

## Scope

This research covers ONLY the new capabilities in milestone v1.2:

1. **Allowed repos configuration** — Per-instance list of repos the agent can target
2. **Agent repo selection** — LLM selects target repo from allowed list based on user message
3. **Cross-repo clone in entrypoint** — Container clones the TARGET repo, not just clawforge's job branch
4. **PR on target repo** — `gh pr create` targets the correct repo, not clawforge
5. **Correct notification URLs** — `notify-pr-complete.yml` uses target repo, not `github.repository`
6. **Single PAT per instance** — One `GH_TOKEN` with access to all allowed repos for that instance

The v1.0/v1.1 stack (LangGraph, Claude Code CLI, GSD, Docker, GitHub Actions, SQLite/Drizzle, native fetch GitHub API) is validated and NOT re-researched here.

---

## Core Problem: What Actually Broke (Verified from Codebase)

The existing `run-job.yml` passes `REPO_URL` as:
```yaml
-e REPO_URL="${{ github.server_url }}/${{ github.repository }}.git"
```

`github.repository` is always the repo that owns the workflow — i.e., `ScalingEngine/clawforge`. The entrypoint clones that URL, so Claude Code always operates on the clawforge working tree regardless of the intended target repo. The `gh pr create` in the entrypoint also targets the cloned repo (clawforge), producing a PR on the wrong repo. The `notify-pr-complete.yml` workflow reads `github.repository` for all PR lookups, compounding the error.

**Fix model:** Pass the target repo as a runtime variable from the Event Handler through to the entrypoint. The entrypoint then:
1. Clones the clawforge job branch (to get job.md, config, logs)
2. Separately clones the target repo
3. Runs `claude -p` inside the target repo working tree
4. Commits and PRs against the target repo

---

## Recommended Stack

### Core Technologies

No new npm dependencies are required. All four feature areas map cleanly onto existing infrastructure.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| GitHub REST API `/repos/{owner}/{repo}/git/refs` | v2022-11-28 (current) | Create job branch on TARGET repo, not clawforge | Already used in `lib/tools/create-job.js` via `githubApi()`. Creating the branch on the target repo requires only changing `owner/repo` in the endpoint path. No new SDK. |
| GitHub REST API `/repos/{owner}/{repo}/contents/{path}` | v2022-11-28 (current) | Write `job.md` to the target repo's job branch | Already used in `create-job.js`. The job.md write must go to the same repo as the branch — changing the path variables suffices. No new SDK. |
| `gh` CLI (already in Docker image) | 2.x (current in bookworm) | Create PR on target repo via `gh pr create --repo {owner}/{repo}` | `gh pr create` supports `--repo OWNER/REPO` flag to target any accessible repo. Verified from official gh CLI docs. No installation needed. |
| Bash `git clone` (already in entrypoint) | git 2.39 (bookworm) | Clone target repo after clawforge job branch clone | Standard git. The entrypoint already does a single `git clone`. The cross-repo model needs two separate clones: clawforge (for job.md/config) then target (for Claude to work in). |
| `GH_TOKEN` (already exists as env var) | — | Authenticate both git clones and gh CLI against target repos | A single PAT with `repo` scope on all allowed repos handles all operations. No new auth mechanism. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new | — | — | All v1.2 features compose on existing infrastructure |

### Configuration (New, No Library Needed)

| Config Item | Where It Lives | Format | Why |
|-------------|----------------|--------|-----|
| `ALLOWED_REPOS` env var | Instance `.env`, GitHub Secrets | JSON array string: `'["ScalingEngine/clawforge","ScalingEngine/neurostory"]'` | Parsed by Event Handler at job creation. Agent tool schema lists allowed repos; LLM selects from list. Simple JSON array is sufficient — no config library needed. |
| `TARGET_REPO` passed to job container | GitHub Actions `docker run -e TARGET_REPO=...` | `OWNER/REPO` string (e.g., `ScalingEngine/neurostory`) | Passed from Event Handler → GitHub API job branch commit (encoded in job.md or a separate env) → Actions workflow → entrypoint. |

---

## Feature-by-Feature Stack Analysis

### Feature 1: Allowed Repos Configuration Per Instance

**What it does:** Each instance (Noah/Archie, StrategyES/Epic) has a list of repos the agent is permitted to target. The agent reads this list, selects the most appropriate repo based on the user message, and dispatches the job to that repo.

**Where it lives:**
- Event Handler: `ALLOWED_REPOS` environment variable per instance
- `lib/ai/tools.js` — `create_job` tool schema updated to include `target_repo` parameter
- `lib/tools/create-job.js` — receives `targetRepo` and uses it in GitHub API calls

**Implementation:**

The `ALLOWED_REPOS` env var is a JSON array string (e.g., `'["ScalingEngine/clawforge","ScalingEngine/neurostory"]'`). Parsed once at startup in `lib/tools/create-job.js` or as a Zod-validated env var. The LLM selects from this list — the `create_job` tool schema adds a `target_repo` parameter with an enum derived from the parsed `ALLOWED_REPOS`:

```javascript
// lib/ai/tools.js — updated create_job schema
const allowedRepos = JSON.parse(process.env.ALLOWED_REPOS || '[]');

schema: z.object({
  job_description: z.string().describe('...'),
  target_repo: z.string()
    .describe(`Target repository for this job. Must be one of: ${allowedRepos.join(', ')}`)
    .refine(val => allowedRepos.includes(val), {
      message: `target_repo must be one of the allowed repos: ${allowedRepos.join(', ')}`
    }),
})
```

The LLM already follows `z.string()` constraints reliably. `refine()` adds runtime validation. No new library.

**Confidence: HIGH** — Zod `refine()` is used in existing codebase (`zod` 4.3.6 already installed). Pattern is standard for enum-like validation from env-configured lists.

---

### Feature 2: Agent Repo Selection

**What it does:** The LangGraph agent receives the user's message. Based on message content (mentions of project names, repo names, or inferred context), the LLM selects the appropriate `target_repo` when calling `create_job`.

**Where it lives:** No code changes beyond Feature 1 above. The LLM selects `target_repo` naturally from the tool schema description and the available allowed repos list. The EVENT_HANDLER.md (system prompt) should be updated to instruct the agent to infer target repo from context cues.

**What to add to EVENT_HANDLER.md:**
```
When dispatching jobs with create_job, select the target_repo that matches the project the user is referring to.
Known repos and their projects: [injected at runtime from ALLOWED_REPOS with descriptions]
```

**Repo-to-project mapping:** The `ALLOWED_REPOS` env var should include an optional description. Recommended format:

```
ALLOWED_REPOS='[{"repo":"ScalingEngine/clawforge","description":"ClawForge agent gateway"},{"repo":"ScalingEngine/neurostory","description":"NeuroStory web app"}]'
```

Parse as JSON array of objects. Pass repo names to the tool schema, descriptions to the system prompt context. No new library.

**Confidence: HIGH** — LLM schema-based selection is well-established in the existing codebase (other tool parameters use descriptive z.string() guidance). Direct codebase inspection of `lib/ai/tools.js` confirms the pattern works.

---

### Feature 3: Job Containers Clone and Operate on Target Repo

**What it does:** The entrypoint receives `TARGET_REPO` (e.g., `ScalingEngine/neurostory`) as an environment variable. Instead of operating only in the clawforge working tree, it:
1. Clones the clawforge job branch (for job.md, config files, logs directory)
2. Clones the target repo's main branch (for Claude to work in)
3. Copies config files (SOUL.md, AGENT.md) from clawforge clone into the target repo context
4. Runs `claude -p` with the target repo as the working directory
5. Commits changes to target repo working tree, pushes to target repo job branch

**Where it lives:** `templates/docker/job/entrypoint.sh` (and synced `docker/job/entrypoint.sh`)

**Key entrypoint changes:**

```bash
# Determine repos
CLAWFORGE_REPO_URL="${REPO_URL}"  # always clawforge (passed from Actions as before)
TARGET_REPO="${TARGET_REPO:-}"    # new env var: OWNER/REPO of the target

# Step A: Clone clawforge job branch (for job.md, config, logs)
git clone --single-branch --branch "$BRANCH" --depth 1 "$CLAWFORGE_REPO_URL" /job-meta
cd /job-meta

# Step B: If cross-repo, clone target separately
if [ -n "$TARGET_REPO" ] && [ "$TARGET_REPO" != "$(echo $CLAWFORGE_REPO_URL | sed 's|.*/\([^/]*/[^/]*\)\.git|\1|')" ]; then
    TARGET_REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/${TARGET_REPO}.git"
    git clone --depth 1 "$TARGET_REPO_URL" /job
    # Create a job branch on the target repo
    cd /job
    git checkout -b "$BRANCH"
else
    # Same-repo: use the already-cloned job branch directly
    cp -r /job-meta /job
fi

cd /job
```

**Authentication for target repo clone:** The same `GH_TOKEN` passed via `SECRETS` JSON handles target repo access, as long as the PAT has `repo` scope on the target repo. The existing `gh auth setup-git` call configures git credentials globally — this applies to all subsequent git operations in the container, including the target repo clone. No second token or separate credential setup needed.

**PR creation on target repo:**
```bash
# In entrypoint.sh PR creation section
if [ -n "$TARGET_REPO" ]; then
    gh pr create \
        --repo "$TARGET_REPO" \
        --title "clawforge: job ${JOB_ID}" \
        --body "Automated job by ClawForge" \
        --base main || true
else
    gh pr create \
        --title "clawforge: job ${JOB_ID}" \
        --body "Automated job by ClawForge" \
        --base main || true
fi
```

**Verified from gh CLI docs:** `gh pr create --repo OWNER/REPO` targets that repo directly. Works even when the git working directory is in a different repo. HIGH confidence — from official gh CLI documentation.

**Logs directory:** Logs (`logs/{jobId}/`) continue to live in the clawforge repo (cloned to `/job-meta`). After Claude runs, the entrypoint commits job artifacts (preflight.md, claude-output.jsonl, observability.md) to `/job-meta` and pushes to the clawforge job branch. Target repo gets only Claude's actual work product. This keeps audit logs in one place.

**Confidence: HIGH** — based on direct inspection of entrypoint.sh (current clone logic) and gh CLI docs (--repo flag).

---

### Feature 4: Job Branch Creation on Target Repo (Event Handler Side)

**What it does:** `create-job.js` currently creates a branch on `GH_REPO` (clawforge). For cross-repo jobs, the branch must be created on the TARGET repo. The `logs/{jobId}/job.md` write must go to the same target repo branch.

**Where it lives:** `lib/tools/create-job.js`

**Current flow:**
```javascript
const { GH_OWNER, GH_REPO } = process.env; // always clawforge
await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/git/refs`, { ... }); // branch on clawforge
await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/contents/logs/${jobId}/job.md`, { ... }); // job.md on clawforge
```

**New flow for cross-repo:**
```javascript
async function createJob(jobDescription, targetRepo = null) {
  const { GH_OWNER, GH_REPO } = process.env;
  // Parse target repo — default to same-repo if not specified
  const [targetOwner, targetRepoName] = (targetRepo || `${GH_OWNER}/${GH_REPO}`).split('/');

  const jobId = uuidv4();
  const branch = `job/${jobId}`;

  // 1. Get main branch SHA from TARGET repo
  const mainRef = await githubApi(`/repos/${targetOwner}/${targetRepoName}/git/ref/heads/main`);
  const mainSha = mainRef.object.sha;

  // 2. Create job branch on TARGET repo
  await githubApi(`/repos/${targetOwner}/${targetRepoName}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });

  // 3. Write job.md to TARGET repo job branch
  await githubApi(`/repos/${targetOwner}/${targetRepoName}/contents/logs/${jobId}/job.md`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `job: ${jobId}`,
      content: Buffer.from(jobDescription).toString('base64'),
      branch: branch,
    }),
  });

  return { job_id: jobId, branch, target_repo: `${targetOwner}/${targetRepoName}` };
}
```

**This means `run-job.yml` must also target the right repo.** The GitHub Actions `on: create` trigger fires for the repo that owns the workflow — which is clawforge. For a branch created on `ScalingEngine/neurostory`, the clawforge Actions workflow does NOT fire. This is a critical architectural constraint.

**The correct architecture for cross-repo:** The job branch must be created on the clawforge repo (to trigger clawforge's `run-job.yml`), and `TARGET_REPO` is passed as metadata (in job.md or as a workflow input). The entrypoint then clones the target repo separately. The clawforge job branch serves only as the Actions trigger + audit log carrier.

**Revised create-job.js approach:**
```javascript
// Job branch always created on clawforge (to trigger run-job.yml)
// TARGET_REPO is embedded in job.md as metadata, not used for branch creation
const { GH_OWNER, GH_REPO } = process.env; // clawforge
// ... create branch on clawforge as before ...

// Embed target repo in the job.md frontmatter
const jobMd = `---
target_repo: ${targetRepo || `${GH_OWNER}/${GH_REPO}`}
---

${jobDescription}`;

await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/contents/logs/${jobId}/job.md`, { ... jobMd ... });
```

The entrypoint reads `target_repo` from job.md frontmatter and uses it as `TARGET_REPO`. Alternatively, pass `TARGET_REPO` as a workflow variable via `workflow_dispatch` inputs — but the `on: create` trigger does not support inputs. The job.md frontmatter approach is the correct one.

**A simpler alternative:** Pass `TARGET_REPO` as an environment variable from the Event Handler through to the GitHub Actions step via a GitHub Actions variable. The Event Handler calls the GitHub API to trigger the workflow (`workflow_dispatch`) — but the current trigger is `on: create`, not `workflow_dispatch`. Changing triggers is out of scope.

**Recommended approach:** Embed `TARGET_REPO` in job.md frontmatter. Entrypoint parses it with `grep`/`awk` or `head -3`. Simple, no new tooling.

```bash
# In entrypoint.sh — parse TARGET_REPO from job.md frontmatter
TARGET_REPO=$(grep '^target_repo:' "/job/logs/${JOB_ID}/job.md" | sed 's/^target_repo: //' | tr -d '[:space:]')
if [ -z "$TARGET_REPO" ]; then
    TARGET_REPO="$(echo $REPO_URL | sed 's|https://[^/]*/||' | sed 's|\.git$||')"
fi
```

**Confidence: HIGH** — this is verified from understanding that `on: create` triggers fire only in the owning repo, and the job.md frontmatter is already a committed file the entrypoint reads. Direct codebase inspection confirms.

---

### Feature 5: Notifications with Correct Target Repo PR URLs

**What it does:** `notify-pr-complete.yml` currently uses `${{ github.repository }}` for all `gh pr` commands, which always resolves to clawforge. For cross-repo jobs, it must look up the PR on the target repo.

**Where it lives:** `templates/.github/workflows/notify-pr-complete.yml`

**Current (broken for cross-repo):**
```yaml
PR_NUMBER=$(gh pr list --head "$BRANCH" --state all --repo "${{ github.repository }}" ...)
```

**Fix:** Extract `TARGET_REPO` from the job.md file (already checked out via `actions/checkout`) and use it for PR lookups:

```bash
# In notify-pr-complete.yml
JOB_ID="${BRANCH#job/}"
TARGET_REPO=$(grep '^target_repo:' "logs/${JOB_ID}/job.md" 2>/dev/null | sed 's/^target_repo: //' | tr -d '[:space:]')
LOOKUP_REPO="${TARGET_REPO:-${{ github.repository }}}"

PR_NUMBER=$(gh pr list --head "$BRANCH" --state all --repo "$LOOKUP_REPO" --json number -q '.[0].number')
PR_URL=$(gh pr view "$PR_NUMBER" --repo "$LOOKUP_REPO" --json url -q '.url')
```

**No new tools needed** — `gh`, `grep`, `sed` are already in the workflow runner environment. This is a bash change in an existing workflow file.

**Confidence: HIGH** — verified from direct inspection of `notify-pr-complete.yml` and gh CLI docs confirming `--repo` flag support.

---

### Feature 6: Single PAT Auth for All Allowed Repos

**What it does:** Each instance has one `GH_TOKEN` PAT that has `repo` scope on all repos in its `ALLOWED_REPOS` list. No per-repo tokens, no OAuth app, no GitHub App.

**What type of PAT:**

**Fine-grained PAT (recommended):** GitHub fine-grained PATs allow selecting specific repositories with granular permissions (Contents: read/write, Pull requests: write, Actions: read). This is strictly better than classic PAT for this use case.

**Classic PAT (acceptable fallback):** `repo` scope covers all repos owned by the token owner. If all allowed repos are in the same org and the bot user has access, classic PAT works. Lower security posture.

**Verification:** The existing `GH_TOKEN` is a classic PAT (inferred from `instances/noah/.env.example` — no scoping noted). For v1.2, if target repos are in the same org (`ScalingEngine`), the existing PAT approach works without change — just ensure the PAT owner has access to the new repos.

**What does NOT need to change:**
- The GitHub Secrets convention (`AGENT_GH_TOKEN` passed to container, `GH_TOKEN` used by Event Handler) remains unchanged
- No new auth mechanism is needed
- `gh auth setup-git` in the entrypoint already configures git credentials from the ambient GitHub token (the token available to the Actions runner, not `GH_TOKEN` from secrets — these are different tokens)

**Critical distinction:**
- `GH_TOKEN` (in `SECRETS` JSON passed to container) — used by Event Handler and the entrypoint's explicit git operations on target repos
- `GITHUB_TOKEN` (automatic Actions token) — used by the `gh` CLI in workflow YAML steps; scoped to the repo owning the workflow (clawforge)

For `gh pr create --repo ScalingEngine/neurostory` to work inside the Docker container, the `GH_TOKEN` (from `SECRETS`) must be passed to `gh` explicitly:

```bash
# In entrypoint.sh — set GH_TOKEN for gh CLI in container
export GH_TOKEN="${AGENT_GH_TOKEN}"  # AGENT_GH_TOKEN comes from SECRETS JSON expansion
```

The existing entrypoint already exports `AGENT_*` secrets as flat env vars. `AGENT_GH_TOKEN` becomes `GH_TOKEN` after the `sub("^AGENT_"; "")` transformation in `run-job.yml`. So `gh pr create` inside the container uses the correct PAT automatically. No change needed.

**Confidence: HIGH** — verified from direct inspection of `run-job.yml` (secrets stripping logic), `entrypoint.sh` (SECRETS expansion), and `instances/noah/.env.example` (`GH_TOKEN` convention).

---

## Installation

No new npm packages required. All features compose on existing infrastructure.

```bash
# No new npm install required
# All features use:
# - lib/tools/github.js (githubApi helper — extend, don't replace)
# - lib/ai/tools.js (create_job schema — add target_repo parameter)
# - lib/tools/create-job.js (pass target_repo through, embed in job.md)
# - templates/docker/job/entrypoint.sh (parse TARGET_REPO, dual-clone logic)
# - templates/.github/workflows/notify-pr-complete.yml (use TARGET_REPO for PR lookups)
# - Instance .env files (add ALLOWED_REPOS JSON array)
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Embed `TARGET_REPO` in job.md frontmatter | Pass as GitHub Actions variable | Use Actions variables if switching to `workflow_dispatch` trigger. With `on: create`, there is no input mechanism — job.md frontmatter is the only reliable channel into the container. |
| Single PAT with `repo` scope on all allowed repos | GitHub App with installation tokens | Use GitHub App if targeting repos across multiple orgs, or if fine-grained permission control per-repo is required. For a single-org setup with 2-5 repos, PAT is simpler and sufficient. |
| `ALLOWED_REPOS` as JSON array env var | Per-repo config files in `instances/{name}/config/` | Use config files if ALLOWED_REPOS grows beyond 10 repos or requires complex metadata (branch restrictions, auto-merge policies). JSON array env var is simpler for the current 2-5 repo scale. |
| `gh pr create --repo TARGET_REPO` in entrypoint | GitHub REST API `POST /repos/{owner}/{repo}/pulls` from entrypoint | Use REST API if you need precise error handling or need to set labels/reviewers. `gh pr create` is simpler, already used in the entrypoint, and handles auth via ambient GH_TOKEN. |
| Same-repo compatibility via `TARGET_REPO` defaulting to clawforge | Separate code paths for same-repo vs. cross-repo | Separate paths create maintenance debt. Defaulting `TARGET_REPO` to the clawforge repo makes the same-repo case pass through the cross-repo path with no special handling — DRY and correct. |
| `@octokit/rest` for GitHub API calls | Extend existing `githubApi()` fetch wrapper | Use Octokit if you need TypeScript types, automatic retry, pagination support, or GitHub App token rotation. At current scale (< 50 jobs/day, 2 instances), the existing `fetch()` wrapper is sufficient and adds no new dependency. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@octokit/rest` or `@octokit/graphql` | Adds 300KB+ to bundle, new dep to maintain, no marginal benefit over existing `githubApi()` pattern at current scale | `githubApi()` in `lib/tools/github.js` with `X-GitHub-Api-Version: 2022-11-28` |
| GitHub App tokens for cross-repo auth | Requires App registration, webhook for token rotation, additional infrastructure; overkill for 1-org, 2-5 repo scenario | Fine-grained PAT with explicit repo access; same auth model as existing `GH_TOKEN` |
| Creating job branches on TARGET repos | Breaks `run-job.yml` — `on: create` only triggers on branches in the repo that owns the workflow (clawforge). Branches on `neurostory` don't trigger clawforge's Actions. | Create branches on clawforge; pass `TARGET_REPO` via job.md frontmatter; entrypoint clones target separately. |
| `workflow_dispatch` trigger for cross-repo | Requires changing `run-job.yml` trigger from `on: create` to `workflow_dispatch`, which changes how the Event Handler triggers jobs and breaks the existing branch-push→Actions chain | Keep `on: create` trigger; pass TARGET_REPO through job.md |
| Docker-in-Docker for target repo isolation | Adds complexity, requires `--privileged` flag, defeats the purpose of the existing single-container model | Two sequential `git clone` operations in the same container: clawforge (for config) then target (for work) |
| Separate `GH_TOKEN_NEUROSTORY` per repo | Each new repo requires new secret, new env var, new secret-passing logic in run-job.yml | Single `GH_TOKEN` (or `AGENT_GH_TOKEN`) with `repo` scope on all allowed repos; simpler, fewer credentials to rotate |

---

## Stack Patterns by Variant

**If target repo is the same as clawforge (same-repo job):**
- `TARGET_REPO` frontmatter defaults to `ScalingEngine/clawforge`
- Entrypoint detects same-repo and skips second clone (or just clones into `/job` as before)
- `gh pr create` omits `--repo` flag (or includes it — same result)
- No regression path needed — same-repo behavior is a subset of cross-repo

**If target repo is in a different GitHub org:**
- Fine-grained PAT required (classic PAT is user-scoped, not org-scoped)
- Out of scope for v1.2 — all current target repos are in `ScalingEngine` org

**If target repo has no `main` branch (uses `master` or other default):**
- `get ref/heads/main` returns 404 — need to query default branch via repo metadata API
- For v1.2: document that all allowed repos must have `main` as default branch
- Future: add default branch detection via `GET /repos/{owner}/{repo}` → `default_branch`

**If target repo has branch protection requiring PR reviews:**
- `auto-merge.yml` currently merges without reviewer requirement
- For protected target repos, auto-merge will fail → PR stays open, notification sent with `not_merged` status
- No code change needed — the notification pipeline already handles `not_merged` state

---

## Integration Points (Where Code Changes Land)

| File | What Changes | Why |
|------|-------------|-----|
| `lib/ai/tools.js` | Add `target_repo` parameter to `create_job` tool schema; derive allowed repos from `ALLOWED_REPOS` env | Agent must select target repo; Zod schema guides LLM selection |
| `lib/tools/create-job.js` | Accept `targetRepo` argument; embed `target_repo:` in job.md frontmatter; return `target_repo` in result | job.md frontmatter is the only channel to pass TARGET_REPO into the container |
| `templates/docker/job/entrypoint.sh` | Parse `TARGET_REPO` from job.md frontmatter; dual-clone logic (clawforge for config, target for work); `gh pr create --repo TARGET_REPO` | Core cross-repo execution mechanism |
| `docker/job/entrypoint.sh` | Same as above (template sync) | Keep live and template byte-for-byte identical |
| `templates/.github/workflows/notify-pr-complete.yml` | Parse `TARGET_REPO` from job.md; use `--repo TARGET_REPO` for all `gh pr` lookups | Correct PR URL in completion notification |
| `.github/workflows/notify-pr-complete.yml` | Same as above (template sync) | Live file must match template |
| `instances/noah/.env.example` | Add `ALLOWED_REPOS` variable | Document configuration requirement |
| `instances/strategyES/.env.example` | Add `ALLOWED_REPOS` variable | Document configuration requirement |

---

## Version Compatibility

| Component | Current Version | Notes |
|-----------|-----------------|-------|
| `zod` 4.3.6 | Node 22, existing | `z.string().refine()` for enum-like validation is stable. Pattern already used in codebase. |
| GitHub REST API `v2022-11-28` | Current | `/repos/{owner}/{repo}/git/refs`, `/repos/{owner}/{repo}/contents/{path}` — same endpoints used in existing `create-job.js`, now parameterized per target repo. No deprecation. |
| `gh` CLI 2.x | Pre-installed in bookworm Docker image | `--repo OWNER/REPO` flag for `gh pr create` is stable since gh 2.0. No version risk. |
| `git` 2.39 | bookworm Docker image | Two sequential `git clone` calls in one entrypoint is standard. No version concern. |
| `GH_TOKEN` PAT | Existing | If using fine-grained PAT for target repo access, it must be regenerated with explicit repo access added. Classic PAT with `repo` scope works if the token owner has org-level access to target repos. |

---

## Sources

- Direct codebase inspection: `templates/.github/workflows/run-job.yml` — `REPO_URL` always hardcoded to `github.repository` (clawforge); root cause of cross-repo bug confirmed (HIGH confidence)
- Direct codebase inspection: `templates/docker/job/entrypoint.sh` — current `git clone "$REPO_URL"` single-clone model; `gh pr create` without `--repo`; job.md read pattern (HIGH confidence)
- Direct codebase inspection: `templates/.github/workflows/notify-pr-complete.yml` — `gh pr list --repo "${{ github.repository }}"` always clawforge; root cause of wrong URL in notification (HIGH confidence)
- Direct codebase inspection: `lib/tools/create-job.js` — branch and job.md creation always use `GH_OWNER`/`GH_REPO` env vars (clawforge); where `targetRepo` parameter needs to be added (HIGH confidence)
- Direct codebase inspection: `lib/ai/tools.js` — `create_job` tool schema using Zod; where `target_repo` parameter should be added (HIGH confidence)
- Direct codebase inspection: `instances/noah/.env.example` — current env var conventions; where `ALLOWED_REPOS` should be added (HIGH confidence)
- GitHub Docs: `https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28` — PR creation API; `on: create` trigger only fires in repo owning the workflow — confirmed cross-repo branch creation does NOT trigger foreign repo workflows (HIGH confidence, official docs)
- GitHub Docs: `https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28` — Git refs API; verified same endpoint works with different owner/repo path params (HIGH confidence)
- gh CLI docs: `https://cli.github.com/manual/gh_pr_create` — `--repo OWNER/REPO` flag confirmed for cross-repo PR creation (HIGH confidence, official docs)
- Zod docs: `z.string().refine()` — enum-like validation pattern; already used in codebase (`zod` 4.3.6 installed) (HIGH confidence)

---

*Stack research for: ClawForge v1.2 — cross-repo job targeting*
*Researched: 2026-02-25*
