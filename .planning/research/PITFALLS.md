# Pitfalls Research

**Domain:** Claude Code CLI + GSD skill integration in Docker job containers
**Researched:** 2026-02-23
**Confidence:** HIGH (based on direct codebase inspection of live and template files, GSD installation layout, and known Claude Code CLI behavior)

---

## Critical Pitfalls

### Pitfall 1: GSD Skills Silently Missing Because HOME Resolves Wrong at Runtime

**What goes wrong:**
`npx get-shit-done-cc@latest --claude --global` installs GSD slash commands to `$HOME/.claude/commands/gsd/` and sub-agents to `$HOME/.claude/agents/`. In the job container, `$HOME` defaults to `/root` (node:22-bookworm-slim runs as root with no explicit `USER` directive). The install during the Docker build step runs as root and correctly places files at `/root/.claude/commands/gsd/` and `/root/.claude/agents/`. At runtime, however, if `HOME` is overridden by GitHub Actions runner environment injection, a CI system, or a future Dockerfile change that adds a non-root `USER`, the runtime `HOME` no longer matches the build-time `HOME`. Claude Code CLI discovers skills from `$HOME/.claude/` at startup — if that path differs from where GSD was installed, all skills are silently missing. Claude Code continues executing the job without error, it simply cannot invoke `/gsd:*` commands.

**Why it happens:**
The Dockerfile has no explicit `ENV HOME=/root` directive. This is an implicit assumption: the image runs as root, so HOME will be /root. This holds today but breaks if: (a) a `USER` directive is added for security hardening, (b) a CI runner injects a different HOME, or (c) the base image default changes. The WORKDIR=/job directive does not affect HOME but can create confusion — developers see `/job` as the runtime directory and may assume that is also where Claude Code looks for its config.

**How to avoid:**
Add `ENV HOME=/root` explicitly to `docker/job/Dockerfile` immediately after the `FROM` line. This locks the install target regardless of runtime environment changes. Alternatively, install GSD after all USER directives, ensuring install and runtime user match. Add a build-time smoke test: `RUN ls /root/.claude/commands/gsd/quick.md` to fail the Docker build immediately if GSD did not install correctly, rather than discovering the failure at job runtime.

**Warning signs:**
- Job output logs show Claude Code running tasks without any `skill_` tool invocations
- Agent ignores AGENT.md instructions to use GSD workflows despite them being in the system prompt
- `claude -p --allowedTools "...,Skill" "list available skills"` returns empty or errors in a local container test
- No `.claude/` directory found at `/root/.claude/` when exec'd into a running container

**Phase to address:**
GSD skill discovery verification phase (the active requirement: "Verify GSD skills are discoverable by Claude Code inside job containers")

---

### Pitfall 2: --allowedTools Template Drift Causes Task and Skill to Be Blocked

**What goes wrong:**
The live entrypoint at `docker/job/entrypoint.sh` defaults `ALLOWED_TOOLS` to `Read,Write,Edit,Bash,Glob,Grep,Task,Skill`. The stale template at `templates/docker/job/entrypoint.sh` line 78 defaults to `Read,Write,Edit,Bash,Glob,Grep` — missing `Task` and `Skill`. Any new instance scaffolded from the template, or any operator who copies the template as a reference and overwrites the live file, will have `Task` and `Skill` silently blocked. GSD's parallel agent workflows require `Task`. GSD's skill invocation requires `Skill`. Without both, GSD commands appear in the system prompt but every invocation fails with a "tool not allowed" error, which may be swallowed into `claude-output.json` without surfacing to the operator.

**Why it happens:**
Template and live files diverged when GSD was added to the live container but the template was not updated. Drift is expected in this pattern — templates are scaffolding, not live config — but without a sync mechanism or a diff check in CI, the gap grows silently. Claude Code CLI does not warn when a listed tool in a system prompt instruction is not in `--allowedTools`; it simply blocks the call.

**How to avoid:**
Resolve template drift immediately: update `templates/docker/job/entrypoint.sh` line 78 to match `docker/job/entrypoint.sh`. Add a CI check (or a pre-commit hook) that diffs the `ALLOWED_TOOLS` default line between the two files and fails if they diverge. Document in the template that `Task` and `Skill` are required for GSD.

**Warning signs:**
- New instance scaffolded from template runs jobs without GSD invocations
- `claude-output.json` contains tool_use blocks with `type: "tool_result"` and error content referencing tool permissions
- CI job fails with "tool not in allowedTools" messages in raw output
- `CLAUDE_ALLOWED_TOOLS` env var not set in the GitHub Actions runner environment, causing the default to apply

**Phase to address:**
Template drift resolution phase (the active requirement: "Template drift resolved — templates/docker/job/ matches actual docker/job/")

---

### Pitfall 3: GSD Sub-Agents Not Discovered Because Agents Directory Is Separate From Commands

**What goes wrong:**
GSD installs two distinct artifacts: slash commands in `~/.claude/commands/gsd/` and sub-agent definitions in `~/.claude/agents/`. The sub-agents (`gsd-executor.md`, `gsd-planner.md`, `gsd-codebase-mapper.md`, etc.) are what GSD's parallel wave execution spawns via the `Task` tool. If the `npx get-shit-done-cc@latest --claude --global` install step completes but only partially writes files (e.g., the install is interrupted, the package version has a bug, or the image layer cache serves a stale layer), the commands directory may be present while the agents directory is empty or absent. Slash commands appear available (the `Skill` tool can invoke `/gsd:quick`) but the command fails mid-execution when it tries to spawn a sub-agent via `Task` that does not exist.

**Why it happens:**
GSD's install writes to two separate directories in one `npx` invocation. There is currently no post-install verification step in the Dockerfile. The image layer cache (`RUN npx get-shit-done-cc@latest --claude --global`) will be invalidated when the package version changes, but a stale cache from a previous version might serve only commands if the agents directory was added in a newer version.

**How to avoid:**
Add explicit post-install verification to the Dockerfile after the GSD install line:
```
RUN npx get-shit-done-cc@latest --claude --global \
    && ls /root/.claude/commands/gsd/quick.md \
    && ls /root/.claude/agents/gsd-executor.md
```
This fails the Docker build immediately if either artifact is missing. Use `--no-cache` when building after a GSD version bump.

**Warning signs:**
- `/gsd:quick` starts executing but fails partway through with a Task spawn error
- `~/.claude/agents/` directory is missing or empty when inspected inside container
- Docker build completes in under 5 seconds for the GSD install step (cache hit on old version)
- GSD version in container does not match current latest (`npx get-shit-done-cc@latest --version` inside container)

**Phase to address:**
GSD skill discovery verification phase

---

### Pitfall 4: System Prompt Injection Via --append-system-prompt Loses GSD Instructions When Prompt Is Empty

**What goes wrong:**
`entrypoint.sh` builds the system prompt by concatenating `SOUL.md` and `AGENT.md` from `/job/config/`. The config directory is read from the cloned job branch — it must exist in the target repository at the path `/job/config/`. If the cloned repo does not have a `config/` directory (e.g., a first-time repo, a third-party repo, or a repo where config was moved), both `SOUL.md` and `AGENT.md` are skipped silently. The `SYSTEM_PROMPT` variable stays empty. `--append-system-prompt ""` passes an empty string, which Claude Code CLI treats as no system prompt. The agent receives no GSD instructions, no persona, and no tool guidance. It runs the job as a raw Claude Code invocation with whatever heuristics it applies by default.

**Why it happens:**
The entrypoint uses `if [ -f ... ]` guards but has no fallback and no warning when both files are missing. The operator assumes config files exist because they're present in the ClawForge repo — but job containers clone the *target* repo (e.g., `strategyes-lab`), not the ClawForge repo. Config files must be pre-committed to the target repo's default branch.

**How to avoid:**
Add a validation step in `entrypoint.sh` that exits with a clear error if neither config file is found:
```bash
if [ -z "$SYSTEM_PROMPT" ]; then
    echo "ERROR: No system prompt found. /job/config/SOUL.md and /job/config/AGENT.md are both missing."
    exit 1
fi
```
Alternatively, bake fallback SOUL.md and AGENT.md into the Docker image itself and use them as defaults when repo-level config is absent.

**Warning signs:**
- Job runs without using GSD despite AGENT.md instructions
- `claude-output.json` shows no persona-consistent behavior (agent introduces itself differently)
- Container logs show no "Found .claude config in repo" message but also no error
- First job against a new target repo fails silently with no GSD usage

**Phase to address:**
GSD skill discovery verification phase / end-to-end test harness phase

---

### Pitfall 5: `--output-format json` Swallows GSD Skill Invocation Visibility

**What goes wrong:**
The entrypoint runs `claude -p --output-format json ...` and pipes all output to `claude-output.json`. This captures the structured JSON output of Claude Code's execution. However, GSD skill invocations and sub-agent Task spawns generate internal tool call records that are embedded deep in the JSON structure — they are not surfaced as human-readable log lines. An operator reading the logs to verify GSD was used must parse the full JSON to find `tool_use` blocks with `name: "skill_"` or `name: "task_"`. Without a log parser or a dedicated verification step, GSD invocation is invisible in practice. The absence of a test harness means this JSON is only read manually when something goes wrong.

**Why it happens:**
`--output-format json` is correct for machine parsing but removes the human-readable streaming output that would show tool calls in real time. The current setup has no post-job log parser that extracts and reports which tools were called.

**How to avoid:**
Add a post-job log parsing step to the entrypoint that extracts tool invocations from `claude-output.json` and writes a human-readable summary to `logs/{JOB_ID}/tool-summary.md`. A minimal `jq` one-liner: `jq -r '[.. | objects | select(.type=="tool_use") | .name] | unique | join(", ")' claude-output.json`. This summary can be included in the PR body, making GSD usage instantly visible in GitHub without manual log inspection.

**Warning signs:**
- Operators cannot confirm GSD usage without downloading and manually inspecting `claude-output.json`
- PR bodies contain no information about which tools were used
- No way to distinguish a job that used GSD from one that did not without raw log access

**Phase to address:**
Job output logging and observability phase

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| No explicit `ENV HOME=/root` in Dockerfile | One less line | HOME assumption breaks on USER change or CI runner override | Never — add it now |
| Template and live entrypoint out of sync | Templates stay lean | New instances silently broken; operators copy wrong defaults | Never — sync immediately |
| No Docker build smoke tests for GSD artifacts | Faster builds | GSD silently missing discovered only at job runtime, hours later | Never for production images |
| `|| true` on all git/PR steps in entrypoint | Container never exits non-zero | Git failures (push conflicts, auth errors) silently swallowed; job appears successful | Acceptable only in development; use proper exit code handling in production |
| No system prompt validation at container start | Simpler entrypoint | Agent runs naked without persona or GSD instructions; silent behavioral degradation | Never — validate before invoking claude |
| `--output-format json` with no log parser | Machine-parseable output | GSD invocation invisible to human operators without log tooling | Acceptable if log parser added as second step |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GSD install via `npx` | Assuming `npx get-shit-done-cc@latest` always fetches latest — Docker layer cache serves stale version | Use `--no-cache` on GSD install layer or pin to explicit version; verify version at build time |
| `--allowedTools` string | Passing tools as space-separated; Claude Code CLI expects comma-separated list | Use `Read,Write,Edit,Bash,Glob,Grep,Task,Skill` (comma-separated, no spaces) |
| `--append-system-prompt` | Passing `$(cat file)` when file doesn't exist passes empty string silently | Validate file exists before passing; use `[ -s file ]` (non-empty check) |
| GitHub Actions secrets to container | Passing ANTHROPIC_API_KEY directly exposes it to Claude Code tool calls | Use `AGENT_` prefix for secrets that reach the container but should not reach LLM; use `AGENT_LLM_` prefix for secrets the LLM may use |
| `claude -p` in headless Docker | Claude Code may attempt interactive prompts or browser-based OAuth on first run | Pre-configure `~/.claude/` settings at build time; use `--dangerously-skip-permissions` is NOT the answer — use `--allowedTools` whitelist instead |
| GSD agents directory | Checking only `~/.claude/commands/gsd/` to verify GSD install | Verify both `commands/gsd/` AND `agents/` directories; GSD requires both for full functionality |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `npx get-shit-done-cc@latest` at build time with layer cache | GSD version in image months behind latest; new GSD commands missing | Pin GSD version or invalidate cache on release; use `ARG GSD_VERSION` to force rebuild | Every GSD release if not invalidated |
| Docker image rebuilt on every job trigger | Cold start adds 5-10 minutes per job (npm install + GSD install + Next.js build) | Pre-build image and push to registry; pull pre-built image in GitHub Actions | At scale with >10 concurrent jobs |
| Cloning full repo history for every job | Large repos (>1GB) cause clone timeouts | `--depth 1 --single-branch` already used in entrypoint; maintain this pattern | Repos with large binary assets or long histories |
| `git add -A` before commit | Accidentally stages build artifacts, tmp files, or secrets if `.gitignore` is wrong | Audit `.gitignore` in target repos; consider explicit `git add logs/` only | When target repo has unignored build outputs |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `.env.vps` not in `.gitignore` | Real Anthropic API keys exposed in git history | Add `.env.vps` to `.gitignore` immediately; rotate any exposed keys; audit git log |
| SECRETS passed via `eval $(jq ...)` in entrypoint | Shell injection if a secret value contains shell metacharacters (e.g., `$(command)`) | Use process substitution or write secrets to temp files with controlled permissions instead of eval |
| Job description written to `job.md` without sanitization | Malicious job description containing Claude Code directives or shell metacharacters | Add length limit and strip control characters before writing `job.md`; validate at Event Handler before job creation |
| GH_TOKEN without documented minimum scopes | Compromised container can delete repos, disable branch protection | Document required scopes (contents:write, pull-requests:write); use fine-grained PAT scoped to specific repos |
| No job timeout in GitHub Actions workflow | Runaway Claude Code session runs for 6 hours, consuming API credits and blocking runner | Set `timeout-minutes: 30` in `run-job.yml`; implement graceful shutdown signal in entrypoint |

---

## "Looks Done But Isn't" Checklist

- [ ] **GSD installed:** `docker run --rm <image> ls /root/.claude/commands/gsd/quick.md` returns the file — not just that the build succeeded
- [ ] **GSD agents installed:** `docker run --rm <image> ls /root/.claude/agents/gsd-executor.md` returns the file — commands without agents means parallel GSD workflows will fail mid-execution
- [ ] **Task and Skill in allowedTools:** Check both `docker/job/entrypoint.sh` AND `templates/docker/job/entrypoint.sh` defaults include `Task,Skill`
- [ ] **System prompt non-empty:** A test job against the target repo confirms `SOUL.md` and `AGENT.md` are present at `/job/config/` after clone
- [ ] **GSD actually invoked:** `claude-output.json` contains at least one `tool_use` block with `name` starting with `skill_` — presence of GSD in system prompt does not mean GSD was used
- [ ] **HOME path explicit:** `docker inspect <image>` shows `ENV HOME=/root` or equivalent — not relying on default
- [ ] **Template parity:** `diff docker/job/entrypoint.sh templates/docker/job/entrypoint.sh` shows only intentional differences, not missing `Task,Skill`
- [ ] **Secrets not in git:** `git log --all --full-history -- .env.vps` shows no commits tracking the file

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| GSD not installed in built image | MEDIUM | Rebuild image with `--no-cache` on GSD layer; re-push to registry; re-run failed jobs |
| Task/Skill missing from allowedTools in running jobs | LOW | Set `CLAUDE_ALLOWED_TOOLS` env var in GitHub Actions runner secrets to override the default; no image rebuild needed |
| System prompt empty (config files missing from target repo) | LOW | Commit `config/SOUL.md` and `config/AGENT.md` to target repo's main branch; re-trigger job |
| `.env.vps` committed with real secrets | HIGH | Immediately rotate all exposed API keys; force-push to remove from history (coordinate with team); add to `.gitignore` |
| Template drift causing broken scaffolded instances | LOW | Update `templates/docker/job/entrypoint.sh` to match live; re-scaffold or manually patch existing instances |
| GSD skills present but agent not using them | MEDIUM | Strengthen AGENT.md instructions with explicit "MUST use /gsd:quick for all tasks"; add verification job that confirms GSD usage in output |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| HOME path assumption breaking GSD install | Container hardening (add `ENV HOME=/root`, build smoke tests) | `docker run --rm <image> ls /root/.claude/commands/gsd/quick.md` exits 0 |
| Task/Skill missing from allowedTools (template drift) | Template sync resolution | `diff docker/job/entrypoint.sh templates/docker/job/entrypoint.sh` shows Task,Skill in both |
| GSD agents directory missing | Container hardening (post-install verification in Dockerfile) | `docker run --rm <image> ls /root/.claude/agents/gsd-executor.md` exits 0 |
| Empty system prompt when config files absent | End-to-end test harness | Test job against real target repo confirms system prompt non-empty in logs |
| GSD invocation invisible in json output | Observability / log parsing | PR body or job summary includes tool invocation list extracted from `claude-output.json` |
| `|| true` masking git/PR failures | Entrypoint hardening | Failed git operations surface in job result notification, not silently pass |
| `.env.vps` not gitignored | Immediate security fix (pre-phase) | `git status` shows `.env.vps` as untracked, not modified |
| SECRETS eval injection | Entrypoint hardening | Secrets with shell metacharacters do not cause unexpected behavior in container |

---

## Sources

- Direct inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/Dockerfile` — live GSD install line confirmed
- Direct inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/entrypoint.sh` — live allowedTools with Task,Skill confirmed
- Direct inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/docker/job/entrypoint.sh` — stale default missing Task,Skill confirmed
- Direct inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/docker/job/Dockerfile` — missing GSD install confirmed
- Direct inspection: `/Users/nwessel/.claude/commands/gsd/` and `/Users/nwessel/.claude/agents/` — GSD two-directory install structure confirmed
- Direct inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/PROJECT.md` — HOME path concern explicitly noted as known risk
- Direct inspection: `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/CONCERNS.md` — security and fragility patterns
- Codebase analysis: No `ENV HOME` directive in `docker/job/Dockerfile` — implicit root assumption confirmed

---
*Pitfalls research for: Claude Code CLI + GSD skill integration in Docker job containers (ClawForge)*
*Researched: 2026-02-23*
