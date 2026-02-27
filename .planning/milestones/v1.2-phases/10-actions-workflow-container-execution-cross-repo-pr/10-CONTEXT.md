# Phase 10: Actions Workflow + Container Execution + Cross-Repo PR - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Container reads target.json (written by Phase 9), clones the target repo as its working tree, runs Claude Code in that repo's context, and opens a PR on the target repo — not on clawforge. Notification and DB recording are Phase 11. Regression verification is Phase 12.

</domain>

<decisions>
## Implementation Decisions

### Failure modes
- Clone failure → write `clone-error.md` to job branch and exit immediately (no retry)
- PR creation failure → write `pr-error.md` to job branch and exit with failure
- Stage-specific error files (`clone-error.md`, `pr-error.md`) so Phase 11 notification pipeline knows exactly what broke
- Same notification flow as today: `notify-job-failed.yml` fires when job branch has no PR after container exits; failure stage detail (clone vs pr-creation) will surface via error files read in Phase 11

### PR body content
All four elements required:
1. Original job description (the text the user sent)
2. ClawForge attribution + AI-generated disclaimer banner
3. Link back to originating clawforge job branch (traceability)
4. Summary/checklist of what Claude did (files changed, approach)
- PR created as regular open PR (not draft)
- No labels applied (too fragile — labels may not exist on target repo)
- PR author = AGENT_GH_TOKEN owner (same identity as same-repo PRs)

### Cross-repo PR fate
- Cross-repo PRs are always open for human review — never auto-merged (ClawForge can't auto-merge on a foreign repo)
- User is notified at PR creation time: "PR opened on [target-repo]: [url]"
- Container writes `pr-result.json` sidecar to the clawforge job branch upon PR creation: `{ target_repo, pr_url, pr_number }`
- `notify-pr-complete.yml` (or equivalent) triggers on push to `job/*` and checks for `pr-result.json` to fire the cross-repo completion notification

### GitHub Actions workflow
- `run-job.yml` stays unchanged — entrypoint reads `target.json` and handles same-repo vs cross-repo logic internally
- No new workflow file for cross-repo jobs
- No new GitHub secret — AGENT_GH_TOKEN is used for everything; document that it must have `repo` scope for any target repos (setup documentation, not code change)
- Notification trigger: extend `notify-pr-complete.yml` to trigger on `push` to `job/*` branches and detect `pr-result.json` (cross-repo path) vs PR merge on clawforge (same-repo path)

### Claude's Discretion
- Exact entrypoint bash logic for two-phase clone (clone clawforge to read target.json, then clone target repo as working directory)
- Exact structure of pr-result.json and error file contents
- How Claude Code's working directory is set to the target repo root
- git commit identity for commits pushed to the target repo (GitHub Actions bot or AGENT_GH_TOKEN user)

</decisions>

<specifics>
## Specific Ideas

- Failure files use a consistent naming convention: `{stage}-error.md` (clone-error.md, pr-error.md) so Phase 11 can glob for them
- `pr-result.json` naming mirrors `target.json` pattern from Phase 9 — consistent sidecar convention
- The PR body should make it immediately clear to target repo owners that this is ClawForge-originated, AI-generated work, not a human committing code

</specifics>

<deferred>
## Deferred Ideas

- Watching cross-repo PRs for merge events (would require target repo to send webhooks back to ClawForge) — potential future phase
- Auto-merge on cross-repo PRs (too aggressive for now, flagged for later consideration)
- Dedicated ClawForge bot GitHub account for cleaner PR attribution — out of scope for v1.2

</deferred>

---

*Phase: 10-actions-workflow-container-execution-cross-repo-pr*
*Context gathered: 2026-02-26*
