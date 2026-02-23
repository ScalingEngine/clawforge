# ClawForge — Secure Claude Code Agent Gateway

ClawForge is a multi-channel AI agent platform that connects Claude Code CLI to messaging channels (Slack, Telegram, Web Chat) with strict Docker isolation between instances.

Forked from `stephengpope/thepopebot`, adapted to use Claude Code CLI instead of Pi agent.

## Architecture

Two-layer architecture:
1. **Event Handler** (Next.js) — Conversational AI layer. Receives messages from channels, orchestrates jobs.
2. **Job Container** (Docker) — Runs Claude Code CLI autonomously. Every action is a git commit, every change is a PR.

```
User → Channel (Slack/Telegram/Web) → Event Handler → create job branch → GitHub Actions → Docker Container (Claude Code) → PR → auto-merge/review → notification
```

## Directory Structure

```
/
├── api/                          # Next.js API route handlers
│   └── index.js                  # GET/POST catch-all (telegram, slack, github webhooks)
├── lib/                          # Core implementation
│   ├── ai/                       # LangGraph agent, model factory, tools
│   │   ├── agent.js              # ReAct agent with SQLite checkpointing
│   │   ├── tools.js              # create_job, get_job_status, get_system_technical_specs
│   │   ├── model.js              # Multi-provider LLM (anthropic/openai/google)
│   │   └── index.js              # chat(), chatStream(), summarizeJob()
│   ├── channels/                 # Channel adapters
│   │   ├── base.js               # Abstract ChannelAdapter interface
│   │   ├── telegram.js           # Telegram via grammy
│   │   ├── slack.js              # Slack via @slack/web-api
│   │   └── index.js              # Adapter factory (getTelegramAdapter, getSlackAdapter)
│   ├── tools/                    # Job creation, GitHub API, Telegram/Slack helpers
│   ├── auth/                     # NextAuth v5 (credentials provider)
│   ├── chat/                     # Web chat streaming + React components
│   ├── db/                       # SQLite via Drizzle ORM
│   ├── paths.js                  # Central path resolver
│   └── actions.js                # Action executor (agent/command/webhook)
├── config/                       # Base config (overridden by instances)
├── instances/                    # Per-instance configuration
│   ├── noah/                     # Noah's personal instance (all channels)
│   │   ├── Dockerfile
│   │   ├── config/               # SOUL.md, EVENT_HANDLER.md, AGENT.md
│   │   └── .env.example
│   └── strategyES/               # StrategyES dev agent (Slack only, Jim-restricted)
│       ├── Dockerfile
│       ├── config/
│       └── .env.example
├── templates/                    # Scaffolding templates
│   ├── docker/
│   │   ├── job/                  # Claude Code job container
│   │   │   ├── Dockerfile        # Node 22 + Claude Code CLI + Chrome deps
│   │   │   └── entrypoint.sh     # Clone → Claude Code → commit → PR
│   │   └── event-handler/        # PM2 + Next.js container
│   └── .github/workflows/
│       ├── run-job.yml           # Triggers Docker container on job/* branch
│       ├── auto-merge.yml        # Path-restricted auto-merge
│       ├── notify-pr-complete.yml
│       └── notify-job-failed.yml
├── docker-compose.yml            # Multi-instance orchestration
└── .env.example                  # All environment variables
```

## Key Decisions

- **Claude Code CLI** replaces Pi agent in job containers
- **`--allowedTools`** whitelist instead of `--dangerously-skip-permissions`
- **Separate Docker networks** for instance isolation (noah-net, strategyES-net)
- **Separate Slack apps** per instance (different workspaces, tokens, scopes)
- **Org-level GitHub Runner** shared across repos (jobs are repo-scoped by Actions)

## Channels

| Channel | Noah Instance | StrategyES Instance |
|---------|--------------|---------------------|
| Slack | Yes (Noah's user ID) | Yes (Jim's user ID, specific channels) |
| Telegram | Yes (chat ID restricted) | No |
| Web Chat | Yes (NextAuth credentials) | No |

## API Routes

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/slack/events` | POST | Slack signing secret | Slack event webhook |
| `/api/telegram/webhook` | POST | Telegram webhook secret | Telegram updates |
| `/api/telegram/register` | POST | API key | Register Telegram webhook |
| `/api/github/webhook` | POST | GH webhook secret | Job completion notifications |
| `/api/create-job` | POST | API key | Generic job creation |
| `/api/jobs/status` | GET | API key | Job status check |
| `/api/ping` | GET | Public | Health check |

## GitHub Secrets Convention

| Prefix | Passed to Container | LLM Can Access | Example |
|--------|--------------------|--------------------|---------|
| `AGENT_` | Yes | No (filtered) | `AGENT_GH_TOKEN` |
| `AGENT_LLM_` | Yes | Yes | `AGENT_LLM_BRAVE_API_KEY` |
| *(none)* | No | No | `GH_WEBHOOK_SECRET` |

## Job Execution Flow

1. Event Handler calls `createJob(description)` → pushes `job/{UUID}` branch with `logs/{UUID}/job.md`
2. `run-job.yml` triggers → spins up Docker container with Claude Code CLI
3. Container clones branch, reads job.md, executes via `claude -p`
4. All changes committed and pushed, PR created
5. `auto-merge.yml` checks ALLOWED_PATHS → merges or requires review
6. `notify-pr-complete.yml` → sends results back to Event Handler
7. Event Handler summarizes and creates notification

## StrategyES Isolation

The StrategyES instance CANNOT:
- Read/write any file outside `strategyes-lab`
- Access Noah's Docker network or containers
- See Noah's environment variables or API keys
- Send messages on Noah's channels
- Access Noah's GitHub repos or secrets
