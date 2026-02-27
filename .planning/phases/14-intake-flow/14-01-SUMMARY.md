---
phase: 14-intake-flow
plan: 01
subsystem: ai
tags: [llm-instructions, system-prompt, intake-flow, event-handler, instance-creation]

# Dependency graph
requires:
  - phase: 13-tool-infrastructure
    provides: create_instance_job tool registered in lib/ai/tools.js with snake_case name
provides:
  - Archie knows how to gather instance configuration across max 4 grouped turns
  - Archie captures optional slack_user_ids and telegram_chat_id silently when volunteered
  - Archie presents full config summary and waits for explicit approval before calling create_instance_job
  - Archie resets intake cleanly on cancel without contaminating subsequent messages
affects: [15-job-prompt, phase-15, future-intake-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LLM behavior controlled via EVENT_HANDLER.md system prompt injection"
    - "Bias-toward-action rule explicitly overridden for multi-step intake flows"

key-files:
  created:
    - .planning/phases/14-intake-flow/14-01-SUMMARY.md
  modified:
    - instances/noah/config/EVENT_HANDLER.md

key-decisions:
  - "Insert new section immediately before final `Current datetime: {{datetime}}` line to preserve template structure"
  - "Tool name must be exact snake_case `create_instance_job` to match Phase 13 registration"
  - "Explicit bias-toward-action override placed in section header so it cannot be missed"
  - "Optional fields section uses `Do NOT ask a dedicated question` language per RESEARCH.md pitfall guidance"
  - "Approval gate requires showing summary ALWAYS — even if operator says yes before summary is shown"

patterns-established:
  - "Intake override pattern: explicitly name the rule being overridden (bias-toward-action) so LLM understands it is an exception, not a contradiction"
  - "Optional field capture: tell the LLM what NOT to do (ask dedicated question) rather than only what to do"

requirements-completed: [INTAKE-02, INTAKE-03, INTAKE-04, INTAKE-05]

# Metrics
duration: 10min
completed: 2026-02-27
---

# Phase 14-01: Intake Flow Summary

**Multi-turn instance creation intake protocol added to EVENT_HANDLER.md — slot-filling with 4-turn grouping, silent optional capture, mandatory approval gate, and cancellation reset**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-27
- **Completed:** 2026-02-27
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Appended "Instance Creation Intake" section to `instances/noah/config/EVENT_HANDLER.md`
- Section includes required fields table (name, purpose, allowed_repos, enabled_channels)
- Optional fields (slack_user_ids, telegram_chat_id) captured silently when volunteered — no dedicated question
- Turn grouping instructions limit intake to max 4 turns, with name+purpose asked together in Turn 1
- Approval gate requires presenting complete config summary before dispatching `create_instance_job`
- Cancellation protocol explicitly forbids carrying partial state into subsequent unrelated messages
- Bias-toward-action override is explicit and placed in the section header

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Instance Creation Intake section to EVENT_HANDLER.md** - `140ee9f` (feat)

## Files Created/Modified
- `instances/noah/config/EVENT_HANDLER.md` - Appended Instance Creation Intake section (71 lines added)
- `config/EVENT_HANDLER.md` — NOT modified (Docker-overwritten path left untouched)

## Decisions Made
- Inserted section between final `---` separator and `Current datetime: {{datetime}}` to preserve file structure
- Tool name `create_instance_job` referenced exactly in snake_case per Phase 13 registration
- "Do NOT ask a dedicated question" wording chosen to make the LLM restriction unambiguous

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Plan 14-02 (human-verify checkpoint) will confirm the behavior works in a live agent conversation.

## Next Phase Readiness

- `instances/noah/config/EVENT_HANDLER.md` updated with complete intake protocol
- Ready for Plan 14-02: human verification of Archie's intake behavior in a live conversation
- Plan 14-02 requires rebuilding the Docker container (`docker compose build noah && docker compose up -d noah`) or restarting the event handler process so the updated config is active

---
*Phase: 14-intake-flow*
*Completed: 2026-02-27*
