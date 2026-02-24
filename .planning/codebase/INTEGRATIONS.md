# External Integrations

**Analysis Date:** 2025-02-23

## APIs & External Services

**LLM Providers:**

- **Anthropic (Claude)** — Primary AI model for agent and chat
  - SDK: `@langchain/anthropic`
  - Auth: `ANTHROPIC_API_KEY` (required, no fallback)
  - Models supported: `claude-sonnet-4-20250514` (default), any Anthropic model ID
  - Configuration: `lib/ai/model.js` (LLM_PROVIDER=anthropic)

- **OpenAI** — Fallback LLM + Whisper transcription
  - SDK: `@langchain/openai`
  - Auth: `OPENAI_API_KEY` (optional; can use custom base URL)
  - Models supported: `gpt-4o` (default), any OpenAI-compatible model
  - Special: Whisper API for Telegram audio transcription (`lib/tools/openai.js`)
  - Configuration: `lib/ai/model.js` (LLM_PROVIDER=openai or custom)

- **Google Gemini** — Alternative LLM provider
  - SDK: `@langchain/google-genai`
  - Auth: `GOOGLE_API_KEY` (required if selected)
  - Models supported: `gemini-2.5-pro` (default), any Gemini model ID
  - Configuration: `lib/ai/model.js` (LLM_PROVIDER=google)

**Search/Information:**

- **Brave Search** — Optional web search capability for agent
  - Integration: Job container via `AGENT_LLM_BRAVE_API_KEY`
  - Implementation: `templates/pi-skills/brave-search/` (Pi skill, not native)

**Code Execution:**

- **Claude Code CLI** — Agent action execution in Docker container
  - Installed: `RUN npm install -g @anthropic-ai/claude-code` in job Dockerfile
  - Execution: `templates/docker/job/entrypoint.sh` calls `claude -p`
  - Input: Job description from `logs/{jobId}/job.md`
  - Output: Git commits and pull requests

**GitHub API:**

- **REST API v2022-11-28** — All repository operations
  - SDK: Native `fetch()` with Bearer token auth
  - Auth: `GH_TOKEN` environment variable (GitHub Personal Access Token)
  - Required Scopes: `repo` (read/write), `workflow` (trigger Actions)
  - Endpoints used:
    - Create branches: `/repos/{owner}/{repo}/git/refs`
    - Upload files: `/repos/{owner}/{repo}/contents/...`
    - Trigger workflows: `/repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches`
    - Query workflow runs: `/repos/{owner}/{repo}/actions/runs`
    - Create pull requests: `/repos/{owner}/{repo}/pulls`
  - Implementation: `lib/tools/github.js`

**GitHub Actions:**

- **Org-level runner** — Job execution in Docker container
  - Trigger: `run-job.yml` on `job/*` branch creation
  - Instance Scoping: Separate repos per instance (clawforge, strategyes-lab)
  - Environment Secrets Passed: `AGENT_*`, `AGENT_LLM_*` secrets filtered by prefix

## Data Storage

**Databases:**

- **SQLite (better-sqlite3)** — Event Handler persistent data
  - Connection: Local file at `data/clawforge.sqlite`
  - Client: Drizzle ORM (`drizzle-orm`)
  - Schema: `lib/db/schema.js`
    - `users` — Authentication users (email, passwordHash, role)
    - `chats` — User conversation sessions
    - `messages` — Chat message history (role, content)
    - `notifications` — Job completion notifications
    - `subscriptions` — Channel registrations (Slack channel IDs, etc.)
    - `job_origins` — Job-to-thread mapping for notification routing
    - `settings` — Configuration key-value pairs
  - Migrations: Applied at startup via `lib/db/initDatabase()` from `drizzle/` folder

**File Storage:**

- **GitHub Repository** — Log files and job artifacts
  - Path: `logs/{jobId}/job.md` (job description, updated by Claude Code)
  - Additional artifacts committed by agent into job branch
  - No external file storage service

**Caching:**

- **None** — SQLite WAL mode provides read concurrency; agent checkpointing via LangGraph

## Authentication & Identity

**Auth Provider:**

- **NextAuth v5** — Custom credential provider (username/password)
  - Implementation: `lib/auth/config.js` (Drizzle adapter)
  - Session Storage: SQLite `users` table
  - Password Hashing: bcrypt-ts
  - Logout: Session invalidation, session cleared from database
  - Web Chat: Session required via `requireAuth()` in Server Actions
  - API: Separate API key authentication (`x-api-key` header) for external callers

**API Key Management:**

- **Storage**: SQLite `api_keys` table (hashed, scoped to users)
- **Usage**: `x-api-key` header on `/api/*` endpoints
- **Verification**: Timing-safe comparison in `lib/db/api-keys.js`
- **Generation/Revocation**: Admin UI (not yet implemented in templates)

**Channel-Specific Auth:**

- **Slack**:
  - Bot Token: `SLACK_BOT_TOKEN` (xoxb-...)
  - Signing Secret: `SLACK_SIGNING_SECRET` (for webhook validation)
  - User Whitelist: `SLACK_ALLOWED_USERS` (comma-separated, enforced per-instance)
  - Channel Whitelist: `SLACK_ALLOWED_CHANNELS` (comma-separated, enforced per-instance)
  - Validation: HMAC-SHA256 signature + timestamp replay check

- **Telegram**:
  - Bot Token: `TELEGRAM_BOT_TOKEN`
  - Webhook Secret: `TELEGRAM_WEBHOOK_SECRET` (custom header validation)
  - Chat ID Whitelist: `TELEGRAM_CHAT_ID` (single chat only, enforced)
  - Verification: Token in `x-telegram-bot-api-secret-token` header

## Monitoring & Observability

**Error Tracking:**

- **None configured** — Errors logged to stdout/stderr in containers

**Logs:**

- **Approach**: Console logging to container stdout
- **Persistence**: Docker logs captured by docker-compose or container runtime
- **Job Logs**: Markdown logs at `logs/{jobId}/job.md` in repository (git history = audit trail)

**Notifications:**

- **Channels**: Slack, Telegram (callback to channel after job completion)
- **Implementation**: `lib/tools/slack.js`, `lib/tools/telegram.js` send messages to thread/chat
- **Data**: Job summary, PR link, status (success/failure)

## CI/CD & Deployment

**Hosting:**

- **Target**: Docker Compose on VPS or cloud instance
- **Orchestration**: Traefik reverse proxy for TLS termination, load balancing
- **Domains**: Per-instance hostnames (clawforge.scalingengine.com, strategyES.scalingengine.com)
- **TLS**: Let's Encrypt via Traefik ACME

**CI Pipeline:**

- **Trigger**: GitHub Actions (no external CI service)
- **Workflows** (`templates/.github/workflows/`):
  - **run-job.yml** — On `job/*` branch creation, spin up Docker job container
  - **auto-merge.yml** — On PR open, merge if path-allowed and tests pass
  - **notify-pr-complete.yml** — On PR merge, notify Event Handler (webhook callback)
  - **notify-job-failed.yml** — On job failure, send error notification
  - **rebuild-event-handler.yml** — On clawforge package update, rebuild event handler
  - **build-image.yml** — Build and push job container image to registry

**Deployment:**

- **Image Registry**: Docker Hub or GHCR (configured via `JOB_IMAGE_URL` variable)
- **Container Images**:
  - Event Handler: Built from `instances/{noah,strategyES}/Dockerfile` (Next.js + Node 18+)
  - Job Container: Pre-built image with Claude Code CLI, git, jq, Chrome deps
- **Network Isolation**: Separate Docker networks per instance (noah-net, strategyES-net)
- **Data Persistence**: Docker volumes for SQLite database and config files

## Environment Configuration

**Required env vars (Event Handler):**

- `APP_URL` — Public URL for web chat (https://...)
- `APP_HOSTNAME` — Domain for routing (used by Traefik)
- `AUTH_SECRET` — NextAuth session key (openssl rand -base64 32)
- `GH_TOKEN` — GitHub Personal Access Token
- `GH_OWNER` — GitHub organization/user (ScalingEngine)
- `GH_REPO` — Repository name (clawforge or strategyes-lab)
- `GH_WEBHOOK_SECRET` — Webhook validation token
- `LLM_PROVIDER` — anthropic/openai/google (default: anthropic)
- `LLM_MODEL` — Model override (e.g., claude-sonnet-4-20250514)
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` or `GOOGLE_API_KEY` — Based on provider

**Channel env vars (Event Handler):**

- **Slack**: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_ALLOWED_USERS`, `SLACK_ALLOWED_CHANNELS`
- **Telegram**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_CHAT_ID`

**Job Container env vars (passed via GitHub Actions):**

- `REPO_URL` — Git repository URL with token embedded
- `BRANCH` — Job branch name (job/{uuid})
- `SECRETS` — JSON object of `AGENT_*` variables (excluding AGENT_LLM_*)
- `LLM_SECRETS` — JSON object of `AGENT_LLM_*` variables (LLM-accessible)
- `LLM_MODEL`, `LLM_PROVIDER`, `OPENAI_BASE_URL` — Forwarded from workflow vars

**Secrets location:**

- Development: `.env` file (local, .gitignored)
- Production: GitHub repository secrets and variables (in Settings > Secrets and variables)
- Docker Compose: Environment section in `docker-compose.yml` (populated from `.env`)

## Webhooks & Callbacks

**Incoming Webhooks:**

- **Slack** (`POST /api/slack/events`) — Slack Events API
  - Validation: HMAC-SHA256 signature + timestamp (5-minute window)
  - Triggers: message events, app_mention
  - No auth header; uses Slack signing secret

- **Telegram** (`POST /api/telegram/webhook`) — Telegram Bot API long-polling
  - Validation: Custom header `x-telegram-bot-api-secret-token`
  - Triggers: text messages, voice messages, documents, photos
  - No standard auth; uses custom secret token

- **GitHub** (`POST /api/github/webhook`) — Pull request completion notifications
  - Validation: Custom header `x-github-webhook-secret-token`
  - Triggers: PR merged, job completed, workflow failed
  - Payload: Job summary, PR link, test results

**Outgoing Webhooks:**

- **GitHub Webhook Registration** — Sets webhook on repository to notify Event Handler
  - Endpoint: POST to Event Handler `/api/github/webhook`
  - Events: Pull requests (merged), workflow runs (completed, failed)
  - Payload: Sent back to Event Handler for notification routing

- **Slack Message Callbacks** — Send job results to Slack thread
  - Endpoint: Internal via `@slack/web-api` client
  - Method: `chat.postMessage` to thread
  - Payload: Job summary, PR link, execution status

- **Telegram Message Callbacks** — Send job results to Telegram chat
  - Endpoint: Internal via grammy Bot client
  - Method: `sendMessage` with HTML parse mode
  - Payload: Job summary, PR link, execution status

- **Event Handler Notifications** — Job completion callbacks to Event Handler
  - Endpoint: Internal via `lib/ai/index.js` on workflow webhook
  - Method: Agent tool `addToThread()` to insert notification into chat
  - Flow: Job runs → PR merges → webhook fires → Event Handler summarizes → notification sent

---

*Integration audit: 2025-02-23*
