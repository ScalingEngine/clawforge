FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    git \
    jq \
    curl \
    procps \
    # Chrome/Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install GSD skills for Claude Code
RUN npx get-shit-done-cc@latest --claude --global

# Verify GSD installed successfully (fail build if missing)
RUN test -d /root/.claude/commands/gsd/ && \
    ls /root/.claude/commands/gsd/ | grep -q . || \
    (echo "ERROR: GSD install failed — /root/.claude/commands/gsd/ missing or empty" && exit 1)

# Install PostToolUse hook for GSD invocation observability
RUN mkdir -p /root/.claude/hooks
COPY hooks/gsd-invocations.js /root/.claude/hooks/gsd-invocations.js
RUN chmod +x /root/.claude/hooks/gsd-invocations.js
# Merge hook settings into settings.json (preserves any existing GSD config)
RUN node -e "\
  const fs = require('fs'); \
  const settingsPath = '/root/.claude/settings.json'; \
  let existing = {}; \
  try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch(e) {} \
  existing.hooks = existing.hooks || {}; \
  existing.hooks.PostToolUse = existing.hooks.PostToolUse || []; \
  existing.hooks.PostToolUse.push({ \
    matcher: 'Skill', \
    hooks: [{ type: 'command', command: 'node /root/.claude/hooks/gsd-invocations.js' }] \
  }); \
  fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2)); \
"

# Create workspace and config directories
RUN mkdir -p /workspace /workspace/.claude

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /job

ENTRYPOINT ["/entrypoint.sh"]
