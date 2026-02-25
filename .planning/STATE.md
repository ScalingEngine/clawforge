# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results
**Current focus:** Milestone v1.1 — Phase 6: Smart Job Prompts

## Current Position

Phase: 6 of 7 (Smart Job Prompts)
Plan: 1 of 1 in current phase
Status: Phase complete — plan 06-01 executed
Last activity: 2026-02-25 — Completed 06-01 (structured FULL_PROMPT with repo context injection)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 9 (6 v1.0 + 3 v1.1)
- Average duration: 1.4 min
- Total execution time: 0.21 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation Fix | 2/2 | 2 min | 1 min |
| 2. Output Observability | 2/2 | 3 min | 1.5 min |
| 3. Test Harness | 1/1 | 2 min | 2 min |
| 4. Instruction Hardening | 1/1 | 1 min | 1 min |
| 5. Pipeline Hardening | 2/2 | 4 min | 2 min |
| 6. Smart Job Prompts | 1/1 | 5 min | 5 min |

**Recent Trend:**
- Last 5 plans: 03-01 (2 min), 04-01 (1 min), 05-01 (2 min), 05-02 (2 min), 06-01 (5 min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

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

### Pending Todos

1. **Set up OpenAI key for Epic audio transcription** (infra) — [todo](./todos/pending/2026-02-24-set-up-openai-key-for-epic-audio-transcription.md)

### Blockers/Concerns

- [Phase 7]: Confirm `notify-pr-complete.yml` live webhook payload field names before generating Drizzle migration — inspect a real webhook payload during Phase 5/6 testing to avoid a re-migration

## Session Continuity

Last session: 2026-02-25
Stopped at: Completed 06-01 (structured FULL_PROMPT with repo context injection) — Phase 6 complete
Resume file: None
