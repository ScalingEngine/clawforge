#!/bin/bash
# tests/test-entrypoint.sh — bypass entrypoint for local Docker testing
# Replicates production entrypoint steps 6-12a without git clone/push/PR.
# Mounted into container by test-job.sh via bind mount.
set -e

# Job ID from env or default
JOB_ID="${TEST_JOB_ID:-test-$(date +%s)}"
echo "Job ID: ${JOB_ID}"

# Step 6: Setup output directory and export LOG_DIR BEFORE claude runs
# (Pitfall 2: LOG_DIR must be exported before claude -p so the PostToolUse hook can read it)
export LOG_DIR="/output"
mkdir -p "${LOG_DIR}"

# Baseline JSONL file so hook always has a target (same as production)
touch "${LOG_DIR}/gsd-invocations.jsonl"

# Preflight check (same as production)
echo "=== PREFLIGHT ==="
echo "HOME: ${HOME}"
echo "claude path: $(which claude)"
echo "GSD directory: ${HOME}/.claude/commands/gsd/"
ls "${HOME}/.claude/commands/gsd/" 2>/dev/null || echo "WARNING: GSD directory not found"
echo "Working directory: $(pwd)"
echo "Job ID: ${JOB_ID}"
echo "LOG_DIR: ${LOG_DIR}"

# Verify GSD is present (fail-fast)
if [ ! -d "${HOME}/.claude/commands/gsd/" ]; then
    echo "ERROR: GSD not installed at ${HOME}/.claude/commands/gsd/"
    exit 1
fi

echo "=== PREFLIGHT COMPLETE ==="

# Step 7: Build system prompt from fixture files (mounted at /fixtures/)
SYSTEM_PROMPT=""
if [ -f "/fixtures/SOUL.md" ]; then
    SYSTEM_PROMPT=$(cat /fixtures/SOUL.md)
    SYSTEM_PROMPT="${SYSTEM_PROMPT}\n\n"
fi
if [ -f "/fixtures/AGENT.md" ]; then
    SYSTEM_PROMPT="${SYSTEM_PROMPT}$(cat /fixtures/AGENT.md)"
fi

# Resolve {{datetime}} variable (same as production)
SYSTEM_PROMPT=$(echo -e "$SYSTEM_PROMPT" | sed "s/{{datetime}}/$(date -u +"%Y-%m-%dT%H:%M:%SZ")/g")

# Write system prompt to file for --append-system-prompt (same as production)
echo -e "$SYSTEM_PROMPT" > /tmp/system-prompt.md

# Step 8: Read job description from fixture
JOB_DESCRIPTION=""
if [ -f "/fixtures/gsd-test-job.md" ]; then
    JOB_DESCRIPTION=$(cat /fixtures/gsd-test-job.md)
fi

# Step 11: Build full prompt (same structure as production)
FULL_PROMPT="# Your Job

${JOB_DESCRIPTION}"

echo "Running Claude Code with job ${JOB_ID}..."
echo "FULL_PROMPT length: ${#FULL_PROMPT}"

# Step 11: Run Claude Code with same flags as production entrypoint
printf '%s' "${FULL_PROMPT}" | claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Task,Skill" \
    2>&1 | tee "${LOG_DIR}/claude-output.json" || true

# Step 12a: Generate observability.md from gsd-invocations.jsonl (same logic as production)
JSONL_FILE="${LOG_DIR}/gsd-invocations.jsonl"
OBS_FILE="${LOG_DIR}/observability.md"

INVOCATION_COUNT=0
if [ -f "${JSONL_FILE}" ]; then
    INVOCATION_COUNT=$(wc -l < "${JSONL_FILE}" | tr -d ' ')
fi

{
  echo "# GSD Invocations — Test Job ${JOB_ID}"
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

echo "Test run complete. Output in /output/"
echo "Invocations: ${INVOCATION_COUNT}"
