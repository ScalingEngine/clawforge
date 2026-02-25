# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results
**Current focus:** Milestone v1.1 — Agent Intelligence & Pipeline Hardening

## Current Position

Phase: Not started (defining requirements)
Milestone: v1.1 — Agent Intelligence & Pipeline Hardening
Status: Defining requirements
Last activity: 2026-02-24 — Milestone v1.1 started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: 1.3 min
- Total execution time: 0.13 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation Fix | 2/2 | 2 min | 1 min |
| 2. Output Observability | 2/2 | 3 min | 1.5 min |
| 3. Test Harness | 1/1 | 2 min | 2 min |
| 4. Instruction Hardening | 1/1 | 1 min | 1 min |

**Recent Trend:**
- Last 5 plans: 01-02 (1 min), 02-01 (2 min), 02-02 (1 min), 03-01 (2 min), 04-01 (1 min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-phase]: GSD installed globally in Docker image (simpler than repo-level, survives across repos) — pending verification
- [Pre-phase]: Template drift accepted temporarily — live docker/ updated but templates/ not synced; Phase 1 resolves this
- [Pre-phase]: Focus on verification before Max subscription auth switch
- [01-01]: Use printf stdin pipe instead of positional argument for claude -p prompt delivery
- [01-01]: Fail-fast exit 1 on missing GSD rather than running claude without GSD capabilities
- [01-01]: Use ${HOME} not /root/ in entrypoint for future-proofing against USER directive changes
- [01-02]: Use /root/ (not ${HOME}) in Dockerfile RUN for build-time assertion since Docker build always runs as root
- [01-02]: Byte-for-byte copy for template sync rather than manual edits to guarantee zero drift
- [02-01]: Use node -e merge approach in Dockerfile for settings.json to avoid overwriting GSD config
- [02-01]: Touch empty gsd-invocations.jsonl before claude runs so file always exists in PR
- [02-01]: Truncate hook args to 200 chars and observability table args to 80 chars for readability
- [02-02]: Comment-only change to workflow; no functional logic modified
- [02-02]: Byte-for-byte template sync also resolved pre-existing RUNNER_TEMP drift
- [03-01]: Use dedicated test-entrypoint.sh bypass rather than modifying production entrypoint with test-mode flags
- [03-01]: Bind-mount test-entrypoint.sh at runtime rather than copying into Docker image to avoid Dockerfile changes
- [03-01]: Assert against gsd-invocations.jsonl (Phase 2 PostToolUse hook output) not tool-usage.json (never built)
- [03-01]: Fixture AGENT.md uses imperative MUST language to maximize GSD invocation reliability
- [04-01]: Replaced advisory "Default choice" GSD language with imperative "MUST use Skill tool" block in both production AGENT.md files
- [04-01]: Added named "GSD Usage — Required Behavior" section to make behavioral mandate structurally distinct from command reference
- [04-01]: Baseline documented as untested against live runs — ~50% figure is community research (LOW confidence), not measured production data

### Pending Todos

1. **Set up OpenAI key for Epic audio transcription** (infra) — [todo](./todos/pending/2026-02-24-set-up-openai-key-for-epic-audio-transcription.md)

### Blockers/Concerns

- ~~Both recorded production job runs show "Input must be provided" error~~ — RESOLVED in 01-01: fixed via stdin pipe
- ~~PostToolUse `tool_name` value for Skill tool is not officially documented~~ — RESOLVED in 02-RESEARCH: confirmed `"Skill"` (capital S) from live transcript evidence
- ~~`.env.vps` untracked in git with real credentials~~ — RESOLVED in 01-01: added to .gitignore

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Epic Slack tag-only replies and audio transcription | 2026-02-24 | 5e65c22 | [1-epic-slack-tag-only-replies-and-audio-tr](./quick/1-epic-slack-tag-only-replies-and-audio-tr/) |

## Session Continuity

Last session: 2026-02-24
Stopped at: Completed quick task 1 — Epic Slack tag-only replies and audio transcription
Resume file: .planning/quick/1-epic-slack-tag-only-replies-and-audio-tr/1-SUMMARY.md
