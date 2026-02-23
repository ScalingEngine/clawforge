#!/bin/bash
set -e

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

# 5. Clone the job branch
if [ -n "$REPO_URL" ]; then
    git clone --single-branch --branch "$BRANCH" --depth 1 "$REPO_URL" /job
else
    echo "No REPO_URL provided"
    exit 1
fi

cd /job

# Create temp directory (gitignored)
mkdir -p /job/tmp

# 6. Setup logs directory
LOG_DIR="/job/logs/${JOB_ID}"
mkdir -p "${LOG_DIR}"

# 7. Build system prompt from config files
SYSTEM_PROMPT=""
if [ -f "/job/config/SOUL.md" ]; then
    SYSTEM_PROMPT=$(cat /job/config/SOUL.md)
    SYSTEM_PROMPT="${SYSTEM_PROMPT}\n\n"
fi
if [ -f "/job/config/AGENT.md" ]; then
    SYSTEM_PROMPT="${SYSTEM_PROMPT}$(cat /job/config/AGENT.md)"
fi

# Resolve {{datetime}} variable
SYSTEM_PROMPT=$(echo -e "$SYSTEM_PROMPT" | sed "s/{{datetime}}/$(date -u +"%Y-%m-%dT%H:%M:%SZ")/g")

# 8. Read job description
JOB_DESCRIPTION=""
if [ -f "/job/logs/${JOB_ID}/job.md" ]; then
    JOB_DESCRIPTION=$(cat "/job/logs/${JOB_ID}/job.md")
fi

# 9. Setup Claude Code configuration
# Copy .claude config if it exists in the repo
if [ -d "/job/.claude" ]; then
    echo "Found .claude config in repo"
fi

# Write system prompt to a file for --append-system-prompt
echo -e "$SYSTEM_PROMPT" > /tmp/system-prompt.md

# 10. Determine allowed tools
ALLOWED_TOOLS="${CLAUDE_ALLOWED_TOOLS:-Read,Write,Edit,Bash,Glob,Grep}"

# 11. Run Claude Code with job description
FULL_PROMPT="# Your Job

${JOB_DESCRIPTION}"

echo "Running Claude Code with job ${JOB_ID}..."
claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "${ALLOWED_TOOLS}" \
    "${FULL_PROMPT}" \
    2>&1 | tee "${LOG_DIR}/claude-output.json" || true

# 12. Commit all changes
git add -A
git add -f "${LOG_DIR}" || true
git commit -m "clawforge: job ${JOB_ID}" || true
git push origin || true

# 13. Create PR
gh pr create \
    --title "clawforge: job ${JOB_ID}" \
    --body "Automated job by ClawForge" \
    --base main || true

echo "Done. Job ID: ${JOB_ID}"
