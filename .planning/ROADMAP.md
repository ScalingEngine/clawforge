# Roadmap: ClawForge

## Milestones

- ✅ **v1.0 GSD Verification & Hardening** — Phases 1-4 (shipped 2026-02-24)
- ✅ **v1.1 Agent Intelligence & Pipeline Hardening** — Phases 5-8 (shipped 2026-02-25)
- ✅ **v1.2 Cross-Repo Job Targeting** — Phases 9-12 (shipped 2026-02-27)
- 🚧 **v1.3 Instance Generator** — Phases 13-17 (in progress)

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

<details>
<summary>✅ v1.2 Cross-Repo Job Targeting (Phases 9-12) — SHIPPED 2026-02-27</summary>

- [x] Phase 9: Config Layer + Tool Schema + Entrypoint Foundation (3/3 plans) — completed 2026-02-26
- [x] Phase 10: Actions Workflow + Container Execution + Cross-Repo PR (3/3 plans) — completed 2026-02-27
- [x] Phase 11: Notification Pipeline + DB Schema (3/3 plans) — completed 2026-02-27
- [x] Phase 12: Regression Verification (1/1 plan) — completed 2026-02-27

</details>

### 🚧 v1.3 Instance Generator (In Progress)

**Milestone Goal:** Archie can create fully-configured ClawForge instances through a guided conversation, generating all instance files as a PR with an operator setup checklist.

- [x] **Phase 13: Tool Infrastructure** - Register `createInstanceJobTool` stub with Zod schema; install `yaml` dependency (completed 2026-02-27)
- [ ] **Phase 14: Intake Flow** - Teach Archie multi-turn instance creation intake via EVENT_HANDLER.md with approval gate and cancellation
- [ ] **Phase 15: Job Prompt Completeness** - Build `buildInstanceJobDescription()` with instructions for all 7 artifacts, literal AGENT.md template, and semantic validation checklist
- [ ] **Phase 16: PR Pipeline and Auto-Merge Exclusion** - Exclude `instances/` from auto-merge; confirm PR title convention and body delivery
- [ ] **Phase 17: End-to-End Validation** - Run real multi-turn conversation through PR creation and verify all artifacts correct

## Phase Details

### Phase 13: Tool Infrastructure
**Goal**: `createInstanceJobTool` is registered in the agent tools array with a validated Zod schema, establishing the structured config contract that all downstream work depends on
**Depends on**: Phase 12 (v1.2 complete)
**Requirements**: INTAKE-01
**Success Criteria** (what must be TRUE):
  1. Sending "create a new instance" to Archie produces a tool-call attempt to `create_instance_job` (not an error about unknown tool)
  2. Calling `create_instance_job` with a valid config object dispatches a job without crashing the agent
  3. Calling `create_instance_job` with a missing required field returns a Zod validation error with the field name, not a silent failure
  4. Agent server restart after adding the tool does not corrupt existing SQLite checkpoint threads
**Plans**: 1 plan
Plans:
- [ ] 13-01-PLAN.md — Register createInstanceJobTool stub in tools.js + agent.js, install yaml

### Phase 14: Intake Flow
**Goal**: Archie recognizes instance creation intent and gathers all required configuration across 3-4 turns, with an approval gate before dispatch and clean cancellation handling
**Depends on**: Phase 13
**Requirements**: INTAKE-02, INTAKE-03, INTAKE-04, INTAKE-05
**Success Criteria** (what must be TRUE):
  1. Operator saying "create an instance for Jim" triggers Archie to begin asking for instance name, purpose, allowed repos, and enabled channels — grouped into no more than 4 turns
  2. Operator volunteering a Slack user ID or Telegram chat ID mid-intake causes Archie to capture it without asking a separate question about it
  3. Archie presents a full configuration summary and waits for explicit "yes" before dispatching the job
  4. Operator saying "cancel" or "never mind" at any point during intake resets the conversation without leaving partial state that contaminates the next unrelated message
**Plans**: TBD

### Phase 15: Job Prompt Completeness
**Goal**: `buildInstanceJobDescription()` produces a job prompt that causes Claude Code to correctly generate all 7 instance artifacts with semantically valid content scoped to the operator's stated purpose
**Depends on**: Phase 14
**Requirements**: SCAF-01, SCAF-02, SCAF-03, SCAF-04
**Success Criteria** (what must be TRUE):
  1. A dispatched instance job produces all 6 files under `instances/{name}/`: Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example
  2. The job updates `docker-compose.yml` with a new service block using comment-preserving YAML modification (existing commented TLS blocks remain intact)
  3. Generated SOUL.md and AGENT.md reflect the operator's stated instance purpose — not generic boilerplate copied from the noah instance
  4. Generated REPOS.json and EVENT_HANDLER.md are scoped to only the gathered allowed repos and enabled channels
  5. Generated AGENT.md contains exact tool name casing matching `--allowedTools` (e.g., `Read` not `read`) so Claude Code jobs do not silently run with no tools
**Plans**: TBD

### Phase 16: PR Pipeline and Auto-Merge Exclusion
**Goal**: Instance scaffolding PRs land with an operator setup checklist in the body and are blocked from auto-merge, ensuring every instance config receives manual review before reaching main
**Depends on**: Phase 15
**Requirements**: DELIV-01, DELIV-02
**Success Criteria** (what must be TRUE):
  1. A PR created by an instance job contains an operator setup checklist with exact GitHub secret names (with correct `AGENT_` prefix), Slack app scopes, PAT permissions, and post-merge commands specific to the new instance
  2. An instance scaffolding PR is not auto-merged by `auto-merge.yml` — it remains open for operator review even when all other auto-merge conditions are met
  3. Running `docker compose config` after applying the PR diff produces no YAML errors
**Plans**: TBD

### Phase 17: End-to-End Validation
**Goal**: A complete real-world run from multi-turn Slack conversation through PR creation confirms the full instance generator pipeline works correctly with all artifacts verified
**Depends on**: Phase 16
**Requirements**: DELIV-03
**Success Criteria** (what must be TRUE):
  1. A multi-turn Slack conversation with Archie (intent → questions → approval) dispatches a job that runs through GitHub Actions to completion without manual intervention
  2. The resulting PR contains all 7 artifacts (6 instance files + docker-compose.yml update) with no Dockerfile COPY path errors, no REPOS.json schema violations, and no shell-expansion hazards in SOUL.md
  3. The PR body checklist is instance-specific (correct secret names, correct scopes) and the PR is not auto-merged
  4. Running the PR diff through `docker compose config` validates successfully
**Plans**: TBD

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
| 9. Config + Tool Schema + Entrypoint Foundation | v1.2 | 3/3 | Complete | 2026-02-26 |
| 10. Actions Workflow + Container Execution + Cross-Repo PR | v1.2 | 3/3 | Complete | 2026-02-27 |
| 11. Notification Pipeline + DB Schema | v1.2 | 3/3 | Complete | 2026-02-27 |
| 12. Regression Verification | v1.2 | 1/1 | Complete | 2026-02-27 |
| 13. Tool Infrastructure | 1/1 | Complete   | 2026-02-27 | - |
| 14. Intake Flow | v1.3 | 0/TBD | Not started | - |
| 15. Job Prompt Completeness | v1.3 | 0/TBD | Not started | - |
| 16. PR Pipeline and Auto-Merge Exclusion | v1.3 | 0/TBD | Not started | - |
| 17. End-to-End Validation | v1.3 | 0/TBD | Not started | - |
