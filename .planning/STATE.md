# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results
**Current focus:** Phase 9 — Config Layer + Tool Schema + Entrypoint Foundation

## Current Position

Phase: 9 of 12 (Config Layer + Tool Schema + Entrypoint Foundation)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-02-25 — v1.2 roadmap created (phases 9-12), ready to plan Phase 9

Progress: [████████░░░░░░░░░░░░] 38% (phases 1-8 complete, 4 remaining in v1.2)

## Performance Metrics

**Velocity:**
- Total plans completed: 13
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

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting v1.2 work:

- [v1.2 roadmap]: Cross-repo notification fires from entrypoint directly — notify-pr-complete.yml cannot observe events in foreign repos
- [v1.2 roadmap]: SOUL.md/AGENT.md baked into Docker image (/defaults/) — cross-repo working tree has no ClawForge config
- [v1.2 roadmap]: gh auth setup-git for all clones — PAT never interpolated into clone URLs (Actions log exposure risk)
- [v1.2 roadmap]: Job branches always live in clawforge — on:create trigger constraint; target.json sidecar carries target metadata
- [v1.2 roadmap]: Cross-repo PRs notify at PR creation, same-repo at merge — semantic difference must surface in UX language

### Pending Todos

1. **Set up OpenAI key for Epic audio transcription** (infra) — [todo](./todos/pending/2026-02-24-set-up-openai-key-for-epic-audio-transcription.md)

### Blockers/Concerns

- [Phase 9]: StrategyES instance REPOS.json content needs operator confirmation before Phase 9 ships
- [Phase 9]: Fine-grained PAT scope update is an operator action — must be documented in .env.example before any cross-repo job runs
- [Phase 11]: Cross-repo merge semantics UX language needs validation ("PR open for review" vs "merged")

## Session Continuity

Last session: 2026-02-25
Stopped at: v1.2 roadmap created — phases 9-12 defined and written to ROADMAP.md
Resume file: None
