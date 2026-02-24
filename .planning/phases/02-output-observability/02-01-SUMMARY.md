---
phase: 02-output-observability
plan: 01
subsystem: infra
tags: [docker, hooks, observability, jsonl, PostToolUse, gsd]

# Dependency graph
requires:
  - phase: 01-foundation-fix
    provides: "Fixed entrypoint.sh with stdin pipe, preflight diagnostics, GSD build-time verification, synced templates"
provides:
  - "PostToolUse hook (gsd-invocations.js) that logs Skill invocations to gsd-invocations.jsonl"
  - "Dockerfile integration with node -e settings.json merge (preserves existing GSD config)"
  - "entrypoint.sh exports LOG_DIR, touches baseline JSONL, generates observability.md after claude -p"
  - "Templates synced with zero drift for all three new/modified files"
affects: [phase-2-output-observability, phase-3-test-harness]

# Tech tracking
tech-stack:
  added: []
  patterns: ["PostToolUse hook with stdin JSON parsing and JSONL append", "node -e settings.json merge in Dockerfile to avoid overwriting existing config", "observability.md generation from JSONL via jq in entrypoint"]

key-files:
  created: ["docker/job/hooks/gsd-invocations.js", "templates/docker/job/hooks/gsd-invocations.js"]
  modified: ["docker/job/Dockerfile", "docker/job/entrypoint.sh", "templates/docker/job/Dockerfile", "templates/docker/job/entrypoint.sh"]

key-decisions:
  - "Use node -e merge approach in Dockerfile instead of COPY for settings.json to avoid overwriting any GSD-written settings"
  - "Touch empty gsd-invocations.jsonl before claude runs so file always exists in PR even with zero invocations"
  - "Truncate hook args to 200 chars and observability table args to 80 chars to keep output readable"

patterns-established:
  - "PostToolUse hook pattern: stdin JSON -> filter by tool_name -> append JSONL to LOG_DIR"
  - "Settings merge pattern: node -e reads existing settings.json, merges new hook config, writes back"
  - "Post-claude artifact generation: entrypoint generates markdown summary from JSONL between claude exit and git commit"

requirements-completed: [OBSV-02]

# Metrics
duration: 2min
completed: 2026-02-24
---

# Phase 2 Plan 1: PostToolUse Hook and Observability Summary

**PostToolUse hook baked into Docker image logs Skill invocations to JSONL, entrypoint generates observability.md summary after claude exits, settings merged safely via node -e**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-24T13:28:44Z
- **Completed:** 2026-02-24T13:30:26Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created gsd-invocations.js PostToolUse hook that filters for `tool_name === 'Skill'` and appends JSONL records with timestamp, skill name, truncated args, and cwd
- Integrated hook into Dockerfile with safe settings.json merge via `node -e` that preserves any existing GSD config
- Modified entrypoint.sh to export LOG_DIR (so claude subprocess and hooks inherit it), touch empty baseline JSONL, and generate observability.md from JSONL after claude -p exits
- Synced all three files to templates/ with verified zero drift

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PostToolUse hook, Dockerfile integration, entrypoint changes** - `c82d230` (feat)
2. **Task 2: Sync templates to match live docker/job/ files** - `7d275b8` (chore)

## Files Created/Modified
- `docker/job/hooks/gsd-invocations.js` - PostToolUse hook that logs Skill invocations to JSONL
- `docker/job/Dockerfile` - Hook COPY, chmod, and settings.json merge via node -e
- `docker/job/entrypoint.sh` - export LOG_DIR, touch baseline JSONL, generate observability.md
- `templates/docker/job/hooks/gsd-invocations.js` - Template copy (byte-for-byte match)
- `templates/docker/job/Dockerfile` - Template copy (byte-for-byte match)
- `templates/docker/job/entrypoint.sh` - Template copy (byte-for-byte match)

## Decisions Made
- Used `node -e` merge approach in Dockerfile instead of a plain COPY for settings.json, because GSD's `npx get-shit-done-cc` may write its own settings.json during install -- merging preserves both configs
- Touch an empty `gsd-invocations.jsonl` before claude runs so the file always exists in the PR even when zero GSD skills are invoked (makes workflow search and operator expectations consistent)
- Truncated args to 200 chars in the hook and 80 chars in the observability.md table to keep output readable without losing essential information

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PostToolUse hook is baked into Docker image and will fire on every Skill invocation
- Every job PR will now contain gsd-invocations.jsonl and observability.md in logs/{jobId}/
- The existing notify-pr-complete.yml workflow already searches for *.jsonl and will find gsd-invocations.jsonl
- Ready for 02-02 (clarifying comments on notify workflow and template sync)
- Templates are in sync with zero drift

## Self-Check: PASSED

- [x] docker/job/hooks/gsd-invocations.js exists with Skill tool_name check and JSONL append
- [x] docker/job/Dockerfile has hook COPY, chmod, and settings.json merge via node -e
- [x] docker/job/entrypoint.sh exports LOG_DIR, touches JSONL baseline, generates observability.md
- [x] templates/docker/job/hooks/gsd-invocations.js byte-for-byte match
- [x] templates/docker/job/Dockerfile byte-for-byte match
- [x] templates/docker/job/entrypoint.sh byte-for-byte match
- [x] 02-01-SUMMARY.md created
- [x] Commit c82d230 exists (Task 1)
- [x] Commit 7d275b8 exists (Task 2)

---
*Phase: 02-output-observability*
*Completed: 2026-02-24*
