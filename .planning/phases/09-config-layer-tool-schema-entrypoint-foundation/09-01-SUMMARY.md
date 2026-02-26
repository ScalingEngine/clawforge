---
phase: 09-config-layer-tool-schema-entrypoint-foundation
plan: 01
subsystem: config
tags: [repos, docker, config, cross-repo, pat]

requires: []
provides:
  - Per-instance REPOS.json config files defining allowed target repos with owner, slug, name, aliases
  - lib/tools/repos.js with loadAllowedRepos() and resolveTargetRepo() for natural language repo resolution
  - Event Handler Dockerfiles bake REPOS.json into container at ./config/REPOS.json
  - PAT scope requirements documented in .env.example for cross-repo targeting
affects:
  - 09-02 (tool schema and input validation uses repos.js)
  - 09-03 (entrypoint uses repos.js to resolve target repo from job metadata)

tech-stack:
  added: []
  patterns:
    - "REPOS.json: per-instance config file defining allowed repos with owner/slug/name/aliases"
    - "resolveTargetRepo: case-insensitive match against slug, name, and aliases array; returns null for unknown input"
    - "loadAllowedRepos: reads config/REPOS.json from PROJECT_ROOT with try/catch, returns [] on failure"

key-files:
  created:
    - instances/noah/config/REPOS.json
    - instances/strategyES/config/REPOS.json
    - lib/tools/repos.js
  modified:
    - instances/noah/Dockerfile
    - instances/strategyES/Dockerfile
    - .env.example

key-decisions:
  - "REPOS.json placed in instances/{name}/config/ and COPY'd into container at ./config/REPOS.json — same path pattern as SOUL.md, AGENT.md"
  - "loadAllowedRepos() reads on every call with no caching — file is <1KB and changes require container rebuild anyway"
  - "resolveTargetRepo() uses .find() with .toLowerCase() matching; returns null (not undefined) via ?? null for consistent caller behavior"

patterns-established:
  - "Repo resolver pattern: resolveTargetRepo(input, repos) -> repo object | null"
  - "Config loading pattern: try/catch around readFileSync, return [] on any failure"

requirements-completed: [CFG-01, CFG-02, TOOL-02]

duration: 2min
completed: 2026-02-25
---

# Phase 9 Plan 01: Config Layer — REPOS.json and Resolver Module Summary

**Per-instance REPOS.json config files with loadAllowedRepos() and resolveTargetRepo() resolver supporting case-insensitive slug/name/alias matching for cross-repo job targeting**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T04:33:25Z
- **Completed:** 2026-02-26T04:35:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created `instances/noah/config/REPOS.json` with clawforge and neurostory repos (owner, slug, name, aliases)
- Created `instances/strategyES/config/REPOS.json` with strategyes-lab stub
- Implemented `lib/tools/repos.js` with `loadAllowedRepos()` (reads config/REPOS.json at runtime) and `resolveTargetRepo()` (case-insensitive slug/name/alias matching, returns null for unrecognized input)
- Updated both Event Handler Dockerfiles to COPY REPOS.json into container at `./config/REPOS.json` (after AGENT.md COPY)
- Documented PAT scope requirements for cross-repo targeting in `.env.example` with actionable comments on both NOAH and SES token entries

## Task Commits

Each task was committed atomically:

1. **Task 1: Create REPOS.json configs and repos.js resolver module** - `8f00d5e` (feat)
2. **Task 2: Update Event Handler Dockerfiles and document PAT scope** - `060292f` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `instances/noah/config/REPOS.json` - Noah instance allowed repos: clawforge, neurostory
- `instances/strategyES/config/REPOS.json` - StrategyES instance allowed repo: strategyes-lab
- `lib/tools/repos.js` - Repo loading (loadAllowedRepos) and resolution (resolveTargetRepo) module
- `instances/noah/Dockerfile` - Added COPY for REPOS.json after AGENT.md COPY
- `instances/strategyES/Dockerfile` - Added COPY for REPOS.json after AGENT.md COPY
- `.env.example` - Added PAT scope comments on NOAH_GH_TOKEN and SES_GH_TOKEN

## Decisions Made

- REPOS.json placed in `instances/{name}/config/` and COPY'd into container at `./config/REPOS.json` — follows the same path pattern as SOUL.md, AGENT.md
- `loadAllowedRepos()` reads on every call with no caching — the file is under 1KB and any content change requires a container rebuild anyway
- `resolveTargetRepo()` returns `null` (not `undefined`) via `?? null` for consistent, explicit caller behavior

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The verification step noted that running the smoke test from the project root returns 0 repos (expected — `config/REPOS.json` doesn't exist in the project root; it's placed there by Docker COPY at container build time). Tested resolver logic directly against the REPOS.json content to confirm correctness.

## User Setup Required

**Operator action required before any cross-repo job runs:** Update the Fine-grained PAT for both instances to include `contents:write` and `pull_requests:write` on all repos listed in REPOS.json.

See comments in `.env.example` on `NOAH_GH_TOKEN` and `SES_GH_TOKEN` for exact scope requirements.

## Next Phase Readiness

- REPOS.json config layer is complete — resolver module ready for import in Phase 9 Plan 02 (tool schema and input validation)
- Blocker documented in STATE.md: StrategyES REPOS.json content needs operator confirmation before Phase 9 ships

---
*Phase: 09-config-layer-tool-schema-entrypoint-foundation*
*Completed: 2026-02-25*

## Self-Check: PASSED

- FOUND: instances/noah/config/REPOS.json
- FOUND: instances/strategyES/config/REPOS.json
- FOUND: lib/tools/repos.js
- FOUND: 09-01-SUMMARY.md
- FOUND: commit 8f00d5e (Task 1)
- FOUND: commit 060292f (Task 2)
