---
phase: 09-config-layer-tool-schema-entrypoint-foundation
plan: "03"
subsystem: api
tags: [langchain, zod, tools, github-api, cross-repo]

# Dependency graph
requires:
  - phase: 09-01
    provides: "REPOS.json schema and loadAllowedRepos/resolveTargetRepo helpers in lib/tools/repos.js"
provides:
  - "create_job LangChain tool schema extended with optional target_repo parameter"
  - "Validation of target_repo against REPOS.json allowed list via resolveTargetRepo()"
  - "target.json sidecar written to job branch when targetRepo is resolved"
  - "Backward-compatible createJob() signature — no behavior change when target_repo absent"
affects:
  - "Phase 10 entrypoint — reads target.json sidecar to determine clone target"
  - "Phase 11 notification — target_repo surface in job completion messages"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tool schema validation pattern: Zod optional() + runtime validation via helper before job creation"
    - "Sidecar file pattern: PUT target.json to same branch/path prefix as job.md — no SHA conflict"
    - "Options object pattern: createJob(desc, options = {}) for backward-compatible extension"

key-files:
  created: []
  modified:
    - lib/ai/tools.js
    - lib/tools/create-job.js

key-decisions:
  - "target_repo validation occurs at tool handler level (lib/ai/tools.js) before createJob is called — clean separation: agent layer validates, job layer trusts"
  - "Error response on unrecognized repo returns available repo names to help agent self-correct"
  - "target.json uses { owner, slug, repo_url } structure — repo_url pre-computed to avoid entrypoint string interpolation"

patterns-established:
  - "Tool parameter threading: optional agent inputs flow through Zod schema -> handler validation -> createJob options -> GitHub API"
  - "Sidecar writes use same PUT pattern as job.md — no new API patterns introduced"

requirements-completed:
  - TOOL-01
  - TOOL-03

# Metrics
duration: 1min
completed: 2026-02-26
---

# Phase 9 Plan 03: Tool Schema + target.json Sidecar Summary

**create_job tool extended with optional target_repo parameter: validates against REPOS.json, writes target.json sidecar { owner, slug, repo_url } to job branch for downstream cross-repo job execution**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-26T04:37:55Z
- **Completed:** 2026-02-26T04:39:16Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended create_job Zod schema with optional `target_repo` string parameter and descriptive hint for the agent
- Added validation in tool handler: `loadAllowedRepos()` + `resolveTargetRepo()` called before job creation; unrecognized repos return a structured error with available repo names
- Updated `createJob()` to accept `options.targetRepo` and conditionally write `target.json` sidecar alongside `job.md` on the job branch
- Success response includes `target_repo: "owner/slug"` field when resolved, giving agent confirmation of target

## Task Commits

Each task was committed atomically:

1. **Task 1: Add target_repo to create_job tool schema with validation** - `eacfa4a` (feat)
2. **Task 2: Extend createJob to accept targetRepo and write target.json sidecar** - `2b0250d` (feat)

**Plan metadata:** `(pending docs commit)` (docs: complete plan)

## Files Created/Modified

- `lib/ai/tools.js` - Added `loadAllowedRepos`/`resolveTargetRepo` import, `target_repo` Zod schema field, validation block, resolvedTarget passed to createJob, target_repo in success response
- `lib/tools/create-job.js` - Updated signature to `createJob(jobDescription, options = {})`, added step 4 conditional `target.json` PUT via githubApi, updated JSDoc

## Decisions Made

- Validation happens at the tool handler layer (tools.js) before createJob is called — agent layer validates, job layer trusts the resolved object. Clean separation.
- Error response includes available repo names (`repos.map(r => r.name).join(', ')`) so the agent can self-correct without a second lookup.
- `target.json` pre-computes `repo_url` as `https://github.com/{owner}/{slug}.git` — entrypoint.sh can use it directly without string interpolation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 10 (entrypoint) can now read `logs/{jobId}/target.json` from the job branch to determine the clone target for cross-repo jobs
- The `{ owner, slug, repo_url }` structure in target.json is the contract between this phase and Phase 10
- Backward compatibility confirmed: createJob called without options behaves identically to v1.1

## Self-Check: PASSED

- FOUND: lib/ai/tools.js
- FOUND: lib/tools/create-job.js
- FOUND: .planning/phases/09-config-layer-tool-schema-entrypoint-foundation/09-03-SUMMARY.md
- FOUND commit eacfa4a: feat(09-03): add target_repo to create_job tool schema with validation
- FOUND commit 2b0250d: feat(09-03): extend createJob to accept targetRepo and write target.json sidecar

---
*Phase: 09-config-layer-tool-schema-entrypoint-foundation*
*Completed: 2026-02-26*
