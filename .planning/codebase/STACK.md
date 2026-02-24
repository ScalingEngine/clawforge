# Technology Stack

**Analysis Date:** 2025-02-23

## Languages

**Primary:**
- **JavaScript (ESM)** — All application code, API routes, agent implementation, channel adapters
- **TypeScript** — Peer dependency declared but not enforced; `.d.ts` files generated from JSDoc

**Secondary:**
- **Shell (Bash)** — Docker entrypoints, deployment scripts
- **YAML** — GitHub Actions workflows, docker-compose configuration

## Runtime

**Environment:**
- **Node.js** 18.0.0+ (specified in `package.json` engines)
- **npm** (lockfile: `package-lock.json` present)

**Container Runtime:**
- **Docker** — Job containers (Node 22-bookworm-slim), event handler containers
- **Docker Compose** — Multi-instance orchestration (Traefik, multiple event handlers)

## Frameworks

**Core:**
- **Next.js** 15.5.12+ — Event handler web application, API routes, SSR for chat UI
- **Next Auth** 5.0.0-beta.30 — Session management, credential-based auth, Drizzle adapter

**AI/Agent:**
- **LangChain** 1.1.x family:
  - `@langchain/langgraph` 1.1.4 — ReAct agent orchestration with tool loop
  - `@langchain/langgraph-checkpoint-sqlite` 1.0.1 — Persistent agent state checkpointing
  - `@langchain/anthropic` 1.3.17 — Claude models
  - `@langchain/openai` 1.2.7 — GPT-4o, Whisper transcription
  - `@langchain/google-genai` 2.1.18 — Gemini models
  - `@langchain/core` 1.1.24 — Base types, messaging, tool framework

**Chat/Streaming:**
- **Vercel AI SDK** (`ai` 5.0.0, `@ai-sdk/react` 2.0.0) — Server-side chat, streaming responses

**Channels:**
- **grammy** 1.39.3 — Telegram Bot API client
- **@slack/web-api** 7.8.0 — Slack messaging API (not bolt)
- **@slack/bolt** 4.1.0 — Slack event adapter (optional, included)

**UI:**
- **React** 19.0.0+ (peer dependency)
- **Tailwind CSS** 4.2.0 — Styling framework
- **@tailwindcss/postcss** 4.2.0 — PostCSS plugin
- **Lucide React** 0.400.0 — Icon library
- **next-themes** 0.4.6 — Dark mode support
- **class-variance-authority** 0.7.0 — Component class composition
- **clsx/tailwind-merge** 2.0.0 / 3.0.0 — CSS class merging

## Key Dependencies

**Critical:**

- **better-sqlite3** 12.6.2 — Embedded SQLite database (event handler state, users, chats, API keys)
  - Config: `lib/db/index.js` (WAL mode enabled)
  - Passed to Next.js `serverExternalPackages` for bundling

- **drizzle-orm** 0.44.0 — TypeScript ORM for SQLite
  - Schema: `lib/db/schema.js` (users, chats, messages, notifications, subscriptions, job_origins, settings)
  - Migrations: `drizzle/` directory, applied via `drizzle-kit`

- **bcrypt-ts** 6.0.0 — Password hashing for user credentials (NextAuth integration)

- **dotenv** 16.3.1 — Environment variable loading

**Infrastructure:**

- **uuid** 9.0.0 — Job ID generation (UUIDv4)
- **zod** 4.3.6 — Environment variable validation, schema validation
- **chalk** 5.3.0 — CLI colored output
- **@clack/prompts** 0.10.0 — Interactive CLI prompts
- **open** 10.0.0 — Open browser from CLI
- **node-cron** 3.0.3 — Cron job scheduling in Event Handler
- **streamdown** 2.2.0 — Markdown parsing/rendering
- **crypto** (Node.js built-in) — HMAC-SHA256 for Slack/Telegram signature verification

**Build:**

- **esbuild** 0.27.3 — Bundle React components (`lib/chat/components/*.jsx` to ESM)
- **drizzle-kit** 0.31.9 — Database schema generation and migrations

## Configuration

**Environment:**

- **Template**: `.env.example` — All required variables documented
- **Instance-specific override**: Via Docker Compose environment section or GitHub Secrets/Variables
- **Secrets Convention**:
  - `AGENT_*` — Available to job container, hidden from LLM
  - `AGENT_LLM_*` — Available to LLM (search API keys, etc.)
  - Other secrets: passed to container via GitHub Actions, not exposed to LLM

**Build:**

- **next.config.mjs** — Template in `templates/next.config.mjs`
  - `serverExternalPackages: ['better-sqlite3', 'drizzle-orm']` — Prevent bundling
  - Custom `NEXT_BUILD_DIR` support for non-standard build output

- **drizzle.config.js** — `lib/db/schema.js` as source, `drizzle/` as migrations output

**Database:**

- **SQLite** — File-based at `data/clawforge.sqlite` (or `DATABASE_PATH` env override)
- **WAL Mode** — Enabled for concurrent reads during write operations
- **Migrations** — Applied at Event Handler startup via `lib/db/initDatabase()` in instrumentation

## Platform Requirements

**Development:**

- Node.js 18+
- npm
- Git
- GitHub CLI (for setup wizard)
- Docker + Docker Compose (for local full stack testing)
- OpenSSL (for generating `AUTH_SECRET` values)

**Production:**

- **Deployment Targets**:
  - **VPS/Cloud** — Docker Compose orchestration, Traefik reverse proxy, Let's Encrypt TLS
  - **GitHub Actions** — Org-level runner for job execution (no external compute required)
  - **Docker Hub / GHCR** — Container image registry (pre-built or CI built)

- **Requirements**:
  - Docker daemon
  - Persistent volume for SQLite database and config
  - HTTPS/TLS (Traefik + Let's Encrypt or reverse proxy)
  - Network isolation between instances (separate Docker networks)

---

*Stack analysis: 2025-02-23*
