# Architecture

**Analysis Date:** 2026-02-23

## Pattern Overview

**Overall:** Event-driven, multi-layer architecture with strict separation between message handling (Event Handler), agent reasoning (LangGraph AI), and job execution (Docker isolation).

**Key Characteristics:**
- Two-layer separation: Next.js Event Handler + isolated Docker job containers
- Channel adapters normalize all messaging platforms (Slack, Telegram, Web) to a common interface
- LangGraph ReAct agent with SQLite conversation memory for stateful reasoning
- Git-as-audit-trail: every job execution creates a branch, commits all changes, and produces a PR
- Webhook-driven: GitHub Actions, Slack, Telegram, custom webhooks all trigger the same API routes

## Layers

**Event Handler (Next.js):**
- Purpose: Receive messages from all channels, route through AI agent, coordinate with job system
- Location: `/api/index.js`, `/lib/ai/`, `/lib/channels/`, `/lib/auth/`
- Contains: Webhook handlers, channel adapters, AI orchestration, session management
- Depends on: LangGraph agent, Drizzle ORM, channel SDKs (Slack, Telegram)
- Used by: External webhook callers (Slack, Telegram, GitHub), browser UI

**AI Agent Layer (LangGraph):**
- Purpose: ReAct reasoning loop with tool access and persistent memory
- Location: `/lib/ai/agent.js`, `/lib/ai/index.js`
- Contains: LangGraph compiled agent, system prompt resolution, message persistence
- Depends on: LLM providers (Anthropic, OpenAI, Google), tool definitions, SQLite checkpointer
- Used by: Event Handler for all conversational queries

**Tool Layer:**
- Purpose: Provide agent with actionable capabilities
- Location: `/lib/ai/tools.js`, `/lib/tools/`
- Contains: `createJob`, `getJobStatus`, `getSystemTechnicalSpecs`, GitHub API, Telegram/Slack helpers
- Depends on: GitHub REST API, external tool implementations
- Used by: LangGraph agent as tool call targets

**Channel Adapter Layer:**
- Purpose: Normalize webhook events from different platforms into a common message format
- Location: `/lib/channels/base.js`, `/lib/channels/telegram.js`, `/lib/channels/slack.js`, `/lib/channels/index.js`
- Contains: Abstract `ChannelAdapter` interface, platform-specific implementations
- Depends on: grammy (Telegram), @slack/bolt and @slack/web-api (Slack), native Request/Response (Web)
- Used by: Event Handler webhook routes to normalize and route messages

**Database Layer (Drizzle ORM):**
- Purpose: Persist chats, messages, users, API keys, notifications, job origins
- Location: `/lib/db/index.js`, `/lib/db/schema.js`, `/lib/db/chats.js`, etc.
- Contains: Schema definitions, query helpers, SQLite initialization
- Depends on: better-sqlite3, Drizzle migrations in `/drizzle/`
- Used by: AI layer, Auth layer, notification system

**Authentication Layer (Auth.js v5):**
- Purpose: Session management, credential validation, user onboarding
- Location: `/lib/auth/index.js`, `/lib/auth/config.js`, `/lib/auth/middleware.js`, `/lib/auth/actions.js`
- Contains: NextAuth providers, session checks, user CRUD
- Depends on: Auth.js v5, SQLite schema (users table)
- Used by: Next.js layout, Server Actions, middleware

**Cron & Trigger Layer:**
- Purpose: Time-based automation (crons) and event-based automation (triggers)
- Location: `/lib/cron.js`, `/lib/triggers.js`
- Contains: node-cron scheduler, trigger config loader, action executor
- Depends on: Cron config at `/config/CRONS.json`, Trigger config at `/config/TRIGGERS.json`
- Used by: Instrumentation hook on server startup

## Data Flow

**Slack Message → Response:**

1. Slack sends webhook to `/api/slack/events`
2. `handleSlackEvents()` validates signing secret, extracts adapter params
3. `SlackAdapter.receive()` normalizes to `{ threadId, text, attachments, metadata }`
4. `processChannelMessage()` acknowledges and starts typing indicator
5. `chat(threadId, text)` invokes LangGraph agent
6. Agent runs ReAct loop with tool access (create_job, get_job_status, etc.)
7. Response saved to DB via `persistMessage()`
8. `SlackAdapter.sendResponse()` posts result to thread
9. Auto-title generation runs (fire-and-forget)

**GitHub Webhook (Job Complete) → Notification:**

1. GitHub webhook to `/api/github/webhook` with job results
2. Validates GH webhook secret (timing-safe)
3. Extracts job ID from branch name or payload
4. `summarizeJob(results)` creates one-shot summary via LLM
5. `createNotification()` saves to DB
6. Routes result back to originating thread:
   - `getJobOrigin(jobId)` finds original Slack thread ID
   - `addToThread(threadId, message)` injects into agent memory
   - Slack adapter posts notification to original thread

**Cron/Trigger Execution:**

1. Cron scheduler fires at scheduled time (loaded by instrumentation hook)
2. Or trigger fires when webhook matches `watch_path`
3. Template variables resolved (e.g., `{{body.field}}`)
4. Action executed: command, webhook, or agent job
5. Results logged to console

**State Management:**

- **Conversation Memory:** LangGraph SQLite checkpointer at `data/clawforge.sqlite`
- **Message History:** Drizzle-persisted chat messages and notifications
- **Job Tracking:** Job origins (Slack thread → job ID) stored in jobOrigins table
- **Cron/Trigger State:** In-memory map of loaded triggers, persisted config in JSON files

## Key Abstractions

**ChannelAdapter:**
- Purpose: Abstract common operations across Slack, Telegram, Web Chat
- Examples: `SlackAdapter` (`/lib/channels/slack.js`), `TelegramAdapter` (`/lib/channels/telegram.js`)
- Pattern: All adapters implement `receive()`, `acknowledge()`, `startProcessingIndicator()`, `sendResponse()`
- Benefits: New channels added with minimal changes to core Event Handler

**Tool (LangGraph):**
- Purpose: Define agent capabilities as structured tools with validation
- Examples: `createJobTool` (`/lib/ai/tools.js`), `getJobStatusTool`
- Pattern: Each tool is a LangGraph StructuredTool with name, description, schema, and run function
- Benefits: Agent automatically handles tool selection and invocation; all calls are logged

**API Routes (Next.js):**
- Purpose: Central webhook ingestion for all external callers
- Pattern: `/api/index.js` exports `GET()` and `POST()` handlers; routes dispatched via path
- Auth: API key-based for generic endpoints, webhook secret for GitHub/Telegram/Slack
- Benefits: Single ingress point for monitoring, rate limiting, trigger firing

## Entry Points

**Server Startup:**
- Location: `config/instrumentation.js` (called by Next.js on server boot)
- Triggers: Database initialization, cron loading, builtin cron startup
- Responsibilities: Validates AUTH_SECRET, initializes SQLite, starts scheduler

**API Routes:**
- Location: `/api/index.js` (`POST` and `GET` handlers)
- Triggers: Slack `/api/slack/events`, Telegram `/api/telegram/webhook`, GitHub `/api/github/webhook`, generic `/api/create-job`
- Responsibilities: Route dispatch, auth checks, rate limiting, trigger firing

**Chat Endpoint:**
- Location: `/lib/chat/api.js` (streaming endpoint for browser UI)
- Triggers: Web chat form submission
- Responsibilities: Session auth, stream formatting, client delivery

## Error Handling

**Strategy:** Best-effort with graceful degradation. Errors are logged but rarely block execution.

**Patterns:**

- **Chat DB Persistence:** Try to save, log error but continue chat if DB fails
- **Channel Webhooks:** Return 200 OK even if processing fails; log error separately
- **Tool Invocation:** LangGraph catches tool errors and retries or continues; logged for auditing
- **Cron/Trigger Execution:** Errors caught, logged with action name; do not prevent scheduler from running

## Cross-Cutting Concerns

**Logging:**
- Approach: `console.log()` with prefixes like `[slack]`, `[trigger]`, `[rate-limit]`
- No structured logging framework; output to stdout for container log aggregation

**Validation:**
- Approach: Zod schemas for config (CRONS.json, TRIGGERS.json); LangGraph tool schemas for agent inputs
- Example: ChannelAdapter normalizes user inputs to `{ threadId, text, attachments, metadata }`

**Authentication:**
- Approach: Session-based (Auth.js) for browser UI; API key + webhook secrets for external callers
- Secrets: API keys hashed in DB (bcrypt-ts); webhook secrets compared timing-safe

**Rate Limiting:**
- Approach: Sliding-window in-memory store per IP per route
- Config: 30 requests/minute per IP per webhook endpoint
- Automatic cleanup of stale entries every 5 minutes

**Instance Isolation:**
- Approach: Separate Docker networks (noah-net, strategyES-net), per-instance Slack apps, restricted GitHub runner scope
- DB: Single shared SQLite, but jobs are repo-scoped by GitHub Actions
- Environment: Secret prefixes (`AGENT_`, `AGENT_LLM_`) control what reaches container vs. LLM

---

*Architecture analysis: 2026-02-23*
