# ClawForge — GSD Integration Verification & Hardening

## What This Is

A verification and hardening effort to ensure ClawForge's job containers (Archie and Epic) are actually using GSD skills when running Claude Code CLI. The containers have GSD installed and allowed tools configured, but there's no way to confirm whether agents invoke GSD workflows in practice, and no test harness to prove the chain works end-to-end.

## Core Value

When Archie or Epic receives a task, it should use GSD structured workflows (`/gsd:quick`, `/gsd:plan-phase`) by default, and operators should be able to verify this from job logs.

## Requirements

### Validated

- Job containers run Claude Code CLI via `claude -p` with system prompt injection
- SOUL.md + AGENT.md are concatenated into system prompt at runtime
- `--allowedTools` whitelist controls available tools (defaults include Task, Skill)
- GSD is installed globally in job Docker image via `npx get-shit-done-cc@latest --claude --global`
- Git-as-audit-trail: every job creates a branch, commits, and opens a PR
- Instance isolation via separate Docker networks and scoped repos
- Two instances configured: Archie (noah, all repos) and Epic (strategyES, strategyes-lab only)

### Active

- [ ] Verify GSD skills are discoverable by Claude Code inside job containers
- [ ] Verify `HOME` and `~/.claude/` paths resolve correctly so GSD is found at runtime
- [ ] Job output logs clearly show when GSD skills were invoked
- [ ] Agents default to GSD workflows when given substantial tasks
- [ ] A test job can be triggered that proves the full GSD chain works
- [ ] Template drift resolved — `templates/docker/job/` matches actual `docker/job/`

### Out of Scope

- Max subscription auth (switching from API keys) — deferred to next milestone
- New channel integrations — existing Slack/Telegram/Web sufficient
- Event Handler changes — focus is on the job container side only
- LangGraph agent improvements — the conversational layer is working fine

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

---
*Last updated: 2026-02-23 after initialization*
