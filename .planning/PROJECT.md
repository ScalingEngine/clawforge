# ClawForge — Secure Claude Code Agent Gateway

## What This Is

A multi-channel AI agent platform that connects Claude Code CLI to messaging channels (Slack, Telegram, Web Chat) with strict Docker isolation between instances. Two-layer architecture: Event Handler (LangGraph ReAct agent) dispatches jobs to ephemeral Docker containers running Claude Code CLI with GSD workflows.

## Core Value

Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results without operator intervention.

## Current Milestone: v1.1 — Agent Intelligence & Pipeline Hardening

**Goal:** Perfect Tier 2 pipeline reliability and build Tier 3 Level 1 (smart job prompts — Event Handler generates custom system prompt per job based on target repo context).

**Target features:**
- Pipeline reliability hardening (conditional PRs, error handling, notification accuracy)
- Smart job prompts (repo CLAUDE.md, package.json, tech stack pulled before dispatch)
- Previous job context injection (agent starts warm, not cold-discovering)
- Event Handler routing improvements (quick vs plan-phase thresholds)

## Requirements

### Validated

<!-- Shipped and confirmed valuable — v1.0 -->

- ✓ Job containers run Claude Code CLI via `claude -p` with system prompt injection — v1.0
- ✓ SOUL.md + AGENT.md are concatenated into system prompt at runtime — v1.0
- ✓ `--allowedTools` whitelist controls available tools (includes Task, Skill) — v1.0
- ✓ GSD is installed globally in job Docker image — v1.0
- ✓ Git-as-audit-trail: every job creates a branch, commits, and opens a PR — v1.0
- ✓ Instance isolation via separate Docker networks and scoped repos — v1.0
- ✓ Preflight diagnostics (HOME, claude path, GSD directory) — v1.0
- ✓ PostToolUse hook for GSD invocation observability — v1.0
- ✓ Test harness for local Docker GSD verification — v1.0
- ✓ Imperative AGENT.md instructions ("MUST use Skill tool") — v1.0
- ✓ Template sync (docker/job/ ↔ templates/docker/job/) — v1.0

### Active

<!-- v1.1 scope — to be defined in REQUIREMENTS.md -->

(Defined in REQUIREMENTS.md)

### Out of Scope

- Max subscription auth (switching from API keys) — defer until volume justifies
- Tier 3 Level 2: Instance generator (Archie standing up new instances) — future milestone
- Tier 3 Level 3: Self-improving agents (meta-agent reviewing success/failure) — future milestone
- Tier 3 Level 4: Agent marketplace / composition — future milestone
- New channel integrations — existing Slack/Telegram/Web sufficient

## Context

- **Codebase mapped**: `.planning/codebase/` has 7 documents covering architecture, stack, conventions, concerns
- **Two Dockerfiles exist**: `docker/job/Dockerfile` (live, has GSD) vs `templates/docker/job/Dockerfile` (stale, no GSD)
- **Two entrypoints exist**: `docker/job/entrypoint.sh` (live, includes Task+Skill) vs `templates/docker/job/entrypoint.sh` (stale, missing Task+Skill)
- **Potential silent failure**: GSD installs to `/root/.claude/` but if `HOME` isn't set or Claude Code looks elsewhere, skills won't be found — agent would just ignore the AGENT.md instructions about GSD
- **No existing test harness**: No way to trigger a test job and verify GSD usage without manually reading raw claude-output.json
- **API keys in `.env.vps`**: Real Anthropic keys exposed in tracked file — security concern to address

## Constraints

- **Docker isolation**: Changes must work within the existing Docker container model — no host filesystem mounts for GSD
- **GitHub Actions**: Job containers are triggered by Actions workflows, so testing requires either local Docker or a GH Actions run
- **Two instances**: Any changes must work for both Archie (full access) and Epic (scoped to strategyes-lab)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GSD installed globally in Docker image | Simpler than repo-level install, survives across job repos | -- Pending verification |
| Template drift accepted for now | Live docker/ files were updated but templates weren't synced | -- Pending resolution |
| Focus on verification before Max subscription | Need to prove current setup works before changing auth model | -- Pending |
| Replaced advisory GSD language ("Default choice") with imperative ("MUST use Skill tool") in both instance AGENT.md files | Advisory language produces ~50% GSD invocation reliability per Phase 3 research. Fixture imperative language produces consistent invocations in test harness. Baseline pre-Phase-4: advisory language untested against live production runs (no live test run performed before edit). | TEST-02 satisfied |

---
*Last updated: 2026-02-24 after milestone v1.1 start*
