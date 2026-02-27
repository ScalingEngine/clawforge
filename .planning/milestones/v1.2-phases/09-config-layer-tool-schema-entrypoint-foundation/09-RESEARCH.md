# Phase 9: Config Layer + Tool Schema + Entrypoint Foundation - Research

**Researched:** 2026-02-25
**Domain:** JavaScript/Node.js config file patterns, Zod v4 schema extension, bash entrypoint modification
**Confidence:** HIGH

## Summary

Phase 9 is a pure codebase modification phase — no new npm dependencies are required. Every change is in existing files: a new JSON config file (`REPOS.json`) per instance, an expanded Zod schema on the `create_job` tool, a resolver function in `tools.js`, updated `create-job.js` to write a `target.json` sidecar, updated Dockerfiles to bake SOUL.md/AGENT.md into the job image under `/defaults/`, and an entrypoint cleanup to always use `gh auth setup-git` (which is already in use at line 26 of `entrypoint.sh` — no PAT leak exists today). The entrypoint SOUL/AGENT load path needs a `/defaults/` fallback for when the cloned repo is NOT clawforge.

The architectural pattern established in v1.2 planning is: job branches always live in clawforge; a `target.json` sidecar on the job branch carries target repo metadata. Phase 9 builds the upstream half of this (config → tool schema → job creation → sidecar write) without touching GitHub Actions or the container's two-phase clone (Phase 10). Backward compatibility is non-negotiable: no `target.json` = same-repo job, unchanged behavior.

**Primary recommendation:** Implement in a single wave — config files first, then tool schema changes, then sidecar write, then Dockerfile bake. Each step is self-contained and testable independently. The entrypoint `gh auth setup-git` requirement is already satisfied; the SOUL/AGENT bake-in is the only Docker image change needed in this phase.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CFG-01 | Each instance has a `REPOS.json` config defining allowed target repos with owner, repo slug, and aliases | JSON file pattern at `instances/{name}/config/REPOS.json`, loaded at runtime via `fs.readFileSync`; structure defined below |
| CFG-02 | PAT per instance scoped with `contents:write` and `pull_requests:write` on all allowed repos (operator action documented) | Operator docs in `.env.example` comments; GitHub fine-grained PAT scope documentation referenced |
| TOOL-01 | `create_job` tool accepts optional `target_repo` parameter validated against allowed repos list | Zod v4 `z.string().optional()` on existing tool schema; validation logic in tool handler against loaded REPOS.json |
| TOOL-02 | Agent resolves target repo from natural language using allowed repos config (name/alias matching) | Resolver function reads REPOS.json at runtime, matches against `name`, `slug`, and `aliases[]`; returns canonical slug or null |
| TOOL-03 | `create-job.js` writes `target.json` sidecar to clawforge job branch when target repo is specified | GitHub Contents API PUT at `logs/{jobId}/target.json` on the same job branch, after `job.md` write |
| EXEC-02 | SOUL.md and AGENT.md baked into Docker image so cross-repo jobs have system prompt | `COPY instances/{name}/config/SOUL.md /defaults/SOUL.md` and same for AGENT.md in job Dockerfile; entrypoint falls back to `/defaults/` when `/job/config/` is absent |
| EXEC-04 | `gh auth setup-git` used for all clones — no PAT in clone URLs | Already satisfied in entrypoint.sh line 26; audit confirms REPO_URL is passed via env not constructed with PAT interpolation |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zod | ^4.3.6 (already installed) | Schema validation for tool parameters | Already the project standard for all tool schemas |
| `fs` (Node built-in) | Node 22 | Read REPOS.json at runtime | No dep needed |
| GitHub Contents API | REST v3 | Write target.json sidecar to job branch | Already used in `create-job.js` for job.md write |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | ^9.0.0 (already installed) | Job ID generation (unchanged) | Already in use |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON file for REPOS config | Environment variable list | JSON is structured (owner, slug, aliases), env var lists are fragile to parse |
| JSON file for REPOS config | SQLite table | Overkill — static config, not runtime data |
| Baking SOUL/AGENT into image | Mounting via volume | Volumes break GitHub Actions Docker runner model — baking is the correct pattern |

**Installation:**
```bash
# No new packages required — all dependencies already present
```

## Architecture Patterns

### Recommended Project Structure
```
instances/
├── noah/
│   └── config/
│       ├── SOUL.md          # (existing) baked into event handler image
│       ├── AGENT.md         # (existing) baked into event handler image
│       ├── EVENT_HANDLER.md # (existing)
│       └── REPOS.json       # (NEW) allowed target repos for this instance
├── strategyES/
│   └── config/
│       └── REPOS.json       # (NEW) allowed target repos — StrategyES scope
templates/docker/job/
├── Dockerfile               # (MODIFY) add COPY /defaults/ lines
└── entrypoint.sh            # (MODIFY) fallback to /defaults/ for SOUL/AGENT
lib/
├── ai/tools.js              # (MODIFY) add target_repo param + resolver call
├── tools/create-job.js      # (MODIFY) accept targetRepo, write target.json sidecar
└── tools/repos.js           # (NEW) loadAllowedRepos(), resolveTargetRepo()
```

### Pattern 1: REPOS.json Structure
**What:** Per-instance static JSON config enumerating allowed target repos with metadata for natural language resolution.
**When to use:** Read once on process start (or per tool call — file is small), validated against at tool invocation time.
**Example:**
```json
{
  "repos": [
    {
      "owner": "ScalingEngine",
      "slug": "clawforge",
      "name": "ClawForge",
      "aliases": ["clawforge", "cf", "the bot"]
    },
    {
      "owner": "ScalingEngine",
      "slug": "neurostory",
      "name": "NeuroStory",
      "aliases": ["neurostory", "ns", "the app"]
    }
  ]
}
```

**Resolution algorithm (TOOL-02):**
```javascript
// lib/tools/repos.js
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../paths.js';

export function loadAllowedRepos() {
  const reposFile = path.join(PROJECT_ROOT, 'config', 'REPOS.json');
  try {
    return JSON.parse(fs.readFileSync(reposFile, 'utf8')).repos;
  } catch {
    return [];
  }
}

/**
 * Resolve a natural-language target repo name to a canonical { owner, slug } entry.
 * Returns null if not found or not allowed.
 */
export function resolveTargetRepo(input, repos) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  return repos.find(r =>
    r.slug.toLowerCase() === lower ||
    r.name.toLowerCase() === lower ||
    (r.aliases || []).some(a => a.toLowerCase() === lower)
  ) || null;
}
```

**Note on REPOS.json path:** Instances bake `config/REPOS.json` from `instances/{name}/config/REPOS.json` (same bake pattern as SOUL.md/AGENT.md in the Event Handler Dockerfile). At runtime in the event handler, `PROJECT_ROOT/config/REPOS.json` is the resolved path.

### Pattern 2: target.json Sidecar Write
**What:** After `job.md` is written to the clawforge job branch, write `target.json` at `logs/{jobId}/target.json` on the same branch. This gives `run-job.yml` (Phase 10) a place to read target repo metadata without parsing job.md.
**When to use:** Only when `targetRepo` is non-null. Absent = same-repo job.
**Example:**
```javascript
// Addition to lib/tools/create-job.js
if (targetRepo) {
  await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/contents/logs/${jobId}/target.json`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `job: ${jobId} — target ${targetRepo.slug}`,
      content: Buffer.from(JSON.stringify({
        owner: targetRepo.owner,
        slug: targetRepo.slug,
        repo_url: `https://github.com/${targetRepo.owner}/${targetRepo.slug}.git`,
      })).toString('base64'),
      branch: branch,
    }),
  });
}
```

**Critical:** The GitHub Contents API processes file creates sequentially on the same branch. Since `job.md` is written first and then `target.json`, both use the same `branch` parameter — no SHA coordination needed (GitHub handles it). This is already proven by the existing `job.md` write pattern.

### Pattern 3: SOUL/AGENT Bake Into Job Image
**What:** The job Docker image currently expects `/job/config/SOUL.md` and `/job/config/AGENT.md` (loaded by entrypoint.sh lines 87-93). For cross-repo jobs, `/job/` will be a foreign repo with no `config/` directory. Solution: bake defaults into the image at `/defaults/SOUL.md` and `/defaults/AGENT.md`, then fall back in entrypoint.
**When to use:** Always for cross-repo jobs; same-repo jobs continue to use `/job/config/` if present.

**Dockerfile change (templates/docker/job/Dockerfile):**
```dockerfile
# Bake per-instance config as fallback for cross-repo jobs
# (instance Dockerfiles extend this template — see Pattern 4)
RUN mkdir -p /defaults
COPY SOUL.md /defaults/SOUL.md
COPY AGENT.md /defaults/AGENT.md
```

**Entrypoint change (templates/docker/job/entrypoint.sh):**
```bash
# 7. Build system prompt from config files (with /defaults/ fallback)
SYSTEM_PROMPT=""
SOUL_FILE="/job/config/SOUL.md"
AGENT_FILE="/job/config/AGENT.md"

# Fall back to baked-in defaults when working in a foreign repo
[ ! -f "$SOUL_FILE" ]  && SOUL_FILE="/defaults/SOUL.md"
[ ! -f "$AGENT_FILE" ] && AGENT_FILE="/defaults/AGENT.md"

if [ -f "$SOUL_FILE" ]; then
    SYSTEM_PROMPT=$(cat "$SOUL_FILE")
    SYSTEM_PROMPT="${SYSTEM_PROMPT}\n\n"
fi
if [ -f "$AGENT_FILE" ]; then
    SYSTEM_PROMPT="${SYSTEM_PROMPT}$(cat "$AGENT_FILE")"
fi
```

### Pattern 4: Instance Job Dockerfile Extension
**What:** The `templates/docker/job/Dockerfile` is the base template. Instance-specific job Dockerfiles extend it by COPYing instance config files. Currently instances have Event Handler Dockerfiles; job image is shared. For EXEC-02, the job image must include instance-specific SOUL.md/AGENT.md.

**Current state:** There is ONE shared `templates/docker/job/Dockerfile` (used as template). Instance Dockerfiles (`instances/noah/Dockerfile`, `instances/strategyES/Dockerfile`) are for the **Event Handler**, not the job container.

**Decision needed for planner:** How should SOUL.md/AGENT.md reach the job image?

Option A (recommended): Add `COPY` statements to the shared job Dockerfile template that copy from a build-arg-specified path, and update `build-image.yml` to pass the correct instance config path. But this adds build-time coupling.

Option B (simpler, recommended): The job Dockerfile at build time has access to the entire repo. Copy SOUL.md and AGENT.md from the instance's config directory at build time using a build argument:
```dockerfile
ARG INSTANCE=noah
COPY instances/${INSTANCE}/config/SOUL.md /defaults/SOUL.md
COPY instances/${INSTANCE}/config/AGENT.md /defaults/AGENT.md
```

Option C (current practical path — most likely correct): Looking at `build-image.yml`, the current image is `scalingengine/clawforge:job-latest` (shared). For two instances with different SOUL/AGENT identities, they either share the job image or need separate job images. Given the existing architecture uses **one shared job image** for both instances, the SOUL/AGENT in `/defaults/` would be from whichever instance was last built.

**Resolution:** The current architecture has one shared job image. For Phase 9 (EXEC-02), the simplest correct implementation is: bake the **Noah/Archie** SOUL.md and AGENT.md into the shared job image. StrategyES is a separate concern — its AGENT.md describes the strategyes-lab scope. Since StrategyES cross-repo targeting is deferred (it only has one allowed repo), the shared image baking Noah's config is acceptable for now. The planner should note this architectural nuance and flag it as a known limitation.

**Alternatively:** Use a generic/neutral `/defaults/SOUL.md` and `/defaults/AGENT.md` in `templates/docker/job/` that describe "ClawForge autonomous agent" without instance-specific identity. This is the cleanest solution for a shared image.

### Anti-Patterns to Avoid
- **Passing REPOS.json content via environment variable:** Env vars in GitHub Actions are logged in plaintext if mishandled. Keep REPOS.json as a file in the image, not an env injection.
- **Writing target.json with hardcoded repo SHA:** The GitHub Contents API for file create does not require a SHA (only updates do). Do not add SHA fetching logic.
- **Fetching REPOS.json from GitHub API at runtime:** This would add latency and a network dependency to every tool call. Bake into the image, read from disk.
- **Modifying entrypoint.sh ONLY (without Dockerfile):** The SOUL/AGENT fallback in entrypoint requires the files to exist at `/defaults/` — both changes must be made together.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema validation on target_repo param | Custom validation function | Zod `.optional()` + `.refine()` | Already the project standard; errors surface cleanly to agent |
| JSON file loading with error handling | Try/catch with custom error types | Simple `try { JSON.parse(...) } catch { return [] }` | Consistent with existing patterns in the codebase (see `gsd-invocations.js`) |
| GitHub branch file creation | Custom multipart PUT | Existing `githubApi()` helper in `lib/tools/github.js` | Already handles auth, error propagation, and JSON headers |

**Key insight:** All required infrastructure is already built. Phase 9 is wiring existing components together, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Sequential GitHub API Writes to Same Branch
**What goes wrong:** Writing `job.md` then immediately writing `target.json` to the same branch can race if both writes use the same base SHA. The second write would fail with a "file already exists" or SHA conflict.
**Why it happens:** GitHub Contents API PUT for a new file needs no SHA; but if there's any timing issue, a second write immediately after the first might see stale state.
**How to avoid:** The existing `create-job.js` only writes `job.md`. `target.json` is a different path in the same directory — no conflict. Both are new file creates (not updates), so no SHA is needed. Verified: this is safe because they are at different paths.
**Warning signs:** 422 Unprocessable Entity from GitHub API on the second PUT.

### Pitfall 2: Zod v4 `.optional()` vs `.nullable()` Semantics
**What goes wrong:** In Zod v4 (installed as ^4.3.6), `z.string().optional()` means the field can be absent (`undefined`) but NOT `null`. Passing `null` from the agent would cause a validation error.
**Why it happens:** LLM may pass `null` explicitly when it means "no target repo".
**How to avoid:** Use `z.string().optional()` and in the tool handler treat both `undefined` and `null` as "no target repo": `const target = args.target_repo || null;`.
**Warning signs:** Zod validation error "Expected string, received null" in tool invocations.

### Pitfall 3: REPOS.json Path Resolution in Containerized Event Handler
**What goes wrong:** `lib/tools/repos.js` uses `PROJECT_ROOT` from `paths.js`, which is `process.cwd()`. In the event handler Docker container, `WORKDIR` is `/app`. The REPOS.json must be at `/app/config/REPOS.json` for the path to resolve correctly.
**Why it happens:** Event handler Dockerfiles copy `instances/{name}/config/SOUL.md` to `./config/SOUL.md` (i.e., `/app/config/SOUL.md`). REPOS.json must follow the same COPY pattern.
**How to avoid:** In both `instances/noah/Dockerfile` and `instances/strategyES/Dockerfile`, add: `COPY instances/noah/config/REPOS.json ./config/REPOS.json`.
**Warning signs:** `loadAllowedRepos()` returns `[]` in production because file not found.

### Pitfall 4: Agent Receives Unrecognized Target Repo
**What goes wrong:** Agent passes a target_repo value that resolves to null (typo, unallowed repo). If `createJob` is called with a null target, it silently falls back to same-repo behavior. The user thinks they're targeting a different repo but they're not.
**Why it happens:** Tool handler must validate the resolved target and return a clear error message to the agent.
**How to avoid:** In the `create_job` tool handler: if `target_repo` is provided but `resolveTargetRepo()` returns null, return `{ success: false, error: "Target repo not recognized or not in allowed list" }` without creating a job.
**Warning signs:** Silent fallback causing wrong-repo job creation.

### Pitfall 5: Shared Job Image With Instance-Specific Identity
**What goes wrong:** Baking Noah's SOUL.md into the shared job image means StrategyES's cross-repo jobs would claim to be "Archie" in their system prompt.
**Why it happens:** One shared job Docker image serves both instances.
**How to avoid:** Use a generic/neutral SOUL.md and AGENT.md in `templates/docker/job/` for the shared image. These describe "ClawForge autonomous agent" without naming a specific instance persona. Instance-specific identity lives in the Event Handler image (which is already instance-specific). Cross-repo job containers get a generic identity.
**Warning signs:** StrategyES job container logs showing "Archie" identity.

### Pitfall 6: gh auth setup-git PAT Exposure Audit
**What goes wrong:** Assumption that no PAT is in clone URLs. Must verify `REPO_URL` is clean.
**Why it happens:** The Actions workflow sets `REPO_URL="${{ github.server_url }}/${{ github.repository }}.git"` — this is `https://github.com/ScalingEngine/clawforge.git` with NO token. The PAT only flows via `SECRETS` JSON, which is exported as `GH_TOKEN` inside the container. `gh auth setup-git` uses this token for git credential resolution.
**How to avoid:** EXEC-04 is already satisfied by current implementation. The Phase 9 deliverable for EXEC-04 is: document this in a comment in entrypoint.sh and verify no new PAT interpolation is introduced.
**Warning signs:** Any `git clone https://${TOKEN}@...` pattern appearing in entrypoint.sh.

## Code Examples

Verified patterns from existing codebase:

### Existing create-job.js Pattern (to extend for target.json)
```javascript
// Source: lib/tools/create-job.js (current state)
// Step 3 creates job.md — target.json write follows same pattern at different path
await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/contents/logs/${jobId}/job.md`, {
  method: 'PUT',
  body: JSON.stringify({
    message: `job: ${jobId}`,
    content: Buffer.from(jobDescription).toString('base64'),
    branch: branch,
  }),
});
```

### Existing Tool Schema Pattern (to extend for target_repo)
```javascript
// Source: lib/ai/tools.js (current state)
// create_job tool schema — add target_repo below job_description
schema: z.object({
  job_description: z.string().describe('...'),
  // NEW:
  target_repo: z.string().optional().describe(
    'Optional: target repository slug (e.g., "neurostory"). ' +
    'Must match an entry in the allowed repos list. ' +
    'If omitted, job runs against the default clawforge repo.'
  ),
}),
```

### Existing SOUL.md Load Pattern (to add fallback)
```bash
# Source: templates/docker/job/entrypoint.sh lines 87-93 (current state)
# 7. Build system prompt from config files
SYSTEM_PROMPT=""
if [ -f "/job/config/SOUL.md" ]; then
    SYSTEM_PROMPT=$(cat /job/config/SOUL.md)
    SYSTEM_PROMPT="${SYSTEM_PROMPT}\n\n"
fi
if [ -f "/job/config/AGENT.md" ]; then
    SYSTEM_PROMPT="${SYSTEM_PROMPT}$(cat /job/config/AGENT.md)"
fi
```

### Existing Event Handler Dockerfile COPY Pattern (to replicate for REPOS.json)
```dockerfile
# Source: instances/noah/Dockerfile lines 38-40 (current state)
COPY instances/noah/config/SOUL.md ./config/SOUL.md
COPY instances/noah/config/EVENT_HANDLER.md ./config/EVENT_HANDLER.md
COPY instances/noah/config/AGENT.md ./config/AGENT.md
# NEW:
COPY instances/noah/config/REPOS.json ./config/REPOS.json
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SOUL/AGENT loaded only from /job/config/ | SOUL/AGENT with /defaults/ fallback | Phase 9 | Cross-repo jobs have system prompt |
| create_job has no target parameter | create_job accepts optional target_repo | Phase 9 | Agent can route to any allowed repo |
| No allowed repos config | REPOS.json per instance | Phase 9 | Security boundary for cross-repo targeting |

**Deprecated/outdated:**
- AGENT.md `## Git` section says "PR is created targeting the main branch" — this will become inaccurate for cross-repo jobs (Phase 10). Phase 9 does not need to update this; Phase 10 can update it.

## Open Questions

1. **Generic vs instance-specific SOUL/AGENT in shared job image**
   - What we know: One shared `scalingengine/clawforge:job-latest` image; two instances with different identities
   - What's unclear: Should the job image have Noah's identity (Archie) or a generic ClawForge agent identity?
   - Recommendation: Create a generic `templates/docker/job/defaults/SOUL.md` and `AGENT.md` that describe "ClawForge" without instance persona. This is the safest choice for the shared image.

2. **StrategyES REPOS.json content**
   - What we know: STATE.md flags this as a blocker — "StrategyES instance REPOS.json content needs operator confirmation before Phase 9 ships"
   - What's unclear: Which repos is StrategyES/Jim allowed to target?
   - Recommendation: Stub `instances/strategyES/config/REPOS.json` with only `strategyes-lab` (its own repo). Add a comment in .env.example for operator to extend. The blocker is about production content, not code — code can ship with a safe stub.

3. **REPOS.json load timing: startup vs per-call**
   - What we know: File is small, static config, changes require container rebuild
   - What's unclear: Should `loadAllowedRepos()` be called once at agent initialization or on every tool call?
   - Recommendation: Call on every tool invocation (inside the tool handler). File is <1KB, read is trivially fast, and this avoids stale config if file is somehow updated mid-run. No caching needed.

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `lib/ai/tools.js`, `lib/tools/create-job.js`, `lib/tools/github.js`, `templates/docker/job/entrypoint.sh`, `templates/docker/job/Dockerfile` — authoritative current state
- Direct codebase read: `instances/noah/Dockerfile`, `instances/strategyES/Dockerfile` — instance build patterns
- Direct codebase read: `lib/paths.js` — PROJECT_ROOT path resolution pattern
- GitHub REST API docs (from project usage): Contents API PUT pattern already in use in create-job.js

### Secondary (MEDIUM confidence)
- Zod v4 `.optional()` semantics — package.json confirms `zod: ^4.3.6`; Zod v4 optional behavior (undefined not null) is a known Zod v3→v4 semantic

### Tertiary (LOW confidence)
- None — all claims are based on direct codebase inspection or well-established library behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all analysis is from existing code
- Architecture: HIGH — all patterns derived from direct codebase inspection
- Pitfalls: HIGH — pitfalls 1-4 derived from actual code; pitfall 5-6 are architectural observations with HIGH basis

**Research date:** 2026-02-25
**Valid until:** 2026-04-25 (stable — no fast-moving dependencies)
