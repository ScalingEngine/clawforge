# Requirements: ClawForge GSD Verification

**Defined:** 2026-02-23
**Core Value:** When Archie or Epic receives a task, it uses GSD workflows by default, and operators can verify this from job logs.

## v1 Requirements

### Foundation

- [x] **FOUND-01**: Job container receives non-empty prompt when `claude -p` executes (fix empty FULL_PROMPT bug)
- [x] **FOUND-02**: Entrypoint confirms HOME path and `~/.claude/commands/gsd/` exists before running `claude -p`
- [x] **FOUND-03**: `templates/docker/job/Dockerfile` matches live `docker/job/Dockerfile` (includes GSD install)
- [x] **FOUND-04**: `templates/docker/job/entrypoint.sh` matches live `docker/job/entrypoint.sh` (includes Task,Skill in allowed tools)
- [x] **FOUND-05**: Docker build fails if GSD is not installed (build-time verification after `npx get-shit-done-cc` step)

### Observability

- [x] **OBSV-01**: Entrypoint echoes HOME, `which claude`, GSD path, and working directory before `claude -p` runs
- [x] **OBSV-02**: PostToolUse hook logs Skill invocations to `logs/{jobId}/gsd-invocations.jsonl`
- [x] **OBSV-03**: `notify-pr-complete.yml` correctly references output file extension (fix `.json`/`.jsonl` mismatch)

### Testing

- [ ] **TEST-01**: A synthetic test job can be triggered that invokes `/gsd:quick` and proves the full chain works
- [ ] **TEST-02**: AGENT.md uses imperative language for GSD usage ("MUST use Skill tool for tasks") not advisory ("Default choice")

### Security

- [x] **SECR-01**: `.env.vps` added to `.gitignore` to prevent accidental credential commit

## v2 Requirements

### Observability

- **OBSV-04**: Stop hook writes one-line GSD usage summary at job completion
- **OBSV-05**: `--verbose` flag toggle via `CLAUDE_VERBOSE` env var for debugging
- **OBSV-06**: Switch to `--output-format stream-json` for richer tool event parsing

### Testing

- **TEST-03**: Automated validation script (`validate-output.sh`) that asserts GSD was called in job output

## Out of Scope

| Feature | Reason |
|---------|--------|
| OpenTelemetry integration | Overkill for 2 instances; hooks + committed logs sufficient |
| Real-time monitoring dashboard | Event Handler changes out of scope; GH Actions log is the real-time view |
| GSD compliance enforcement (blocking) | Too fragile before baseline established; log first, enforce later |
| Separate test Docker instance | Use dedicated test repo instead; isolated by repo, not instance |
| Unit tests for entrypoint.sh | Bash orchestration requires heavy mocking; E2E Docker test is more valuable |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| OBSV-01 | Phase 1 | Complete |
| SECR-01 | Phase 1 | Complete |
| OBSV-02 | Phase 2 | Complete |
| OBSV-03 | Phase 2 | Complete |
| TEST-01 | Phase 3 | Pending |
| TEST-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-02-23*
*Last updated: 2026-02-23 after roadmap creation*
