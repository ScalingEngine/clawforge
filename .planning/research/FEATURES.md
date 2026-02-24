# Feature Research

**Domain:** Claude Code CLI agent observability and verification in headless Docker containers
**Researched:** 2026-02-23
**Confidence:** MEDIUM — Hook system and transcript format verified via official docs (HIGH); Skill tool hook schema unverified (LOW); output format behavior confirmed from real failed job logs (MEDIUM)

---

## Context: What "Verification" Means Here

This milestone is not about building a general observability platform. It is about answering one specific question:

> When Archie or Epic receives a job, does it actually invoke GSD workflows (`/gsd:quick`, `/gsd:plan-phase`) — and can an operator confirm this from job artifacts without reading raw JSON?

Features below are scoped to that question. Nothing here is about monitoring system health, dashboards, or multi-tenant observability.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must exist for "verification" to mean anything. Missing these = the milestone goal is unachievable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Job log captures whether Skill tool was called | Without this, GSD verification is impossible — you have no signal | LOW | `claude -p --output-format json` + `tee` already exists in entrypoint.sh. Problem: real job runs have been failing (both claude-output.json files contain only error messages). Fix is prerequisite. |
| GSD path resolution confirmed at runtime | If `HOME` isn't `/root` or GSD installs to wrong location, Skill calls silently fail with no error | LOW | Docker runs as root; `npx get-shit-done-cc@latest --claude --global` installs to `/root/.claude/`; entrypoint.sh starts as root. Needs a runtime echo of `HOME` + `ls ~/.claude/` to verify. |
| Entrypoint actually receives a job prompt | Current claude-output.json files show "Input must be provided either through stdin or as a prompt argument" — claude -p is being called with no input | LOW | The `FULL_PROMPT` variable is constructed but may be empty if `job.md` is missing. This is the actual bug blocking all verification. |
| Template drift resolved | `templates/docker/job/` is stale relative to `docker/job/`. Two versions of Dockerfile and entrypoint exist. Testing one doesn't test the other. | LOW | Mechanical sync — copy live files to templates. No logic change needed. |
| Skill tool appears as identifiable event in output | Claude Code's `--output-format json` and transcript JSONL both record tool calls. Need to confirm Skill appears with `tool_name: "Skill"` (not as a bash command or invisible). | MEDIUM | HIGH confidence: hooks docs lists Skill in allowedTools context. LOW confidence on exact `tool_input` schema for Skill — not documented in hooks reference. Verification requires a real successful run. |

**Dependency: All other features depend on the table stakes above being working first.** If `claude -p` isn't receiving a prompt, nothing else matters.

### Differentiators (Competitive Advantage)

Features that make GSD verification fast, automatic, and operator-friendly rather than manual log spelunking.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| PostToolUse hook that appends Skill invocations to a GSD-specific log file | Hooks fire synchronously during the job. A `PostToolUse` hook matching `Skill` can write to `/job/logs/{id}/gsd-invocations.jsonl` automatically — no post-processing needed | LOW | Verified: PostToolUse receives `tool_name`, `tool_input`, `tool_response`. Hook runs as shell command with JSON on stdin. Can be defined in `.claude/settings.json` committed to the job repo. Async flag available so it doesn't block job execution. |
| `gsd-invocations.jsonl` committed alongside `claude-output.json` | Operators see a clean list of every GSD command used in the PR diff. No need to read the full JSON output. | LOW | Depends on PostToolUse hook feature above. The entrypoint already does `git add -A` at the end, so any new file in `/job/logs/` is automatically included. |
| Test job that exercises the full chain | A synthetic job description like "Use /gsd:quick to add a comment to README.md" proves that: (1) GSD is discoverable, (2) Skill tool is invoked, (3) GSD executes its workflow, (4) output is logged | MEDIUM | Requires: working claude -p invocation (table stakes), GSD path confirmed, either local Docker build or triggered GH Actions run. Local Docker is faster for iteration. |
| Stop hook that emits a GSD usage summary | When `claude -p` finishes, a `Stop` hook runs and writes a one-line summary: "GSD invoked: /gsd:quick (1x), /gsd:plan-phase (2x)" | LOW | Stop hook receives `last_assistant_message`. Can grep the transcript path (also provided) for Skill calls. Simple jq pipeline. |
| Entrypoint diagnostic block before `claude -p` | 5 lines of `echo` before the Claude invocation: `HOME`, `which claude`, `ls ~/.claude/`, GSD version, working directory. Shows up in GitHub Actions logs. | LOW | Zero risk. Pure diagnostic output. Resolves HOME path ambiguity immediately without needing a successful job. |
| `--verbose` flag added to `claude -p` in test mode | `--verbose` enables full turn-by-turn output showing tool calls as they happen. Useful during debugging, not for production (noisy). | LOW | Already documented in CLI reference. Add as env var toggle: `CLAUDE_VERBOSE=true`. |
| AGENT.md instruction audit: verify GSD default behavior language | AGENT.md currently says "Default choice: /gsd:quick for small tasks, /gsd:plan-phase + /gsd:execute-phase for anything substantial." This is instruction, not enforcement. Verify whether agents actually follow it by checking logs from real jobs. | LOW | Pure analysis. No code change. Informs whether stronger prompting is needed. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem useful but create complexity without matching value for this milestone's scope.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| OpenTelemetry / OTel integration | "Real" observability for production systems | Requires OTel collector, metric backend, configuration complexity. Overkill for verifying 2 Docker instances. Adds infrastructure dependency. | Use hooks + committed log files. The PR is already the audit trail. |
| Real-time job monitoring dashboard | Operators want to see live job progress | Event Handler changes are explicitly out of scope. Would require WebSocket streaming from job container to event handler — significant architecture change. | GitHub Actions log is the real-time view. GH Actions already shows stdout. |
| Automated GSD compliance enforcement that blocks jobs if GSD isn't used | "We want to guarantee GSD is used" | A Stop hook can be made to block with `decision: "block"` — but this would cause all non-GSD jobs to fail with no recourse. Fragile: agent might invoke GSD via different mechanism. | Log Skill calls, then review. Only enforce after validating baseline behavior across multiple real jobs. |
| Replacing `--output-format json` with `--output-format stream-json` | Stream JSON has richer per-turn events | Would require changing how the output is processed. Current json format produces final summary; stream-json produces incremental events that need parsing differently. The summary format is simpler for PR review. | Stick with json for now. Stream-json is useful for real-time but adds post-processing complexity. |
| Test harness with unit tests for the entrypoint.sh | "We should test everything" | entrypoint.sh is a bash orchestration script. Unit testing bash that calls `git`, `gh`, and `claude` requires heavy mocking. Low ROI. | Test the behavior end-to-end with a real Docker build + real job. That is the only meaningful test for this layer. |
| Separate test instance (third Docker instance) | "Don't pollute prod with test jobs" | Adds instance management complexity. Both Archie and Epic need to be tested. A test job on the real instance using a test repo is simpler. | Use a dedicated test repo (`clawforge-test-jobs`) that the test jobs commit to. Isolated by repo, not by Docker instance. |

---

## Feature Dependencies

```
[Entrypoint receives job prompt (fix)]
    └──required by──> [GSD path confirmation]
    └──required by──> [Skill appears in output]
    └──required by──> [PostToolUse hook captures GSD calls]
    └──required by──> [Test job proves full chain]

[PostToolUse hook (Skill matcher)]
    └──required by──> [gsd-invocations.jsonl committed to PR]
    └──required by──> [Stop hook GSD summary]

[Entrypoint diagnostic block]
    ├──required by──> [GSD path confirmation] (can confirm path without a real job)
    └──enhances──> [Test job debugging] (shows env state before claude runs)

[Template drift resolved]
    └──required by──> [Local Docker test build] (must test the right Dockerfile)

[Test job]
    └──confirms──> [AGENT.md instruction audit]
```

### Dependency Notes

- **Entrypoint fix requires finding root cause:** The `claude-output.json` files both show "Input must be provided either through stdin or as a prompt argument." This means `FULL_PROMPT` was empty when `claude -p` ran. Most likely cause: `job.md` was missing or empty in the cloned branch at the time of the failing runs. Must reproduce and confirm before writing a fix.
- **Hooks require a `.claude/settings.json` in the job repo:** Claude Code picks up hooks from the project's `.claude/settings.json`. This file needs to be created in the target repos (or committed via the entrypoint setup). Hooks are snapshot-captured at session start — they cannot be added mid-session.
- **PostToolUse for Skill depends on Skill appearing as a hook-matchable tool name:** The hooks reference lists `Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Task`, `WebFetch`, `WebSearch` explicitly in the PreToolUse section. `Skill` is not listed. This is LOW confidence. Need to verify via a real run whether `Skill` appears as `tool_name: "Skill"` in PostToolUse or under a different identifier.
- **Template drift blocks local Docker testing:** If the live `docker/job/Dockerfile` and `templates/docker/job/Dockerfile` diverge, a local `docker build` from the templates directory tests the wrong image. Must sync before running local tests.

---

## MVP Definition

### Launch With (v1 — what this milestone delivers)

Minimum set to prove GSD is working end-to-end.

- [ ] **Fix entrypoint job prompt delivery** — diagnose why `FULL_PROMPT` was empty in both recorded runs, fix it, verify with a successful `claude -p` invocation (table stakes blocker)
- [ ] **Entrypoint diagnostic block** — 5-line echo before `claude -p` showing HOME, claude path, GSD install status (zero risk, unblocks path verification)
- [ ] **Sync template drift** — copy live `docker/job/` files to `templates/docker/job/` (mechanical, prerequisite for local Docker testing)
- [ ] **PostToolUse hook for Skill logging** — `.claude/settings.json` with PostToolUse hook that appends to `logs/{id}/gsd-invocations.jsonl`
- [ ] **Test job** — synthetic job description that triggers GSD usage and produces a PR with `gsd-invocations.jsonl` confirming Skill was called

### Add After Validation (v1.x)

Once baseline GSD usage is confirmed across real jobs.

- [ ] **Stop hook GSD summary** — add a Stop hook that writes a one-line GSD usage summary to the log; trigger: at least 3 successful jobs confirmed
- [ ] **AGENT.md instruction audit** — analyze logs from 5+ real jobs to assess whether agents default to GSD; trigger: enough job history exists
- [ ] **`--verbose` toggle** — add `CLAUDE_VERBOSE` env var support to entrypoint for debugging; trigger: when debugging a specific behavior requires turn-level output

### Future Consideration (v2+)

Defer until post-milestone and when there is a demonstrated need.

- [ ] **OTel integration** — when running more than 10 concurrent instances with a proper ops team; defer
- [ ] **Compliance enforcement via Stop hook blocking** — after 20+ successful jobs confirm behavior; only then consider whether enforcement is needed

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fix entrypoint job prompt delivery | HIGH | LOW | P1 |
| Entrypoint diagnostic block | HIGH | LOW | P1 |
| Sync template drift | HIGH | LOW | P1 |
| PostToolUse hook for Skill logging | HIGH | LOW | P1 |
| Test job proving full chain | HIGH | MEDIUM | P1 |
| Stop hook GSD summary | MEDIUM | LOW | P2 |
| AGENT.md instruction audit | MEDIUM | LOW | P2 |
| `--verbose` toggle | LOW | LOW | P2 |
| OTel integration | LOW | HIGH | P3 |
| Compliance enforcement via Stop hook | MEDIUM | LOW | P3 |

**Priority key:**
- P1: Must have for milestone goal (verifying GSD works)
- P2: Should have, add after P1s confirmed working
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

This is not a product competing in a market — it is internal verification tooling. The comparison is against alternative approaches:

| Approach | How it works | Why Not Here |
|----------|--------------|--------------|
| Manual log inspection | Read `claude-output.json` after each job | Already failing — logs are empty from error runs. Not scalable past 2 jobs. |
| `--verbose` flag + GH Actions logs | Run `claude -p --verbose`, read GH Actions output | Verbose output is unstructured, mixes tool calls with other text. Hard to grep reliably. Still requires manual review. |
| Claude Code hooks (recommended) | PostToolUse hook writes structured JSONL on every Skill call | Fires automatically, zero post-processing, committed to PR diff. Best match for the constraint. |
| External process watching stdout | Parse `claude-output.json` after the fact | The json output format is a summary, not turn-by-turn. Stream-json has turns but is harder to parse. |
| OTel + metric backend | Standard enterprise observability | Too heavy. Adds infra. Doesn't work well in ephemeral Docker containers without persistent OTel collector. |

**Recommended approach:** Hooks-based logging committed to git. Rationale: works within existing Docker + GitHub Actions model, requires no new infrastructure, produces a permanent audit trail in the PR diff, and is reversible if behavior changes.

---

## Sources

- Claude Code Hooks Reference: https://code.claude.com/docs/en/hooks (MEDIUM confidence — HIGH for PreToolUse/PostToolUse schema; LOW for Skill-specific tool_input fields)
- Claude Code CLI Reference: https://code.claude.com/docs/en/cli-reference (HIGH confidence — all flags verified from official docs)
- Claude Code Settings: https://code.claude.com/docs/en/settings (HIGH confidence — OTel config, hooks configuration schema)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/entrypoint.sh` — actual job execution flow
- `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/Dockerfile` — live Dockerfile with GSD install
- `/Users/nwessel/Claude Code/Business/Products/clawforge/logs/*/claude-output.json` — real job output (both failed: "Input must be provided")
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/CONCERNS.md` — test coverage gaps, fragile areas
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/TESTING.md` — no test framework currently installed
- Transcript JSONL analysis: `~/.claude/projects/.../session.jsonl` shows Skill invocations as `<command-message>gsd:progress</command-message>` in user message content — confirms Skill calls are recorded in the session transcript

---
*Feature research for: ClawForge GSD Integration Verification & Hardening*
*Researched: 2026-02-23*
