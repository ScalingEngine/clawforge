---
status: complete
phase: 09-config-layer-tool-schema-entrypoint-foundation
source: 09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-03-SUMMARY.md
started: 2026-02-26T05:00:00Z
updated: 2026-02-26T05:08:00Z
---

## Current Test

[testing complete]

## Tests

### 1. REPOS.json Instance Configs
expected: Each instance has REPOS.json at instances/{name}/config/REPOS.json. Noah's lists clawforge + neurostory with owner/slug/name/aliases. StrategyES lists strategyes-lab.
result: pass

### 2. Repo Resolver Module
expected: lib/tools/repos.js exports loadAllowedRepos() and resolveTargetRepo(). resolveTargetRepo does case-insensitive matching on slug, name, and aliases. Returns null for unrecognized input.
result: pass

### 3. Dockerfile REPOS.json COPY
expected: Both instances/noah/Dockerfile and instances/strategyES/Dockerfile include a COPY line that puts REPOS.json into the container at ./config/REPOS.json.
result: pass

### 4. Generic Default SOUL.md and AGENT.md
expected: templates/docker/job/defaults/ contains SOUL.md (generic agent identity, no instance persona) and AGENT.md (generic instructions with GSD usage). Job Dockerfile COPYs both to /defaults/.
result: pass

### 5. Entrypoint Fallback Logic
expected: templates/docker/job/entrypoint.sh step 7 uses SOUL_FILE/AGENT_FILE variables that prefer /job/config/ files and fall back to /defaults/ when absent. EXEC-04 audit comment present after step 4.
result: pass

### 6. create_job Target Repo Schema
expected: lib/ai/tools.js create_job tool has an optional target_repo Zod string parameter with a descriptive hint. Validation calls loadAllowedRepos()/resolveTargetRepo() before job creation. Unrecognized repos return error with available repo names.
result: pass

### 7. target.json Sidecar Write
expected: lib/tools/create-job.js createJob() accepts options.targetRepo. When present, writes target.json sidecar (with owner, slug, repo_url) alongside job.md on the job branch. Without targetRepo, behavior is unchanged.
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
