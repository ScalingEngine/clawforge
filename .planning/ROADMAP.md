# Roadmap: ClawForge

## Milestones

- v1.0 GSD Verification & Hardening - Phases 1-4 (shipped 2026-02-24)
- v1.1 Agent Intelligence & Pipeline Hardening - Phases 5-7 (in progress)

## Phases

<details>
<summary>v1.0 GSD Verification & Hardening (Phases 1-4) - SHIPPED 2026-02-24</summary>

### Phase 1: Foundation Fix
**Goal**: The job container reliably delivers a non-empty prompt to `claude -p`, GSD is confirmed present at runtime, and no stale template or exposed credential can mask results
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, SECR-01, OBSV-01
**Success Criteria** (what must be TRUE):
  1. A triggered job produces claude output (no "Input must be provided" error in logs)
  2. Every job PR includes a `preflight.md` showing HOME, claude path, and GSD directory contents
  3. Docker build fails loudly if GSD install step produces no `~/.claude/commands/gsd/` directory
  4. `templates/docker/job/Dockerfile` and `entrypoint.sh` are byte-for-byte equivalent to `docker/job/` counterparts
  5. `.env.vps` is listed in `.gitignore` and cannot be accidentally committed
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Fix prompt delivery (stdin pipe), add preflight diagnostics + GSD runtime check, lock .env.vps
- [x] 01-02-PLAN.md — Add build-time GSD verification to Dockerfile, sync templates to match live files

### Phase 2: Output Observability
**Goal**: GSD invocations are recorded automatically during job execution and surface as human-readable artifacts in every PR, with the notification workflow sending actual log content
**Depends on**: Phase 1
**Requirements**: OBSV-02, OBSV-03
**Success Criteria** (what must be TRUE):
  1. Every job PR contains a `gsd-invocations.jsonl` file (empty if no GSD calls were made)
  2. Every job PR contains an `observability.md` summarizing tool calls in plain English
  3. The Slack/Telegram notification for a completed job includes actual log content, not an empty field
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — PostToolUse hook for Skill logging, Dockerfile integration, entrypoint observability.md generation, template sync
- [x] 02-02-PLAN.md — Add clarifying comments to notify-pr-complete.yml documenting hook-to-notification dependency, sync template

### Phase 3: Test Harness
**Goal**: An operator can run a single local Docker command that triggers a synthetic GSD job and gets a PASS/FAIL result proving whether GSD was invoked — no production credentials or Slack round-trips required
**Depends on**: Phase 2
**Requirements**: TEST-01
**Success Criteria** (what must be TRUE):
  1. `tests/test-job.sh` exists and runs to completion with a local Docker build
  2. The test output produces a `tool-usage.json` that `validate-output.sh` can assert against
  3. `validate-output.sh` exits non-zero when no GSD calls are detected, and zero when GSD is confirmed
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md — Create test harness: fixture files, bypass entrypoint, runner script, validation script, .gitignore update

### Phase 4: Instruction Hardening
**Goal**: AGENT.md instructions for both Archie and Epic instances use imperative language that maximizes Skill tool invocation, informed by evidence from Phase 3 test runs
**Depends on**: Phase 3
**Requirements**: TEST-02
**Success Criteria** (what must be TRUE):
  1. AGENT.md for both instances uses imperative phrasing ("MUST use Skill tool") not advisory ("Default choice")
  2. A Phase 3 test run with the updated AGENT.md produces at least one GSD invocation in `gsd-invocations.jsonl`
  3. Documented baseline behavior (invocation rate) is recorded in PROJECT.md Key Decisions
**Plans**: 1 plan

Plans:
- [x] 04-01-PLAN.md — Replace advisory GSD language with imperative in both AGENT.md files, document decision in PROJECT.md

</details>

### v1.1 Agent Intelligence & Pipeline Hardening (In Progress)

**Milestone Goal:** Perfect pipeline reliability so failures are visible and trustworthy, then build smart job prompts that start agents warm with repo context, then persist job outcomes so agents can reference prior work.

#### Phase 5: Pipeline Hardening

**Goal**: The pipeline handles failure and success states correctly — jobs only open PRs when work was done, failures notify with enough context to debug, and runner timeouts prevent hung jobs from locking CI
**Depends on**: Phase 4
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05
**Success Criteria** (what must be TRUE):
  1. A job that exits with a non-zero Claude exit code or produces zero commits does not create a PR
  2. A failed job notification includes a failure stage label (docker_pull / auth / claude) and a relevant log excerpt
  3. The `notify-job-failed.yml` workflow reads `claude-output.jsonl` (not `.json`) without a file-not-found error
  4. A job that runs indefinitely is terminated after the configured timeout and triggers failure notification
  5. All three workflow files in `templates/.github/workflows/` are byte-for-byte identical to their live counterparts
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Zero-commit PR guard, rename output to .jsonl, add runner timeout
- [x] 05-02-PLAN.md — Failure stage categorization in notifications, template sync

#### Phase 6: Smart Job Prompts

**Goal**: Every job container starts with CLAUDE.md and package.json from the target repo already in the job description, structured in a consistent template with a GSD routing hint, so the agent knows the stack and conventions before writing a line of code
**Depends on**: Phase 5
**Requirements**: PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04
**Success Criteria** (what must be TRUE):
  1. A generated `job.md` contains a "Repository Documentation" section with CLAUDE.md content from the target repo
  2. A generated `job.md` contains a "Stack" section populated from `package.json` dependencies
  3. Injected CLAUDE.md content is wrapped in "Read-Only Reference" framing and capped at 2,000 tokens
  4. A job description includes a GSD command routing hint (quick vs plan-phase) derived from task keywords
  5. Job creation succeeds even when CLAUDE.md or package.json are missing or the GitHub API times out
**Plans**: 1 plan

Plans:
- [x] 06-01-PLAN.md — Add repo context reads (CLAUDE.md + package.json), GSD routing hint, and structured FULL_PROMPT template to entrypoint.sh, then sync template

#### Phase 7: Previous Job Context

**Goal**: When a user sends a follow-up message in the same thread, the new job description includes a summary of what the prior job accomplished and what files it changed — so the agent picks up where the last one left off instead of rediscovering the repo state
**Depends on**: Phase 6
**Requirements**: HIST-01, HIST-02, HIST-03, HIST-04
**Success Criteria** (what must be TRUE):
  1. Completing a job persists its status, changed files, PR URL, and log summary to the `job_outcomes` table
  2. A follow-up job description in the same thread includes a prior job summary section when the previous PR was merged
  3. A follow-up job description does NOT include prior context when the previous PR was not merged
  4. Previous job lookups return only results scoped to the current thread ID, with no cross-instance leakage
**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — Add job_outcomes schema, DB helpers, Drizzle migration, and webhook persistence
- [ ] 07-02-PLAN.md — Enrich createJobTool with prior merged job context lookup and injection

## Progress

**Execution Order:**
Phases execute in strict dependency order: 5 → 6 → 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation Fix | v1.0 | 2/2 | Complete | 2026-02-24 |
| 2. Output Observability | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Test Harness | v1.0 | 1/1 | Complete | 2026-02-24 |
| 4. Instruction Hardening | v1.0 | 1/1 | Complete | 2026-02-24 |
| 5. Pipeline Hardening | v1.1 | 2/2 | Complete | 2026-02-25 |
| 6. Smart Job Prompts | v1.1 | 1/1 | Complete | 2026-02-25 |
| 7. Previous Job Context | 2/2 | Complete    | 2026-02-25 | - |
