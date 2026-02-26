# Pitfalls Research

**Domain:** Cross-repo job targeting added to existing single-repo Claude Code agent pipeline (ClawForge v1.2)
**Researched:** 2026-02-25
**Confidence:** HIGH (codebase inspection of entrypoint.sh, run-job.yml, notify-pr-complete.yml, auto-merge.yml, create-job.js, github.js, tools.js) / MEDIUM (GitHub Actions token behavior from official docs + community confirmation) / LOW (security exposure patterns — flagged)

---

## Critical Pitfalls

### Pitfall 1: Entrypoint Clones clawforge When Target Is a Different Repo

**What goes wrong:**
The `run-job.yml` workflow fires on `job/*` branch creation in clawforge. It passes `REPO_URL` as `"${{ github.server_url }}/${{ github.repository }}.git"` — always the clawforge repo. The entrypoint clones that URL into `/job`. When a cross-repo job targets, say, NeuroStory, the container is working inside the clawforge tree the entire time. Claude Code reads clawforge's files, commits to the clawforge job branch, and opens a PR against clawforge. The notification reports "merged" against the clawforge PR URL. No changes land in NeuroStory. This is the confirmed bug discovered 2026-02-25.

**Why it happens:**
`run-job.yml` hardcodes `github.repository` (the workflow's owning repo) as `REPO_URL`. There is no mechanism for the Event Handler to pass the target repo through the GitHub Actions trigger. The `create_job` tool in `lib/ai/tools.js` has no `target_repo` parameter — `createJob()` in `lib/tools/create-job.js` operates only on `GH_OWNER`/`GH_REPO` env vars, which are always clawforge.

**How to avoid:**
Thread the target repo through every layer:

1. `create_job` tool schema adds an optional `target_repo` string parameter (e.g., `"NeuroStory"` or `"owner/repo"`).
2. `createJob()` writes a `TARGET_REPO` line into `logs/{jobId}/job.md` (the entrypoint already reads this file).
3. The entrypoint reads `TARGET_REPO` from `job.md` before the clone step and sets `CLONE_URL` to the target repo's authenticated URL.
4. `run-job.yml` is unchanged — it still passes clawforge's URL as fallback; the entrypoint overrides it when `TARGET_REPO` is present.
5. Fallback: if no `TARGET_REPO`, entrypoint uses `REPO_URL` (preserving same-repo behavior).

**Warning signs:**
- PR URL in notification points to `github.com/{clawforge_owner}/clawforge/pull/...` when user asked for work on a different repo.
- Claude commits changes to `logs/`, `config/`, or other clawforge paths that are irrelevant to the task.
- No branch or PR appears in the target repo after a "successful" cross-repo job.

**Phase to address:**
Phase 1 (Entrypoint: cross-repo clone) — the first phase must fix this before any other cross-repo feature makes sense.

---

### Pitfall 2: GITHUB_TOKEN Cannot Authenticate to a Different Repository

**What goes wrong:**
The entrypoint calls `gh auth setup-git` which configures git credentials using the `GH_TOKEN` env var. For same-repo jobs this is already the PAT used to clone clawforge (`AGENT_GH_TOKEN` secret, passed as `GH_TOKEN` inside the container). When the entrypoint tries to `git clone` a different repo using this token, the clone will fail with `repository not found` or `403` if the PAT does not have access to that repo. Worse: `|| true` on the clone would silently swallow the error and proceed with an empty `/job` directory, causing Claude to fail cryptically when trying to read files.

The existing `AGENT_GH_TOKEN` secret is scoped to clawforge (or whatever scopes the operator configured). Cross-repo work requires a PAT with `repo` scope for each target repo.

**Why it happens:**
GitHub PATs are not automatically repo-scoped — a classic PAT grants access to all repos the user can access, but a fine-grained PAT is scoped at creation time to specific repos. The current architecture assumes the token is for clawforge only. Adding cross-repo without explicitly managing per-repo token scope risks either: (a) using an overprivileged classic PAT that silently works but grants too much access, or (b) using a fine-grained PAT scoped to clawforge only that fails silently on target repos.

**How to avoid:**
Use a single fine-grained PAT per instance, configured with `repo` scope for clawforge plus all allowed target repos. Store as `AGENT_GH_TOKEN` (already the convention). The `ALLOWED_REPOS` config per instance defines which repos need access — this directly maps to the PAT's repo permissions. Document this constraint in instance config: "AGENT_GH_TOKEN must have Contents (read/write) and Pull Requests (write) for all repos in ALLOWED_REPOS."

Do not use separate tokens per target repo — the entrypoint would need logic to select which token to use, and token selection errors are silent in bash with `gh auth setup-git`.

**Warning signs:**
- Entrypoint log shows `git clone: repository not found` or `ERROR 403` before Claude runs.
- Container exits at clone step, `preflight.md` is never written, `failure_stage` in notification is `docker_pull` (incorrect — it's actually an auth failure at clone, not docker pull).
- Clone appears to succeed (no error) but `/job` is empty or contains only an empty directory.

**Phase to address:**
Phase 1 (Entrypoint: cross-repo clone) — token scope must be confirmed before any cross-repo clone is attempted.

---

### Pitfall 3: `gh pr create` Creates PR Against clawforge, Not the Target Repo

**What goes wrong:**
The entrypoint's PR creation step is:
```bash
gh pr create \
    --title "clawforge: job ${JOB_ID}" \
    --body "Automated job by ClawForge" \
    --base main || true
```

`gh pr create` without `--repo` infers the repo from the git remote of the current directory (`/job`). For same-repo jobs, `/job` is a clone of clawforge — so the PR goes to clawforge. For cross-repo jobs, `/job` is a clone of the target repo — so the PR would go to the target repo, which is the desired behavior.

However, three sub-problems emerge:

1. The PR title says `"clawforge: job ${JOB_ID}"` — this leaks the orchestration system name into the target repo's PR list.
2. The `--base main` assumption fails for repos where the default branch is not `main` (e.g., `master`, `develop`, or a custom trunk branch).
3. The job branch `job/{uuid}` was pushed to the target repo by the entrypoint's `git push origin` — but if the PAT lacks `contents: write` on the target repo, the push silently fails (`|| true`), and `gh pr create` then fails because the branch doesn't exist remotely, also silently (`|| true`). Net result: no PR, no error, notification reports "not_merged" but without explaining why.

**How to avoid:**
1. Parameterize the PR title to omit "clawforge" for cross-repo PRs, or use a neutral title.
2. Detect the default branch of the target repo before `gh pr create`: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
3. Add explicit error detection around push and PR creation — the `|| true` pattern hides these failures. Check `git push` exit code and report it as a new failure stage: `push_failed`.
4. After `git push`, verify the branch exists on the remote before attempting `gh pr create`: `gh api repos/{owner}/{repo}/branches/{branch}`.

**Warning signs:**
- PRs appear in clawforge for jobs targeting other repos (wrong `--repo` behavior — indicates `/job` remote is pointing at clawforge despite cross-repo setup).
- PR creation fails silently — `HAS_NEW_COMMIT=true` but no PR appears in either repo.
- Notification `pr_url` is empty string (the `|| true` caused `gh pr create` to not output a URL).

**Phase to address:**
Phase 2 (PR creation on target repo) — depends on Phase 1's clone being correct.

---

### Pitfall 4: `notify-pr-complete.yml` and `auto-merge.yml` Run in the Wrong Repository

**What goes wrong:**
`notify-pr-complete.yml` fires on completion of "Auto-Merge ClawForge PR" workflow (a `workflow_run` trigger). `auto-merge.yml` fires on `pull_request` opened against clawforge's `main` branch. Both workflows live in clawforge and can only observe events in clawforge.

When a cross-repo job creates a PR in NeuroStory, these workflows in clawforge never fire. The cross-repo PR in NeuroStory has no auto-merge behavior. The notification that reports "merged/not_merged" never fires. The Event Handler never receives a completion callback. The user's Slack thread is permanently silent — the job appears to have vanished.

**Why it happens:**
GitHub Actions workflows are repo-scoped. `notify-pr-complete.yml` observes `workflow_run` events, but `workflow_run` only captures workflows within the same repository. A PR merge in NeuroStory does not trigger any workflow in clawforge. Cross-repo notifications require an explicit outbound call from the target repo's workflows to the Event Handler, or a polling mechanism.

**How to avoid:**
For cross-repo PRs, the notification path must change:

Option A (recommended): After `gh pr create` in the entrypoint, the entrypoint itself sends the notification payload directly to the Event Handler webhook. This avoids needing workflows in target repos. The entrypoint already has `APP_URL` and `GH_WEBHOOK_SECRET` available as `AGENT_*` secrets.

Option B: Install clawforge's workflow files (notify-pr-complete.yml, auto-merge.yml) into each allowed target repo. This is operationally complex and requires maintaining these files across repos.

Option A is the right call for v1.2 scope. The entrypoint must distinguish same-repo vs cross-repo post-completion and use the appropriate notification path.

**Warning signs:**
- Cross-repo jobs complete but no notification appears in Slack/Telegram.
- `job_outcomes` table in SQLite has no entry for the cross-repo job ID.
- The PR in the target repo is open/merged but the Event Handler has no record of completion.
- User asks "what happened to my job?" — the agent has no context.

**Phase to address:**
Phase 3 (Notification routing for cross-repo jobs) — this is the hardest problem and must be explicitly designed, not discovered during testing.

---

### Pitfall 5: `auto-merge.yml` Cannot Merge PRs in Target Repos

**What goes wrong:**
`auto-merge.yml` in clawforge fires on `pull_request` opened against clawforge. For cross-repo PRs, it never fires. Even if it did, the `GITHUB_TOKEN` provided to clawforge's workflow cannot merge PRs in NeuroStory — `GITHUB_TOKEN` is scoped to a single repository (the workflow's owning repo). Auto-merge for cross-repo jobs requires either (a) the entrypoint auto-merges immediately after PR creation using the already-authenticated PAT, or (b) a human merges the PR manually.

Additionally, the `ALLOWED_PATHS` guard in `auto-merge.yml` is designed to prevent Claude from modifying arbitrary files in clawforge. For target repos, the semantics are completely different — operators may want Claude to modify any file in NeuroStory, not just `logs/`. Blindly applying clawforge's `ALLOWED_PATHS` to cross-repo PRs would block all merges.

**Why it happens:**
The auto-merge design assumes the PR is always in clawforge and always subject to clawforge's path restrictions. Cross-repo jobs have different merge policies (who approves, what paths are allowed) that vary by target repo.

**How to avoid:**
For v1.2, define cross-repo merge policy explicitly in `ALLOWED_REPOS` config:

```json
{
  "neurostory": {
    "owner": "ScalingEngine",
    "repo": "neurostory",
    "auto_merge": true,
    "allowed_paths": "/"
  }
}
```

The entrypoint reads the target repo's merge policy from `ALLOWED_REPOS` config (passed via `AGENT_*` secrets as JSON). If `auto_merge: true`, the entrypoint calls `gh pr merge --squash` immediately after PR creation, using the PAT it already has. This moves merge authority into the entrypoint where the correct token and correct repo context are already present.

**Warning signs:**
- Cross-repo PRs stay open indefinitely with no merge.
- `job_outcomes` entries show `merge_result: "not_merged"` for all cross-repo jobs.
- Operators get "not merged" notifications and have to manually merge PRs.

**Phase to address:**
Phase 2 (PR creation and merge on target repo) — design the merge policy per target repo during PR creation phase.

---

### Pitfall 6: Same-Repo Jobs Regress When Entrypoint Logic Is Modified

**What goes wrong:**
Adding `TARGET_REPO` detection to the entrypoint requires a conditional branch: "if cross-repo, clone target; if same-repo, use existing REPO_URL." A bug in the conditional — wrong variable name, incorrect fallback, or a missing `elif` — causes same-repo jobs to fall into the wrong branch. The symptom is subtle: the container clones the right repo but from the wrong branch, or `JOB_ID` extraction fails because `BRANCH` is parsed differently in the new code path.

Additionally, any change to how `FULL_PROMPT` is assembled that breaks the 5-section structure causes Claude to receive a malformed prompt — it may not know where the task starts and where documentation ends. The test harness (`templates/docker/job/test-harness/`) runs locally against a Docker container but does not exercise the cross-repo path.

**Why it happens:**
The entrypoint is a bash script with `set -e` — any unhandled error exits the container. Conditional logic for cross-repo vs same-repo is error-prone in bash, especially when `REPO_URL`, `TARGET_REPO`, and `CLONE_URL` coexist and one is derived from another. Developers add the cross-repo path, test it, and assume same-repo is unchanged — but bash variable scoping issues can cause cross-contamination.

**How to avoid:**
Write an explicit regression test before touching the entrypoint:
1. Run a same-repo job against a local test scenario using the existing test harness.
2. Record the baseline: which files are cloned, what `FULL_PROMPT` looks like, what `git log` shows after the job.
3. Add cross-repo logic, then re-run the same test and confirm baseline is unchanged.

Use clear variable naming: `TARGET_REPO_SLUG` (the new cross-repo value), `SELF_REPO_URL` (the always-clawforge URL from `REPO_URL`), `CLONE_URL` (resolved from target or self). Never reuse `REPO_URL` to mean different things in different code paths.

**Warning signs:**
- Same-repo jobs fail immediately after entrypoint changes are deployed.
- `JOB_ID` is extracted as empty string or UUID-shaped random value (parsing broke).
- `preflight.md` shows `Working directory` as `/job` but `git remote -v` shows the wrong repo URL.
- The 5-section `FULL_PROMPT` structure is missing sections (e.g., Stack section absent because `REPO_STACK` logic was refactored).

**Phase to address:**
Phase 1 (Entrypoint: cross-repo clone) — regression tests must be written before entrypoint changes. The phase should explicitly gate on "same-repo jobs still pass" before cross-repo work is considered complete.

---

### Pitfall 7: `createJob()` Creates Branches and Writes `job.md` in clawforge — Not in the Target Repo

**What goes wrong:**
`lib/tools/create-job.js` calls GitHub API to:
1. Get clawforge's `main` branch SHA.
2. Create `job/{uuid}` branch in clawforge.
3. Write `logs/{uuid}/job.md` to that branch in clawforge.

This always happens in clawforge regardless of target repo. This is correct — the job branch in clawforge is what triggers `run-job.yml`, and `job.md` is how the job description reaches the container. The pitfall is assuming this needs to change for cross-repo jobs. It does not.

The confusion is: developers see `createJob()` targeting clawforge and assume it needs to be updated to target the target repo. Changing `createJob()` to create branches in the target repo would break the GitHub Actions trigger (which watches clawforge's `job/*` branches) and would require the target repo to have run-job.yml installed.

**Why it happens:**
The architecture's two-step design (clawforge branch triggers Action, Action runs container, container clones target) is non-obvious. Developers who read `createJob()` in isolation see it creating files in clawforge and assume the whole pipeline needs to be in the target repo for cross-repo support.

**How to avoid:**
Document explicitly in the code and architecture: "clawforge is always the orchestrator. The job branch always goes to clawforge. The target repo is only touched by the entrypoint inside the container." Only the entrypoint changes for cross-repo support. `createJob()` changes only to embed `TARGET_REPO` in the `job.md` content it writes — the API calls remain clawforge-only.

The entrypoint reads `TARGET_REPO` from the `job.md` it finds after cloning the clawforge branch. This is the correct handoff point.

**Warning signs:**
- PRs/branches appearing in NeuroStory during development but before entrypoint changes are tested (indicates `createJob()` was incorrectly modified).
- `run-job.yml` stops firing (indicates the branch creation was moved out of clawforge).
- `notify-job-failed.yml` can no longer find `logs/{jobId}/job.md` (indicates log directory was moved to target repo).

**Phase to address:**
Phase 1 (Entrypoint: cross-repo clone) — explicitly document which layer does what. Code review should flag any changes to `createJob()` that touch repo targeting.

---

### Pitfall 8: Notification Routing Fails Because `job_origins` Maps Job ID to Thread, Not to Repo

**What goes wrong:**
When a cross-repo job completes, the Event Handler's `getJobOrigin(jobId)` looks up which thread originated the job to route the notification. For same-repo jobs, `notify-pr-complete.yml` sends the webhook to the Event Handler with `job_id` and `pr_url` populated. The Event Handler matches `job_id` → `thread_id` → sends Slack/Telegram notification.

For cross-repo jobs (if using Option A notification via entrypoint), the entrypoint sends the notification directly. But the payload needs to include `job_id` (which the entrypoint has), `pr_url` (which `gh pr create` outputs), and `merge_result`. The Event Handler's webhook handler must reconstruct a payload that matches the expected schema — but the cross-repo notification arrives before the PR is merged (the entrypoint sends it immediately after PR creation or merge), while the same-repo notification arrives after auto-merge. The `merge_result` field will be different, and the `summarizeJob()` logic uses that field to choose the notification tone.

**Why it happens:**
The notification schema was designed for the existing flow where GitHub Actions is the notifier. The entrypoint-as-notifier pattern requires the entrypoint to construct the same JSON payload that `notify-pr-complete.yml` constructs — including fields it may not have (changed files list, commit message from merged PR).

**How to avoid:**
The entrypoint should build the notification payload after push and PR creation:
```bash
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
COMMIT_MSG=$(git log -1 --format="%s" 2>/dev/null || echo "")
PR_URL=$(gh pr create ... 2>&1 | grep "https://github.com" || echo "")
```
Then use the same `jq` construction as `notify-pr-complete.yml` to build the payload. The `merge_result` field should be set to `"merged"` if the entrypoint auto-merged, or `"open"` if the PR is left for human review. This keeps the Event Handler's webhook handler unchanged — it receives the same schema regardless of same-repo vs cross-repo.

**Warning signs:**
- Cross-repo job notification appears in wrong Slack thread.
- Event Handler logs show "job_id not found in job_origins" for cross-repo jobs.
- Notification tone is wrong (e.g., reports "failed" for a successfully merged cross-repo PR).
- `job_outcomes` table has no record for cross-repo job IDs.

**Phase to address:**
Phase 3 (Notification routing for cross-repo jobs) — must replicate exact notification schema used by `notify-pr-complete.yml`.

---

### Pitfall 9: Branch Name `job/{uuid}` Pushed to Target Repo Pollutes Its Branch List

**What goes wrong:**
The entrypoint's git workflow:
1. Clones target repo to `/job` on the cross-repo branch (job branch from clawforge, which is `job/{uuid}`).
2. Claude makes changes inside `/job`.
3. `git push origin` pushes the `job/{uuid}` branch to the target repo's remote.
4. `gh pr create` opens a PR in the target repo from `job/{uuid}` to the target's default branch.

After the PR is merged, the `job/{uuid}` branch remains in the target repo unless explicitly deleted. Over time, hundreds of `job/{LONG-UUID}` branches accumulate in the target repo, polluting the branch list and potentially confusing human contributors.

Additionally, a `job/{uuid}` branch in the target repo is meaningless without clawforge context — a developer seeing it in NeuroStory has no idea what created it.

**Why it happens:**
The current entrypoint never deletes branches after PR creation because for same-repo jobs, GitHub's branch-deletion-on-merge setting handles cleanup. For target repos, that setting may not be enabled, and even if it is, it only applies after merge — not-merged (rejected) PRs leave orphaned branches.

**How to avoid:**
1. After PR creation (and optionally after merge), add `git push origin --delete job/${JOB_ID}` to the entrypoint's cross-repo path. For the same-repo path, preserve existing behavior (let GitHub handle cleanup).
2. Consider using a different branch naming convention in target repos: `clawforge/{uuid}` instead of `job/{uuid}`. This makes the branch origin obvious to target repo contributors and avoids any namespace collision if the target repo has its own `job/` branches.
3. If using `clawforge/{uuid}` branches in target repos, update the `pr_url` extraction logic in the entrypoint — it cannot rely on searching for `job/*` branches in the target repo.

**Warning signs:**
- Target repo accumulates dozens of `job/{uuid}` branches with no clear ownership.
- Target repo contributors open issues asking "what are these job branches?"
- PR list in target repo is polluted with ClawForge-generated PRs, making navigation difficult.

**Phase to address:**
Phase 2 (PR creation on target repo) — branch naming convention for target repos should be decided before any cross-repo jobs run.

---

### Pitfall 10: CLAUDE.md Injection in Entrypoint Reads from `/job` — Which Is Now the Target Repo, Not clawforge

**What goes wrong:**
The entrypoint reads CLAUDE.md from `/job/CLAUDE.md`:
```bash
if [ -f "/job/CLAUDE.md" ]; then
    RAW_CLAUDE_MD=$(cat /job/CLAUDE.md)
```

For same-repo jobs, this is clawforge's own CLAUDE.md — the agent gets architectural context for the codebase it's modifying.

For cross-repo jobs, `/job` is a clone of the target repo. The entrypoint reads the target repo's CLAUDE.md — which is exactly what you want for cross-repo work. This part works correctly by accident.

However, the SOUL.md and AGENT.md system prompt files are still read from `/job/config/`:
```bash
if [ -f "/job/config/SOUL.md" ]; then
if [ -f "/job/config/AGENT.md" ]; then
```

For cross-repo jobs, `/job/config/SOUL.md` is the target repo's `config/SOUL.md` — which may not exist (NeuroStory doesn't have clawforge's config structure). The system prompt will be empty. Claude runs with no persona, no behavioral guidelines, and no GSD routing instructions.

**Why it happens:**
The entrypoint assumes the cloned repo always has `config/SOUL.md` and `config/AGENT.md`. This is true for clawforge (same-repo jobs). It is false for any other repo (cross-repo jobs). The system prompt assembly silently produces an empty string when the files are absent — no error, no warning, no fallback.

**How to avoid:**
Bake the system prompt into the Docker image rather than reading it from the cloned repo. Store SOUL.md and AGENT.md as files inside the Docker image (e.g., `/defaults/SOUL.md`, `/defaults/AGENT.md`). The entrypoint always loads from the image defaults, with an optional override if the cloned repo has these files. Cross-repo repos never override because they don't have this structure.

Alternatively, pass the system prompt content as a container environment variable (base64-encoded) from `run-job.yml`, which can read it from clawforge's own repo at Action startup time.

**Warning signs:**
- Cross-repo job runs produce no SOUL.md-aligned output — Claude behaves generically, not as the configured persona.
- AGENT.md instructions ("MUST use Skill tool") are absent from cross-repo jobs — Claude does not invoke GSD.
- `--append-system-prompt` receives an empty string — Claude runs with only Anthropic's default system prompt.
- GSD invocations are zero for cross-repo jobs even for complex tasks.

**Phase to address:**
Phase 1 (Entrypoint: cross-repo clone) — system prompt sourcing must be fixed in the same phase as the clone change. This is a blocking issue.

---

### Pitfall 11: Token Embedded in REPO_URL Appears in Container Logs

**What goes wrong:**
`run-job.yml` passes:
```yaml
-e REPO_URL="${{ github.server_url }}/${{ github.repository }}.git"
```
This is just the plain URL without a token — `gh auth setup-git` handles authentication separately. However, when the entrypoint is extended to clone a target repo, developers may be tempted to embed the PAT directly in the clone URL for simplicity:
```bash
CLONE_URL="https://x-access-token:${AGENT_GH_TOKEN}@github.com/org/target-repo.git"
git clone "$CLONE_URL" /job
```
This will print the full URL with the embedded token in the container's stdout output, which is captured by GitHub Actions and stored in the workflow run logs. If the workflow run is public (public repo), the token is exposed to anyone who reads the logs.

**Why it happens:**
Embedding tokens in URLs is the simplest way to authenticate `git clone` in a container where git credential helpers may not be set up. It works, but it leaks secrets via logs. The current entrypoint avoids this by calling `gh auth setup-git` first, then using a plain URL — but this pattern may not be obvious to developers extending the entrypoint for cross-repo.

**How to avoid:**
Always use `gh auth setup-git` before any `git clone` call. `gh auth setup-git` configures git's credential helper to use the `GH_TOKEN` environment variable transparently — no token appears in URLs. Confirm `GH_TOKEN` is set before calling `gh auth setup-git`. For cross-repo clones, `GH_TOKEN` must be the PAT with access to the target repo (same token, broader scope).

If embedding in URL is unavoidable, use `git clone` with `GIT_ASKPASS` or `git credential-store` patterns — never interpolate token into the URL string that is echoed or logged.

**Warning signs:**
- GitHub Actions log for a run shows a URL containing `https://ghp_...@github.com` or `x-access-token:...`.
- GitHub's secret-scanning bot detects a token in workflow logs and sends a security alert email.
- Token embedded in URL shows up in `git remote -v` output, which may be echoed by debugging steps.

**Phase to address:**
Phase 1 (Entrypoint: cross-repo clone) — review the clone URL construction in code review to ensure no token interpolation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode `--base main` for cross-repo PRs | Simpler entrypoint | PR creation fails for repos with non-main default branches | Never — detect default branch with `gh repo view --json defaultBranchRef` |
| Read SOUL.md/AGENT.md from `/job/config/` for cross-repo | No entrypoint change needed | Empty system prompt for all cross-repo jobs — Claude runs without persona or GSD instructions | Never for cross-repo — bake into Docker image |
| Use one classic PAT with all-repo access | One token, no per-repo config | Overprivileged token; if leaked, all repos are compromised | Acceptable in MVP with 2 instances; unacceptable at scale |
| Have entrypoint push `job/{uuid}` branch to target repo | No branch naming change needed | Target repo accumulates orphaned branches; semantically confusing to contributors | Acceptable short-term if branch-deletion-on-merge is enabled; document as known debt |
| `|| true` on `git push` and `gh pr create` for cross-repo | Container never fails on push errors | Auth failures and push rejections are silently swallowed — no push failure notification | Never — add explicit exit code tracking and `push_failed` stage |
| Notify from `notify-pr-complete.yml` for cross-repo | No entrypoint changes | Notification never fires because workflow only sees clawforge events | Never — entrypoint must notify for cross-repo |
| Skip ALLOWED_REPOS validation in agent tool | Simpler `create_job` tool | Agent can target any arbitrary public GitHub repo, not just allowed list | Never — enforce allowlist before `createJob()` is called |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `gh pr create` in cross-repo entrypoint | Running without `--repo` assumes current dir's remote is always right | Use `--repo {owner}/{repo}` explicitly; the current dir remote may differ from what you intend |
| `gh auth setup-git` for cross-repo clone | Calling once at the top then cloning a different repo where token has no access | Confirm `GH_TOKEN` has access to target repo before cloning; add a preflight API call: `gh api repos/{owner}/{repo}` |
| `workflow_run` trigger for cross-repo completion | Expecting `notify-pr-complete.yml` to fire when a PR merges in NeuroStory | `workflow_run` only captures runs in the same repo — cross-repo completion requires entrypoint-side notification |
| `GITHUB_TOKEN` in `auto-merge.yml` and `notify-pr-complete.yml` | Using `GITHUB_TOKEN` for cross-repo `gh pr merge` or `gh pr view` | `GITHUB_TOKEN` is repo-scoped to clawforge only; cross-repo operations require the PAT from `AGENT_GH_TOKEN` |
| `git push origin` in cross-repo entrypoint | Pushing `job/{uuid}` branch to target repo without checking if it already exists | Run `git ls-remote --exit-code origin job/${JOB_ID}` before push; handle "already exists" separately from auth failures |
| `gh pr list --repo "${{ github.repository }}"` in `notify-pr-complete.yml` | Always queries clawforge for PR info | For cross-repo the PR is in the target repo; this query finds no match and `pr_url` remains empty |
| `REPO_SLUG` derivation from `REPO_URL` in entrypoint | `REPO_SLUG` resolves to `ScalingEngine/clawforge` for all jobs | For cross-repo jobs, `TARGET_REPO_SLUG` should be used in `FULL_PROMPT`'s `## Target` section |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Cloning large target repos with `--depth 1` | Clone takes 2-3 minutes for repos with many large files; job times out | Use `--depth 1 --single-branch --branch {job_branch}` — already the pattern; ensure target repo has no LFS bloat | Any target repo >500MB |
| PR creation poll loop for cross-repo | Entrypoint waits for PR to be mergeable (like `auto-merge.yml`) — blocks for 5+ minutes | For cross-repo, merge immediately after push if `auto_merge: true`; do not poll — entrypoint has a 30-min timeout | Target repos with required status checks that take >10 min |
| `gh pr list` in target repo without scoping | Fetches all PRs in target repo to find the right one; slow for active repos with hundreds of PRs | Use `--head job/{uuid}` to filter by branch — O(1) lookup | Target repos with >500 open PRs |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Token embedded in clone URL passed to `git clone` | Token appears in container stdout → workflow logs → publicly visible for public repos | Always use `gh auth setup-git` + plain URL; never interpolate PAT into URL string |
| Classic PAT with all-org repo access | If PAT is leaked (via log, artifact, or env dump), attacker accesses all repos in org | Use fine-grained PAT scoped to specific allowed repos only |
| Allowing agent to self-select any target repo | Agent or malicious prompt could target repos not in the allowed list | Enforce `ALLOWED_REPOS` check in `createJobTool` before calling `createJob()`; reject unknown repos with clear error |
| Cross-repo CLAUDE.md injection without sanitization | Target repo's CLAUDE.md may contain adversarial instructions aimed at the agent | Already mitigated by "read-only reference" framing from v1.1; confirm framing persists for cross-repo target CLAUDE.md |
| `AGENT_GH_TOKEN` logged by entrypoint debug output | Token appears in Actions logs if entrypoint echoes env vars | Never `echo` or `env` in the entrypoint; the current `set -e` + no env dump is correct — preserve this |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No acknowledgment of which repo the agent is targeting | User sends "fix the README in neurostory" and gets "job created" — no confirmation of target | `create_job` tool returns `target_repo` in confirmation message: "Job created for NeuroStory (job/uuid)" |
| Cross-repo job completes silently (notification never fires) | User waits indefinitely; job appears hung | Entrypoint-side notification for cross-repo is mandatory — same UX as same-repo jobs |
| PR in target repo has "clawforge: job {uuid}" title | Target repo contributors see cryptic automated PRs | Use descriptive PR titles derived from the job description's first sentence |
| "Merged" notification but PR is only "open" (agent auto-merged but notify sent too early) | User thinks job succeeded; later discovers PR was rejected/reverted | Send notification only after merge completes; if not auto-merging, send "PR open for review" with URL |
| Job appears to succeed but no changes in target repo (same-repo regression) | User confused — notification says merged but target is unchanged | Same-repo regression tests prevent this; but if it slips through, `changed_files` in notification is the first signal |

---

## "Looks Done But Isn't" Checklist

- [ ] **Cross-repo clone:** Trigger a job targeting NeuroStory. Confirm the container's working directory (`pwd` in entrypoint log) shows it cloned NeuroStory, not clawforge. `git remote -v` output should show NeuroStory's URL.

- [ ] **Same-repo regression:** After entrypoint changes, trigger a normal clawforge job. Confirm it still clones clawforge, CLAUDE.md injection is from clawforge, and PR goes to clawforge.

- [ ] **SOUL.md/AGENT.md loaded from image, not target repo:** Verify the system prompt in `--append-system-prompt` for a cross-repo job contains the expected SOUL.md persona text, not empty string.

- [ ] **PR in right repo:** After a cross-repo job to NeuroStory, confirm the PR URL in the notification points to `github.com/.../neurostory/pull/...`, not `github.com/.../clawforge/pull/...`.

- [ ] **Notification fires for cross-repo:** Send a cross-repo job. Wait for completion. Confirm notification arrives in originating Slack thread within 2 minutes of PR creation/merge.

- [ ] **Token not in logs:** Check the GitHub Actions run log for the cross-repo job. Confirm no URL containing `ghp_`, `x-access-token`, or `github_pat_` appears.

- [ ] **ALLOWED_REPOS enforced:** Ask the agent to "run a job on microsoft/vscode". Confirm the `create_job` tool returns an error and no job branch is created.

- [ ] **Default branch detection:** Target a repo with `master` as default branch. Confirm the PR is created against `master`, not `main`.

- [ ] **Branch cleanup:** After a cross-repo PR is created, confirm the `job/{uuid}` branch in the target repo is deleted (either by merge setting or entrypoint explicit delete).

- [ ] **`getJobStatus` tool still works:** After cross-repo changes, confirm `get_job_status` still queries clawforge's workflow runs correctly — it should be unaffected since jobs still trigger from clawforge.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cross-repo job cloned wrong repo (same-repo bug) | LOW | Close the bad PR; re-trigger job after entrypoint fix; no data loss |
| Token embedded in log (exposed PAT) | HIGH | Immediately revoke the exposed token in GitHub settings; generate new PAT; update AGENT_GH_TOKEN secret; audit any repos the token had access to for unauthorized activity |
| Notification never fired for cross-repo job | LOW | Manually summarize the target repo PR; use `getJobStatus` to confirm job ran; entrypoint-notification fix prevents recurrence |
| System prompt empty for cross-repo job (SOUL.md missing) | MEDIUM | The job ran without persona — output may be inconsistent; re-trigger job after fixing system prompt sourcing; review the empty-persona job's PR carefully before merging |
| Same-repo jobs regressed after entrypoint change | HIGH | Revert entrypoint to last known-good; re-deploy; investigate conditional logic before re-applying cross-repo changes |
| `job/{uuid}` branches accumulate in target repo | LOW | Run `git branch -r | grep job/ | sed 's/origin\///' | xargs git push origin --delete` to clean up; add entrypoint branch-delete logic to prevent recurrence |
| Agent targeted a non-allowed repo | MEDIUM | Close any PR created in unauthorized repo; audit what Claude did in the container; add ALLOWED_REPOS enforcement before re-enabling |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Entrypoint clones clawforge instead of target repo | Phase 1: Cross-repo clone in entrypoint | Trigger cross-repo job; inspect container log for correct git remote |
| GITHUB_TOKEN cannot clone target repo | Phase 1: Cross-repo clone in entrypoint | Confirm PAT scope includes target repo; preflight API call to `gh api repos/{target}` before clone |
| `gh pr create` creates PR in wrong repo | Phase 2: PR creation on target repo | Trigger cross-repo job; confirm PR URL in notification matches target repo |
| `auto-merge.yml` cannot merge cross-repo PRs | Phase 2: PR creation on target repo | Confirm per-repo merge policy config; entrypoint auto-merge for `auto_merge: true` repos |
| `notify-pr-complete.yml` never fires for cross-repo | Phase 3: Cross-repo notification routing | Trigger cross-repo job; confirm Slack notification arrives within 2 min of PR creation |
| Notification routes to wrong thread | Phase 3: Cross-repo notification routing | Trigger from two different threads; confirm each notification routes back to originating thread |
| Same-repo regression from entrypoint changes | Phase 1: Cross-repo clone in entrypoint | Run same-repo test harness before and after entrypoint change; both must pass |
| SOUL.md/AGENT.md absent for cross-repo | Phase 1: Cross-repo clone in entrypoint | Check `--append-system-prompt` content in cross-repo job; must contain persona text |
| Token in clone URL leaks to logs | Phase 1: Cross-repo clone in entrypoint | Audit entrypoint code review; run job and search Actions log for token patterns |
| Branch pollution in target repo | Phase 2: PR creation on target repo | Check target repo branch list after job; `job/` branches should be absent or deleted |
| ALLOWED_REPOS not enforced | Phase 1: Agent tool: allowed repos config | Test with unauthorized repo; confirm rejection before job branch is created |
| `REPO_SLUG` in FULL_PROMPT is clawforge instead of target | Phase 1: Cross-repo clone in entrypoint | Inspect `FULL_PROMPT` in Claude output; `## Target` section must show target repo slug |

---

## Sources

### PRIMARY (HIGH confidence — direct codebase inspection)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/docker/job/entrypoint.sh` — Clone URL construction (line 35), SOUL.md/AGENT.md sourcing (lines 87-93), CLAUDE.md injection (lines 111-119), PR creation (lines 267-274)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/.github/workflows/run-job.yml` — `REPO_URL` hardcoded to `${{ github.repository }}` (line 51)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/.github/workflows/notify-pr-complete.yml` — Workflow fires on `workflow_run` within same repo only; `--repo "${{ github.repository }}"` scope (lines 29, 37, 72-75)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/.github/workflows/auto-merge.yml` — `GITHUB_TOKEN` used for merge; `--repo "${{ github.repository }}"` scope (lines 25, 84, 117)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/tools/create-job.js` — `GH_OWNER`/`GH_REPO` always clawforge (lines 10, 15-35)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/tools.js` — `create_job` tool has no `target_repo` parameter (lines 71-78)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/PROJECT.md` — Known cross-repo bug description (line 87); v1.2 requirements (lines 62-68)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/INTEGRATIONS.md` — `GH_REPO` env var scope (lines 183-184); notification webhook flow (lines 240-246)

### SECONDARY (MEDIUM confidence — official GitHub docs + confirmed community patterns)
- [GitHub Docs: Automatic token authentication](https://docs.github.com/en/actions/security-guides/automatic-token-authentication) — GITHUB_TOKEN is scoped to a single repository; cross-repo operations require PAT or GitHub App token
- [GitHub Community: GITHUB_TOKEN cannot read other private repos in same org](https://github.com/orgs/community/discussions/46566) — Confirmed: GITHUB_TOKEN is repo-scoped by design; PAT required for cross-repo clone
- [GitHub Community: Pull request created in Action does not trigger pull_request workflow](https://github.com/orgs/community/discussions/65321) — GITHUB_TOKEN-created PRs do not re-trigger `pull_request` workflows; PAT required
- [GitHub Community: Allow actions/checkout to checkout different private repo](https://github.com/orgs/community/discussions/59488) — Confirmed pattern: PAT with repo scope required for cross-repo checkout
- [Some Natalie's Corner: Push commits to another repository with GitHub Actions](https://some-natalie.dev/blog/multi-repo-actions/) — Fine-grained PATs per-repo for cross-repo push; token not in URL

### TERTIARY (LOW confidence — security research, single source)
- [Wiz Blog: tj-actions/changed-files supply chain attack CVE-2025-30066](https://www.wiz.io/blog/github-action-tj-actions-changed-files-supply-chain-attack-cve-2025-30066) — Tokens printed to workflow logs are exposed in public repos; informs anti-pattern of token-in-URL
- [Unit42 Palo Alto: ArtiPACKED — hacking giants through race condition in GitHub Actions Artifacts](https://unit42.paloaltonetworks.com/github-repo-artifacts-leak-tokens/) — Token exposure patterns in GitHub Actions; general awareness for log hygiene

---
*Pitfalls research for: ClawForge v1.2 — cross-repo job targeting added to existing single-repo agent pipeline*
*Researched: 2026-02-25*
