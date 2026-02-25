# Requirements: ClawForge

**Defined:** 2026-02-24
**Core Value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results without operator intervention.

## v1.0 Requirements (Complete)

### Foundation

- [x] **FOUND-01**: Job container receives non-empty prompt when `claude -p` executes
- [x] **FOUND-02**: Entrypoint confirms HOME path and `~/.claude/commands/gsd/` exists before running `claude -p`
- [x] **FOUND-03**: `templates/docker/job/Dockerfile` matches live `docker/job/Dockerfile`
- [x] **FOUND-04**: `templates/docker/job/entrypoint.sh` matches live `docker/job/entrypoint.sh`
- [x] **FOUND-05**: Docker build fails if GSD is not installed

### Observability

- [x] **OBSV-01**: Entrypoint echoes HOME, `which claude`, GSD path, and working directory before `claude -p` runs
- [x] **OBSV-02**: PostToolUse hook logs Skill invocations to `logs/{jobId}/gsd-invocations.jsonl`
- [x] **OBSV-03**: `notify-pr-complete.yml` correctly references output file extension

### Testing

- [x] **TEST-01**: A synthetic test job can be triggered that invokes `/gsd:quick` and proves the full chain works
- [x] **TEST-02**: AGENT.md uses imperative language for GSD usage

### Security

- [x] **SECR-01**: `.env.vps` added to `.gitignore` to prevent accidental credential commit

## v1.1 Requirements

### Pipeline Hardening

- [ ] **PIPE-01**: Job container creates PR only when Claude exits successfully and commits exist on the job branch
- [ ] **PIPE-02**: Failed job notifications include failure stage categorization (docker_pull/auth/claude) with relevant log excerpt
- [ ] **PIPE-03**: `notify-job-failed.yml` reads `claude-output.jsonl` (not `.json`) for failure log content
- [ ] **PIPE-04**: `run-job.yml` enforces `timeout-minutes` to prevent runner lock-up on hung jobs
- [ ] **PIPE-05**: All workflow templates in `templates/.github/workflows/` are byte-for-byte synced with live workflows

### Smart Job Prompts

- [ ] **PROMPT-01**: Job entrypoint reads CLAUDE.md and package.json from cloned repo and injects content into the Claude prompt
- [ ] **PROMPT-02**: Job description follows a structured template with Target, Context, Stack, Task, and GSD Hint sections
- [ ] **PROMPT-03**: Injected repo context is wrapped in "Read-Only Reference" framing and capped at 2,000 tokens
- [ ] **PROMPT-04**: Job description includes a GSD command routing hint (quick vs plan-phase) based on task keywords

### Previous Job Context

- [ ] **HIST-01**: `job_outcomes` table persists job completion data (status, changed files, PR URL, log summary) on webhook receipt
- [ ] **HIST-02**: Follow-up job descriptions include prior job summary when the previous PR on the same thread was merged
- [ ] **HIST-03**: Previous job context injection is gated on `merge_result == "merged"` to prevent false continuity
- [ ] **HIST-04**: Previous job context lookups are scoped by thread ID for instance isolation

## Future Requirements

### Observability

- **OBSV-04**: Stop hook writes one-line GSD usage summary at job completion
- **OBSV-05**: `--verbose` flag toggle via `CLAUDE_VERBOSE` env var for debugging
- **OBSV-06**: Switch to `--output-format stream-json` for richer tool event parsing

### Testing

- **TEST-03**: Automated validation script (`validate-output.sh`) that asserts GSD was called in job output

### Agent Intelligence (Tier 3 Level 2+)

- **INST-01**: Archie can stand up new ClawForge instances autonomously
- **LEARN-01**: Meta-agent reviews job success/failure rates and updates AGENT.md with learned lessons
- **COMP-01**: Modular agent capabilities in a registry for composing new instances

## Out of Scope

| Feature | Reason |
|---------|--------|
| OpenTelemetry integration | Overkill for 2 instances; hooks + committed logs sufficient |
| Real-time monitoring dashboard | GH Actions log is the real-time view |
| GSD compliance enforcement (blocking) | Log first, enforce later |
| Full repo tree fetch in context | GitHub API rate limits + context window noise; CLAUDE.md + package.json only |
| Multi-repo single-job model | Conflicts with single-repo-per-container isolation |
| Automatic retry with corrected prompt | Complex orchestration; most failures are prompt-related, not transient |
| Max subscription auth | Defer until volume justifies |
| Event Handler pre-fetching of CLAUDE.md | Stale context risk; entrypoint-side reading is fresher and simpler |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 (v1.0) | Complete |
| FOUND-02 | Phase 1 (v1.0) | Complete |
| FOUND-03 | Phase 1 (v1.0) | Complete |
| FOUND-04 | Phase 1 (v1.0) | Complete |
| FOUND-05 | Phase 1 (v1.0) | Complete |
| OBSV-01 | Phase 1 (v1.0) | Complete |
| SECR-01 | Phase 1 (v1.0) | Complete |
| OBSV-02 | Phase 2 (v1.0) | Complete |
| OBSV-03 | Phase 2 (v1.0) | Complete |
| TEST-01 | Phase 3 (v1.0) | Complete |
| TEST-02 | Phase 4 (v1.0) | Complete |
| PIPE-01 | Phase 5 (v1.1) | Pending |
| PIPE-02 | Phase 5 (v1.1) | Pending |
| PIPE-03 | Phase 5 (v1.1) | Pending |
| PIPE-04 | Phase 5 (v1.1) | Pending |
| PIPE-05 | Phase 5 (v1.1) | Pending |
| PROMPT-01 | Phase 6 (v1.1) | Pending |
| PROMPT-02 | Phase 6 (v1.1) | Pending |
| PROMPT-03 | Phase 6 (v1.1) | Pending |
| PROMPT-04 | Phase 6 (v1.1) | Pending |
| HIST-01 | Phase 7 (v1.1) | Pending |
| HIST-02 | Phase 7 (v1.1) | Pending |
| HIST-03 | Phase 7 (v1.1) | Pending |
| HIST-04 | Phase 7 (v1.1) | Pending |

**Coverage:**
- v1.0 requirements: 11 total — 11 complete
- v1.1 requirements: 13 total
- Mapped to phases: 13 (Phase 5: 5, Phase 6: 4, Phase 7: 4)
- Unmapped: 0

---
*Requirements defined: 2026-02-24*
*Last updated: 2026-02-24 after v1.1 roadmap creation*
