# ClawForge — Secure Claude Code Agent Gateway

## What This Is

A multi-channel AI agent platform that connects Claude Code CLI to messaging channels (Slack, Telegram, Web Chat) with strict Docker isolation between instances. Two-layer architecture: Event Handler (LangGraph ReAct agent) dispatches jobs to ephemeral Docker containers running Claude Code CLI with GSD workflows. Agents receive structured prompts with repo context and prior job history, producing high-quality results autonomously.

## Core Value

Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results without operator intervention.

## Current Milestone: v1.2 Cross-Repo Job Targeting

**Goal:** Enable job containers to clone and operate on any allowed target repo, not just clawforge.

**Target features:**
- Allowed repos configuration per instance
- Agent repo selection from allowed list based on user message context
- Container clones target repo at runtime (entrypoint modification)
- PRs created on target repo
- Notifications with correct target repo PR URLs
- Single PAT per instance scoped to allowed repos
- No regression on same-repo (clawforge) jobs

## Current State (after v1.1)

**Shipped:** v1.0 Foundation + v1.1 Agent Intelligence & Pipeline Hardening
**Codebase:** 5,651 LOC JavaScript (Next.js + LangGraph + Drizzle ORM)
**Instances:** 2 (Noah/Archie — full access, StrategyES/Epic — scoped)

**What works:**
- Full job pipeline for **same-repo jobs**: message → Event Handler → job branch → GitHub Actions → Docker container → Claude Code CLI → PR → auto-merge → notification
- Structured 5-section FULL_PROMPT (Target, Docs, Stack, Task, GSD Hint) with CLAUDE.md injection
- Previous job context: follow-up jobs start warm with prior merged job summary
- Failure stage detection and surfacing in notifications (docker_pull/auth/claude)
- Zero-commit PR guard, 30-min timeout, explicit JSONL lookup
- Test harness aligned with production prompt format
- All templates byte-for-byte synced with live files

## Requirements

### Validated

- ✓ Job containers run Claude Code CLI via `claude -p` with system prompt injection — v1.0
- ✓ SOUL.md + AGENT.md concatenated into system prompt at runtime — v1.0
- ✓ `--allowedTools` whitelist controls available tools (includes Task, Skill) — v1.0
- ✓ GSD installed globally in job Docker image — v1.0
- ✓ Git-as-audit-trail: every job creates a branch, commits, and opens a PR — v1.0
- ✓ Instance isolation via separate Docker networks and scoped repos — v1.0
- ✓ Preflight diagnostics (HOME, claude path, GSD directory) — v1.0
- ✓ PostToolUse hook for GSD invocation observability — v1.0
- ✓ Test harness for local Docker GSD verification — v1.0
- ✓ Imperative AGENT.md instructions ("MUST use Skill tool") — v1.0
- ✓ Template sync (docker/job/ ↔ templates/docker/job/) — v1.0
- ✓ Pipeline hardening: conditional PRs, failure stage detection, timeouts — v1.1
- ✓ Smart job prompts: CLAUDE.md + package.json injection, GSD routing hints — v1.1
- ✓ Previous job context: thread-scoped merged job summaries — v1.1
- ✓ Notification accuracy: failure stage in messages, explicit JSONL lookup — v1.1
- ✓ Test-production alignment: 5-section prompt, file-redirect delivery — v1.1

### Active

- [ ] Allowed repos configuration per instance with repo-to-owner mapping
- [ ] Agent selects target repo from allowed list based on user message
- [ ] Job containers clone and operate on the target repo
- [ ] PRs created on the target repo, not clawforge
- [ ] Notifications include correct target repo PR URLs
- [ ] Single PAT per instance for target repo access
- [ ] Same-repo (clawforge) jobs continue working without regression

### Out of Scope

- Max subscription auth (switching from API keys) — defer until volume justifies
- Tier 3 Level 2: Instance generator (Archie standing up new instances) — future milestone
- Tier 3 Level 3: Self-improving agents (meta-agent reviewing success/failure) — future milestone
- Tier 3 Level 4: Agent marketplace / composition — future milestone
- New channel integrations — existing Slack/Telegram/Web sufficient
- OpenTelemetry integration — hooks + committed logs sufficient for 2 instances
- Full repo tree fetch in context — rate limits + noise; CLAUDE.md + package.json only

## Context

- **Codebase mapped**: `.planning/codebase/` has 7 documents covering architecture, stack, conventions, concerns
- **Templates synced**: All docker/ and workflow files byte-for-byte identical with templates/
- **SQLite DB**: job_outcomes table tracks completions for prior-context injection
- **Prompt architecture**: 5-section structured FULL_PROMPT delivered via /tmp/prompt.txt file redirect
- **`.env.vps`**: Added to `.gitignore` (v1.0 security fix)
- **Cross-repo jobs broken**: Job containers run inside clawforge's GitHub Actions checkout. When a job targets a different repo (e.g., NeuroStory), the entrypoint has no mechanism to clone the target repo — Claude operates on clawforge's working tree instead. The notification falsely reports success with a stale PR URL. Discovered 2026-02-25 when a NeuroStory README job reported "Merged" but no changes landed. **Same-repo jobs work correctly.** Cross-repo targeting needs its own phase.

## Constraints

- **Docker isolation**: Changes must work within the existing Docker container model — no host filesystem mounts for GSD
- **GitHub Actions**: Job containers are triggered by Actions workflows, so testing requires either local Docker or a GH Actions run
- **Two instances**: Any changes must work for both Archie (full access) and Epic (scoped to strategyes-lab)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GSD installed globally in Docker image | Simpler than repo-level install, survives across job repos | ✓ Working in production |
| Template sync via `cp` not manual edit | Eliminates drift risk, byte-for-byte guarantee | ✓ Good — all templates synced |
| Focus on verification before Max subscription | Need to prove current setup works before changing auth model | ✓ Pipeline proven reliable |
| Imperative AGENT.md instructions | Advisory language ~50% reliability; imperative produces consistent invocations | ✓ TEST-02 satisfied |
| SHA-based zero-commit PR guard | Safer than git status with shallow clones | ✓ Prevents empty PRs |
| 30-min hardcoded timeout | Simpler for 2 instances, not configurable | ✓ Prevents runner lock-up |
| Artifact-based failure stage detection | Checks presence of preflight.md/claude-output.jsonl to infer stage | ✓ Accurate categorization |
| CLAUDE.md injection at entrypoint side | Fresher than Event Handler pre-fetch; 8k char cap prevents context bloat | ✓ Smart prompts working |
| GSD hint defaults to 'quick' | Upgrades to 'plan-phase' on complexity keywords | ✓ Routing appropriate |
| job_outcomes with UUID PK | Allows multiple outcomes per job; TEXT column for changedFiles | ✓ Persistence working |
| Thread-scoped prior context lookup | Filters by thread_id for instance isolation, merge_result='merged' gate | ✓ Warm starts working |
| failure_stage in summarizeJob userMessage | Uses existing .filter(Boolean) pattern; no system prompt change needed | ✓ Stage surfaced |

---
*Last updated: 2026-02-25 after v1.2 milestone start*
