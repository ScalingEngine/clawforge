# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results
**Current focus:** Phase 14 — Intake Flow (v1.3 Instance Generator)

## Current Position

Phase: 14 of 17 (Intake Flow)
Plan: 1 of 2 complete (Plan 14-01 done, Plan 14-02 pending human verify)
Status: Wave 1 complete — awaiting human verification checkpoint (Plan 14-02)
Last activity: 2026-02-27 — Phase 14 Plan 01 executed (Instance Creation Intake section added to EVENT_HANDLER.md)

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

- [14-01]: Bias-toward-action override pattern — explicitly name the rule being overridden in the LLM instructions so it understands this is an exception, not a contradiction
- [14-01]: Optional field capture: tell the LLM what NOT to do (ask dedicated question) rather than only what to do — avoids ambiguity
- [14-01]: Approval gate requires showing summary ALWAYS — even if operator says yes before summary is shown (prevents premature dispatch on early affirmatives)
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
