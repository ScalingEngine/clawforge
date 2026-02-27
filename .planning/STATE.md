# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results
**Current focus:** Phase 13 — Tool Infrastructure (v1.3 Instance Generator)

## Current Position

Phase: 13 of 17 (Tool Infrastructure)
Plan: 1 of 1
Status: Phase complete — ready for Phase 14
Last activity: 2026-02-27 — Phase 13 executed (createInstanceJobTool registered, yaml installed)

Progress: [████████████░░░░░░░░] 60% (12/17 phases complete across all milestones)

## Performance Metrics

**Velocity:**
- Total plans completed: 23
- Average duration: ~2.5 min
- Total execution time: ~0.96 hours

**By Phase (v1.3 — TBD until planning):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 13. Tool Infrastructure | TBD | — | — |
| 14. Intake Flow | TBD | — | — |
| 15. Job Prompt Completeness | TBD | — | — |
| 16. PR Pipeline + Auto-Merge | TBD | — | — |
| 17. End-to-End Validation | TBD | — | — |

**Recent Trend (v1.2):**
- Last 5 plans: 09-P03 (1 min), 10-P01 (3 min), 10-P02 (2 min), 10-P03 (1 min), 11-P01 (3 min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

- [v1.3 roadmap]: Tool stub must be registered in agent tools array before any EVENT_HANDLER.md intake is written — avoids SQLite checkpoint corruption on tool add mid-session
- [v1.3 roadmap]: Instruction-driven slot filling via EVENT_HANDLER.md is the intake model — no custom StateGraph or interrupt() calls needed
- [v1.3 roadmap]: JavaScript template literals + fs.writeFileSync for file generation — all template engines (Handlebars, EJS, Mustache) are CommonJS-only, incompatible with ESM project
- [v1.3 roadmap]: yaml@^2.8.2 is the only new dependency — ESM-native, comment-preserving for docker-compose.yml modification
- [v1.3 roadmap]: Instance scaffolding PRs excluded from auto-merge — broken configs must be reviewed before reaching main
- [v1.3 roadmap]: Literal AGENT.md template must be embedded in job prompt — tool name casing is case-sensitive in --allowedTools; LLM cannot infer correct casing reliably

### Pending Todos

1. **Set up OpenAI key for Epic audio transcription** (infra) — [todo](./todos/pending/2026-02-24-set-up-openai-key-for-epic-audio-transcription.md)

### Blockers/Concerns

- [v1.3 pre-work]: StrategyES instance REPOS.json content needs operator confirmation (carried from v1.2)
- [v1.3 pre-work]: Fine-grained PAT scope update is an operator action — must be documented in .env.example before any cross-repo job runs (carried from v1.2)
- [Phase 15]: PR body delivery mechanism (--body-file vs --body inline) must be confirmed against entrypoint.sh before writing job prompt instructions
- [Phase 15]: yaml package parseDocument() + addIn() API against actual docker-compose.yml (nested Traefik command arrays) warrants a focused test before job prompt includes it

## Session Continuity

Last session: 2026-02-27
Stopped at: v1.3 roadmap created — Phases 13-17 defined, REQUIREMENTS.md traceability updated
Resume file: None
