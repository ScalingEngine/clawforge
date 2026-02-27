# Roadmap: ClawForge

## Milestones

- ✅ **v1.0 GSD Verification & Hardening** — Phases 1-4 (shipped 2026-02-24)
- ✅ **v1.1 Agent Intelligence & Pipeline Hardening** — Phases 5-8 (shipped 2026-02-25)
- 🚧 **v1.2 Cross-Repo Job Targeting** — Phases 9-12 (in progress)

## Phases

<details>
<summary>✅ v1.0 GSD Verification & Hardening (Phases 1-4) — SHIPPED 2026-02-24</summary>

- [x] Phase 1: Foundation Fix (2/2 plans) — completed 2026-02-24
- [x] Phase 2: Output Observability (2/2 plans) — completed 2026-02-24
- [x] Phase 3: Test Harness (1/1 plan) — completed 2026-02-24
- [x] Phase 4: Instruction Hardening (1/1 plan) — completed 2026-02-24

</details>

<details>
<summary>✅ v1.1 Agent Intelligence & Pipeline Hardening (Phases 5-8) — SHIPPED 2026-02-25</summary>

- [x] Phase 5: Pipeline Hardening (2/2 plans) — completed 2026-02-25
- [x] Phase 6: Smart Job Prompts (1/1 plan) — completed 2026-02-25
- [x] Phase 7: Previous Job Context (2/2 plans) — completed 2026-02-25
- [x] Phase 8: Polish & Test Sync (2/2 plans) — completed 2026-02-25

</details>

### 🚧 v1.2 Cross-Repo Job Targeting (In Progress)

**Milestone Goal:** Enable job containers to clone and operate on any allowed target repo, not just clawforge. Agent selects target repo from natural language, container performs two-phase clone, PR created on target repo, notifications include correct target PR URL.

- [x] **Phase 9: Config Layer + Tool Schema + Entrypoint Foundation** - Thread target_repo from agent input through job creation and establish entrypoint correctness blockers (completed 2026-02-26)
- [x] **Phase 10: Actions Workflow + Container Execution + Cross-Repo PR** - Container clones and operates in target repo, PR created on correct repo (completed 2026-02-27)
- [x] **Phase 11: Notification Pipeline + DB Schema** - Cross-repo job completions notify users with correct PR URLs, outcomes recorded (completed 2026-02-27)
- [ ] **Phase 12: Regression Verification** - Both instances verified end-to-end, same-repo behavior confirmed unchanged

## Phase Details

### Phase 9: Config Layer + Tool Schema + Entrypoint Foundation
**Goal**: target_repo travels through the full system — from agent tool call through job creation — and the entrypoint operates correctly for all jobs regardless of target
**Depends on**: Phase 8 (v1.1 complete)
**Requirements**: CFG-01, CFG-02, TOOL-01, TOOL-02, TOOL-03, EXEC-02, EXEC-04
**Success Criteria** (what must be TRUE):
  1. Agent accepts "work on [repo name]" and resolves it to a valid allowed repo slug (or rejects if not allowed)
  2. A job created with a target repo writes target.json alongside job.md on the clawforge job branch
  3. Jobs created without a target repo produce no target.json and behave identically to v1.1
  4. SOUL.md and AGENT.md are loaded from the Docker image for all jobs — cross-repo jobs have a system prompt
  5. No PAT appears in any clone URL in entrypoint output (gh auth setup-git handles all auth)
**Plans**: 3 plans

Plans:
- [ ] 09-01-PLAN.md — REPOS.json config, repos.js resolver, Dockerfile COPY, PAT docs
- [ ] 09-02-PLAN.md — Job image /defaults/ SOUL/AGENT bake, entrypoint fallback, EXEC-04 audit
- [ ] 09-03-PLAN.md — create_job target_repo schema + validation, target.json sidecar write

### Phase 10: Actions Workflow + Container Execution + Cross-Repo PR
**Goal**: Container reads target.json, clones the target repo as its working tree, and creates a PR on the target repo with correct branch naming and default branch detection
**Depends on**: Phase 9
**Requirements**: PR-01, EXEC-01, EXEC-03, PR-02, PR-03, PR-04, PR-05
**Success Criteria** (what must be TRUE):
  1. Sending a job targeting NeuroStory causes Claude to operate on NeuroStory's codebase, not clawforge's
  2. A PR appears in the target repo (not clawforge) with branch name clawforge/{uuid}
  3. PR base branch matches the target repo's actual default branch (not hardcoded to main)
  4. If target repo clone fails, container writes clone-error.md and failure stage surfaces as "clone" in notification
  5. PR body identifies ClawForge as the originating system and includes the job ID
**Plans**: 3 plans

Plans:
- [ ] 10-01-PLAN.md — Two-phase clone with WORK_DIR routing, clone-error.md failure guard, cross-repo FULL_PROMPT context
- [ ] 10-02-PLAN.md — Cross-repo branch creation, default branch detection, gh pr create --repo, pr-result.json + pr-error.md sidecars
- [ ] 10-03-PLAN.md — notify-pr-complete.yml push trigger extension for cross-repo PR completion notification

### Phase 11: Notification Pipeline + DB Schema
**Goal**: Cross-repo job completions reach the user via Slack/Telegram with the correct target repo PR URL, and outcomes are recorded with target repo attribution
**Depends on**: Phase 10
**Requirements**: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04
**Success Criteria** (what must be TRUE):
  1. After a cross-repo job completes, user receives a Slack/Telegram notification referencing the target repo PR URL
  2. Notification message distinguishes "PR open for review" (cross-repo) from "merged" (same-repo)
  3. job_outcomes table records which repo was targeted, visible via get_job_status
  4. Same-repo job notifications are unaffected — still fire at merge with correct clawforge PR URL
**Plans**: 3 plans

Plans:
- [ ] 11-01-PLAN.md — DB schema target_repo column + Drizzle migration + saveJobOutcome() update
- [ ] 11-02-PLAN.md — Webhook handler target_repo passthrough + Telegram thread-origin routing
- [ ] 11-03-PLAN.md — getJobStatus() DB overlay for completed jobs + tool description update

### Phase 12: Regression Verification
**Goal**: Both instances confirmed working end-to-end for both same-repo and cross-repo jobs, with no silent failures
**Depends on**: Phase 11
**Requirements**: REG-01, REG-02
**Success Criteria** (what must be TRUE):
  1. A same-repo clawforge job completes successfully on both Noah/Archie and StrategyES/Epic instances
  2. A cross-repo job completes successfully on at least one instance, producing a PR in the target repo
  3. Sending a job targeting a repo not in ALLOWED_REPOS is rejected by the agent before job creation
  4. GitHub Actions logs contain no PAT values in plain text
**Plans**: TBD

Plans:
- [ ] 12-01: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation Fix | v1.0 | 2/2 | Complete | 2026-02-24 |
| 2. Output Observability | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Test Harness | v1.0 | 1/1 | Complete | 2026-02-24 |
| 4. Instruction Hardening | v1.0 | 1/1 | Complete | 2026-02-24 |
| 5. Pipeline Hardening | v1.1 | 2/2 | Complete | 2026-02-25 |
| 6. Smart Job Prompts | v1.1 | 1/1 | Complete | 2026-02-25 |
| 7. Previous Job Context | v1.1 | 2/2 | Complete | 2026-02-25 |
| 8. Polish & Test Sync | v1.1 | 2/2 | Complete | 2026-02-25 |
| 9. Config + Tool Schema + Entrypoint Foundation | 3/3 | Complete   | 2026-02-26 | - |
| 10. Actions Workflow + Container Execution + Cross-Repo PR | 3/3 | Complete    | 2026-02-27 | - |
| 11. Notification Pipeline + DB Schema | 3/3 | Complete   | 2026-02-27 | - |
| 12. Regression Verification | v1.2 | 0/? | Not started | - |
