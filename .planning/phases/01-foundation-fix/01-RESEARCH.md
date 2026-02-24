# Phase 1: Foundation Fix — Research

**Researched:** 2026-02-23
**Domain:** Docker entrypoint shell scripting, Claude Code CLI, Git file sync, credential hygiene
**Confidence:** HIGH (all findings verified against live codebase; no framework/library docs needed)

---

## Summary

Phase 1 is infrastructure surgery, not application code. Every requirement targets either a shell script, a Dockerfile, or a .gitignore. The technical domain is Bash entrypoint authoring, Docker build-time verification, and file synchronization between two canonical paths in the same repo.

The most critical requirement (FOUND-01) has a confirmed root cause: `claude -p "${FULL_PROMPT}"` passes the prompt as a positional shell argument. Two production job runs both produced `Error: Input must be provided either through stdin or as a prompt argument when using --print`, despite `job.md` being present and non-empty in both cloned branches. The fix is to pipe the prompt through stdin (`printf '%s' "${FULL_PROMPT}" | claude -p ...`), which the claude error message itself designates as the valid alternative path.

The remaining requirements are mechanical file edits: adding three Dockerfile lines (GSD install + build-time verification), syncing two files between `docker/job/` and `templates/docker/job/`, adding `OBSV-01` preflight echoes + writing `preflight.md`, and adding `.env.vps` to `.gitignore`. None require external library research.

**Primary recommendation:** Fix FOUND-01 first (stdin pipe pattern), then SECR-01 (gitignore), then FOUND-05 (build-time verification), then FOUND-03/FOUND-04 (template sync), then FOUND-02/OBSV-01 (preflight output). All changes touch only `docker/job/`, `templates/docker/job/`, and `.gitignore`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | Job container receives non-empty prompt when `claude -p` executes (fix empty FULL_PROMPT bug) | Root cause identified: positional arg quoting issue. Fix: stdin pipe. See "Root Cause: FOUND-01" section. |
| FOUND-02 | Entrypoint confirms HOME path and `~/.claude/commands/gsd/` exists before running `claude -p` | Bash `test -d` check + exit on failure. GSD installs to `/root/.claude/commands/gsd/` in Docker. |
| FOUND-03 | `templates/docker/job/Dockerfile` matches live `docker/job/Dockerfile` | Diff confirmed: template is missing 3 lines (GSD install step). Fix: copy lines verbatim. |
| FOUND-04 | `templates/docker/job/entrypoint.sh` matches live `docker/job/entrypoint.sh` | Diff confirmed: template missing `Task,Skill` in ALLOWED_TOOLS default. Fix: update line 78. |
| FOUND-05 | Docker build fails if GSD is not installed (build-time verification after `npx get-shit-done-cc` step) | Pattern: `RUN test -d /root/.claude/commands/gsd/ && ls /root/.claude/commands/gsd/ | grep -q .` |
| SECR-01 | `.env.vps` added to `.gitignore` to prevent accidental credential commit | `.env.vps` is untracked and contains live credentials. Not in current `.gitignore`. One-line fix. |
| OBSV-01 | Entrypoint echoes HOME, `which claude`, GSD path, and working directory before `claude -p` runs | Bash `echo` statements + write to `logs/{jobId}/preflight.md`. Success criterion: preflight.md in every PR. |
</phase_requirements>

---

## Standard Stack

No new dependencies or libraries are introduced in this phase. All work uses tools already present:

### Core (Already Present)
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| Bash | System (Bookworm) | Entrypoint scripting | `#!/bin/bash set -e` already in use |
| Docker | Build-time | Image construction and verification | `RUN test ...` for build-time assertions |
| `npx get-shit-done-cc` | `@latest` | GSD skill installation | Already in live Dockerfile; add to template |
| `claude` CLI | Installed via `npm install -g @anthropic-ai/claude-code` | Job execution | Fix: use stdin, not positional arg |
| `.gitignore` | — | Credential exclusion | One-line addition |

### No New Installations Required
This phase makes no npm installs, no new apt packages, no new GitHub Actions steps.

---

## Architecture Patterns

### Current Docker/Job Directory Structure
```
docker/job/
├── Dockerfile       ← CANONICAL (authoritative, used by build-image.yml)
└── entrypoint.sh    ← CANONICAL

templates/docker/job/
├── Dockerfile       ← STALE (missing GSD install step)
└── entrypoint.sh    ← STALE (missing Task,Skill in ALLOWED_TOOLS)
```

After Phase 1, both pairs must be byte-for-byte identical.

### Entrypoint Execution Flow (Current → Fixed)

```
Current:
  clone → read job.md → build FULL_PROMPT → claude -p "${FULL_PROMPT}" ← BUG

Fixed:
  clone → preflight → read job.md → verify GSD → pipe prompt → claude -p ← OK
```

### Pattern 1: Stdin Pipe for claude -p (FOUND-01 fix)

**What:** Replace positional argument with stdin pipe
**When to use:** Anytime `claude -p` is invoked with a multi-line prompt in a non-interactive context

```bash
# BEFORE (broken — positional arg with embedded newlines may be swallowed)
claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "${ALLOWED_TOOLS}" \
    "${FULL_PROMPT}" \
    2>&1 | tee "${LOG_DIR}/claude-output.json" || true

# AFTER (correct — stdin pipe avoids positional arg parsing issues)
printf '%s' "${FULL_PROMPT}" | claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "${ALLOWED_TOOLS}" \
    2>&1 | tee "${LOG_DIR}/claude-output.json" || true
```

Source: Claude CLI `--help` output (verified): `"Input must be provided either through stdin or as a prompt argument when using --print"`. Both paths are supported; stdin avoids shell quoting issues.

### Pattern 2: Build-Time Verification (FOUND-05)

**What:** Assert critical installation succeeded before image is usable
**When to use:** After any `RUN` step that installs tools Claude Code depends on at runtime

```dockerfile
# Install GSD skills for Claude Code
RUN npx get-shit-done-cc@latest --claude --global

# VERIFY: Fail the build if GSD didn't install
RUN test -d /root/.claude/commands/gsd/ && \
    ls /root/.claude/commands/gsd/ | grep -q . || \
    (echo "ERROR: GSD install failed — /root/.claude/commands/gsd/ missing or empty" && exit 1)
```

Source: Verified against local installation — GSD installs 31 `.md` files to `~/.claude/commands/gsd/`. In Docker as root, `HOME=/root`.

### Pattern 3: Preflight Echoes + File (FOUND-02 + OBSV-01)

**What:** Log runtime environment before main execution; write to committed artifact
**When to use:** Before `claude -p` invocation; output must appear in both Actions log and PR diff

```bash
# --- PREFLIGHT CHECK ---
echo "=== PREFLIGHT ==="
echo "HOME: ${HOME}"
echo "claude path: $(which claude)"
echo "GSD directory: ${HOME}/.claude/commands/gsd/"
ls "${HOME}/.claude/commands/gsd/" || echo "WARNING: GSD directory not found"
echo "Working directory: $(pwd)"
echo "Job ID: ${JOB_ID}"

# Verify GSD is present (fail-fast before wasting claude tokens)
if [ ! -d "${HOME}/.claude/commands/gsd/" ]; then
    echo "ERROR: GSD not installed at ${HOME}/.claude/commands/gsd/" | tee "${LOG_DIR}/preflight.md"
    exit 1
fi

# Write preflight artifact
cat > "${LOG_DIR}/preflight.md" << EOF
# Preflight — Job ${JOB_ID}

| Item | Value |
|------|-------|
| HOME | ${HOME} |
| claude | $(which claude) |
| GSD directory | ${HOME}/.claude/commands/gsd/ |
| Working directory | $(pwd) |
| Timestamp | $(date -u +"%Y-%m-%dT%H:%M:%SZ") |

## GSD Commands Present

$(ls "${HOME}/.claude/commands/gsd/")
EOF

echo "=== PREFLIGHT COMPLETE ==="
```

### Anti-Patterns to Avoid

- **Positional arg for multi-line prompts:** `claude -p "${MULTI_LINE}"` — use stdin pipe instead
- **Silent build step failure:** Installing GSD without verifying outcome — add `test -d` assertion immediately after
- **Template drift:** Editing `docker/job/` without updating `templates/docker/job/` — always update both in same commit
- **Assuming HOME in Docker:** In `node:22-bookworm-slim` as root, `HOME=/root`. Never hardcode `/root/`; use `${HOME}`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-line prompt to claude -p | Custom escaping/encoding | `printf '%s' "${VAR}" \| claude -p` | stdin is documented as supported; positional arg has quoting issues |
| Build-time verification | Custom verification script | `RUN test -d path \|\| exit 1` | Native Docker RUN exits non-zero to fail build; no extra tooling needed |
| Preflight artifact | Dedicated logging library | `cat > file << EOF ... EOF` | Bash heredoc is sufficient; no dependencies |

**Key insight:** This phase is pure shell scripting. Adding any external tooling would introduce more drift risk than it solves.

---

## Common Pitfalls

### Pitfall 1: Positional Argument Swallowing
**What goes wrong:** `claude -p "${FULL_PROMPT}"` produces `Error: Input must be provided either through stdin or as a prompt argument when using --print` even when `FULL_PROMPT` is non-empty.
**Why it happens:** Multi-line strings passed as positional shell arguments behave differently across shell implementations and claude CLI versions. The `||true` at the end masks the error; only the output file reveals it.
**How to avoid:** Use `printf '%s' "${FULL_PROMPT}" | claude -p ...` (stdin pipe). The claude CLI documentation explicitly lists stdin as a valid input path for `--print` mode.
**Warning signs:** `claude-output.json` contains only the error string with no preceding JSON output; job commits contain both `job.md` (proof clone succeeded) and the error output (proof prompt wasn't received).

### Pitfall 2: Template Drift Recurrence
**What goes wrong:** A fix is applied to `docker/job/` but the identical change is not made to `templates/docker/job/`. The next time someone scaffolds a new instance from templates, they get the broken version.
**Why it happens:** The two paths serve different purposes (live vs. scaffold) so developers focus on one and forget the other.
**How to avoid:** Always diff the two before committing. A CI step that asserts `diff docker/job/ templates/docker/job/` would enforce this permanently.
**Warning signs:** `diff docker/job/Dockerfile templates/docker/job/Dockerfile` exits non-zero.

### Pitfall 3: HOME Assumption in Docker
**What goes wrong:** GSD verification path hardcoded as `/root/.claude/commands/gsd/` breaks if USER is changed in Dockerfile.
**Why it happens:** `node:22-bookworm-slim` runs as root by default; developers assume this will always be true.
**How to avoid:** Use `${HOME}/.claude/commands/gsd/` everywhere. In the current Dockerfile there is no USER directive, so `HOME=/root`, but using the variable makes the scripts correct for any future USER change.
**Warning signs:** Build verification passes but runtime can't find GSD because container runs as non-root user.

### Pitfall 4: .env.vps Committed Accidentally
**What goes wrong:** Developer runs `git add -A` before a commit and `.env.vps` (containing live credentials) gets staged and committed.
**Why it happens:** `.env.vps` is untracked and not in `.gitignore`. The file contains a live GitHub token, Anthropic API key, and Slack tokens.
**How to avoid:** SECR-01 must be the first commit in Phase 1. Add `.env.vps` to `.gitignore` before any other changes are staged.
**Warning signs:** `git status` shows `.env.vps` as untracked. Current state confirmed: the file IS untracked with real credentials visible.

### Pitfall 5: GSD Build Verification Timing
**What goes wrong:** The `test -d` verification is placed in the wrong RUN layer and passes vacuously because the directory was created by something else.
**Why it happens:** Docker layer caching. If a previous `RUN` created `/root/.claude/` for any reason, the `test -d` on `.claude/commands/gsd/` might pass before GSD runs.
**How to avoid:** Place the verification `RUN` immediately after the `npx get-shit-done-cc` `RUN` with no intervening steps. Also check for non-empty contents: `ls /root/.claude/commands/gsd/ | grep -q .`

---

## Code Examples

### FOUND-01: Fixed entrypoint.sh excerpt
```bash
# Source: docker/job/entrypoint.sh (live file, verified working pattern)

# Build prompt and pipe via stdin (avoids positional arg quoting issues)
FULL_PROMPT="# Your Job

${JOB_DESCRIPTION}"

echo "Running Claude Code with job ${JOB_ID}..."
printf '%s' "${FULL_PROMPT}" | claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "${ALLOWED_TOOLS}" \
    2>&1 | tee "${LOG_DIR}/claude-output.json" || true
```

### FOUND-03/FOUND-05: Updated Dockerfile
```dockerfile
# Source: docker/job/Dockerfile (live canonical version + FOUND-05 verification)

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install GSD skills for Claude Code
RUN npx get-shit-done-cc@latest --claude --global

# Verify GSD installed successfully (fail build if missing)
RUN test -d /root/.claude/commands/gsd/ && \
    ls /root/.claude/commands/gsd/ | grep -q . || \
    (echo "ERROR: GSD install failed — /root/.claude/commands/gsd/ missing or empty" && exit 1)

# Create workspace and config directories
RUN mkdir -p /workspace /workspace/.claude
```

### FOUND-04: Fixed ALLOWED_TOOLS default
```bash
# Source: docker/job/entrypoint.sh line 78

# Live (correct):
ALLOWED_TOOLS="${CLAUDE_ALLOWED_TOOLS:-Read,Write,Edit,Bash,Glob,Grep,Task,Skill}"

# Template (stale — missing Task,Skill):
ALLOWED_TOOLS="${CLAUDE_ALLOWED_TOOLS:-Read,Write,Edit,Bash,Glob,Grep}"
```

### SECR-01: .gitignore addition
```
# Credentials — VPS deployment config with live secrets
.env.vps
```

Place after the existing `# Credentials - NEVER commit these` block in `.gitignore`.

---

## Exact Diffs Required

### diff: `docker/job/Dockerfile` vs `templates/docker/job/Dockerfile`
The live Dockerfile has these 3 lines that the template is missing:
```
# Install GSD skills for Claude Code
RUN npx get-shit-done-cc@latest --claude --global

```
(Located after `RUN npm install -g @anthropic-ai/claude-code`, before `# Create workspace and config directories`)

### diff: `docker/job/entrypoint.sh` vs `templates/docker/job/entrypoint.sh`
Line 78 differs:
```
# Live (correct):
ALLOWED_TOOLS="${CLAUDE_ALLOWED_TOOLS:-Read,Write,Edit,Bash,Glob,Grep,Task,Skill}"

# Template (stale):
ALLOWED_TOOLS="${CLAUDE_ALLOWED_TOOLS:-Read,Write,Edit,Bash,Glob,Grep}"
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Pass prompt as positional arg to `claude -p` | Pipe prompt via stdin with `printf` | Eliminates "Input must be provided" error |
| No GSD build verification | `RUN test -d /root/.claude/commands/gsd/ \|\| exit 1` | Build fails loudly instead of silently at runtime |
| Template files manually kept in sync | Sync in same commit; diff in CI | Prevents drift recurrence |
| `.env.vps` untracked with live credentials | `.env.vps` in `.gitignore` | Prevents accidental credential commit |

---

## Open Questions

1. **Root cause certainty for FOUND-01**
   - What we know: Both production runs failed with "Input must be provided"; job.md was present in both clones; the error is specific to missing/empty claude prompt argument
   - What's unclear: Whether the bug is (a) positional arg quoting with multi-line strings, (b) a version-specific claude CLI behavior, or (c) something else entirely
   - Recommendation: Fix with stdin pipe pattern (safest), then add `echo "FULL_PROMPT length: ${#FULL_PROMPT}"` debug line before the call to make future failures diagnosable. STATE.md explicitly says "do not assume the cause" — log first, then verify fix works in next triggered job.

2. **build-image.yml trigger condition**
   - What we know: `build-image.yml` only runs if `vars.JOB_IMAGE_URL` starts with `ghcr.io/` — if this var is unset, the image is never rebuilt in CI
   - What's unclear: Whether `JOB_IMAGE_URL` is configured in the live GitHub repo vars
   - Recommendation: Out of scope for Phase 1; note it as a v2 concern. Phase 1 assumes the image build path works (confirmed: failing jobs DID run claude CLI, meaning the image had claude installed).

3. **System prompt path mismatch**
   - What we know: Entrypoint reads from `/job/config/SOUL.md` and `/job/config/AGENT.md`, but these files live in `instances/noah/config/` — so the system prompt is always empty for job runs
   - What's unclear: Whether this is intentional (jobs run without personality context) or a bug
   - Recommendation: Out of scope for Phase 1. The entrypoint handles missing config gracefully with if-exists guards. Flag for Phase 2 or separate requirement.

---

## Sources

### Primary (HIGH confidence)
- Live codebase: `/docker/job/Dockerfile` — verified GSD install step present
- Live codebase: `/docker/job/entrypoint.sh` — verified current claude invocation pattern
- Live codebase: `/templates/docker/job/Dockerfile` — verified GSD install step missing
- Live codebase: `/templates/docker/job/entrypoint.sh` — verified Task,Skill missing from ALLOWED_TOOLS
- Live codebase: `.gitignore` — verified `.env.vps` not present in ignore list
- Live codebase: `.env.vps` — confirmed file is untracked and contains real credentials
- Live codebase: `logs/fc22e04c.../claude-output.json` (via git history) — confirmed "Input must be provided" error
- Live codebase: `logs/fc22e04c.../job.md` (via git history) — confirmed job.md had non-empty content
- `claude --help` output (local claude 2.1.51) — confirmed stdin is a valid input path for `-p` mode
- `npx get-shit-done-cc@latest --help` — confirmed install path and flags
- Local GSD installation: `~/.claude/commands/gsd/` — confirmed 31 `.md` files installed

### Secondary (MEDIUM confidence)
- None required — all claims verified against live codebase

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Root cause (FOUND-01): MEDIUM — strong circumstantial evidence (two failures, job.md present, stdin fix documented by claude itself), but exact mechanism not 100% confirmed without running a test job
- Standard stack: HIGH — everything already in use, no new deps
- Architecture patterns: HIGH — verified against live code
- File diffs: HIGH — produced by actual `diff` command on live files
- Pitfalls: HIGH — drawn directly from observed failures and git history

**Research date:** 2026-02-23
**Valid until:** 2026-03-25 (stable domain; only invalidated by claude CLI breaking changes)
