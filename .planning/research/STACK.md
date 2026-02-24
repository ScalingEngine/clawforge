# Stack Research

**Domain:** Claude Code CLI agent container verification and GSD skill integration
**Researched:** 2026-02-23
**Confidence:** HIGH for Claude Code CLI behavior / MEDIUM for GSD auto-invocation reliability / HIGH for Docker path resolution

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@anthropic-ai/claude-code` | 2.1.50 (latest) | Claude Code CLI running inside Docker job container | The agent runtime. Already installed globally via `npm install -g`. Dockerfile uses `@latest` tag — must pin to avoid surprise upgrades. |
| Node.js | 22 (bookworm-slim) | Runtime for Claude Code CLI and parse-job-output.js | Claude Code 2.x requires Node 18+; Node 22 LTS provides stability. Already in Dockerfile. |
| `get-shit-done-cc` | 1.20.6 (latest as of 2026-02-23) | GSD skill system installed globally into container image | Installs to `~/.claude/commands/gsd/` (not `~/.claude/skills/`). Registers hooks in `~/.claude/settings.json`. |
| `jq` | system package (Debian bookworm) | Parse `claude-output.json` after `claude -p` completes | Already installed in Dockerfile. Required for stream-json parsing without Node runtime overhead. |
| Bash | system (bash 5.x) | Entrypoint scripting and pre-flight verification | Already the entrypoint shell. Sufficient for environment checks, fail-fast logic, and jq pipeline invocation. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js (built-in) `fs`, `readline` | N/A (Node 22 stdlib) | Parse `claude-output.json` line-by-line in a post-run Node.js script | When jq pipeline becomes too complex for multi-step extraction (e.g., correlating tool_use + tool_result pairs to verify GSD call results). Use for Phase 2 observability. |
| `gh` (GitHub CLI) | latest (from official apt repo) | Create PRs and authenticate git operations | Already installed. No change. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Docker Desktop / Docker Engine | Build and run job container locally for testing | Use `docker build -t clawforge-job docker/job/` and `docker run` with env vars for local test harness. No external services needed. |
| `docker inspect` + `docker exec` | Verify container filesystem layout after build | Use `docker run --entrypoint /bin/bash` to explore `/root/.claude/` post-install during Dockerfile development. |
| `jq` (local) | Validate `claude-output.json` structure manually | Run `jq '.' logs/{jobId}/claude-output.json \| head -50` against a real job output to confirm stream structure before writing parser. |

---

## Critical Finding: How GSD Installs and Where Skills Live

**This is the most important finding for this milestone.**

GSD installs to `~/.claude/commands/gsd/` — NOT to `~/.claude/skills/`. Each GSD command is a `.md` file at `~/.claude/commands/gsd/<command-name>.md`. The `--claude --global` installer also registers hooks in `~/.claude/settings.json` (SessionStart update checker, statusLine display).

Verified by inspecting the host system's actual GSD install at `/Users/nwessel/.claude/commands/gsd/`:
```
add-phase.md, add-todo.md, audit-milestone.md, check-todos.md, cleanup.md,
complete-milestone.md, debug.md, discuss-phase.md, execute-phase.md, health.md,
help.md, insert-phase.md, list-phase-assumptions.md, map-codebase.md,
new-milestone.md, new-project.md, pause-work.md, plan-milestone-gaps.md,
plan-phase.md, progress.md, quick.md, reapply-patches.md, remove-phase.md,
research-phase.md, resume-work.md, set-profile.md, settings.md, update.md
```

GSD agents install to `~/.claude/agents/gsd-*.md` (executor, planner, verifier, researcher, etc.).

**Confidence: HIGH** — Verified from direct filesystem inspection of a live GSD install.

---

## Critical Finding: How Claude Code Discovers Skills and Commands

Claude Code 2.x loads commands from `~/.claude/commands/` and skills from `~/.claude/skills/`. The `Skill` tool (when included in `--allowedTools`) provides access to skills from `~/.claude/skills/` directories. The legacy `commands/` directory supports subdirectory namespacing (`commands/gsd/quick.md` → `/gsd:quick`).

**HOME environment variable is the key.** Claude Code resolves `~` using the `HOME` environment variable at runtime. In the job container:
- Docker Node 22 base image runs as `root`, so `HOME=/root`
- GSD installs via `npx get-shit-done-cc@latest --claude --global` during `docker build`, which runs as root
- Therefore GSD installs to `/root/.claude/commands/gsd/` and `/root/.claude/agents/`
- At `docker run` time, `HOME` defaults to `/root` in the Node base image — this should work
- **Risk:** If any step in entrypoint.sh changes `HOME` (e.g., `gh auth setup-git` or git config) or if the container is run as a different user, `~/.claude/` resolution breaks silently

**Confidence: HIGH** — Based on Docker Node.js base image conventions and GSD installer behavior. Needs runtime verification (which is exactly what the pre-flight check in entrypoint.sh will provide).

---

## Critical Finding: `claude -p` Mode and Skill Tool Invocation

**User-invoked skills (`/gsd:quick`) are NOT available in `-p` (headless) mode.** This is stated explicitly in official Claude Code documentation:

> "User-invoked skills like `/commit` and built-in commands are only available in interactive mode. In `-p` mode, describe the task you want to accomplish instead."

**However, model-invoked skills (via the `Skill` tool) DO work in `-p` mode.** When `Skill` is included in `--allowedTools`, Claude Code can invoke skills programmatically during the agent loop. The mechanism is:

1. Skill descriptions are loaded into context so Claude knows what's available
2. Claude invokes the `Skill(gsd:quick)` tool during the agent loop when it decides the skill is relevant
3. The tool loads `~/.claude/commands/gsd/quick.md`, injects the skill content as a context message
4. Claude executes the skill instructions within the same `-p` session

The AGENT.md instruction in the current system ("Use `/gsd:*` commands via the Skill tool") is the correct approach — it instructs Claude to use `Skill(gsd:quick)` rather than `/gsd:quick`, which is the form that works in headless mode.

**Confidence: HIGH** — Verified from official headless mode documentation and cross-referenced with the skills deep-dive article describing the Skill tool's mechanical operation.

---

## Critical Finding: Skill Auto-Invocation Reliability

**Auto-invocation of skills by Claude Code is unreliable — approximately 50% success rate in practice.**

Multiple sources confirm this:
- GitHub issue #11266 (closed as duplicate): Skills in `~/.claude/skills/` not auto-discovered even with correct structure
- Scott Spence's blog post: Hook-based workaround achieved only 4-5/10 success across sessions
- The fundamental reason: "The AI model makes the decision to invoke skills based on textual descriptions presented in its system prompt. There is no algorithmic skill selection."

**Implication for ClawForge:** The current AGENT.md instruction ("Default choice: `/gsd:quick` for small tasks, `/gsd:plan-phase` + `/gsd:execute-phase` for anything substantial") is necessary but not sufficient. The agent will sometimes ignore these instructions and solve tasks without GSD.

**Recommended mitigation:** The system prompt instruction should be imperative and prominent, not advisory. "You MUST use the Skill tool to invoke GSD commands for all substantial tasks" is more reliable than "Default choice: /gsd:quick". Verification of actual GSD invocation (via output log parsing) is the only way to confirm compliance after the fact.

**Confidence: MEDIUM** — Multiple independent community sources agree on the reliability problem. Anthropic has not published official guidance on success rates. The pre-flight verification will help confirm whether the problem is discoverability (GSD not found) vs. instruction-following (GSD found but not used).

---

## Critical Finding: `claude-output.json` Structure for Tool Usage Detection

`claude -p --output-format json` produces a single JSON object at the end (not JSON lines). `--output-format stream-json` produces newline-delimited JSON objects during execution.

The current entrypoint uses `--output-format json`, so `claude-output.json` is a single JSON object with this top-level structure:
```json
{
  "result": "...",
  "session_id": "...",
  "cost_usd": ...,
  "duration_ms": ...,
  "num_turns": ...
}
```

**To detect tool usage, use `--output-format stream-json` instead.** Stream-json emits one JSON object per line, including tool_use events:
```json
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}}
{"type":"tool_use","name":"Skill","input":{"name":"gsd:quick","arguments":"..."}}
{"type":"tool_result","tool_use_id":"...","content":"..."}
```

To detect Skill tool invocations in stream-json output:
```bash
grep '"type":"tool_use"' "${LOG_DIR}/claude-output.json" | \
  jq -r 'select(.name == "Skill") | .input.name // empty'
```

**Alternative for `--output-format json`:** Use `--verbose` flag. With verbose mode, the single JSON output includes an `assistant_messages` array containing the full conversation with tool_use blocks.

**Recommendation:** Switch the entrypoint from `--output-format json` to `--output-format stream-json` and rename the output file to `claude-output.jsonl`. This enables real-time tool detection during parsing AND fixes the file extension mismatch with `notify-pr-complete.yml` (which looks for `*.jsonl`).

**Confidence: MEDIUM** — The stream-json format is documented. The exact field names for tool_use events in the stream (`"type":"tool_use"`, `"name"`, `"input"`) are derived from the Agent SDK docs and community parsing examples. Should be validated against an actual job run before finalizing the parser.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `--dangerously-skip-permissions` | Removes security model; does not fix GSD invocation. GSD non-invocation is a path or prompt issue, not a permissions issue. | `--allowedTools` with `Skill` explicitly listed |
| `/gsd:quick` syntax in AGENT.md as-is | User-invoked slash commands don't work in `-p` mode. They are interactive-only. | `Skill(gsd:quick)` tool invocation syntax in AGENT.md instructions |
| Relying on skill auto-invocation alone | ~50% success rate. Skills are loaded into context but Claude frequently ignores them. | Strong imperative instructions in AGENT.md + verification that Skill tool was called |
| Mounting `~/.claude/` from host | Introduces host secrets into container; breaks isolation. GSD should be baked into the image at build time. | `npx get-shit-done-cc@latest --claude --global` in Dockerfile |
| Using `npm install -g @anthropic-ai/claude-code` without a pinned version | `@latest` changes on every build; agent behavior may shift without notice. | Pin to a specific version (e.g., `@2.1.50`) in Dockerfile with a comment for update policy |
| `--output-format json` for tool usage detection | The single JSON object at the end does not include tool_use events in a parseable stream. | `--output-format stream-json` (rename output file to `.jsonl`) |
| Testing via live Slack → Archie → GitHub Actions pipeline | Slow (~5 min round trip), non-deterministic, requires production credentials. Not suitable for iteration. | Local `docker run` with a fixed fixture job.md |
| Adding GSD detection logic to the Event Handler | Event Handler receives summarized webhook payload, not the raw tool call stream. Detection there is unreliable. | Parse `claude-output.jsonl` inside the job container immediately after `claude -p` completes |

---

## Stack Patterns by Variant

**Pre-flight verification (Bash in entrypoint.sh):**
- Use `command -v claude` to verify the binary is on PATH
- Use `[ -d "${HOME}/.claude/commands/gsd/" ]` to verify GSD is installed (check commands/, not skills/)
- Use `[ -d "${HOME}/.claude/agents/" ]` to verify GSD agents are installed
- Use `echo "HOME=${HOME}"` to surface the actual HOME value to the log
- Exit non-zero only on hard failures (missing binary, missing API key); soft-warn on GSD path issues
- Write results to `${LOG_DIR}/preflight.md` via `tee`

**Tool usage detection (jq on stream-json output):**
```bash
# Detect Skill tool invocations in stream-json output
jq -r 'select(type == "object") | select(.type == "tool_use") | select(.name == "Skill") | .input.name // empty' \
  "${LOG_DIR}/claude-output.jsonl" 2>/dev/null | grep "^gsd:" | wc -l
```

**GSD invocation in system prompt (correct for -p mode):**
```markdown
For all substantial tasks, you MUST invoke GSD workflows using the Skill tool:
- Skill(gsd:quick) for ad-hoc tasks
- Skill(gsd:plan-phase) followed by Skill(gsd:execute-phase) for multi-step work
Do NOT attempt substantial work without GSD unless the task is trivial (single file edit, read-only lookup).
```

**If GSD install is failing silently during Docker build:**
- Add `RUN ls /root/.claude/commands/gsd/ && echo "GSD install verified"` after the `npx get-shit-done-cc` step
- This causes the build to fail loudly if GSD didn't install, rather than silently producing a broken image

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@anthropic-ai/claude-code@2.1.50` | Node 22 bookworm-slim | Node 22 LTS is the recommended base. `better-sqlite3` and other native deps compile correctly on bookworm (glibc). |
| `get-shit-done-cc@1.20.6` | Claude Code 2.1.x | GSD v1.20.x targets Claude Code 2.x commands/ directory structure. The skills/ migration path exists for Codex but is not the default for Claude Code installs as of 2026-02-23. |
| Claude Code 2.1.x `--allowedTools Skill` | GSD commands in `~/.claude/commands/gsd/` | The `Skill` tool in Claude Code 2.1.x loads from both `commands/` (legacy) and `skills/` directories. Both work. |
| `--output-format stream-json` | Claude Code 2.x | Stream-json is stable in Claude Code 2.x. The format is: one JSON object per line, tool_use events have `type`, `name`, `input` fields. |

---

## GSD Install Verification Pattern (Dockerfile)

Add this immediately after the `npx get-shit-done-cc@latest --claude --global` line in `docker/job/Dockerfile`:

```dockerfile
# Verify GSD installed correctly (fail build if not)
RUN ls /root/.claude/commands/gsd/quick.md || (echo "ERROR: GSD install failed" && exit 1)
RUN ls /root/.claude/agents/gsd-executor.md || (echo "ERROR: GSD agents not installed" && exit 1)
```

This converts a silent GSD install failure into a loud Docker build failure — much better than discovering GSD is missing at job runtime.

**Confidence: HIGH** — Standard Dockerfile verification pattern. The paths (`/root/.claude/commands/gsd/quick.md`) are confirmed from direct GSD install inspection.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `jq` for stream-json parsing | Node.js script | Use Node.js when tool_use/tool_result correlation is needed (e.g., verifying GSD skill actually produced output, not just that it was invoked). For simple "was Skill called?" detection, jq is sufficient and has no additional dependencies. |
| `--output-format stream-json` | `--output-format json --verbose` | `--verbose` with json mode includes full message history in the output, but the structure is less predictable. Use stream-json for all new work. |
| Pin Claude Code version in Dockerfile | `@latest` tag | Use `@latest` ONLY if you have an automated test harness that catches behavioral regressions before the image hits production. Currently there is no test harness, so pin the version. |
| `~/.claude/commands/gsd/` path verification | `~/.claude/skills/gsd-*/` | GSD for Claude Code uses `commands/`, not `skills/`. The skills/ directory in `~/.claude/` contains non-GSD skills. Do not look for GSD in `skills/`. |
| Imperative system prompt for GSD invocation | Descriptive system prompt ("Default choice is /gsd:quick") | Use descriptive language only if auto-invocation success rate is acceptable. Given ~50% reliability, imperative is required for a production agent. |

---

## Sources

- Official Claude Code docs: `https://code.claude.com/docs/en/skills` — Skill discovery paths, ~/.claude/ structure, user-invocable vs model-invoked, headless mode limitation
- Official Claude Code docs: `https://code.claude.com/docs/en/headless.md` — Confirmed `-p` mode limitations: "User-invoked skills like /commit and built-in commands are only available in interactive mode."
- Official Claude Code docs: `https://code.claude.com/docs/en/cli-reference.md` — `--allowedTools`, `--output-format`, `--append-system-prompt` flags
- Official Claude Code docs: `https://platform.claude.com/docs/en/agent-sdk/structured-outputs` — stream-json and json output format structure
- GitHub issue #11266 anthropics/claude-code (MEDIUM confidence) — "User skills in ~/.claude/skills/ not auto-discovered" — closed as duplicate of #9716
- GitHub issue #218 gsd-build/get-shit-done (MEDIUM confidence) — "GSD commands may not work after Claude Code update" — closed Jan 29 2026, confirmed commands/ → skills/ migration for 2.1.x
- Scott Spence blog: `https://scottspence.com/posts/claude-code-skills-dont-auto-activate` (MEDIUM) — 50% auto-invocation success rate in practice
- Lee Hanchung deep dive: `https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/` (MEDIUM) — Skill tool mechanical operation: validation → permission check → file loading → context injection
- Direct filesystem inspection: `/Users/nwessel/.claude/commands/gsd/` (HIGH) — Confirmed GSD installs to commands/, not skills/; confirmed agent file list
- Direct codebase inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/Dockerfile` (HIGH) — Current container setup
- Direct codebase inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/entrypoint.sh` (HIGH) — Current entrypoint and --output-format json usage
- npm registry: `@anthropic-ai/claude-code` version 2.1.50 (HIGH) — Current latest version as of 2026-02-23
- GSD changelog: `https://github.com/gsd-build/get-shit-done/blob/main/CHANGELOG.md` (HIGH) — Current version 1.20.6

---

*Stack research for: ClawForge GSD integration verification and hardening*
*Researched: 2026-02-23*
