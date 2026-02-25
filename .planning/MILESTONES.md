# Milestones

## v1.0 Foundation & Observability (Shipped: 2026-02-24)

**Phases:** 1-4, 6 plans
**Archive:** milestones/v1.0-ROADMAP.md (if exists)

**Key accomplishments:**
- Job containers run Claude Code CLI via `claude -p` with GSD installed globally
- Preflight diagnostics, PostToolUse observability hook, template sync
- Test harness for local Docker GSD verification
- Imperative AGENT.md instructions for consistent GSD invocation

---

## v1.1 Agent Intelligence & Pipeline Hardening (Shipped: 2026-02-25)

**Phases:** 5-8, 7 plans, ~10 tasks
**Timeline:** 24 days (2026-02-01 → 2026-02-25)
**Files changed:** 45 (+5,023 / -257)
**Archive:** milestones/v1.1-ROADMAP.md, milestones/v1.1-REQUIREMENTS.md

**Key accomplishments:**
- Pipeline hardening: zero-commit PR guard, 30-min runner timeout, failure stage detection (docker_pull/auth/claude)
- Smart job prompts: structured FULL_PROMPT with CLAUDE.md injection (8k cap), package.json stack, GSD routing hints
- Previous job context: follow-up jobs receive prior merged job summary scoped by thread ID
- Notification accuracy: failure stage surfaced in Slack/Telegram, explicit gsd-invocations.jsonl lookup
- Test harness sync: test-entrypoint.sh aligned with production 5-section prompt and file-redirect delivery
- Full template sync: all workflows byte-for-byte identical between live and templates/

---

