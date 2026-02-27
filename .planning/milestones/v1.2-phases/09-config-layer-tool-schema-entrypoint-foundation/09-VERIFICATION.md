---
phase: 09-config-layer-tool-schema-entrypoint-foundation
verified: 2026-02-25T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 9: Config Layer + Tool Schema + Entrypoint Foundation — Verification Report

**Phase Goal:** target_repo travels through the full system — from agent tool call through job creation — and the entrypoint operates correctly for all jobs regardless of target
**Verified:** 2026-02-25
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from Phase 9 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent accepts "work on [repo name]" and resolves to valid allowed repo slug (or rejects if not allowed) | VERIFIED | `lib/ai/tools.js` lines 52-64: validates `target_repo` via `resolveTargetRepo()`, returns structured error with available repo list when not found |
| 2 | A job created with a target repo writes target.json alongside job.md on the clawforge job branch | VERIFIED | `lib/tools/create-job.js` lines 40-55: conditional `githubApi` PUT to `logs/{jobId}/target.json` when `targetRepo` is truthy |
| 3 | Jobs created without a target repo produce no target.json and behave identically to v1.1 | VERIFIED | `createJob()` conditionally writes target.json only `if (targetRepo)` — the function signature `options = {}` with `targetRepo = undefined` by default preserves exact prior behavior |
| 4 | SOUL.md and AGENT.md are loaded from the Docker image for all jobs — cross-repo jobs have a system prompt | VERIFIED | `entrypoint.sh` lines 89-104: `SOUL_FILE`/`AGENT_FILE` variables fall back to `/defaults/SOUL.md` and `/defaults/AGENT.md` when `/job/config/` versions are absent; Dockerfile lines 64-68 bake defaults in |
| 5 | No PAT appears in any clone URL in entrypoint output (gh auth setup-git handles all auth) | VERIFIED | `entrypoint.sh` line 39: `git clone ... "$REPO_URL"` — no token interpolation. `gh auth setup-git` at line 26 provides credentials. EXEC-04 audit comment at lines 33-35 documents compliance. No PAT-in-URL pattern found in code. |

**Score:** 5/5 truths verified

---

## Required Artifacts

### Plan 09-01 Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `instances/noah/config/REPOS.json` | Noah allowed repos with owner, slug, name, aliases | Yes | Yes — 2 repos (clawforge, neurostory) with all fields present | Copied into container at line 41 of Noah Dockerfile | VERIFIED |
| `instances/strategyES/config/REPOS.json` | StrategyES allowed repos config | Yes | Yes — 1 repo (strategyes-lab) with all fields present | Copied into container at line 41 of SES Dockerfile | VERIFIED |
| `lib/tools/repos.js` | Repo loading and resolution logic | Yes | Yes — 39 lines, exports `loadAllowedRepos` and `resolveTargetRepo` with JSDoc and case-insensitive slug/name/alias matching | Imported and called in `lib/ai/tools.js` lines 9, 55-56 | VERIFIED |
| `instances/noah/Dockerfile` | Event Handler image with REPOS.json | Yes | Yes — line 41: `COPY instances/noah/config/REPOS.json ./config/REPOS.json` | Bakes file into image at `./config/REPOS.json` (where `loadAllowedRepos()` reads it via `PROJECT_ROOT/config/REPOS.json`) | VERIFIED |
| `instances/strategyES/Dockerfile` | Event Handler image with REPOS.json | Yes | Yes — line 41: `COPY instances/strategyES/config/REPOS.json ./config/REPOS.json` | Same pattern as Noah | VERIFIED |
| `.env.example` | PAT scope documentation | Yes | Yes — lines 22-25 (NOAH) and 60-63 (SES): PAT scope comment blocks present with contents:write and pull_requests:write requirements | Documentation — no wiring needed | VERIFIED |

### Plan 09-02 Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `templates/docker/job/defaults/SOUL.md` | Generic ClawForge agent identity | Yes | Yes — 11 lines, generic identity, no instance persona ("Archie"/"Epic" absent) | Dockerfile COPY at line 67 bakes into /defaults/SOUL.md; entrypoint.sh fallback at line 95 loads it | VERIFIED |
| `templates/docker/job/defaults/AGENT.md` | Generic agent instructions with GSD block | Yes | Yes — 20 lines, GSD usage block present, generic instructions, no instance-specific content | Dockerfile COPY at line 68 bakes into /defaults/AGENT.md; entrypoint.sh fallback at line 96 loads it | VERIFIED |
| `templates/docker/job/Dockerfile` | Job image with /defaults/ baked in | Yes | Yes — lines 64-68: `RUN mkdir -p /defaults`, COPY for both SOUL.md and AGENT.md | Referenced by entrypoint.sh which uses the /defaults/ path | VERIFIED |
| `templates/docker/job/entrypoint.sh` | Entrypoint with SOUL/AGENT fallback logic | Yes | Yes — lines 89-104: variable-based file path selection with fallback to /defaults/; EXEC-04 audit comment at lines 33-35 | Loaded at runtime by Docker ENTRYPOINT | VERIFIED |

### Plan 09-03 Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `lib/ai/tools.js` | Extended create_job tool with target_repo parameter | Yes | Yes — lines 24, 52-64, 80, 93-97: target_repo in schema, validation block, resolvedTarget passed to createJob, success response includes target_repo | Imported into agent via existing tool registration chain | VERIFIED |
| `lib/tools/create-job.js` | Job creation with optional target.json sidecar | Yes | Yes — lines 11-12, 40-55: options parameter, targetRepo extraction, conditional PUT of target.json with owner/slug/repo_url payload | Called from `lib/ai/tools.js` line 66 with `{ targetRepo: resolvedTarget }` | VERIFIED |

---

## Key Link Verification

### Plan 09-01 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `lib/tools/repos.js` | `config/REPOS.json` | `fs.readFileSync` at runtime | WIRED | Line 11-16: `path.join(PROJECT_ROOT, 'config', 'REPOS.json')` with `fs.readFileSync(reposFile, 'utf8')` |
| `instances/noah/Dockerfile` | `instances/noah/config/REPOS.json` | COPY at build time | WIRED | Line 41: `COPY instances/noah/config/REPOS.json ./config/REPOS.json` |
| `instances/strategyES/Dockerfile` | `instances/strategyES/config/REPOS.json` | COPY at build time | WIRED | Line 41: `COPY instances/strategyES/config/REPOS.json ./config/REPOS.json` |

### Plan 09-02 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `templates/docker/job/Dockerfile` | `templates/docker/job/defaults/` | COPY at build time | WIRED | Lines 67-68: `COPY defaults/SOUL.md /defaults/SOUL.md` and `COPY defaults/AGENT.md /defaults/AGENT.md` |
| `templates/docker/job/entrypoint.sh` | `/defaults/SOUL.md` | fallback test at step 7 | WIRED | Line 95: `[ ! -f "$SOUL_FILE" ] && SOUL_FILE="/defaults/SOUL.md"` |
| `templates/docker/job/entrypoint.sh` | `/defaults/AGENT.md` | fallback test at step 7 | WIRED | Line 96: `[ ! -f "$AGENT_FILE" ] && AGENT_FILE="/defaults/AGENT.md"` |

### Plan 09-03 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `lib/ai/tools.js` | `lib/tools/repos.js` | import + call `resolveTargetRepo()` | WIRED | Line 9: `import { loadAllowedRepos, resolveTargetRepo } from '../tools/repos.js'`; lines 55-56: called in tool handler |
| `lib/ai/tools.js` | `lib/tools/create-job.js` | passes targetRepo to `createJob()` | WIRED | Line 66: `await createJob(enrichedDescription, { targetRepo: resolvedTarget })` |
| `lib/tools/create-job.js` | GitHub Contents API | PUT `target.json` to job branch | WIRED | Lines 47-53: `githubApi(...contents/logs/${jobId}/target.json...)` with PUT method and base64-encoded JSON payload |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CFG-01 | 09-01 | Each instance has a REPOS.json config defining allowed target repos with owner, repo slug, and aliases | SATISFIED | `instances/noah/config/REPOS.json` (2 repos) and `instances/strategyES/config/REPOS.json` (1 repo) both exist with complete `owner`/`slug`/`name`/`aliases` structure |
| CFG-02 | 09-01 | PAT per instance scoped with contents:write and pull_requests:write on all allowed repos (operator action documented) | SATISFIED | `.env.example` lines 22-25 and 60-63 document exact PAT scope requirements for each instance with actionable instructions |
| TOOL-01 | 09-03 | create_job tool accepts optional target_repo parameter validated against allowed repos list | SATISFIED | `lib/ai/tools.js` lines 93-97: `target_repo: z.string().optional()` in schema; lines 52-64: validation returning structured error with available repos |
| TOOL-02 | 09-01 | Agent resolves target repo from natural language using allowed repos config (name/alias matching) | SATISFIED | `lib/tools/repos.js` `resolveTargetRepo()`: case-insensitive matching against slug, name, and all aliases; called from tool handler before job creation |
| TOOL-03 | 09-03 | create-job.js writes target.json sidecar to clawforge job branch when target repo is specified | SATISFIED | `lib/tools/create-job.js` lines 40-55: conditional PUT of `logs/{jobId}/target.json` with `{ owner, slug, repo_url }` payload |
| EXEC-02 | 09-02 | SOUL.md and AGENT.md baked into Docker image so cross-repo jobs have system prompt | SATISFIED | Job Dockerfile lines 64-68 bake both files to `/defaults/`; entrypoint.sh lines 94-96 fall back to them when `/job/config/` is absent |
| EXEC-04 | 09-02 | gh auth setup-git used for all clones (no PAT in clone URLs) | SATISFIED | `entrypoint.sh` line 26: `gh auth setup-git` before any git operation; line 39: clone uses bare `$REPO_URL` with no token interpolation; audit comment at lines 33-35 documents compliance |

**All 7 requirements declared in plan frontmatter: SATISFIED**

No orphaned requirements detected — REQUIREMENTS.md Traceability table lists CFG-01, CFG-02, TOOL-01, TOOL-02, TOOL-03, EXEC-02, EXEC-04 as "Phase 9 / Complete", which matches the plan claims.

---

## Anti-Patterns Found

| File | Pattern | Severity | Finding |
|------|---------|----------|---------|
| `templates/docker/job/defaults/SOUL.md` | Instance persona check | Info | No "Archie" or "Epic" found — generic identity confirmed |
| `lib/tools/repos.js` | Return null/empty | Info | `return []` on catch is intentional graceful degradation, not a stub — documented behavior |
| `entrypoint.sh` | `PAT` keyword in comment | Info | Line 35 contains "PAT" only in the EXEC-04 audit comment, not in any URL — confirmed no leak |

No blocker or warning anti-patterns found.

---

## Human Verification Required

### 1. REPOS.json runtime resolution in Docker container

**Test:** Build the Noah Event Handler image and call `create_job` with `target_repo="cf"` from Slack/Telegram
**Expected:** Tool returns `{ success: true, target_repo: "ScalingEngine/clawforge" }` without error
**Why human:** Requires Docker build and live message dispatch — `PROJECT_ROOT` resolves to `process.cwd()` which must be `/app` at container runtime; this cannot be verified statically

### 2. Entrypoint fallback behavior in cross-repo job

**Test:** Run a job container against a foreign repo (no `config/` directory). Observe that Claude receives a non-empty system prompt.
**Expected:** Claude starts with content from `/defaults/SOUL.md` and `/defaults/AGENT.md` — no empty system prompt
**Why human:** Requires launching an actual job container with a target repo that has no `config/` directory; static analysis confirms the logic is correct but end-to-end execution cannot be verified without infrastructure

### 3. target.json sidecar appears on job branch

**Test:** Create a job via `create_job` with `target_repo="neurostory"`. Check the GitHub job branch in the clawforge repo for `logs/{jobId}/target.json`
**Expected:** File exists with `{ owner: "ScalingEngine", slug: "neurostory", repo_url: "https://github.com/ScalingEngine/neurostory.git" }`
**Why human:** Requires live GitHub API call with valid GH_TOKEN and GH_OWNER/GH_REPO set in environment

---

## Gaps Summary

No gaps found. All 5 observable truths are verified, all 10 artifacts pass all three levels (exists, substantive, wired), all 7 key links are confirmed in code, and all 7 requirements are satisfied.

The phase goal is achieved: `target_repo` travels through the full system — from agent tool call (`create_job` schema + `resolveTargetRepo` validation) through job creation (`createJob` with `target.json` sidecar), and the entrypoint operates correctly for all jobs regardless of target (defaults baked in, fallback logic in place, no PAT in clone URLs).

---

_Verified: 2026-02-25_
_Verifier: Claude (gsd-verifier)_
