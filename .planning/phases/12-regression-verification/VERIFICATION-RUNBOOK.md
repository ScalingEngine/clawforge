# Regression Verification Runbook — v1.2 Cross-Repo Job Targeting

**Date:** [operator fills in]
**Operator:** [operator fills in]
**Status:** [ ] In Progress [ ] PASS [ ] FAIL

---

## Prerequisites

Before running any scenario:

1. Confirm AGENT_GH_TOKEN on Noah/Archie has `contents:write` + `pull_requests:write` on `ScalingEngine/neurostory`
   - Verify: `gh api /repos/ScalingEngine/neurostory/collaborators --header "Authorization: token <AGENT_GH_TOKEN>" 2>&1` — should return 200 or list your token's access
   - Faster: attempt `gh auth token` inside the Noah/Archie container and test with `gh pr list --repo ScalingEngine/neurostory`
2. Confirm StrategyES REPOS.json content is final with operator — currently contains `strategyes-lab` only (no cross-repo target). Operator must sign off before running S2.
3. Both instances must be running: `docker ps` — confirm Noah/Archie event handler container AND StrategyES/Epic event handler container are `Up`
4. GitHub Actions must be enabled on `ScalingEngine/clawforge` and `ScalingEngine/strategyes-lab` — check Settings > Actions in both repos
5. Slack app tokens for both instances are valid (test: send a `/ping` or health-check message and observe response)

---

## Scenario Summary

| Scenario | Instance | Type | Requirements | Status |
|----------|----------|------|--------------|--------|
| S1 | Noah/Archie | Same-repo (clawforge) | REG-01, REG-02 | [ ] |
| S2 | StrategyES/Epic | Same-repo (strategyes-lab) | REG-02 | [ ] |
| S3 | Noah/Archie | Cross-repo (neurostory) | REG-02 | [ ] |
| S4 | Noah/Archie | Rejection (unknown-repo) | REG-01 | [ ] |
| S5 | Both | PAT log scan (passive) | Success Criteria 4 | [ ] |

## Pass Gate

**v1.2 ships when ALL five scenarios are marked PASS.**

S5 is passive — it is performed during S1 and S3 log review, not as a separate trigger.

---

## S1: Noah/Archie Same-Repo Job

**Instance:** Noah/Archie
**Job Type:** same-repo (target = clawforge itself)
**Requirements Confirmed:** REG-01, REG-02

### Preconditions

- Noah/Archie event handler container is running (`docker ps`)
- GitHub Actions enabled on `ScalingEngine/clawforge`
- Slack or Telegram channel available for Noah/Archie (Noah's user ID authorized)
- No in-flight jobs on clawforge that could interfere

### Trigger

Send the following message to Noah/Archie via Slack (as Noah) or Telegram:

```
Create a job: add a comment to lib/paths.js saying "verified by regression test"
```

Note the job UUID from the agent's acknowledgement response.

### Observe

1. **GitHub Actions** — go to `https://github.com/ScalingEngine/clawforge/actions` and watch for a `run-job.yml` run triggered on branch `job/{UUID}`
2. **Actions log** — open the run, expand the job steps, and search for the string `Working directory:`
3. **Pull Request** — after the Actions run completes, go to `https://github.com/ScalingEngine/clawforge/pulls` and look for the PR created by the job
4. **Slack/Telegram notification** — watch for a completion message in the channel where you sent the job
5. **notify-pr-complete.yml** — go to Actions and find the `notify-pr-complete.yml` run(s) triggered after the PR is created/merged; check the `route` step output

### Pass Criteria (ALL must be true)

- [ ] Exactly one `run-job.yml` GitHub Actions run is triggered on `ScalingEngine/clawforge` (no duplicate runs)
- [ ] Actions log for `run-job.yml` contains the line `Working directory: /job` (NOT `/workspace`)
- [ ] A PR is created on `ScalingEngine/clawforge` (NOT on any other repo)
- [ ] Exactly one Slack or Telegram notification is received with a URL matching `github.com/ScalingEngine/clawforge/pull/...`
- [ ] The notification message says "merged" or "completed" — same-repo completion language (NOT "PR open for review")
- [ ] `notify-pr-complete.yml` triggered by `workflow_run` shows route step output `path=same_repo`
- [ ] `notify-pr-complete.yml` triggered by `push` to `job/**` shows route step output `path=skip` (confirming no double-fire)

### Fail Indicators

- Two notifications received for one job (double-fire — notify-pr-complete.yml push path not routing to skip)
- PR created on a repo other than `ScalingEngine/clawforge`
- Actions log shows `Working directory: /workspace` (cross-repo path taken incorrectly)
- No notification received within 5 minutes of PR creation (check notify-pr-complete.yml curl step for non-200 response or APP_URL misconfiguration)
- `notify-pr-complete.yml` shows `path=cross_repo` for this same-repo job

### Cleanup

1. The PR should have been auto-merged; if not, merge or close it
2. Delete the `job/{UUID}` branch on `ScalingEngine/clawforge`: `gh api -X DELETE /repos/ScalingEngine/clawforge/git/refs/heads/job/{UUID}`

---

## S2: StrategyES/Epic Same-Repo Job

**Instance:** StrategyES/Epic
**Job Type:** same-repo (target = strategyes-lab)
**Requirements Confirmed:** REG-02

### Preconditions

- StrategyES/Epic event handler container is running (`docker ps`)
- GitHub Actions enabled on `ScalingEngine/strategyes-lab`
- **Jim's Slack account** must be used for this test — StrategyES is restricted to Jim's user ID only; messages from Noah's account will be silently dropped
- Operator has confirmed StrategyES REPOS.json is final (prerequisite 2 above)
- Jim is available to send the test message, OR operator is logged in to Slack as Jim

### Trigger

Have **Jim** send the following message to the StrategyES Slack channel:

```
Create a job: add a comment to any file in strategyes-lab saying "verified by regression test"
```

Note the job UUID from the agent's acknowledgement response.

### Observe

1. **GitHub Actions** — go to `https://github.com/ScalingEngine/strategyes-lab/actions` and watch for a `run-job.yml` run triggered on branch `job/{UUID}`
2. **Pull Request** — after the Actions run, go to `https://github.com/ScalingEngine/strategyes-lab/pulls`
3. **Slack notification** — watch for completion message in the StrategyES Slack channel
4. **User restriction test** — after S2 completes, send a message to the StrategyES channel from Noah's Slack account and confirm NO response is received

### Pass Criteria (ALL must be true)

- [ ] GitHub Actions `run-job.yml` run is triggered on `ScalingEngine/strategyes-lab` (NOT on `clawforge`)
- [ ] PR is created on `ScalingEngine/strategyes-lab` (NOT on any other repo)
- [ ] Exactly one Slack notification is received in the StrategyES channel with a URL matching `github.com/ScalingEngine/strategyes-lab/pull/...`
- [ ] A message sent from Noah's Slack account (non-Jim) to the StrategyES channel receives **no response** (user ID restriction is active)

### Fail Indicators

- GitHub Actions triggered on `clawforge` instead of `strategyes-lab` (instance isolation broken)
- No response from StrategyES agent when Jim sends the message (user ID restriction misconfigured — Jim's ID not set correctly)
- Noah's message receives a response (user restriction not enforced)
- PR created on a repo other than `strategyes-lab`

### Cleanup

1. Merge or close the PR on `ScalingEngine/strategyes-lab`
2. Delete the `job/{UUID}` branch on `ScalingEngine/strategyes-lab`: `gh api -X DELETE /repos/ScalingEngine/strategyes-lab/git/refs/heads/job/{UUID}`

---

## S3: Noah/Archie Cross-Repo Job to Neurostory

**Instance:** Noah/Archie
**Job Type:** cross-repo (target = neurostory)
**Requirements Confirmed:** REG-02

### Preconditions

- AGENT_GH_TOKEN on Noah/Archie has `contents:write` + `pull_requests:write` on `ScalingEngine/neurostory` (confirmed in Prerequisites above — **do not skip this**)
- Get neurostory's default branch: `gh repo view ScalingEngine/neurostory --json defaultBranchRef --jq '.defaultBranchRef.name'` — note it for the pass criteria check
- Noah/Archie event handler container is running
- `clawforge/{UUID}` branch does not already exist on `ScalingEngine/neurostory` (clean state)

### Trigger

Send the following message to Noah/Archie via Slack (as Noah) or Telegram:

```
Create a job targeting neurostory: add a comment to any file saying "verified by cross-repo regression test"
```

Note the job UUID from the agent's acknowledgement response.

### Observe

1. **clawforge job branch** — go to `https://github.com/ScalingEngine/clawforge/branches` and confirm `job/{UUID}` branch was created with both `job.md` and `target.json` in `logs/{UUID}/`
2. **GitHub Actions** — go to `https://github.com/ScalingEngine/clawforge/actions` and watch for a `run-job.yml` run triggered on the `job/{UUID}` branch
3. **Actions log** — open the run, search for `Working directory:` (must be `/workspace`) and `target.json` detection
4. **neurostory PR** — after the run, check: `gh pr list --repo ScalingEngine/neurostory --head "clawforge/{UUID}" --json url,title`
5. **Slack/Telegram notification** — watch for a completion message with a neurostory PR URL
6. **notify-pr-complete.yml** — find the run triggered by the push to `job/{UUID}` on clawforge; check the `route` step output
7. **Job status API** — call `GET /api/jobs/status?jobId={UUID}` with your API key and confirm `target_repo` is populated in the response

### Pass Criteria (ALL must be true)

- [ ] `target.json` exists in `logs/{UUID}/` on the `job/{UUID}` branch of `ScalingEngine/clawforge` (alongside `job.md`)
- [ ] Actions log for `run-job.yml` contains the line `Working directory: /workspace` (NOT `/workspace` is cross-repo; `/job` would be wrong)

  > Correction: `Working directory: /workspace` = PASS for cross-repo. `Working directory: /job` = FAIL (same-repo path taken incorrectly).

- [ ] PR is created on `ScalingEngine/neurostory` with a head branch named `clawforge/{UUID}`
- [ ] PR base branch on neurostory matches the default branch returned by `gh repo view ScalingEngine/neurostory --json defaultBranchRef` (not hardcoded `main`)
- [ ] PR body contains ClawForge attribution text and the job ID `{UUID}`
- [ ] Exactly one Slack or Telegram notification is received with a URL matching `github.com/ScalingEngine/neurostory/pull/...`
- [ ] Notification message says **"PR open for review"** (NOT "merged" — cross-repo semantic, PR is open, not auto-merged)
- [ ] `GET /api/jobs/status?jobId={UUID}` (with API key) returns JSON with `target_repo` field populated (e.g., `"target_repo": "ScalingEngine/neurostory"`)
- [ ] `notify-pr-complete.yml` run triggered by `push` to `job/{UUID}` shows route step output `path=cross_repo`

### Fail Indicators

- PR created on `ScalingEngine/clawforge` instead of neurostory (target.json not read by entrypoint)
- Actions log shows `Working directory: /job` (same-repo path taken — target.json not detected)
- `pr-error.md` appears in the clawforge job branch (gh pr create failed — likely PAT scope gap on neurostory)
- No notification received (cross-repo push trigger not firing notify-pr-complete.yml, or pr-result.json not written to LOG_DIR before final commit)
- Notification says "merged" instead of "PR open for review" (wrong status used for cross-repo)
- `target_repo` is null or absent in job status API response (Phase 11 DB layer not recording cross-repo target)
- `notify-pr-complete.yml` shows `path=same_repo` or `path=skip` instead of `path=cross_repo`

### Cleanup

1. Close the PR on `ScalingEngine/neurostory` (do NOT merge — this was a test)
2. Delete the `clawforge/{UUID}` branch on `ScalingEngine/neurostory`: `gh api -X DELETE /repos/ScalingEngine/neurostory/git/refs/heads/clawforge/{UUID}`
3. Delete the `job/{UUID}` branch on `ScalingEngine/clawforge`: `gh api -X DELETE /repos/ScalingEngine/clawforge/git/refs/heads/job/{UUID}`

---

## S4: Rejected Repo (Agent-Layer Enforcement)

**Instance:** Noah/Archie
**Job Type:** negative test — repo not in ALLOWED_REPOS
**Requirements Confirmed:** REG-01

### Preconditions

- Noah/Archie event handler container is running
- No recent in-flight jobs that could produce a false positive notification
- You are logged in to GitHub with `gh auth status` to verify no `job/*` branch is created

### Trigger

Send the following message to Noah/Archie via Slack (as Noah) or Telegram:

```
Create a job targeting repo: unknown-repo — add a hello world file
```

### Observe

1. **Agent response** — watch for a reply in the channel within 30 seconds
2. **GitHub Actions** — go to `https://github.com/ScalingEngine/clawforge/actions` — confirm **no** new `run-job.yml` run is triggered
3. **Branches** — check that no `job/*` branch is created: `gh api /repos/ScalingEngine/clawforge/branches --jq '.[].name' | grep job`

### Pass Criteria (ALL must be true)

- [ ] Agent responds in the channel with an error message that lists the available repo names (`clawforge`, `neurostory`)
- [ ] **No** `run-job.yml` GitHub Actions run is triggered on `ScalingEngine/clawforge`
- [ ] **No** `job/*` branch is created on `ScalingEngine/clawforge`
- [ ] **No** `target.json` file is written anywhere

### Fail Indicators

- Any GitHub Actions run is triggered (agent called `createJob` despite invalid target)
- `job/*` branch appears on clawforge (job branch was created before validation fired)
- Agent silently accepts the unknown repo and runs the job against clawforge or another default
- Agent returns a generic error with no repo names listed (helpful rejection message missing)

### Cleanup

No cleanup required if the test passes — no branches or PRs are created.

If a job branch was created (test failed), delete it: `gh api -X DELETE /repos/ScalingEngine/clawforge/git/refs/heads/job/{UUID}`

---

## S5: PAT Log Scan (Passive)

**Instance:** Both (Noah/Archie during S1 and S3; StrategyES during S2)
**Job Type:** passive — no separate trigger needed
**Requirements Confirmed:** Success Criteria 4 (no PAT exposure in logs)

### Preconditions

- S1 and S3 Actions runs have completed (S5 is performed as part of log review for those scenarios)

### Trigger

No separate trigger. Perform this scan while reviewing Actions logs for S1 and S3.

### Observe

For each `run-job.yml` Actions log (S1, S3, and S2 if accessible):

1. Open the raw log: click the gear icon in the run view → **"View raw logs"** or append `/logs` to the run URL
2. Use browser Ctrl+F / Cmd+F to search for the following strings:
   - `ghp_`
   - `github_pat_`
   - `x-access-token:`
3. Also check the `REPO_URL` line in the log: should read `https://github.com/...` with no embedded token
4. Find the step where `SECRETS` and `LLM_SECRETS` env vars are passed to the `docker run` command — confirm the logged value is a filtered JSON blob, not raw token values

### Pass Criteria (ALL must be true)

- [ ] Search for `ghp_` in the full Actions log — **zero occurrences**
- [ ] Search for `github_pat_` in the full Actions log — **zero occurrences**
- [ ] `REPO_URL` line in the log shows `https://github.com/ScalingEngine/...` with no token embedded (gh auth setup-git credential path used)
- [ ] `SECRETS` / `LLM_SECRETS` env vars passed to docker show filtered JSON (only `AGENT_LLM_`-prefixed keys present), with no raw token values visible in the log output

### Fail Indicators

- Any occurrence of `ghp_` or `github_pat_` in the Actions log (PAT exposed — check for `set -x` in entrypoint.sh or unintended echo of secret vars)
- `REPO_URL` contains `ghp_...@github.com` or similar token-in-URL pattern (gh auth setup-git not being used correctly)
- Raw `AGENT_GH_TOKEN` value visible in the docker run command logged by Actions

### Cleanup

No cleanup. This is a read-only log scan.

---

## Results

| Scenario | Date | Operator | Pass/Fail | Notes |
|----------|------|----------|-----------|-------|
| S1 | | | | |
| S2 | | | | |
| S3 | | | | |
| S4 | | | | |
| S5 | | | | |

## Issues Found

[List any failures below with enough detail to open a bug. Include: scenario, step where failure observed, expected behavior, actual behavior, relevant log excerpt or screenshot reference.]
