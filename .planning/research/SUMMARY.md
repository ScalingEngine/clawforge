# Project Research Summary

**Project:** ClawForge — GSD Integration Verification & Hardening
**Domain:** Claude Code CLI agent observability in Docker job containers
**Researched:** 2026-02-23
**Confidence:** HIGH (stack, architecture, pitfalls) / MEDIUM (GSD auto-invocation reliability)

## Executive Summary

ClawForge's job containers already have the structural ingredients for GSD integration: Claude Code 2.1.x with `--allowedTools Skill,Task`, `get-shit-done-cc` installed globally, and a two-stage entrypoint that builds a system prompt and invokes `claude -p`. The problem is that both recorded production job runs failed at the most basic level — `claude -p` received no input prompt, producing only "Input must be provided either through stdin or as a prompt argument" in the output. This means zero real evidence exists on whether GSD is discoverable or used by the agent. Everything else — hook design, output parsing, AGENT.md instruction quality — is speculation until the root cause of the empty prompt is diagnosed and fixed.

The recommended approach treats this as a three-phase hardening effort: (1) fix the broken entrypoint and verify GSD is actually installed and discoverable at runtime, (2) add structured observability so GSD invocations are recorded and visible without manual log spelunking, and (3) run a test harness that proves the full chain end-to-end. The key architectural insight is that all verification work belongs inside the job container execution flow — not in the Event Handler — because the container has direct access to the raw tool call stream while the Event Handler only sees a summarized webhook payload.

The primary risk is that GSD auto-invocation is unreliable by design: community sources report roughly 50% success rates even when GSD is correctly installed and discoverable. The mitigation is two-pronged — strengthen AGENT.md instructions to be imperative rather than advisory, and add PostToolUse hook-based logging so operators can verify after each job whether GSD was actually called. Neither mitigation can be validated until the entrypoint prompt delivery bug is fixed first.

## Key Findings

### Recommended Stack

The existing stack is correct and requires no new technologies. Claude Code 2.1.50 on Node 22 (bookworm-slim) with `get-shit-done-cc@1.20.6` is the right foundation. The critical insight is that GSD installs to `~/.claude/commands/gsd/` and `~/.claude/agents/` — NOT `~/.claude/skills/` — and the `HOME` environment variable is what determines where Claude Code discovers these artifacts at runtime. In the job container, `HOME=/root` is an implicit assumption (no explicit `ENV HOME=/root` directive in the Dockerfile) that holds today but is fragile.

**Core technologies:**
- `@anthropic-ai/claude-code@2.1.50`: Claude Code CLI runtime — pin the version; `@latest` changes behavior without notice
- `get-shit-done-cc@1.20.6`: GSD skill system — installs to `~/.claude/commands/gsd/` and `~/.claude/agents/`; verify both directories at build time
- Node 22 (bookworm-slim): Container base — required for Claude Code 2.x; runs as root so `HOME=/root` holds
- `--output-format stream-json`: Replace the current `--output-format json` — stream-json emits tool_use events per line, enabling GSD detection; the current json format emits only a final summary
- `jq`: Already installed — sufficient for Phase 1 GSD detection; switch to a Node.js script for Phase 2 when tool_use/tool_result correlation is needed

**What NOT to use:**
- `/gsd:quick` slash-command syntax in AGENT.md — user-invoked commands are interactive-only; headless `-p` mode requires `Skill(gsd:quick)` invocation syntax
- `--dangerously-skip-permissions` — does not fix GSD non-invocation; the issue is path resolution or prompt instruction, not permissions
- Mounting `~/.claude/` from host — breaks isolation and introduces host secrets

### Expected Features

The milestone goal is narrow: prove that GSD is discoverable and invoked by the agent in production job runs. Features are scoped to that question only.

**Must have (table stakes):**
- Fix entrypoint prompt delivery — `FULL_PROMPT` is empty in both recorded runs; this is the blocker for everything else
- GSD path confirmed at runtime — diagnostic echo of `HOME` and `ls ~/.claude/commands/gsd/` before `claude -p`
- Skill tool appears as identifiable event in output — needed to prove GSD invocations are detectable
- Template drift resolved — `templates/docker/job/` is missing GSD install and `Task,Skill` from `ALLOWED_TOOLS`; testing the template tests a broken image

**Should have (differentiators):**
- PostToolUse hook for Skill logging — writes `gsd-invocations.jsonl` automatically during job execution; no post-processing needed; hook fires synchronously
- Test job that exercises the full chain — deterministic synthetic job requiring `/gsd:quick`; runs locally via Docker without production credentials
- Stop hook GSD summary — writes one-line GSD usage count at session end
- `--output-format stream-json` migration — enables real-time tool detection; also fixes the `.jsonl` vs `.json` extension mismatch that causes `notify-pr-complete.yml` to send an empty log field

**Defer (v2+):**
- OpenTelemetry integration — overkill for 2 Docker instances; adds infrastructure dependency
- Compliance enforcement via Stop hook blocking — only after 20+ successful jobs confirm baseline behavior; enforce only after you understand normal
- Real-time monitoring dashboard — requires Event Handler changes explicitly out of scope

### Architecture Approach

All verification and observability work lives inside the job container execution flow. The entrypoint (`entrypoint.sh`) has two natural hook points: post-prompt-build/pre-`claude` (for pre-flight verification) and post-`claude`/pre-commit (for output parsing). Both produce files written to `logs/{jobId}/` which are already committed via `git add -A` and surface in the PR diff. This design adds zero new infrastructure and preserves the existing Event Handler interface.

**Major components:**
1. Pre-Flight Verifier (shell function in entrypoint) — validates `HOME`, claude binary on PATH, GSD commands and agents directories present, API key set; writes `preflight.md`; exits non-zero on hard failures only
2. Output Log Parser (jq pipeline or Node.js script) — reads `claude-output.json` after `claude -p` completes; extracts `tool_use` events; writes `observability.md` (human summary) and `tool-usage.json` (structured data)
3. Test Harness (`tests/` directory) — local `docker run` script with a fixed `gsd-test-job.md` fixture; `validate-output.sh` reads `tool-usage.json` and exits non-zero if no GSD calls detected

**Build order is strictly dependency-driven:** Template sync first (so local Docker builds the right image), then pre-flight verifier (confirms environment state), then output parser (requires working `claude-output.json`), then test harness (requires both parser evidence and confirmed environment), then AGENT.md tuning (requires test harness evidence of what the agent actually does).

**Known bug to fix:** `notify-pr-complete.yml` looks for `*.jsonl` but entrypoint produces `*.json`. Fix the workflow `find` pattern to match both extensions.

### Critical Pitfalls

1. **GSD silently missing because HOME resolves wrong at runtime** — Add `ENV HOME=/root` explicitly to `Dockerfile`; add build-time smoke tests (`RUN ls /root/.claude/commands/gsd/quick.md`) so a missing GSD install fails the build loudly rather than silently producing a broken image used only when a job runs

2. **Task and Skill missing from ALLOWED_TOOLS in templates** — The live `entrypoint.sh` has `Task,Skill` but `templates/docker/job/entrypoint.sh` does not; new instances scaffolded from templates silently lose GSD capability; sync templates immediately and add a CI diff check

3. **GSD agents directory separately absent from commands directory** — GSD installs two separate artifact sets; slash commands may exist while agents are missing; `Skill(gsd:quick)` starts but fails mid-execution when it spawns a Task sub-agent that does not exist; verify both `commands/gsd/` and `agents/` at build time

4. **Empty system prompt when config files missing from target repo** — Entrypoint reads `SOUL.md` and `AGENT.md` from the cloned target repo, not the ClawForge repo; if the target repo does not have `/job/config/`, the agent runs naked with no GSD instructions; add validation that exits non-zero if `SYSTEM_PROMPT` is empty

5. **GSD invocation invisible in JSON output** — `--output-format json` emits only a final summary; tool_use events are buried in the JSON structure and not visible without a parser; switch to `--output-format stream-json` and add a post-job parser to surface GSD calls in the PR

## Implications for Roadmap

Based on research, four phases in strict dependency order:

### Phase 1: Foundation Fix and Environment Hardening
**Rationale:** Nothing else can be validated until `claude -p` actually receives a prompt. This is the blocking bug. Environment hardening goes here because pre-flight verification is the first thing added to a working entrypoint — and template sync is prerequisite to local Docker testing of any changes.
**Delivers:** A working `claude -p` invocation with confirmed GSD path; a pre-flight diagnostic block committed to `preflight.md` in every job; templates matching live files
**Addresses:** Fix entrypoint prompt delivery (table stakes blocker), entrypoint diagnostic block, template drift resolution
**Avoids:** Pitfalls 1 (HOME path), 2 (template drift), 3 (agents directory), 4 (empty system prompt)
**Research flag:** None — all patterns are well-documented and verified against the live codebase

### Phase 2: Output Observability
**Rationale:** Once `claude -p` produces real output, the next gap is that GSD invocations are invisible in the JSON output. This phase makes them detectable and human-readable. Switching to `stream-json` also fixes the `.jsonl`/`.json` extension bug that causes the notification workflow to send an empty log.
**Delivers:** `observability.md` and `tool-usage.json` committed to every job PR; `gsd-invocations.jsonl` written by PostToolUse hook during execution; notification workflow sends actual log content
**Uses:** `--output-format stream-json`, `jq` pipeline, Claude Code hooks (PostToolUse + Stop)
**Implements:** Output Log Parser component; PostToolUse hook in `.claude/settings.json`
**Avoids:** Pitfall 5 (GSD invocation invisible in JSON output)
**Research flag:** LOW — hooks PostToolUse schema for the `Skill` tool is not officially documented; the exact `tool_name` field value needs validation against a real successful run before finalizing the hook matcher

### Phase 3: Test Harness and End-to-End Validation
**Rationale:** With a working entrypoint and parseable output, a local test harness proves the full GSD chain deterministically without production credentials or Slack round-trips. This is the evidence gate before AGENT.md tuning.
**Delivers:** `tests/test-job.sh`, `tests/fixtures/gsd-test-job.md`, `tests/validate-output.sh`; PASS/FAIL result from a local Docker run against a synthetic job; confirmed evidence of GSD invocation (or confirmed absence)
**Addresses:** Test job feature (P1 in FEATURES.md)
**Implements:** Test Harness component
**Research flag:** None — standard Docker test harness pattern

### Phase 4: AGENT.md Tuning and Instruction Hardening
**Rationale:** This phase is conditional on Phase 3 evidence. If the test harness shows GSD is available but not being invoked, the issue is instruction-following, not discoverability. Only then does tightening AGENT.md make sense — and only with specific evidence of what the agent is doing instead of GSD.
**Delivers:** Revised AGENT.md with imperative GSD instructions; AGENT.md instruction audit based on Phase 3 output logs; documented baseline behavior for both Archie and Epic instances
**Avoids:** ~50% auto-invocation failure rate (STACK.md finding) by making instructions imperative rather than advisory
**Research flag:** MEDIUM — no official Anthropic guidance on what instruction phrasing maximizes Skill tool usage; community sources agree strong imperatives help but no controlled study exists

### Phase Ordering Rationale

- Phase 1 must come first because both recorded production runs show a broken entrypoint; all other phases assume `claude -p` produces meaningful output
- Phase 2 before Phase 3 because the test harness needs the output parser to have something to assert against; `validate-output.sh` reads `tool-usage.json` which Phase 2 produces
- Phase 3 before Phase 4 because AGENT.md changes should be informed by actual observed behavior, not speculation; tuning a prompt without baseline evidence is guesswork
- Template sync is the first sub-task of Phase 1 because it prevents further divergence during development and enables local Docker testing

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (PostToolUse hook):** Confirm the exact `tool_name` value when `Skill` is invoked — research found it is likely `"Skill"` but this is LOW confidence and must be validated against a real successful run before writing the hook matcher; use `--verbose` during a test run to inspect raw tool call records
- **Phase 4 (AGENT.md tuning):** Consult GSD documentation and Anthropic headless mode guidance on how to phrase imperative skill invocation instructions; the specific wording matters for ~50% auto-invocation baseline

Phases with standard patterns (can skip research-phase):
- **Phase 1 (Foundation Fix):** All patterns verified from direct codebase inspection; entrypoint fix, pre-flight shell function, and template sync are mechanical with no ambiguous behavior
- **Phase 3 (Test Harness):** Standard Docker test harness pattern; no novel integration required

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified via direct filesystem inspection of live GSD install, official Claude Code docs, and live Dockerfile inspection; one MEDIUM exception: `stream-json` tool_use field names need validation against a real run |
| Features | MEDIUM | Table stakes features well-understood; PostToolUse Skill hook schema is LOW confidence — `Skill` is not listed in the hooks reference; needs runtime verification |
| Architecture | HIGH | Derived from direct codebase analysis of live files with line-level precision; one MEDIUM item: `claude-output.json` stream structure inferred from docs patterns, not directly observed from a successful run |
| Pitfalls | HIGH | All critical pitfalls identified from direct inspection of live vs. template file divergence; HOME path assumption verified as implicit (no `ENV HOME` directive); `.env.vps` security issue confirmed from git status |

**Overall confidence:** HIGH for what needs to be built; MEDIUM for exact behavior of GSD invocation once the entrypoint is fixed

### Gaps to Address

- **Root cause of empty FULL_PROMPT:** Research identifies the most likely cause (job.md missing or empty in cloned branch at time of failing runs) but this must be reproduced and confirmed during Phase 1 before writing a fix. Do not assume the cause — inspect the failing job branches directly.
- **PostToolUse Skill tool_name value:** The exact string that appears as `tool_name` when the `Skill` tool is invoked is not officially documented. If it is not `"Skill"`, the hook matcher will silently fail. Validate with `--verbose` during a Phase 1 test run before writing Phase 2 hook logic.
- **GSD auto-invocation baseline:** Research establishes ~50% reliability as a community consensus figure. The actual rate for ClawForge's specific AGENT.md instructions is unknown. Phase 3 test harness will establish the actual baseline for Archie and Epic.
- **Security gap — `.env.vps` not gitignored:** Git status shows `.env.vps` as untracked. If it contains real credentials, it is at risk of accidental commit. This is a pre-phase security fix, not part of the roadmap phases — address immediately.

## Sources

### Primary (HIGH confidence)
- Direct filesystem inspection: `/Users/nwessel/.claude/commands/gsd/` and `/Users/nwessel/.claude/agents/` — GSD two-directory install structure confirmed
- Direct codebase inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/Dockerfile` and `entrypoint.sh` — live container configuration
- Direct codebase inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/docker/job/entrypoint.sh` — confirmed template drift (missing Task,Skill)
- Official Claude Code docs: `https://code.claude.com/docs/en/headless.md` — confirmed `-p` mode limitation on user-invoked slash commands
- Official Claude Code docs: `https://code.claude.com/docs/en/cli-reference.md` — `--allowedTools`, `--output-format`, `--append-system-prompt` flags

### Secondary (MEDIUM confidence)
- Official Claude Code docs: `https://code.claude.com/docs/en/hooks` — PreToolUse/PostToolUse schema confirmed; Skill-specific tool_input fields not documented
- Claude Code Hooks Reference — PostToolUse receives `tool_name`, `tool_input`, `tool_response`; Skill not explicitly listed
- Scott Spence blog: `https://scottspence.com/posts/claude-code-skills-dont-auto-activate` — ~50% auto-invocation success rate in practice
- Lee Hanchung deep dive: `https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/` — Skill tool mechanical operation
- Real job logs: `/Users/nwessel/Claude Code/Business/Products/clawforge/logs/*/claude-output.json` — both failed runs show "Input must be provided" error

### Tertiary (LOW confidence)
- GitHub issue #11266 anthropics/claude-code — skills not auto-discovered; closed as duplicate
- GitHub issue #218 gsd-build/get-shit-done — commands/ to skills/ migration for 2.1.x
- `--output-format stream-json` tool_use field names (`type`, `name`, `input`) — inferred from Agent SDK docs; needs runtime validation

---
*Research completed: 2026-02-23*
*Ready for roadmap: yes*
