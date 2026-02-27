---
phase: 10-actions-workflow-container-execution-cross-repo-pr
plan: "02"
subsystem: infra
tags: [docker, bash, entrypoint, cross-repo, gh-cli, pr-creation, default-branch-detection]

# Dependency graph
requires:
  - phase: 10-01
    provides: Two-phase clone with WORK_DIR routing, TARGET_REPO_SLUG export, clawforge/{uuid} branch created in /workspace

provides:
  - Cross-repo PR creation via gh pr create --repo with auto-detected default branch
  - pr-result.json sidecar in LOG_DIR (triggers notify-pr-complete.yml cross-repo path)
  - pr-error.md failure artifact committed to clawforge job branch on PR creation failure
  - Same-repo PR creation path guarded by [ -z "$TARGET_REPO_SLUG" ] (v1.1 behavior preserved)
  - Multi-line PR body via --body-file /tmp/pr-body.md with attribution banner, job description, originating job link, changes summary

affects:
  - phase 10-03 (notify-pr-complete.yml reads pr-result.json from clawforge job branch push)
  - phase 11 (notifications — pr-result.json structure)
  - phase 12 (regression testing — same-repo vs cross-repo PR paths)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-repo PR creation: gh pr create --repo TARGET_REPO_SLUG --head clawforge/{uuid} --base DEFAULT_BRANCH"
    - "Default branch detection: gh repo view --json defaultBranchRef -q '.defaultBranchRef.name' with || echo 'main' fallback"
    - "PR body via file (/tmp/pr-body.md) to avoid heredoc/shell quoting hazards with multi-line strings"
    - "pr-result.json written to LOG_DIR BEFORE final git add so it is included in the clawforge job commit"
    - "pr-error.md failure artifact committed and pushed before exit 1 for observability"
    - "Same-repo PR path wrapped in if [ -z TARGET_REPO_SLUG ] guard — identical to v1.1 when no cross-repo"

key-files:
  created: []
  modified:
    - templates/docker/job/entrypoint.sh

key-decisions:
  - "Use --body-file /tmp/pr-body.md not --body for multi-line PR body — avoids shell quoting hazards in heredoc-in-subshell contexts"
  - "Write pr-result.json BEFORE final git add so it is captured in the clawforge job branch commit — notify-pr-complete.yml reads it from that commit"
  - "pr-error.md includes PR output text so operator can diagnose failure from the artifact alone without container logs"
  - "gh pr create uses PR_OUTPUT=$(... 2>&1) capture so failure output is available for pr-error.md"
  - "DEFAULT_BRANCH uses double fallback: || echo 'main' on gh command failure, :- expansion for empty string — both cases handled"
  - "Same-repo path unchanged from v1.1 — no behavioral change for existing deployments"

patterns-established:
  - "PR sidecar pattern: pr-result.json written to LOG_DIR before final commit so both job artifacts and PR metadata are in one commit"
  - "Failure artifact pattern: pr-error.md mirrors clone-error.md structure (stage/target/exit-code/output/timestamp)"

requirements-completed:
  - PR-02
  - PR-03
  - PR-04
  - PR-05

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 10 Plan 02: Cross-Repo PR Creation with pr-result.json Sidecar Summary

**Cross-repo PR delivery: clawforge/{uuid} branch pushed to target repo, default branch auto-detected via gh repo view, PR created via gh pr create --repo, pr-result.json sidecar written before final commit**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T02:11:56Z
- **Completed:** 2026-02-27T02:14:02Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `git -C /workspace checkout -b "clawforge/${JOB_ID}"` in section 5b so all Claude's commits land on the correct target branch before Claude runs
- Added section 12b cross-repo PR creation block: push branch to target repo, detect default branch via gh repo view, create PR with attribution body via --body-file, write pr-result.json sidecar before final git add
- pr-error.md failure artifact written and committed to clawforge job branch on PR creation failure; container exits 1
- Same-repo gh pr create guarded with `if [ -z "$TARGET_REPO_SLUG" ]` — v1.1 behavior preserved for all existing deployments

## Task Commits

Each task was committed atomically:

1. **Task 1: Create clawforge/{uuid} branch in target repo before Claude runs** - `fabcc84` (feat)
2. **Task 2: Cross-repo PR creation, default branch detection, pr-result.json and pr-error.md sidecars** - `3054678` (feat)

## Files Created/Modified

- `templates/docker/job/entrypoint.sh` - Section 5b: branch creation in /workspace; Section 12b: cross-repo push, default branch detection, gh pr create --repo, pr-result.json sidecar, pr-error.md failure artifact; same-repo path guarded by [ -z TARGET_REPO_SLUG ]

## Decisions Made

- Used `--body-file /tmp/pr-body.md` not `--body` for multi-line PR body to avoid shell quoting hazards with heredoc-in-subshell contexts
- pr-result.json written BEFORE final `git add -A` so it is captured in the clawforge job branch commit — notify-pr-complete.yml's push trigger reads it from that commit
- pr-error.md includes full PR_OUTPUT text (stderr+stdout) so operators can diagnose failure from the artifact alone without container logs
- Double fallback for DEFAULT_BRANCH: `|| echo "main"` on gh CLI failure plus `${DEFAULT_BRANCH:-main}` for empty string — both edge cases handled
- Same-repo PR path unchanged from v1.1 — no behavioral change for existing deployments without target.json

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pr-error.md grep count below expected minimum**

- **Found during:** Task 2 overall verification
- **Issue:** Plan verification expected `grep -c "pr-error.md"` to return ≥3; initial implementation had only 2 references (comment + heredoc target path). Line 383 used `pr-error` without `.md` suffix in the commit message.
- **Fix:** Added `echo "pr-error.md committed to clawforge job branch"` before the git commit line and updated commit message from `pr-error` to `pr-error.md` — brings count to 4
- **Files modified:** templates/docker/job/entrypoint.sh
- **Verification:** `grep -c "pr-error.md"` returns 4 (≥3)
- **Committed in:** 3054678 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — observability count)
**Impact on plan:** Minor observability improvement, matching same pattern applied in Plan 10-01 for clone-error.md. No behavioral change.

## Issues Encountered

None — plan logic was clear and implementation sequence was well-specified.

## User Setup Required

None - no external service configuration required. Changes take effect on next Docker image build.

## Next Phase Readiness

- pr-result.json artifact structure (target_repo, pr_url, pr_number, branch, job_id) is stable — Plan 10-03's notify-pr-complete.yml push trigger reads it directly
- pr-error.md structure matches clone-error.md pattern (stage/target/exit-code/output/timestamp) — Phase 11 failure detection can parse both consistently
- Same-repo path (no target.json) unchanged from v1.1 — Phase 12 regression tests can compare against baseline

---
*Phase: 10-actions-workflow-container-execution-cross-repo-pr*
*Completed: 2026-02-27*
