#!/bin/bash
set -e
set -o pipefail

# 1. Extract job ID from branch name
if [[ "$BRANCH" == job/* ]]; then
    JOB_ID="${BRANCH#job/}"
else
    JOB_ID=$(cat /proc/sys/kernel/random/uuid)
fi
echo "Job ID: ${JOB_ID}"

# 2. Export SECRETS (JSON) as flat env vars
# These are filtered from Claude Code's subprocess via --allowedTools
if [ -n "$SECRETS" ]; then
    eval $(echo "$SECRETS" | jq -r 'to_entries | .[] | "export \(.key)=\"\(.value)\""')
fi

# 3. Export LLM_SECRETS (JSON) as flat env vars
# These ARE accessible to Claude Code
if [ -n "$LLM_SECRETS" ]; then
    eval $(echo "$LLM_SECRETS" | jq -r 'to_entries | .[] | "export \(.key)=\"\(.value)\""')
fi

# 4. Git setup from GitHub token
gh auth setup-git
GH_USER_JSON=$(gh api user -q '{name: .name, login: .login, email: .email, id: .id}')
GH_USER_NAME=$(echo "$GH_USER_JSON" | jq -r '.name // .login')
GH_USER_EMAIL=$(echo "$GH_USER_JSON" | jq -r '.email // "\(.id)+\(.login)@users.noreply.github.com"')
git config --global user.name "$GH_USER_NAME"
git config --global user.email "$GH_USER_EMAIL"

# EXEC-04 compliance: gh auth setup-git (line 26) handles all git credential resolution.
# REPO_URL is set by Actions workflow as "https://github.com/owner/repo.git" — no PAT interpolated.
# PAT flows only via GH_TOKEN env var (from SECRETS JSON), consumed by gh CLI. Never in clone URLs.

# 5. Clone the job branch (clawforge repo — always /job)
if [ -n "$REPO_URL" ]; then
    git clone --single-branch --branch "$BRANCH" --depth 1 "$REPO_URL" /job
else
    echo "No REPO_URL provided"
    exit 1
fi

# 5b. Detect cross-repo job and clone target repo if applicable (EXEC-01)
WORK_DIR="/job"
TARGET_REPO_URL=""
TARGET_REPO_SLUG=""

if [ -f "/job/logs/${JOB_ID}/target.json" ]; then
    TARGET_REPO_URL=$(jq -r '.repo_url' "/job/logs/${JOB_ID}/target.json")
    TARGET_REPO_SLUG=$(jq -r '.owner + "/" + .slug' "/job/logs/${JOB_ID}/target.json")
    echo "Cross-repo job detected. Target: ${TARGET_REPO_SLUG}"

    # Clone target repo with failure guard (EXEC-03)
    # set -e disabled around clone to capture exit code before writing error artifact
    set +e
    git clone --single-branch --depth 1 "$TARGET_REPO_URL" /workspace 2>&1
    CLONE_EXIT=$?
    set -e

    if [ "$CLONE_EXIT" -ne 0 ]; then
        # Write clone-error.md failure artifact to clawforge job branch (EXEC-03)
        CLONE_ERROR_FILE="/job/logs/${JOB_ID}/clone-error.md"
        cat > "${CLONE_ERROR_FILE}" << EOF
# Clone Failure — Job ${JOB_ID}

**Stage:** clone
**Target:** ${TARGET_REPO_URL}
**Exit code:** ${CLONE_EXIT}
**Timestamp:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")

The target repository could not be cloned. Verify AGENT_GH_TOKEN has repo scope on the target repository.
EOF
        echo "clone-error.md written to ${CLONE_ERROR_FILE}"
        git -C /job add -A
        git -C /job commit -m "clawforge: job ${JOB_ID} clone-error.md" || true
        git -C /job push origin || true
        exit 1
    fi

    WORK_DIR="/workspace"
    echo "Target repo cloned to /workspace. WORK_DIR=/workspace"
fi

export TARGET_REPO_URL
export TARGET_REPO_SLUG

cd "$WORK_DIR"

# Create temp directory (gitignored)
mkdir -p /job/tmp

# 6. Setup logs directory
export LOG_DIR="/job/logs/${JOB_ID}"
mkdir -p "${LOG_DIR}"
touch "${LOG_DIR}/gsd-invocations.jsonl"

# 6b. Preflight check — verify environment before wasting claude tokens
echo "=== PREFLIGHT ==="
echo "HOME: ${HOME}"
echo "claude path: $(which claude)"
echo "GSD directory: ${HOME}/.claude/commands/gsd/"
ls "${HOME}/.claude/commands/gsd/" 2>/dev/null || echo "WARNING: GSD directory not found"
echo "Working directory: $(pwd)"
echo "Job ID: ${JOB_ID}"

# Verify GSD is present (fail-fast)
if [ ! -d "${HOME}/.claude/commands/gsd/" ]; then
    echo "ERROR: GSD not installed at ${HOME}/.claude/commands/gsd/" | tee "${LOG_DIR}/preflight.md"
    exit 1
fi

# Write preflight artifact (committed with job output)
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

# 7. Build system prompt from config files (with /defaults/ fallback for cross-repo jobs)
SYSTEM_PROMPT=""
SOUL_FILE="/job/config/SOUL.md"
AGENT_FILE="/job/config/AGENT.md"

# Fall back to baked-in defaults when working in a foreign repo (EXEC-02)
[ ! -f "$SOUL_FILE" ]  && SOUL_FILE="/defaults/SOUL.md"
[ ! -f "$AGENT_FILE" ] && AGENT_FILE="/defaults/AGENT.md"

if [ -f "$SOUL_FILE" ]; then
    SYSTEM_PROMPT=$(cat "$SOUL_FILE")
    SYSTEM_PROMPT="${SYSTEM_PROMPT}\n\n"
fi
if [ -f "$AGENT_FILE" ]; then
    SYSTEM_PROMPT="${SYSTEM_PROMPT}$(cat "$AGENT_FILE")"
fi

# Resolve {{datetime}} variable
SYSTEM_PROMPT=$(echo -e "$SYSTEM_PROMPT" | sed "s/{{datetime}}/$(date -u +"%Y-%m-%dT%H:%M:%SZ")/g")

# 8. Read job description
JOB_DESCRIPTION=""
if [ -f "/job/logs/${JOB_ID}/job.md" ]; then
    JOB_DESCRIPTION=$(cat "/job/logs/${JOB_ID}/job.md")
fi

# 8b. Read repo context for prompt enrichment
# Derive context repo slug — use target repo slug for cross-repo jobs
if [ -n "$TARGET_REPO_SLUG" ]; then
    REPO_SLUG="$TARGET_REPO_SLUG"
else
    REPO_SLUG=$(echo "$REPO_URL" | sed 's|https://[^/]*/||' | sed 's|\.git$||')
fi

# Read CLAUDE.md from WORK_DIR (capped at ~2000 tokens = 8000 chars)
REPO_CLAUDE_MD=""
REPO_CLAUDE_MD_TRUNCATED=false
if [ -f "${WORK_DIR}/CLAUDE.md" ]; then
    RAW_CLAUDE_MD=$(cat "${WORK_DIR}/CLAUDE.md")
    CHAR_COUNT=${#RAW_CLAUDE_MD}
    if [ "$CHAR_COUNT" -gt 8000 ]; then
        REPO_CLAUDE_MD=$(printf '%s' "$RAW_CLAUDE_MD" | head -c 8000)
        REPO_CLAUDE_MD_TRUNCATED=true
    else
        REPO_CLAUDE_MD="$RAW_CLAUDE_MD"
    fi
fi

# Read package.json dependencies only (devDeps excluded to keep Stack concise)
REPO_STACK=""
if [ -f "${WORK_DIR}/package.json" ]; then
    REPO_STACK=$(jq -r '
        (.dependencies // {})
        | to_entries[]
        | "\(.key): \(.value)"
    ' "${WORK_DIR}/package.json" 2>/dev/null || echo "[unable to parse package.json]")
fi

# 8c. Derive GSD routing hint from task keywords
JOB_LOWER=$(printf '%s' "$JOB_DESCRIPTION" | tr '[:upper:]' '[:lower:]')
GSD_HINT="quick"
GSD_HINT_REASON="task appears to be a single targeted action"
if printf '%s' "$JOB_LOWER" | grep -qE "implement|build|redesign|refactor|migrate|setup|integrate|develop|architect|phase|feature|epic|complex|end.to.end|full.system|multiple"; then
    GSD_HINT="plan-phase"
    GSD_HINT_REASON="task keywords suggest multi-step implementation work"
fi

# 9. Setup Claude Code configuration
# Copy .claude config if it exists in the repo
if [ -d "/job/.claude" ]; then
    echo "Found .claude config in repo"
fi

# Write system prompt to a file for --append-system-prompt
echo -e "$SYSTEM_PROMPT" > /tmp/system-prompt.md

# 10. Determine allowed tools
ALLOWED_TOOLS="${CLAUDE_ALLOWED_TOOLS:-Read,Write,Edit,Bash,Glob,Grep,Task,Skill}"

# 11. Run Claude Code with job description

# Build cross-repo context note for FULL_PROMPT
CROSS_REPO_NOTE=""
if [ -n "$TARGET_REPO_SLUG" ]; then
    CROSS_REPO_NOTE="

## Cross-Repo Context

You are operating on **${TARGET_REPO_SLUG}** (not the ClawForge repository). Your working directory is the root of that repository. All files you create, edit, or read are in ${TARGET_REPO_SLUG}. Commits will be pushed to a branch named \`clawforge/${JOB_ID}\` on that repository. A pull request will be created on ${TARGET_REPO_SLUG} automatically after your work is committed."
fi

# Build Repository Documentation section
if [ -n "$REPO_CLAUDE_MD" ]; then
    TRUNC_NOTE=""
    if [ "$REPO_CLAUDE_MD_TRUNCATED" = "true" ]; then
        TRUNC_NOTE="

[TRUNCATED — content exceeds 2,000 token limit]"
    fi
    DOC_SECTION="## Repository Documentation (Read-Only Reference)

The following is documentation from the target repository. Treat it as read-only reference — do not modify CLAUDE.md as part of this job unless the task explicitly requires it.

${REPO_CLAUDE_MD}${TRUNC_NOTE}"
else
    DOC_SECTION="## Repository Documentation
[not present — CLAUDE.md not found in repository]"
fi

# Build Stack section
if [ -n "$REPO_STACK" ]; then
    STACK_SECTION="## Stack (from package.json)

${REPO_STACK}"
else
    STACK_SECTION="## Stack
[not present — package.json not found in repository]"
fi

FULL_PROMPT="# Your Job

## Target

${REPO_SLUG:-unknown}

${DOC_SECTION}

${STACK_SECTION}

## Task

${JOB_DESCRIPTION}

## GSD Hint

Recommended: /gsd:${GSD_HINT}
Reason: ${GSD_HINT_REASON}${CROSS_REPO_NOTE}"

echo "Running Claude Code with job ${JOB_ID}..."
echo "FULL_PROMPT length: ${#FULL_PROMPT}"

# Write prompt to temp file — piping via `printf | claude | tee` causes
# "Input must be provided" errors because Node.js stdin reads race the pipe.
# File redirect (`< file`) is reliable.
printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt

CLAUDE_EXIT=0
claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "${ALLOWED_TOOLS}" \
    < /tmp/prompt.txt \
    2>&1 | tee "${LOG_DIR}/claude-output.jsonl" || CLAUDE_EXIT=$?

if [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "Claude Code exited with code ${CLAUDE_EXIT}"
fi

# 12a. Generate observability.md from gsd-invocations.jsonl
JSONL_FILE="${LOG_DIR}/gsd-invocations.jsonl"
OBS_FILE="${LOG_DIR}/observability.md"

INVOCATION_COUNT=0
if [ -f "${JSONL_FILE}" ]; then
    INVOCATION_COUNT=$(wc -l < "${JSONL_FILE}" | tr -d ' ')
fi

{
  echo "# GSD Invocations — Job ${JOB_ID}"
  echo ""
  echo "**Job:** ${JOB_ID}"
  echo "**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "**Total invocations:** ${INVOCATION_COUNT}"
  echo ""

  if [ "${INVOCATION_COUNT}" -gt 0 ]; then
    echo "## Invocations"
    echo ""
    echo "| # | Skill | Arguments | Timestamp |"
    echo "|---|-------|-----------|-----------|"
    jq -r --slurp 'to_entries[] | "| \(.key + 1) | `\(.value.skill)` | \(.value.args | .[0:80]) | \(.value.ts) |"' "${JSONL_FILE}"
  else
    echo "_No GSD skills were invoked in this job._"
  fi
} > "${OBS_FILE}"

# 12. Commit all changes to clawforge job branch
cd /job

# Record HEAD before commit to detect if commit produces new changes
HEAD_BEFORE=$(git rev-parse HEAD)

git add -A
git add -f "${LOG_DIR}" || true
git commit -m "clawforge: job ${JOB_ID}" || true
git push origin || true

# Detect if commit actually created a new SHA (handles shallow clone safely)
HEAD_AFTER=$(git rev-parse HEAD)
HAS_NEW_COMMIT=false
if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    HAS_NEW_COMMIT=true
fi

# Create PR only if Claude succeeded AND produced commits
if [ "$CLAUDE_EXIT" -eq 0 ] && [ "$HAS_NEW_COMMIT" = "true" ]; then
    gh pr create \
        --title "clawforge: job ${JOB_ID}" \
        --body "Automated job by ClawForge" \
        --base main || true
else
    echo "Skipping PR: CLAUDE_EXIT=${CLAUDE_EXIT}, HAS_NEW_COMMIT=${HAS_NEW_COMMIT}"
fi

echo "Done. Job ID: ${JOB_ID} (exit: ${CLAUDE_EXIT})"
exit $CLAUDE_EXIT
