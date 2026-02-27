---
phase: 13-tool-infrastructure
plan: 01
subsystem: ai
tags: [langgraph, langchain, tools, zod, yaml, agent]

# Dependency graph
requires:
  - phase: 12-cross-repo-job-targeting
    provides: createJob, saveJobOrigin, detectPlatform patterns used in new tool handler
provides:
  - createInstanceJobTool registered in LangGraph agent tools array with Zod-validated schema
  - yaml@^2.8.2 installed (ESM-native, comment-preserving — ready for Phase 15)
  - Structured config contract (name, purpose, allowed_repos, enabled_channels) for all downstream v1.3 phases
affects: [14-intake-flow, 15-job-prompt-completeness, 16-pr-pipeline, 17-end-to-end-validation]

# Tech tracking
tech-stack:
  added: [yaml@^2.8.2]
  patterns: [LangGraph tool registration, Zod schema without .transform(), saveJobOrigin pattern for notification routing]

key-files:
  created: []
  modified:
    - lib/ai/tools.js
    - lib/ai/agent.js
    - package.json
    - package-lock.json

key-decisions:
  - "Tool name is snake_case 'create_instance_job' — LangGraph routes by exact string match; camelCase causes 'Tool not found' crash"
  - "No .transform() on any Zod schema field — transforms break LangChain JSON Schema serialization"
  - "Phase 13 stub builds minimal job description inline; Phase 15 replaces with buildInstanceJobDescription(config)"
  - "saveJobOrigin called in handler so instance job completions route back to originating conversation thread"
  - "yaml@^2.8.2 chosen over js-yaml (CommonJS-only, incompatible with ESM project)"

patterns-established:
  - "New tools follow createJobTool pattern: capture thread_id from runConfig?.configurable?.thread_id, call saveJobOrigin in try/catch"
  - "Export line in tools.js is the single source of truth for available tools — agent.js imports by name"

requirements-completed: [INTAKE-01]

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 13-01: Tool Infrastructure Summary

**create_instance_job LangGraph tool registered in agent with Zod schema (4 required + 2 optional fields), yaml@^2.8.2 installed**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-27T00:00:00Z
- **Completed:** 2026-02-27T00:05:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `createInstanceJobTool` defined in `lib/ai/tools.js` with snake_case name `create_instance_job`, full Zod schema, stub handler, saveJobOrigin call, JSDoc block
- Tool exported from `tools.js` and imported + registered in `lib/ai/agent.js` tools array
- `yaml@^2.8.2` installed — ESM-native, comment-preserving, importable without error

## Task Commits

Each task was committed atomically:

1. **Task 1: Add createInstanceJobTool to tools.js and install yaml** - `2e9c950` (feat)
2. **Task 2: Register createInstanceJobTool in agent.js tools array** - `e9313e1` (feat)

## Files Created/Modified
- `lib/ai/tools.js` - Added createInstanceJobTool definition (lines 143-186), updated export line
- `lib/ai/agent.js` - Updated import and tools array to include createInstanceJobTool
- `package.json` - Added yaml@^2.8.2 to dependencies
- `package-lock.json` - Updated lock file

## Decisions Made
- Followed plan exactly — no architectural decisions required beyond what was pre-decided in PLAN.md frontmatter

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 14 (Intake Flow) can now write EVENT_HANDLER.md intake instructions that reference `create_instance_job` — the tool exists in the agent tools array and will be recognized by the LLM
- Phase 15 (Job Prompt Completeness) can replace the stub description builder with `buildInstanceJobDescription(config)` — yaml package is installed and ready
- Server restart required after PR merges for the running singleton to pick up the new tool (expected behavior, operator action)

---
*Phase: 13-tool-infrastructure*
*Completed: 2026-02-27*
