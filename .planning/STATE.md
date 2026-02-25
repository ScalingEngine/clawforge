# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results
**Current focus:** Planning next milestone

## Current Position

Phase: 8 of 8 (Polish, Test, Sync) — COMPLETE
Plan: 2 of 2 in current phase — COMPLETE
Status: Plan 08-02 complete — test-entrypoint aligned with production prompt format, documentation artifacts fixed
Last activity: 2026-02-25 — Completed 08-02 (test harness prompt sync + doc tracking)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 13 (6 v1.0 + 5 v1.1 + 2 v1.2)
- Average duration: 1.4 min
- Total execution time: 0.27 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation Fix | 2/2 | 2 min | 1 min |
| 2. Output Observability | 2/2 | 3 min | 1.5 min |
| 3. Test Harness | 1/1 | 2 min | 2 min |
| 4. Instruction Hardening | 1/1 | 1 min | 1 min |
| 5. Pipeline Hardening | 2/2 | 4 min | 2 min |
| 6. Smart Job Prompts | 1/1 | 5 min | 5 min |
| 7. Previous Job Context | 2/2 | 5 min | 2.5 min |
| 8. Polish, Test, Sync | 2/2 | 2 min | 1 min |

**Recent Trend:**
- Last 5 plans: 06-01 (5 min), 07-01 (2 min), 07-02 (3 min), 08-01 (1 min), 08-02 (1 min)
- Trend: stable

*Updated after each plan completion*
| Phase 07-previous-job-context P02 | 3 | 1 tasks | 1 files |
| Phase 08-polish-test-sync P01 | 1 | 2 tasks | 4 files |
| Phase 08-polish-test-sync P02 | 1 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [07-01]: jobOutcomes uses UUID PK (not jobId) to allow multiple outcomes per job
- [07-01]: changedFiles stored as JSON string in TEXT column — no JOIN needed
- [07-01]: saveJobOutcome wrapped in try/catch in webhook handler — DB failures never block notifications
- [07-01]: getLastMergedJobOutcome filters mergeResult='merged' at query level (HIST-03), scoped by threadId (HIST-04)
- [06-01]: CLAUDE.md injected at entrypoint side via cat /job/CLAUDE.md, capped at 8000 chars (~2000 tokens), with Read-Only Reference framing
- [06-01]: GSD hint defaults to 'quick', upgrades to 'plan-phase' on keywords: implement|build|redesign|refactor|migrate|setup|integrate|develop|architect|phase|feature|epic|complex|end.to.end|full.system|multiple
- [06-01]: Dependencies only (not devDependencies) in Stack section — keeps prompt concise for large repos
- [05-02]: Artifact-based failure stage detection — preflight.md presence and claude-output.jsonl presence determine stage
- [05-01]: SHA comparison (HEAD_BEFORE != HEAD_AFTER) for zero-commit PR guard — safer with shallow clones than git status check
- [05-01]: Hardcoded 30-min timeout, not configurable — simpler for 2 instances
- [04-01]: Replaced advisory "Default choice" GSD language with imperative "MUST use Skill tool" block in both production AGENT.md files
- [04-01]: Baseline documented as untested against live runs — ~50% figure is community research (LOW confidence), not measured production data
- [v1.1 roadmap]: Phase 5 first — no new code paths, pure workflow fixes; establishes reliable test baseline before additive features
- [v1.1 roadmap]: Phase 6 context fetch via entrypoint-side reads (cat /job/CLAUDE.md) not Event Handler pre-fetch — confirmed fresher and simpler
- [v1.1 roadmap]: Phase 7 scopes all job_outcomes lookups by thread_id for instance isolation (not repo-scoped)
- [Phase 07-02]: threadId extracted before createJob call so enrichment runs before job is dispatched
- [Phase 07-02]: Non-fatal try/catch around prior context lookup — DB errors never block job creation
- [Phase 07-02]: Prior context prepended as markdown ## Prior Job Context section with --- separator for clear LLM delineation
- [08-01]: failure_stage surfaced in summarizeJob userMessage using existing .filter(Boolean) pattern — no system prompt changes needed
- [08-01]: Template synced byte-for-byte via cp, not manually — eliminates drift risk
- [08-02]: Test harness uses stub values for non-test sections — structural alignment is the goal, not content fidelity
- [08-02]: Preserved || true in test harness (vs production's || CLAUDE_EXIT=$?) — simpler where exit code not needed downstream
- [08-02]: REQUIREMENTS.md HIST-01 was already Complete — idempotent check passed, no edit needed

### Pending Todos

1. **Set up OpenAI key for Epic audio transcription** (infra) — [todo](./todos/pending/2026-02-24-set-up-openai-key-for-epic-audio-transcription.md)

### Blockers/Concerns

- [Phase 7 - RESOLVED]: Confirm `notify-pr-complete.yml` live webhook payload field names — payload fields confirmed via existing handleGithubWebhook code (job_id, status, merge_result, pr_url, changed_files)

## Session Continuity

Last session: 2026-02-25
Stopped at: Completed 08-02 (test harness prompt sync + doc tracking) — Phase 8 complete
Resume file: None
