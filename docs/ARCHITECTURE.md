# ClawForge — End-to-End Architecture

## What Is ClawForge?

ClawForge is a multi-channel AI agent gateway that connects **Claude Code CLI** to messaging platforms (Slack, Telegram, Web Chat). You describe what you want in conversation, and a Docker-isolated AI agent builds it, commits it, and sends you back a PR.

Forked from [stephengpope/thepopebot](https://github.com/stephengpope/thepopebot), adapted for Claude Code CLI with GSD workflow skills.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           C L A W F O R G E                                 │
│                                                                             │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐                                   │
│   │  Slack  │   │Telegram │   │Web Chat │     CHANNELS                      │
│   └────┬────┘   └────┬────┘   └────┬────┘                                   │
│        │             │             │                                        │
│        └─────────────┼────────────┘                                         │
│                      │ webhooks                                             │
│                      ▼                                                      │
│              ┌────────────────┐                                             │
│              │    Traefik     │     REVERSE PROXY (HTTPS / Let's Encrypt)   │
│              └───────┬────────┘                                             │
│                      │ routes by hostname                                   │
│           ┌──────────┴──────────┐                                           │
│           ▼                     ▼                                           │
│   ┌───────────────┐    ┌───────────────┐                                    │
│   │  Noah/Archie  │    │StrategyES/Epic│   EVENT HANDLERS                   │
│   │  (Next.js +   │    │  (Next.js +   │   (LangGraph ReAct Agent)          │
│   │   LangGraph)  │    │   LangGraph)  │                                    │
│   └───────┬───────┘    └───────┬───────┘                                    │
│           │                    │                                            │
│           │   create_job()     │                                            │
│           ▼                    ▼                                            │
│   ┌─────────────────────────────────┐                                       │
│   │         GitHub Actions          │     JOB ORCHESTRATION                 │
│   │  (run-job.yml on job/* branch)  │                                       │
│   └───────────────┬─────────────────┘                                       │
│                   │                                                         │
│                   ▼                                                         │
│   ┌─────────────────────────────────┐                                       │
│   │      Docker Job Container       │     EXECUTION                         │
│   │  ┌───────────────────────────┐  │                                       │
│   │  │  Claude Code CLI (-p)     │  │                                       │
│   │  │  + GSD Skills (30 cmds)   │  │                                       │
│   │  │  + Node.js 22 + gh CLI    │  │                                       │
│   │  └───────────────────────────┘  │                                       │
│   └───────────────┬─────────────────┘                                       │
│                   │                                                         │
│                   ▼                                                         │
│   ┌─────────────────────────────────┐                                       │
│   │    PR → Auto-Merge / Review     │     DELIVERY                          │
│   └───────────────┬─────────────────┘                                       │
│                   │                                                         │
│                   ▼                                                         │
│   ┌─────────────────────────────────┐                                       │
│   │  Notification → Slack Thread    │     NOTIFICATION ROUTING              │
│   │  + LangGraph Memory Injection   │                                       │
│   └─────────────────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The 10-Step Flow

```
 ┌──────┐                                                              ┌──────┐
 │ YOU  │                                                              │ YOU  │
 └──┬───┘                                                              └──▲───┘
    │ 1. Send message                                        10. Reply    │
    ▼                                                        in thread    │
 ┌──────────────────┐                                    ┌────────────────┴───┐
 │ 2. CHANNEL       │                                    │ NOTIFICATION       │
 │    (Slack/TG/Web)│                                    │ ROUTING            │
 └────────┬─────────┘                                    │ - Slack reply      │
          │ webhook                                      │ - LangGraph memory │
          ▼                                              └────────▲───────────┘
 ┌──────────────────┐                                             │
 │ 3. TRAEFIK       │                                    ┌────────┴───────────┐
 │    route by host │                                    │ 9. AUTO-MERGE      │
 └────────┬─────────┘                                    │    (path-checked)  │
          │                                              └────────▲───────────┘
          ▼                                                       │
 ┌──────────────────┐                                    ┌────────┴───────────┐
 │ 4. LANGGRAPH     │                                    │ 8. DOCKER          │
 │    AGENT         │                                    │    CONTAINER       │
 │    - SOUL.md     │                                    │    - clone branch  │
 │    - 3 tools     │                                    │    - claude -p     │
 │    - SQLite      │                                    │    - GSD skills    │
 └────────┬─────────┘                                    │    - commit + PR   │
          │ user approves                                └────────▲───────────┘
          ▼                                                       │
 ┌──────────────────┐                                    ┌────────┴───────────┐
 │ 5. CREATE_JOB    │                                    │ 7. GITHUB ACTIONS  │
 │    - UUID branch │                                    │    run-job.yml     │
 │    - job.md      │                                    │    - GHCR image    │
 │    - job_origins │──────── 6. git push ──────────────▶│    - secrets       │
 └──────────────────┘         triggers CI                └────────────────────┘
```

### Step 1: You Send a Message
Talk to **Archie** (Noah's agent) or **Epic** (StrategyES agent) through Slack, Telegram, or the web chat at `clawforge.scalingengine.com`.

### Step 2: Channel Receives It
The message hits one of three channel adapters:
- **Slack** — Events API webhook with HMAC-SHA256 signature verification
- **Telegram** — Bot API webhook with secret token
- **Web Chat** — NextAuth session + streaming response

### Step 3: VPS Routes to Correct Instance
Traefik reverse proxy (with automatic HTTPS via Let's Encrypt) routes to the correct Docker container:
- `clawforge.scalingengine.com` → Noah/Archie instance
- `strategyES.scalingengine.com` → StrategyES/Epic instance

Each instance runs in an isolated Docker network.

### Step 4: LangGraph Agent Processes
The event handler is a **LangGraph ReAct agent** with three tools:
- `create_job` — Dispatch an autonomous coding job
- `get_job_status` — Check running/completed jobs
- `get_system_technical_specs` — Read CLAUDE.md architecture docs

The agent uses its SOUL.md (personality) and EVENT_HANDLER.md (capabilities + GSD command reference) as system context. It stores conversation history in **SQLite via Drizzle ORM** with LangGraph checkpointing.

For simple questions, the agent answers directly. For tasks requiring code changes, it proposes a job description and waits for approval.

### Step 5: create_job Runs
When approved, the agent calls `create_job()` which:
1. Generates a UUID job ID
2. Creates a `job/{UUID}` branch on the target GitHub repo
3. Writes the job description to `logs/{UUID}/job.md`
4. Pushes the branch
5. **Saves the job origin** (thread ID + platform) to `job_origins` table for notification routing

### Step 6: Git Push Triggers GitHub Actions
The `job/*` branch push triggers `run-job.yml`, which passes the branch name, repo URL, and secrets to the job container.

### Step 7: GitHub Actions Runs the Job Container
The workflow pulls the pre-built Docker image from **GHCR** (GitHub Container Registry) and runs it with:
- `REPO_URL` — Which repo to clone
- `BRANCH` — Which job branch
- `GITHUB_TOKEN` — For git operations
- `SECRETS` — Env vars filtered from Claude Code
- `LLM_SECRETS` — Env vars accessible to Claude Code (API keys, etc.)

### Step 8: Docker Container Executes
The container (built from `docker/job/Dockerfile`):
1. Clones the job branch
2. Reads `config/SOUL.md` + `config/AGENT.md` for system context
3. Reads `logs/{UUID}/job.md` for the task
4. Runs **Claude Code CLI** in non-interactive mode:
   ```bash
   claude -p --output-format json \
     --append-system-prompt "$(cat /tmp/system-prompt.md)" \
     --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Task,Skill" \
     "${FULL_PROMPT}"
   ```
5. Claude Code reasons through the task, writes code, runs commands, uses **GSD skills** (30 commands for project planning, execution, debugging)
6. Commits all changes and pushes
7. Creates a PR targeting main

### Step 9: Auto-Merge
`auto-merge.yml` checks if changed files are within allowed paths:
- If yes → automatically merges the PR
- If no → leaves PR open for human review

### Step 10: Notification Routes Back
`notify-pr-complete.yml` sends a webhook to the event handler with job results. The handler:
1. Summarizes the job results using a one-shot LLM call
2. Saves a notification to the database
3. **Looks up `job_origins`** to find the originating thread
4. If Slack: posts the summary as a **reply in the original thread**
5. **Injects the summary into LangGraph memory** so the agent has context for follow-up questions

---

## Two Instances

```
                         ┌─────────────────────────┐
                         │       Traefik v3         │
                         │  (HTTPS / Let's Encrypt) │
                         └────────┬────────┬────────┘
                                  │        │
             clawforge.           │        │        strategyES.
             scalingengine.com    │        │        scalingengine.com
                                  │        │
                    ┌─────────────┘        └──────────────┐
                    ▼                                     ▼
     ┌──────────────────────────┐          ┌──────────────────────────┐
     │      NOAH / ARCHIE       │          │   STRATEGYES / EPIC      │
     │                          │          │                          │
     │  Channels:               │          │  Channels:               │
     │    Slack + Telegram + Web│          │    Slack + Web           │
     │                          │          │                          │
     │  Repos:                  │          │  Repos:                  │
     │    All ScalingEngine     │          │    strategyes-lab ONLY   │
     │                          │          │                          │
     │  Users: Noah only        │          │  Users: Jim only         │
     │                          │          │                          │
     │  Network: noah-net       │          │  Network: strategyES-net │
     │                          │          │                          │
     │  Skills: GSD (30 cmds)   │          │  Skills: GSD (30 cmds)   │
     └──────────────────────────┘          └──────────────────────────┘
              │                                       │
              │       SAME Docker Job Image (GHCR)    │
              │                                       │
              └──────────────┬────────────────────────┘
                             ▼
              ┌──────────────────────────┐
              │   Shared Job Container   │
              │   (node:22 + Claude CLI  │
              │    + GSD + gh CLI)       │
              │                          │
              │   Differentiated by:     │
              │   - AGENT.md (scope)     │
              │   - CLAUDE_ALLOWED_TOOLS │
              │   - Separate Slack apps  │
              └──────────────────────────┘
```

---

## Notification Routing (Slack Thread Replies)

```
  ┌────────────┐      1. User says               ┌─────────────────┐
  │   Slack    │      "build X"                  │  Event Handler  │
  │   Thread   │ ────────────────────────────▶   │  (LangGraph)    │
  │  #channel  │                                 └────────┬────────┘
  └─────▲──────┘                                          │
        │                                      2. create_job()
        │                                         saves origin:
  6. Reply in                                     job_origins table
     same thread                                  ┌──────────────┐
        │                                         │ jobId: abc123│
        │                                         │ threadId: C..│
  ┌─────┴──────┐                                  │ platform: sl │
  │ Slack API  │                                  └──────┬───────┘
  │ postMessage│                                         │
  └─────▲──────┘                                  3. git push
        │                                            job/abc123
        │                                                │
  5. Look up                                             ▼
     job_origins     ◄──── 4. Job completes ───── GitHub Actions
     route to                  PR merged              Docker
     original thread           webhook fires          Container
```

**Platform detection** (how we know where the message came from):
- Slack: `C0AGVADJDKK:1234567890.123456` (channel:timestamp)
- Telegram: `123456789` (numeric chat ID)
- Web Chat: `550e8400-e29b-41d4-a716-446655440000` (UUID)

---

## Job Container Internals

```
  ┌─────────────────────────────────────────────────────────┐
  │              Docker Job Container (GHCR)                │
  │                                                         │
  │  Base: node:22-bookworm-slim                            │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │  Installed Software                               │  │
  │  │                                                   │  │
  │  │  ● Node.js 22              (base image)           │  │
  │  │  ● GitHub CLI (gh)         (apt)                  │  │
  │  │  ● Chrome dependencies     (apt, for Playwright)  │  │
  │  │  ● Claude Code CLI         (npm -g)               │  │
  │  │  ● GSD Skills (30 cmds)    (npx get-shit-done-cc) │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │  Claude Code Allowed Tools                        │  │
  │  │                                                   │  │
  │  │  Read ─── Write ─── Edit ─── Bash                 │  │
  │  │  Glob ─── Grep ─── Task ─── Skill                 │  │
  │  │                      │        │                   │  │
  │  │              (GSD subagents) (/gsd:* commands)    │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │  entrypoint.sh Flow                               │  │
  │  │                                                   │  │
  │  │  1. Clone job branch                              │  │
  │  │  2. Read SOUL.md + AGENT.md → system prompt       │  │
  │  │  3. Read logs/{UUID}/job.md → task prompt         │  │
  │  │  4. claude -p --output-format json                │  │
  │  │     --append-system-prompt "..."                  │  │
  │  │     --allowedTools "Read,Write,..."               │  │
  │  │     "${FULL_PROMPT}"                              │  │
  │  │  5. git add + commit + push                       │  │
  │  │  6. gh pr create --base main                      │  │
  │  └───────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────┘
```

---

## Event Handler Internals

```
  ┌─────────────────────────────────────────────────────────┐
  │              Event Handler (Next.js + LangGraph)        │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │  API Routes                                       │  │
  │  │                                                   │  │
  │  │  POST /api/slack/events     ← Slack webhooks      │  │
  │  │  POST /api/telegram/webhook ← Telegram updates    │  │
  │  │  POST /api/github/webhook   ← Job completions     │  │
  │  │  POST /api/create-job       ← Generic job API     │  │
  │  │  GET  /api/jobs/status      ← Job status check    │  │
  │  │  GET  /api/ping             ← Health check        │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │  LangGraph ReAct Agent                            │  │
  │  │                                                   │  │
  │  │  System Context:                                  │  │
  │  │    SOUL.md ──── personality / voice               │  │
  │  │    EVENT_HANDLER.md ── capabilities + GSD ref     │  │
  │  │                                                   │  │
  │  │  Tools:                                           │  │
  │  │    create_job ──── dispatch coding job            │  │
  │  │    get_job_status ── check running/completed      │  │
  │  │    get_system_technical_specs ── read CLAUDE.md   │  │
  │  │                                                   │  │
  │  │  Memory:                                          │  │
  │  │    SQLite (Drizzle ORM) + LangGraph checkpoints   │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │  Database Tables (SQLite)                         │  │
  │  │                                                   │  │
  │  │  users ──── web chat accounts (NextAuth)          │  │
  │  │  chats ──── conversation threads                  │  │
  │  │  messages ── message history                      │  │
  │  │  notifications ── job result summaries            │  │
  │  │  subscriptions ── Telegram push subscriptions     │  │
  │  │  settings ── instance configuration               │  │
  │  │  job_origins ── thread routing (Slack replies)    │  │
  │  └───────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────┘
```

---

## Docker Network Isolation

```
                    ┌─────────────────────┐
                    │     proxy-net       │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │   Traefik     │  │
                    │  └───┬───────┬───┘  │
                    │      │       │      │
                    └──────┼───────┼──────┘
                           │       │
            ┌──────────────┘       └──────────────┐
            │                                     │
  ┌─────────┴───────────┐            ┌────────────┴──────────┐
  │     noah-net        │            │    strategyES-net     │
  │                     │            │                       │
  │  ┌───────────────┐  │            │  ┌─────────────────┐  │
  │  │ Noah/Archie   │  │            │  │ StrategyES/Epic │  │
  │  │ Event Handler │  │            │  │ Event Handler   │  │
  │  └───────────────┘  │            │  └─────────────────┘  │
  │                     │            │                       │
  │  ● Own .env         │            │  ● Own .env           │
  │  ● Own SQLite DB    │            │  ● Own SQLite DB      │
  │  ● Own Slack app    │            │  ● Own Slack app      │
  │  ● Can't see SES    │            │  ● Can't see Noah     │
  └─────────────────────┘            └───────────────────────┘
```

---

## GitHub Actions Workflows

```
  git push job/UUID branch
           │
           ▼
  ┌──────────────────────────────────────────────────────┐
  │  run-job.yml                                         │
  │                                                      │
  │  Trigger: push to job/* branch                       │
  │  Action:  Pull GHCR image, run container with:       │
  │           REPO_URL, BRANCH, GITHUB_TOKEN,            │
  │           SECRETS, LLM_SECRETS                       │
  └───────────────────────┬──────────────────────────────┘
                          │
                          ▼ (container creates PR)
  ┌──────────────────────────────────────────────────────┐
  │  auto-merge.yml                                      │
  │                                                      │
  │  Trigger: PR opened/synchronize                      │
  │  Check:   Are changed files in ALLOWED_PATHS?        │
  │                                                      │
  │     YES ──▶ Auto-merge PR                            │
  │     NO  ──▶ Leave open for human review              │
  └───────────────────────┬──────────────────────────────┘
                          │
                          ▼ (PR merged or closed)
  ┌──────────────────────────────────────────────────────┐
  │  notify-pr-complete.yml / notify-job-failed.yml      │
  │                                                      │
  │  Trigger: PR merged or job failure                   │
  │  Action:  POST webhook to event handler with:        │
  │           job ID, PR URL, status, changed files      │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
                 Event Handler receives webhook
                 → summarizeJob()
                 → createNotification()
                 → route to Slack thread (job_origins)
                 → inject into LangGraph memory
```

---

## GSD Commands Available in Jobs

```
  ┌─────────────────────────────────────────────────────────┐
  │              GSD Skills (30 Commands)                   │
  │                                                         │
  │  PROJECT LIFECYCLE                                      │
  │  ├── /gsd:new-project       Initialize from scratch     │
  │  ├── /gsd:new-milestone     Start milestone cycle       │
  │  ├── /gsd:complete-milestone Archive + next version     │
  │  ├── /gsd:audit-milestone   Verify goals met            │
  │  └── /gsd:plan-milestone-gaps Close audit gaps          │
  │                                                         │
  │  PHASE PLANNING & EXECUTION                             │
  │  ├── /gsd:discuss-phase     Gather context              │
  │  ├── /gsd:list-phase-assumptions Surface assumptions    │
  │  ├── /gsd:research-phase    Research approach           │
  │  ├── /gsd:plan-phase        Create PLAN.md              │
  │  ├── /gsd:execute-phase     Build with parallelization  │
  │  └── /gsd:verify-work       UAT validation              │
  │                                                         │
  │  QUICK TASKS & DEBUGGING                                │
  │  ├── /gsd:quick             Small tasks, atomic commits │
  │  └── /gsd:debug             Systematic debugging        │
  │                                                         │
  │  ROADMAP MANAGEMENT                                     │
  │  ├── /gsd:add-phase         Append phase to milestone   │
  │  ├── /gsd:insert-phase      Insert urgent work (72.1)   │
  │  ├── /gsd:remove-phase      Remove + renumber           │
  │  └── /gsd:progress          Status + next action        │
  │                                                         │
  │  SESSION MANAGEMENT                                     │
  │  ├── /gsd:pause-work        Context handoff             │
  │  ├── /gsd:resume-work       Restore context             │
  │  ├── /gsd:add-todo          Capture idea                │
  │  └── /gsd:check-todos       Work on captured todos      │
  │                                                         │
  │  CODEBASE & HEALTH                                      │
  │  ├── /gsd:map-codebase      Parallel analysis           │
  │  ├── /gsd:health            Diagnose + repair           │
  │  └── /gsd:cleanup           Archive old phases          │
  │                                                         │
  │  CONFIGURATION                                          │
  │  ├── /gsd:set-profile       quality/balanced/budget     │
  │  ├── /gsd:settings          Workflow toggles            │
  │  ├── /gsd:update            Update GSD version          │
  │  └── /gsd:reapply-patches   Reapply local mods          │
  └─────────────────────────────────────────────────────────┘

  DECISION GUIDE:
  ┌─────────────────────────────────────────────────────────┐
  │  "Build X from scratch"     → /gsd:new-project          │
  │  "Plan how to build X"      → /gsd:plan-phase           │
  │  "Execute the plan"         → /gsd:execute-phase        │
  │  "Fix this bug" (complex)   → /gsd:debug                │
  │  "Fix this bug" (simple)    → /gsd:quick                │
  │  "Add a file / small change"→ /gsd:quick                │
  │  "What's the status?"       → /gsd:progress             │
  │  "Start new version"        → /gsd:new-milestone        │
  │  "Analyze this codebase"    → /gsd:map-codebase         │
  └─────────────────────────────────────────────────────────┘
```

---

## Key Differences: ClawForge vs Local Claude Code

```
  ┌─────────────────────────────┐    ┌─────────────────────────────┐
  │   CLAWFORGE (Archie/Epic)   │    │     LOCAL CLAUDE CODE       │
  │                             │    │                             │
  │  Mode:                      │    │  Mode:                      │
  │    Non-interactive (-p)     │    │    Interactive conversation │
  │                             │    │                             │
  │  Skills:                    │    │  Skills:                    │
  │    GSD only (30 commands)   │    │    All (content, make,      │
  │                             │    │    manage, linear, bowser,  │
  │  MCP Servers:               │    │    marketing, gsd, etc.)    │
  │    None (unless Dockerfile) │    │                             │
  │                             │    │  MCP Servers:               │
  │  Memory:                    │    │    All connected (GHL,      │
  │    Per-thread LangGraph     │    │    Rube, Metricool, etc.)   │
  │    checkpoints              │    │                             │
  │                             │    │  Memory:                    │
  │  Output:                    │    │    Full memory directory    │
  │    Git commit + PR          │    │                             │
  │                             │    │  Output:                    │
  │  Best for:                  │    │    Direct file changes      │
  │    Autonomous background    │    │                             │
  │    jobs you don't want      │    │  Best for:                  │
  │    to babysit               │    │    Daily interactive work   │
  └─────────────────────────────┘    └─────────────────────────────┘

  They're complementary:
  ┌────────────────────────────────────────────────────────────────┐
  │  Local Claude Code ── interactive daily driver with all tools  │
  │  ClawForge ───────── fire-and-forget autonomous jobs           │
  └────────────────────────────────────────────────────────────────┘
```

---

## Per-Instance Skill Customization

```
  ┌──────────────────────────────────────────────────────────────┐
  │              SHARED Docker Job Image (GHCR)                  │
  │                                                              │
  │  Everything installed in Dockerfile is available to BOTH:    │
  │  Claude Code CLI, GSD Skills, Node.js, gh CLI, Chrome deps   │
  └──────────────┬──────────────────────────┬────────────────────┘
                 │                          │
                 ▼                          ▼
  ┌──────────────────────────┐  ┌──────────────────────────┐
  │   Noah / Archie          │  │   StrategyES / Epic      │
  │                          │  │                          │
  │   AGENT.md:              │  │   AGENT.md:              │
  │     "All SE repos"       │  │     "strategyes-lab ONLY"│
  │                          │  │                          │
  │   CLAUDE_ALLOWED_TOOLS:  │  │   CLAUDE_ALLOWED_TOOLS:  │
  │     (all 8 tools)        │  │     (can restrict)       │
  │                          │  │                          │
  │   Slack App:             │  │   Slack App:             │
  │     SE workspace         │  │     SES workspace        │
  └──────────────────────────┘  └──────────────────────────┘

  Differentiation is through CONFIG, not separate images.
```

---

## Adding MCP Servers to Jobs

MCPs can be added to the job container:
1. Install server dependencies in `docker/job/Dockerfile`
2. Configure in `/root/.claude/settings.json` (or project `.claude/settings.json`)
3. Pass API keys via GitHub secrets with `AGENT_LLM_` prefix

---

## Keeping Updated from Upstream

ClawForge tracks the upstream `thepopebot` repo:

```bash
git fetch upstream
git log --oneline main..upstream/main  # See what's new
git cherry-pick <hash>                  # Pick specific commits
```

Cherry-pick is safer than merge due to significant divergence.

---

## Deployment

```
  LOCAL                              VPS
  ┌────────────────┐                ┌─────────────────────────┐
  │  git push      │                │                         │
  │  origin main   │ ──────────────▶│  1. git pull            │
  └────────┬───────┘                │  2. docker compose build│
           │                        │  3. docker compose up -d│
           │                        │                         │
           │  If docker/job/**      │  Drizzle migrations     │
           │  changed:              │  auto-run on startup    │
           ▼                        └─────────────────────────┘
  ┌────────────────┐
  │ build-image.yml│
  │ auto-triggers  │
  │ rebuilds GHCR  │
  │ job image      │
  └────────────────┘
```

---

## GitHub Secrets Convention

```
  ┌──────────────────┬─────────────────────┬────────────────────┐
  │  Prefix          │  Passed to          │  Claude Code       │
  │                  │  Container?         │  Can Access?       │
  ├──────────────────┼─────────────────────┼────────────────────┤
  │  AGENT_          │  Yes                │  No (filtered)     │
  │  AGENT_LLM_      │  Yes                │  Yes               │
  │  (none)          │  No                 │  No                │
  └──────────────────┴─────────────────────┴────────────────────┘

  Examples:
    AGENT_GH_TOKEN        → container uses, Claude can't see
    AGENT_LLM_BRAVE_KEY   → container uses, Claude CAN see
    GH_WEBHOOK_SECRET     → stays in GitHub, never in container
```

---

## Key Files

```
  clawforge/
  ├── api/
  │   └── index.js ─────────── All webhook handlers (Slack, TG, GitHub)
  ├── lib/
  │   ├── ai/
  │   │   ├── agent.js ──────── ReAct agent + SQLite checkpointing
  │   │   ├── tools.js ──────── create_job, get_job_status, get_specs
  │   │   ├── model.js ──────── Multi-provider LLM factory
  │   │   └── index.js ──────── chat(), chatStream(), summarizeJob()
  │   ├── channels/
  │   │   ├── slack.js ──────── HMAC verify, threading, file download
  │   │   └── telegram.js ──── Telegram bot adapter
  │   ├── db/
  │   │   ├── schema.js ─────── 7 tables (users, chats, messages, etc.)
  │   │   └── job-origins.js ── saveJobOrigin(), getJobOrigin()
  │   └── chat/
  │       └── components/ ──── Web chat UI (app-sidebar, ascii-logo)
  ├── instances/
  │   ├── noah/config/ ──────── SOUL.md, EVENT_HANDLER.md, AGENT.md
  │   └── strategyES/config/ ── SOUL.md, EVENT_HANDLER.md, AGENT.md
  ├── docker/
  │   └── job/
  │       ├── Dockerfile ────── Job container image definition
  │       └── entrypoint.sh ─── Clone → Claude Code → commit → PR
  └── docker-compose.yml ────── Multi-instance orchestration
```
