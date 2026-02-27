---
phase: 09-config-layer-tool-schema-entrypoint-foundation
plan: 02
subsystem: infra
tags: [docker, entrypoint, claude-code, gsd, config, cross-repo]

# Dependency graph
requires:
  - phase: 09-01
    provides: "Phase 9 plan 1 foundation work in same phase"
provides:
  - "Generic SOUL.md baked into job Docker image at /defaults/SOUL.md"
  - "Generic AGENT.md baked into job Docker image at /defaults/AGENT.md"
  - "Entrypoint /defaults/ fallback logic for cross-repo jobs"
  - "EXEC-04 compliance audit comment in entrypoint.sh"
affects: [cross-repo-job-targeting, job-container, entrypoint, docker-build]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bake defaults into Docker image so cross-repo jobs always have a system prompt"
    - "Variable-based file paths in entrypoint allow transparent fallback without branching logic"

key-files:
  created:
    - templates/docker/job/defaults/SOUL.md
    - templates/docker/job/defaults/AGENT.md
  modified:
    - templates/docker/job/Dockerfile
    - templates/docker/job/entrypoint.sh

key-decisions:
  - "Bake SOUL.md/AGENT.md into Docker image at /defaults/ — cross-repo working trees have no ClawForge config"
  - "Use variable-based fallback (SOUL_FILE/AGENT_FILE) to preserve backward compatibility — /job/config/ takes precedence when present"
  - "No PAT in clone URLs: gh auth setup-git handles credential resolution; GH_TOKEN only flows via env var"

patterns-established:
  - "Pattern: Docker image bakes generic defaults; per-instance config overrides at runtime"
  - "Pattern: Entrypoint uses SOUL_FILE/AGENT_FILE variables, defaulting to /job/config/ and falling back to /defaults/"

requirements-completed: [EXEC-02, EXEC-04]

# Metrics
duration: 5min
completed: 2026-02-26
---

# Phase 9 Plan 02: Config Defaults and Entrypoint Fallback Summary

**Generic SOUL.md and AGENT.md baked into job Docker image at /defaults/ with transparent /job/config/ fallback and EXEC-04 PAT-free clone audit comment**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-26T04:33:42Z
- **Completed:** 2026-02-26T04:38:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created generic ClawForge agent identity (SOUL.md) and instructions (AGENT.md) in templates/docker/job/defaults/ with no instance-specific persona
- Updated Dockerfile to COPY both defaults to /defaults/ in the image (EXEC-02 compliance)
- Updated entrypoint step 7 with variable-based fallback: /job/config/ takes precedence, falls back to /defaults/ when absent
- Added EXEC-04 audit comment documenting PAT-free clone URL approach via gh auth setup-git

## Task Commits

Each task was committed atomically:

1. **Task 1: Create generic /defaults/ SOUL.md and AGENT.md, update Dockerfile** - `959447b` (feat)
2. **Task 2: Update entrypoint with /defaults/ fallback and EXEC-04 audit comment** - `af23185` (feat)

## Files Created/Modified

- `templates/docker/job/defaults/SOUL.md` - Generic ClawForge agent identity for cross-repo jobs (10 lines)
- `templates/docker/job/defaults/AGENT.md` - Generic agent instructions with GSD usage block (19 lines)
- `templates/docker/job/Dockerfile` - Added COPY defaults/SOUL.md and COPY defaults/AGENT.md before entrypoint COPY
- `templates/docker/job/entrypoint.sh` - Step 7 fallback logic + EXEC-04 audit comment after step 4

## Decisions Made

- Baking defaults into the Docker image at build time (not mounting at runtime) ensures cross-repo containers always have a system prompt even when no volume mount is available
- Variable-based paths (SOUL_FILE/AGENT_FILE) make the fallback transparent — same-repo jobs continue using /job/config/ without any code changes
- EXEC-04 compliance was already correct; a documentation-only audit comment was added for clarity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Job image now always provides a system prompt regardless of target repo
- Same-repo behavior is unchanged — backward compatible
- Cross-repo jobs (Phase 11+) will use /defaults/ automatically
- EXEC-04 PAT-free clone approach is documented and auditable

---
*Phase: 09-config-layer-tool-schema-entrypoint-foundation*
*Completed: 2026-02-26*

## Self-Check: PASSED

- FOUND: templates/docker/job/defaults/SOUL.md
- FOUND: templates/docker/job/defaults/AGENT.md
- FOUND: templates/docker/job/Dockerfile
- FOUND: templates/docker/job/entrypoint.sh
- FOUND: .planning/phases/09-config-layer-tool-schema-entrypoint-foundation/09-02-SUMMARY.md
- FOUND commit: 959447b (feat(09-02): add generic /defaults/ SOUL.md and AGENT.md to job image)
- FOUND commit: af23185 (feat(09-02): add /defaults/ fallback logic and EXEC-04 audit comment to entrypoint)
