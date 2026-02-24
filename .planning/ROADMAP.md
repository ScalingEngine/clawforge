# Roadmap: ClawForge GSD Verification & Hardening

## Overview

Four phases in strict dependency order: fix the broken entrypoint so `claude -p` actually receives a prompt, add observability so GSD invocations are visible in job output, run a local test harness that proves the full chain end-to-end, then harden AGENT.md instructions based on what the test harness reveals. Nothing in Phase 2 can be validated until Phase 1 works. Nothing in Phase 4 should be written until Phase 3 produces evidence.

## Phases

- [x] **Phase 1: Foundation Fix** - Fix broken entrypoint, harden environment, sync templates, lock credentials
- [x] **Phase 2: Output Observability** - Make GSD invocations visible in every job PR via hooks and output parsing
- [x] **Phase 3: Test Harness** - Local Docker test that proves the full GSD chain without production credentials
- [x] **Phase 4: Instruction Hardening** - Tighten AGENT.md based on Phase 3 evidence

## Phase Details

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
**Plans:** 2 plans

Plans:
- [x] 01-01-PLAN.md — Fix prompt delivery (stdin pipe), add preflight diagnostics + GSD runtime check, lock .env.vps
- [ ] 01-02-PLAN.md — Add build-time GSD verification to Dockerfile, sync templates to match live files

### Phase 2: Output Observability
**Goal**: GSD invocations are recorded automatically during job execution and surface as human-readable artifacts in every PR, with the notification workflow sending actual log content
**Depends on**: Phase 1
**Requirements**: OBSV-02, OBSV-03
**Success Criteria** (what must be TRUE):
  1. Every job PR contains a `gsd-invocations.jsonl` file (empty if no GSD calls were made)
  2. Every job PR contains an `observability.md` summarizing tool calls in plain English
  3. The Slack/Telegram notification for a completed job includes actual log content, not an empty field
**Plans:** 2 plans

Plans:
- [ ] 02-01-PLAN.md — PostToolUse hook for Skill logging, Dockerfile integration, entrypoint observability.md generation, template sync
- [ ] 02-02-PLAN.md — Add clarifying comments to notify-pr-complete.yml documenting hook-to-notification dependency, sync template

### Phase 3: Test Harness
**Goal**: An operator can run a single local Docker command that triggers a synthetic GSD job and gets a PASS/FAIL result proving whether GSD was invoked — no production credentials or Slack round-trips required
**Depends on**: Phase 2
**Requirements**: TEST-01
**Success Criteria** (what must be TRUE):
  1. `tests/test-job.sh` exists and runs to completion with a local Docker build
  2. The test output produces a `tool-usage.json` that `validate-output.sh` can assert against
  3. `validate-output.sh` exits non-zero when no GSD calls are detected, and zero when GSD is confirmed
**Plans:** 1 plan

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
**Plans:** 1 plan

Plans:
- [x] 04-01-PLAN.md — Replace advisory GSD language with imperative in both AGENT.md files, document decision in PROJECT.md

## Progress

**Execution Order:**
Phases execute in strict dependency order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation Fix | 2/2 | Complete | 2026-02-24 |
| 2. Output Observability | 2/2 | Complete | 2026-02-24 |
| 3. Test Harness | 1/1 | Complete | 2026-02-24 |
| 4. Instruction Hardening | 1/1 | Complete | 2026-02-24 |
