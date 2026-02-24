# Codebase Structure

**Analysis Date:** 2026-02-23

## Directory Layout

```
/
├── api/                              # Next.js API route handlers
│   └── index.js                      # Webhook ingestion (Slack, Telegram, GitHub, generic)
├── lib/                              # Core implementation
│   ├── ai/                           # LangGraph agent and tools
│   │   ├── agent.js                  # Agent singleton, createReactAgent, SQLite checkpointing
│   │   ├── index.js                  # chat(), chatStream(), summarizeJob(), addToThread()
│   │   ├── model.js                  # Multi-provider LLM factory (Anthropic, OpenAI, Google)
│   │   └── tools.js                  # Tool definitions (createJobTool, getJobStatusTool, etc.)
│   ├── channels/                     # Channel adapters (Slack, Telegram, Web)
│   │   ├── base.js                   # Abstract ChannelAdapter interface
│   │   ├── slack.js                  # SlackAdapter implementation
│   │   ├── telegram.js               # TelegramAdapter implementation
│   │   └── index.js                  # Adapter factory (getTelegramAdapter, getSlackAdapter)
│   ├── tools/                        # Tool implementations used by agent
│   │   ├── create-job.js             # GitHub branch creation for job execution
│   │   ├── github.js                 # GitHub REST API client
│   │   ├── telegram.js               # Telegram setWebhook and API helpers
│   │   └── openai.js                 # OpenAI API integration
│   ├── auth/                         # Authentication and session
│   │   ├── index.js                  # Auth.js exports, getPageAuthState()
│   │   ├── config.js                 # NextAuth v5 config (providers, callbacks)
│   │   ├── middleware.js             # Auth.js middleware
│   │   ├── actions.js                # Server actions for auth (login, logout, signup)
│   │   └── edge-config.js            # Edge Config integration (optional)
│   ├── chat/                         # Web chat components and streaming
│   │   ├── components/               # React components (ChatMessage, MessageList, Input)
│   │   ├── components/index.js       # Barrel export of all chat components
│   │   ├── api.js                    # Server action for chat streaming via AI SDK
│   │   ├── actions.js                # Server actions for chat operations
│   │   └── utils.js                  # Markdown rendering, token counting
│   ├── db/                           # Database (Drizzle ORM, SQLite)
│   │   ├── index.js                  # getDb(), initDatabase() singleton
│   │   ├── schema.js                 # Drizzle table definitions (users, chats, messages, etc.)
│   │   ├── chats.js                  # getChatById, createChat, saveMessage, updateChatTitle
│   │   ├── users.js                  # getUserCount, createUser, getUserByEmail
│   │   ├── notifications.js          # createNotification, getNotifications, markRead
│   │   ├── job-origins.js            # saveJobOrigin, getJobOrigin (Slack thread → job ID mapping)
│   │   ├── api-keys.js               # verifyApiKey, createApiKey, deleteApiKey
│   │   └── update-check.js           # getUpdateAvailable, setUpdateAvailable
│   ├── utils/                        # Utilities
│   │   └── render-md.js              # Render Markdown with template variable substitution
│   ├── actions.js                    # executeAction (command, webhook, agent) dispatcher
│   ├── cron.js                       # Cron scheduler, version check, builtin crons
│   ├── triggers.js                   # Trigger config loader, template resolver, action firing
│   └── paths.js                      # Central path resolver (configDir, logsDir, clawforgeDb, etc.)
├── config/                           # Base/default configuration
│   ├── index.js                      # withClawforge() Next.js config wrapper
│   └── instrumentation.js            # Next.js instrumentation hook (db init, cron startup)
├── instances/                        # Per-instance configuration
│   ├── noah/                         # Noah's personal instance
│   │   ├── config/                   # SOUL.md, EVENT_HANDLER.md, AGENT.md
│   │   ├── Dockerfile                # Instance-specific Docker build
│   │   └── .env.example              # Instance env variables
│   └── strategyES/                   # StrategyES dev agent
│       ├── config/                   # Instance-specific config
│       ├── Dockerfile                # Instance Docker build
│       └── .env.example
├── templates/                        # Scaffolding templates for instances
│   ├── app/                          # Next.js app directory structure
│   │   ├── page.js                   # Landing/main page
│   │   ├── layout.js                 # Root layout with theme/auth
│   │   ├── globals.css               # Global styles
│   │   ├── login/                    # Login page
│   │   ├── chats/                    # Chat history UI
│   │   ├── chat/                     # Single chat UI (streaming)
│   │   ├── notifications/            # Job notifications UI
│   │   ├── triggers/                 # Trigger management UI
│   │   ├── crons/                    # Cron schedule UI
│   │   ├── settings/                 # Settings/config UI
│   │   ├── components/               # Shared UI components (theme toggle, login form, setup form)
│   │   └── api/                      # Next.js API directory (auth routes)
│   ├── config/                       # Config template overrides
│   ├── docker/
│   │   ├── event-handler/            # PM2 + Next.js container
│   │   │   ├── Dockerfile
│   │   │   └── ecosystem.config.cjs
│   │   └── job/                      # Claude Code CLI job container
│   │       ├── Dockerfile            # Node 22 + Claude Code CLI + Chrome deps
│   │       └── entrypoint.sh         # Clone → claude -p → commit → PR
│   ├── .github/workflows/            # GitHub Actions template
│   │   ├── run-job.yml               # Trigger Docker container on job/* branch
│   │   ├── auto-merge.yml            # Path-restricted auto-merge
│   │   ├── notify-pr-complete.yml    # Webhook back to Event Handler
│   │   └── notify-job-failed.yml
│   └── pi-skills/                    # Skills for Pi agent (legacy, may be deprecated)
├── drizzle/                          # Drizzle ORM migrations
│   ├── meta/                         # Migration metadata
│   └── [migration-files].sql         # SQL migration files
├── logs/                             # Job execution logs (auto-created)
│   └── {jobId}/                      # Per-job log directory
│       └── job.md                    # Job description and execution log
├── docker-compose.yml                # Multi-instance orchestration
├── CLAUDE.md                         # Architecture and deployment documentation
├── package.json                      # Dependencies, build scripts, exports
├── bin/                              # CLI and build utilities
│   ├── cli.js                        # clawforge CLI entry point
│   ├── local.sh                      # Local development setup script
│   └── postinstall.js                # NPM postinstall hook
├── setup/                            # Setup and onboarding utilities
│   └── lib/                          # Setup helper modules
└── .env.example                      # Template environment variables
```

## Directory Purposes

**api/:**
- Purpose: External webhook ingestion only
- Contains: POST/GET route handlers
- Key files: `index.js` (all routes)

**lib/:**
- Purpose: Core application logic
- Contains: Agent, channels, tools, database, auth, cron/trigger systems
- Key files: See subdirectory breakdown below

**lib/ai/:**
- Purpose: LangGraph ReAct agent and LLM integration
- Contains: Agent definition, tool signatures, model factory
- Key files: `agent.js` (singleton), `index.js` (chat interface), `tools.js` (tool defs)

**lib/channels/:**
- Purpose: Platform-agnostic message handling
- Contains: Slack, Telegram, abstract base adapter
- Key files: `base.js` (interface), `slack.js` (Slack impl), `telegram.js` (Telegram impl), `index.js` (factory)

**lib/tools/:**
- Purpose: Tool implementations for agent and action executor
- Contains: GitHub branch/PR creation, status checks, Telegram/Slack helpers
- Key files: `create-job.js`, `github.js`

**lib/auth/:**
- Purpose: Session and credential management
- Contains: NextAuth config, user CRUD, session checks
- Key files: `config.js` (NextAuth config), `index.js` (exports)

**lib/chat/:**
- Purpose: Web chat UI and streaming
- Contains: React components, server actions, API streaming route
- Key files: `api.js` (streaming endpoint), `components/` (UI), `actions.js` (server actions)

**lib/db/:**
- Purpose: SQLite data persistence via Drizzle ORM
- Contains: Schema, migrations, table-specific query functions
- Key files: `schema.js` (tables), `index.js` (getDb), `chats.js`, `users.js`, etc.

**lib/utils/:**
- Purpose: Shared utility functions
- Contains: Markdown rendering, template interpolation
- Key files: `render-md.js`

**config/:**
- Purpose: Server initialization and Next.js integration
- Contains: Instrumentation hook, Config wrapper
- Key files: `instrumentation.js` (on startup), `index.js` (withClawforge)

**instances/:**
- Purpose: Per-instance configuration and deployment
- Contains: Instance-specific Docker builds, env overrides, config overrides
- Key files: Each instance has Dockerfile, .env.example, config/ subdir

**templates/:**
- Purpose: Scaffolding for new instances
- Contains: Next.js app template, Docker templates, GitHub Actions templates, skill templates
- Key files: `app/` (full Next.js app), `docker/` (build templates), `.github/workflows/`

**drizzle/:**
- Purpose: Database migrations
- Contains: SQL migration files, migration metadata
- Generated by: `npm run db:generate`

**logs/:**
- Purpose: Job execution logs and metadata
- Contains: Per-job directories with job.md (created by createJob)
- Auto-created: By `createJob()` via GitHub API

**bin/:**
- Purpose: CLI and build utilities
- Contains: CLI entry point, local dev setup, postinstall hook
- Key files: `cli.js` (clawforge command), `local.sh`

**setup/:**
- Purpose: Onboarding and initialization helpers
- Contains: Setup wizards, configuration generators
- Key files: helpers in `setup/lib/`

## Key File Locations

**Entry Points:**

- `api/index.js`: All external webhooks (Slack, Telegram, GitHub, generic)
- `config/instrumentation.js`: Server startup (called by Next.js)
- `lib/chat/api.js`: Web chat streaming endpoint (Server Action)
- `bin/cli.js`: CLI entry point for `clawforge` command

**Configuration:**

- `package.json`: Dependencies, exports, scripts
- `config/index.js`: Next.js wrapper (`withClawforge()`)
- `config/instrumentation.js`: Server initialization
- `instances/{instance}/config/`: Instance-specific overrides (SOUL.md, EVENT_HANDLER.md, AGENT.md)
- `drizzle/`: Migration SQL files

**Core Logic:**

- `lib/ai/agent.js`: LangGraph agent singleton
- `lib/ai/index.js`: chat(), chatStream(), summarizeJob() interface
- `lib/channels/base.js`: ChannelAdapter interface
- `lib/db/index.js`: SQLite initialization and getDb() singleton
- `lib/auth/config.js`: NextAuth configuration

**Testing:**

- No test files present (package.json shows `"test": "echo \"No tests yet\" && exit 0"`)

## Naming Conventions

**Files:**

- Kebab-case for utilities and helpers: `create-job.js`, `render-md.js`, `api-keys.js`
- Camel-case for module singletons: `agent.js`, `model.js`
- Index files for barrel exports: `lib/channels/index.js`, `lib/chat/components/index.js`
- `.actions.js` suffix for Server Actions: `lib/auth/actions.js`, `lib/chat/actions.js`

**Directories:**

- Plural for feature groups: `lib/channels/`, `lib/tools/`, `lib/db/`
- Singular for specific modules: `lib/ai/`, `lib/auth/`, `lib/chat/`
- Instance names are lowercase: `instances/noah/`, `instances/strategyES/`
- Config directories: `config/`, `instances/{name}/config/`, no leading dot (except `.env`)

**Functions & Classes:**

- Pascal case for classes: `ChannelAdapter`, `SlackAdapter`
- Camel case for functions: `getAgent()`, `createJob()`, `persistMessage()`
- Verb-first for action functions: `executeAction()`, `fireTrigg()` calls `executeActions()`
- Tool naming: All tools have `Tool` suffix: `createJobTool`, `getJobStatusTool`

## Where to Add New Code

**New Feature (e.g., new tool or capability):**
- Primary code: `lib/ai/tools.js` (add tool definition) + `lib/tools/[feature].js` (implement tool logic)
- Tests: Not currently used; would go in test/ directory if added
- Dependencies: Update `package.json` if new packages needed

**New Channel/Adapter (e.g., Discord, Microsoft Teams):**
- Implementation: `lib/channels/[platform].js` (extend `ChannelAdapter`)
- Registration: Update `lib/channels/index.js` to export factory function
- Webhook handler: Add case in `/api/index.js` POST route handler

**New Database Table:**
- Schema: Add table to `lib/db/schema.js`
- Query helpers: Create new file `lib/db/[entity].js` with CRUD functions
- Migration: Run `npm run db:generate` to auto-generate migration SQL
- Use: Import from `lib/db/[entity].js` in consumers

**New Server Action (for browser UI):**
- Implementation: Create in `lib/[feature]/actions.js` with `'use server'` directive
- Use in components: Import and call in client components
- Auth: Wrap with `requireAuth()` session check

**New Configuration (crons, triggers, etc.):**
- Config file: Create JSON in `config/` directory
- Loader: Create loader in `lib/` if needed (cron.js and triggers.js already exist)
- Path resolution: Add path to `lib/paths.js` if needed

**New Instance:**
- Directory: Create `instances/[instance-name]/`
- Config: Create `instances/[instance-name]/config/` with SOUL.md, EVENT_HANDLER.md, AGENT.md
- Docker: Copy template from `templates/docker/` and customize Dockerfile
- Env: Create `.env.example` with instance-specific secrets

**Utilities and Helpers:**
- Shared helpers: `lib/utils/[feature].js` (e.g., `render-md.js`)
- Action executors: `lib/actions.js` (dispatch pattern already established)
- Path resolution: `lib/paths.js` (central resolver)

## Special Directories

**logs/:**
- Purpose: Job execution logs and metadata
- Generated: Automatically by `createJob()` via GitHub API
- Committed: No; git-ignored
- Structure: `logs/{jobId}/job.md` contains job description and execution log

**data/:**
- Purpose: SQLite database and persistent data
- Generated: Automatically when first accessed
- Committed: No; git-ignored
- Contents: `clawforge.sqlite` (DB file), SQLite WAL files

**drizzle/:**
- Purpose: Database schema migrations
- Generated: By `npm run db:generate` after schema changes
- Committed: Yes; version-controlled migrations
- Contents: `.sql` migration files and `meta/` metadata

**.next/:**
- Purpose: Next.js build output
- Generated: By `npm run build`
- Committed: No; git-ignored
- Used at runtime for production

**node_modules/:**
- Purpose: Installed dependencies
- Generated: By `npm install`
- Committed: No; git-ignored

---

*Structure analysis: 2026-02-23*
