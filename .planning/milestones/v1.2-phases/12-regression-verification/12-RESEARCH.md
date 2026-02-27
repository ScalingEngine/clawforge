# Phase 12: Regression Verification - Research

**Researched:** 2026-02-26
**Domain:** End-to-end verification runbook — same-repo and cross-repo job execution, both instances
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REG-01 | Same-repo jobs work identically when TARGET_REPO_URL is absent or equals REPO_URL | entrypoint.sh `if [ -z "$TARGET_REPO_SLUG" ]` guard verified — same-repo path is fully isolated from cross-repo changes; WORK_DIR stays /job, no target.json branch taken |
| REG-02 | Both instances (Noah/Archie and StrategyES/Epic) verified end-to-end after all changes | Noah: clawforge (same-repo) + neurostory (cross-repo) allowed; StrategyES: strategyes-lab (same-repo only — no cross-repo in REPOS.json) |
</phase_requirements>

---

## Summary

Phase 12 is a **verification phase**, not an implementation phase. The primary deliverable is a structured runbook of test scenarios that an operator executes manually against live infrastructure. No new code is written; all changes shipped in phases 9–11 are treated as complete and the goal is to confirm they work end-to-end without silent failures.

The two requirements (REG-01, REG-02) map to four concrete scenarios: same-repo job on Noah/Archie, same-repo job on StrategyES/Epic, cross-repo job on Noah/Archie (neurostory as target), and one negative test confirming ALLOWED_REPOS rejection. A fifth scenario — PAT log cleanliness — is a passive check run against GitHub Actions logs during the other scenarios.

The planner should produce a single task: write the verification runbook. That runbook is the pass/fail gate for the entire v1.2 release.

**Primary recommendation:** Produce one plan with one task — write a `VERIFICATION-RUNBOOK.md` that operators can execute step-by-step, with explicit pass/fail criteria for each scenario. Do not write new code.

---

## Standard Stack

This phase uses no new libraries. Verification is performed with existing tooling:

### Core (Verification Tooling)
| Tool | Purpose | Why Standard |
|------|---------|--------------|
| GitHub Actions UI | Observe run-job.yml and notify-pr-complete.yml execution | Source of truth for container behavior |
| gh CLI | Trigger jobs, inspect PRs, check logs | Already used throughout project |
| Slack / Telegram | Send job requests, receive completion notifications | End-to-end channel coverage |
| GitHub Actions log viewer | Confirm no PAT values appear in plain text | Required by success criteria 4 |

### No Installation Required
All tooling is already in place. No `npm install` needed for this phase.

---

## Architecture Patterns

### Verification Scenario Structure

Each scenario follows this pattern:

```
1. Precondition — what must be true before running
2. Trigger — exact action operator takes (message text, channel)
3. Observe — where to look and what to see
4. Pass criteria — explicit, boolean, no ambiguity
5. Fail criteria — what failure looks like
6. Cleanup — branch/PR cleanup after test
```

### Scenario Map

| Scenario | Instance | Job Type | Channel | Confirms |
|----------|----------|----------|---------|---------|
| S1 | Noah/Archie | Same-repo (clawforge) | Slack or Telegram | REG-01, REG-02 |
| S2 | StrategyES/Epic | Same-repo (strategyes-lab) | Slack (Jim-restricted) | REG-02 |
| S3 | Noah/Archie | Cross-repo (neurostory target) | Slack or Telegram | REG-02, cross-repo pipeline |
| S4 | Noah/Archie | Rejected repo (not in ALLOWED_REPOS) | Slack | REG-01 (agent-layer rejection) |
| S5 (passive) | Both | PAT log scan | GitHub Actions UI | Success criteria 4 |

### Instance Configuration Summary

**Noah/Archie**
- REPOS.json: `ScalingEngine/clawforge` (aliases: clawforge, cf, the bot) + `ScalingEngine/neurostory` (aliases: neurostory, ns, the app)
- Channels: Slack + Telegram + Web Chat
- Same-repo = clawforge itself; Cross-repo = neurostory

**StrategyES/Epic**
- REPOS.json: `ScalingEngine/strategyes-lab` only (aliases: strategyes-lab, strategyes, lab)
- Channels: Slack only, Jim-restricted
- Note: no cross-repo target exists for StrategyES — S2 is same-repo only

### Runbook Output Location

```
.planning/phases/12-regression-verification/
└── VERIFICATION-RUNBOOK.md    # The operator-facing checklist
```

### Anti-Patterns to Avoid
- **Treating this as an implementation task:** No code changes. If a scenario fails, open a bug — don't fix inline.
- **Vague pass criteria:** Every scenario must have a boolean observable (PR URL returned, notification received, etc.), not "looks correct."
- **Testing only the happy path:** S4 (rejection) is a required negative test. Silent acceptance of a disallowed repo is a security regression.
- **Skipping StrategyES:** Both instances must be verified per REG-02. StrategyES is restricted to Jim's Slack user — runbook must document the operator performing the Jim-side test.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PAT log scanning | Custom regex scanner | Read raw GitHub Actions log in browser, search for token prefix | Token format is known (ghp_, github_pat_); manual scan is sufficient for one-time verification |
| Automated e2e test harness | Jest/Playwright integration test | Manual runbook | Infrastructure round-trips (GitHub Actions + Docker + external channels) cannot be reliably automated in test time budget; manual is correct here |

**Key insight:** This is infrastructure verification, not unit testing. The correct artifact is a human-executable runbook, not code.

---

## Common Pitfalls

### Pitfall 1: Same-Repo Backward Compat Breakage
**What goes wrong:** Cross-repo additions to entrypoint.sh accidentally alter WORK_DIR, PATH, or git remote behavior for same-repo jobs.
**Why it happens:** The `if [ -n "$TARGET_REPO_SLUG" ]` guard in section 5b protects the cross-repo clone, but the final `cd "$WORK_DIR"` and section 12 `cd /job` must also be correct.
**How to avoid:** In S1, confirm WORK_DIR stays /job (check Actions log line "Working directory: /job") and that the PR is created against clawforge, not a foreign repo.
**Warning signs:** PR created on wrong repo, git push fails, Claude reads /workspace instead of /job.

### Pitfall 2: Silent Notification Failure
**What goes wrong:** Job completes, PR is created, but the event handler never receives the webhook — so the user gets no Slack/Telegram message.
**Why it happens:** `APP_URL` var misconfigured in GitHub Actions, or GH_WEBHOOK_SECRET mismatch.
**How to avoid:** In every scenario, wait at least 3 minutes after PR creation for the notification. Check Actions run for notify-pr-complete.yml — the curl step must show HTTP 200.
**Warning signs:** No notification received; notify-pr-complete.yml `curl` step exits non-zero or shows a non-200 response.

### Pitfall 3: Cross-Repo PAT Scope Gap
**What goes wrong:** Clone of neurostory succeeds but `gh pr create --repo` fails because AGENT_GH_TOKEN lacks pull_requests:write on the target repo.
**Why it happens:** PAT scoped to clawforge but not neurostory.
**How to avoid:** Before S3, confirm AGENT_GH_TOKEN has `contents:write` and `pull_requests:write` on `ScalingEngine/neurostory`. This was flagged as a blocker in STATE.md.
**Warning signs:** `pr-error.md` artifact in clawforge job branch; entrypoint exits non-zero at `gh pr create`.

### Pitfall 4: notify-pr-complete.yml Double-Fire on Same-Repo
**What goes wrong:** On same-repo jobs, the push trigger fires in addition to the workflow_run trigger, causing two notifications.
**Why it happens:** notify-pr-complete.yml triggers on both `push` to `job/**` AND `workflow_run`. The push path checks for `pr-result.json` (only written on cross-repo jobs) and routes to `path=skip` — but if logic regresses, both paths could fire.
**How to avoid:** In S1, confirm exactly one Slack/Telegram notification is received. Check notify-pr-complete.yml run — route step should output `path=same_repo` (workflow_run trigger) and `path=skip` (push trigger, silent).
**Warning signs:** Two notifications received for one job; duplicate Slack messages.

### Pitfall 5: StrategyES Jim-Restriction
**What goes wrong:** Operator sends test message from Noah's Slack account to StrategyES channel — message is dropped by the user ID restriction.
**Why it happens:** StrategyES is scoped to Jim's Slack user ID.
**How to avoid:** Runbook must specify that S2 is performed by Jim (or operator logs in as Jim). Document this prerequisite explicitly.
**Warning signs:** No response from StrategyES agent; no GitHub Actions run triggered.

### Pitfall 6: PAT Exposure via SECRETS JSON Logging
**What goes wrong:** GitHub Actions logs the raw `ALL_SECRETS` JSON before the AGENT_ filtering step, exposing PAT values.
**Why it happens:** Any `echo "$ALL_SECRETS"` or `set -x` before the jq filter would print the raw secrets.
**How to avoid:** In S5 (passive scan), search Actions log for `ghp_` or `github_pat_`. The SECRETS/LLM_SECRETS env vars passed to docker are constructed via `jq -c` inside a shell var assignment — GitHub Actions masks registered secrets but only if the secret value is registered in the Actions secrets store (not dynamically derived).
**Warning signs:** Any token-like string (ghp_, github_pat_) visible in plain text in the Actions log.

---

## Code Examples

These are reference patterns for what the runbook should instruct operators to observe:

### Confirming WORK_DIR in Same-Repo Job (Actions Log)
```
# In GitHub Actions run-job.yml log, look for:
Working directory: /job        ← PASS
Working directory: /workspace  ← FAIL (cross-repo path taken incorrectly)
```

### Confirming Cross-Repo Branch Naming (Target Repo)
```bash
# After S3, on ScalingEngine/neurostory, verify:
gh pr list --repo ScalingEngine/neurostory --head "clawforge/{UUID}" --json url,title
# Expect: one open PR with title starting "clawforge: ..."
```

### Confirming Agent-Layer Rejection (S4)
```
# Send to Noah/Archie: "Create a job targeting repo: unknown-repo"
# Expected agent response: error message listing available repos
# Expected: NO GitHub Actions run triggered (no job/* branch created)
```

### Confirming target_repo Stored in DB (NOTIF-02)
```bash
# After S3, call getJobStatus with the job ID:
# Expected: target_repo field populated in response JSON
# This can be tested via /api/jobs/status?jobId=<UUID> with API key
```

### PAT Log Scan (S5)
```
# In GitHub Actions log for run-job.yml:
# 1. Search for "ghp_" — should find zero occurrences
# 2. Search for "github_pat_" — should find zero occurrences
# 3. Confirm REPO_URL line shows: https://github.com/... (no token in URL)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-phase clone (clawforge only) | Two-phase clone: clawforge /job + target /workspace | Phase 10 | Cross-repo jobs now have correct working tree |
| PAT in clone URL | gh auth setup-git + GH_TOKEN env var only | Phase 9 | PAT never appears in Actions logs |
| Hard-coded `--base main` | `gh repo view` detects default branch | Phase 10 | Works for repos with non-main default branches |
| No target_repo column | nullable `target_repo` in job_outcomes | Phase 11 | getJobStatus() returns cross-repo PR URL |
| notify-pr-complete.yml: workflow_run only | Dual-trigger: workflow_run + push to job/** | Phase 11 | Cross-repo PR notification possible (no merge event on foreign repos) |

---

## Open Questions

1. **StrategyES REPOS.json operator confirmation**
   - What we know: REPOS.json contains only `strategyes-lab` (no cross-repo target)
   - What's unclear: Whether this was intentionally finalized or still needs operator sign-off (flagged as blocker in STATE.md Phase 9)
   - Recommendation: Runbook should include a precondition: "Confirm with operator that StrategyES REPOS.json content is final"

2. **PAT scope on neurostory**
   - What we know: STATE.md flagged "Fine-grained PAT scope update is an operator action — must be documented" as a Phase 9 blocker
   - What's unclear: Whether AGENT_GH_TOKEN on Noah/Archie has been updated to include neurostory
   - Recommendation: Runbook must include a preflight step: verify AGENT_GH_TOKEN has contents:write + pull_requests:write on ScalingEngine/neurostory before running S3

3. **Cross-repo merge semantics UX language**
   - What we know: STATE.md flags this as needing validation ("PR open for review" vs "merged")
   - What's unclear: Whether the notification text currently says "PR open for review" for cross-repo (status=cross_repo_pr_open) vs "merged" for same-repo
   - Recommendation: Runbook S3 pass criteria should explicitly check the notification message wording

---

## Validation Architecture

Nyquist validation is not configured (no `workflow.nyquist_validation` key in `.planning/config.json`). This section is omitted.

However, because Phase 12 IS verification, the "test framework" is the VERIFICATION-RUNBOOK.md itself. The planner should treat runbook completion (all scenarios checked PASS) as the phase gate.

---

## Sources

### Primary (HIGH confidence)
- `templates/docker/job/entrypoint.sh` — verified same-repo guard at line 424 (`if [ -z "$TARGET_REPO_SLUG" ]`), WORK_DIR logic at lines 46-94, PAT-free clone at line 39
- `templates/.github/workflows/notify-pr-complete.yml` — verified dual-trigger (push + workflow_run), route step logic, cross-repo vs same-repo paths
- `templates/.github/workflows/run-job.yml` — verified SECRETS filtering (AGENT_ prefix stripping), no PAT in docker run env
- `instances/noah/config/REPOS.json` — verified allowed repos: clawforge + neurostory
- `instances/strategyES/config/REPOS.json` — verified allowed repo: strategyes-lab only
- `lib/tools/repos.js` — verified resolveTargetRepo() returns null for unknown repos, caller receives null
- `.planning/REQUIREMENTS.md` — REG-01, REG-02 requirements read directly
- `.planning/STATE.md` — confirmed blockers, accumulated decisions

### Secondary (MEDIUM confidence)
- CLAUDE.md (project) — instance architecture, channel restrictions, isolation model

---

## Metadata

**Confidence breakdown:**
- Scenario map: HIGH — derived directly from REPOS.json content and entrypoint.sh code paths
- Pitfalls: HIGH — derived from actual code inspection, not speculation
- Open questions: HIGH — directly cited from STATE.md blockers

**Research date:** 2026-02-26
**Valid until:** Until next code change to entrypoint.sh, notify-pr-complete.yml, or REPOS.json (stable for 30 days otherwise)
