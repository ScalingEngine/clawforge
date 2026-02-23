# ClawForge Event Handler — StrategyES Instance
# Build context is repo root (.), so all paths are relative to that.

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y curl git python3 make g++ && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g pm2

WORKDIR /app

# Copy package files and install ALL deps (need devDeps for next build)
COPY package.json package-lock.json* ./
RUN npm install

# Copy core source
COPY lib/ ./lib/
COPY api/ ./api/
COPY drizzle/ ./drizzle/
COPY drizzle.config.js ./

# Copy Next.js app from templates
COPY templates/app/ ./app/
COPY templates/next.config.mjs ./
COPY templates/postcss.config.mjs ./
COPY templates/instrumentation.js ./
COPY templates/middleware.js ./

# Copy instance-specific config
COPY instances/strategyES/config/ ./config/

# Build Next.js (needs AUTH_SECRET at build time)
ENV AUTH_SECRET=build-placeholder
RUN npx next build

# Remove devDependencies after build
RUN npm prune --omit=dev

# Copy ecosystem config
COPY templates/docker/event-handler/ecosystem.config.cjs /opt/ecosystem.config.cjs

EXPOSE 80
CMD ["pm2-runtime", "/opt/ecosystem.config.cjs"]
