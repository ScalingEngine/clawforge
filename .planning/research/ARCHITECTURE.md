# Architecture Research

**Domain:** Claude Code CLI agent verification and observability in Docker job containers
**Researched:** 2026-02-23
**Confidence:** HIGH (based on direct codebase analysis) / MEDIUM (for ecosystem patterns)

---

## Standard Architecture for Verification + Observability

### System Overview

The existing ClawForge system has two primary layers. The verification/observability work lives entirely in the **Job Container** layer — it does not touch the Event Handler.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Event Handler (Next.js)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │  Slack   │  │ Telegram │  │  Web UI  │  │  GitHub Webhook │ │
│  │ Adapter  │  │ Adapter  │  │  Chat    │  │  /api/github/   │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬────────┘ │
│       └─────────────┴─────────────┴─────────────────┘          │
│                          LangGraph Agent                         │
│                     (createJob → job branch)                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ job/* branch push
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Runner                          │
│  run-job.yml → docker run [job image]                            │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Job Container (Docker)                        │
│                                                                  │
│  entrypoint.sh                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  [STEP A] Clone job branch                                  │ │
│  │  [STEP B] Build system prompt (SOUL.md + AGENT.md)         │ │
│  │  [STEP C] Read job.md description                           │ │
│  │  [STEP D] ← VERIFICATION HOOK: env/path validation         │ │
│  │  [STEP E] claude -p --output-format json ...               │ │
│  │           --allowedTools Read,Write,Edit,Bash,Glob,Grep,   │ │
│  │                          Task,Skill                         │ │
│  │           2>&1 | tee logs/{jobId}/claude-output.json       │ │
│  │  [STEP F] ← OBSERVABILITY: parse claude-output.json        │ │
│  │  [STEP G] git add -A && git commit && git push             │ │
│  │  [STEP H] gh pr create                                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Filesystem Layout                                               │
│  /root/.claude/          ← GSD installs here (HOME=/root)       │
│  /job/                   ← cloned repo root                     │
│  /job/config/SOUL.md     ← identity prompt                      │
│  /job/config/AGENT.md    ← GSD instructions                     │
│  /job/logs/{jobId}/      ← job.md (input) + claude-output.json  │
│  /job/tmp/               ← gitignored scratch space             │
└──────────────────────────────┬───────────────────────────────────┘
                               │ commit + PR
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│         Auto-Merge + Notification Workflows                       │
│   auto-merge.yml → notify-pr-complete.yml → /api/github/webhook │
│   (reads logs/{jobId}/*.jsonl for log content)                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | Current State |
|-----------|----------------|---------------|
| `docker/job/Dockerfile` | Install Node 22, Claude Code CLI, GSD globally, GitHub CLI | Live. GSD installed via `npx get-shit-done-cc@latest --claude --global` |
| `docker/job/entrypoint.sh` | Clone, build prompt, run `claude -p`, commit, PR | Live. Streams output to `claude-output.json` via tee |
| `instances/*/config/SOUL.md` | Agent identity and persona | Per-instance. Sets character |
| `instances/*/config/AGENT.md` | Tool list + GSD command reference | Per-instance. Instructs GSD usage |
| `logs/{jobId}/job.md` | Job input — task description | Written by Event Handler before branch push |
| `logs/{jobId}/claude-output.json` | Full raw output of `claude -p` (JSON stream) | Already captured. Not parsed post-run |
| `templates/docker/job/` | Stale copies of Dockerfile and entrypoint | Drift issue — missing GSD install, missing Task+Skill in ALLOWED_TOOLS |
| `run-job.yml` | GitHub Actions trigger — fires on `job/*` branch create | Template. `ALLOWED_TOOLS` not settable via env in current template (hardcoded in entrypoint) |
| `notify-pr-complete.yml` | Reads `logs/{jobId}/*.jsonl`, sends to Event Handler | Looks for `.jsonl` — but `claude -p --output-format json` produces `.json`, not `.jsonl` |

---

## Recommended Architecture for Verification/Observability

The verification/observability layer adds three new components, all inside or adjacent to the job container execution flow. They do not modify the Event Handler.

### Component 1: Pre-Flight Verifier (Shell, in entrypoint)

**What:** A shell function inserted between prompt construction (Step C) and `claude -p` invocation (Step E). Checks the actual runtime environment.

**Responsibility:**
- Confirm `HOME` is set and resolves to `/root` (or expected value)
- Confirm `~/.claude/` exists and GSD agents/skills are present
- Confirm `claude` binary is on `PATH` and executable
- Confirm `ANTHROPIC_API_KEY` is set (without printing its value)
- Write a brief verification report to `logs/{jobId}/preflight.md`
- Exit non-zero (fail fast) if critical deps missing

**Hook location in entrypoint.sh:** Between step 8 (read job.md) and step 11 (run `claude -p`). Specifically after line 76 (`echo -e "$SYSTEM_PROMPT" > /tmp/system-prompt.md`) and before line 86 (`claude -p ...`).

```bash
# VERIFICATION HOOK — insert here
verify_gsd_environment() {
    echo "=== Pre-flight check ==="
    echo "HOME: ${HOME}"
    echo "Claude binary: $(which claude || echo 'NOT FOUND')"
    echo "GSD agents dir: ${HOME}/.claude/agents/"
    ls "${HOME}/.claude/agents/" 2>/dev/null || echo "WARNING: No agents found"
    echo "========================"
    # write summary to logs
}
verify_gsd_environment | tee "${LOG_DIR}/preflight.md"
```

**Data flow:** entrypoint → stdout/preflight.md → committed to repo → visible in PR diff

**Build dependency:** None. Self-contained in entrypoint.sh changes.

---

### Component 2: Output Log Parser (Post-run, in entrypoint)

**What:** A Node.js script (or `jq` pipeline) invoked after `claude -p` completes. Parses `claude-output.json` to extract tool invocations and detect GSD skill usage.

**Responsibility:**
- Read `logs/{jobId}/claude-output.json` (JSON stream of Claude Code output)
- Extract all `tool_use` events from the stream
- Filter for `Skill` tool calls that match `/gsd:*` patterns
- Count: total tools called, GSD skills invoked, non-GSD tool calls
- Write `logs/{jobId}/observability.md` with a human-readable summary
- Write `logs/{jobId}/tool-usage.json` with structured data for downstream parsing

**Hook location in entrypoint.sh:** After step 11 (`claude -p` pipe), before step 12 (git commit). Specifically after line 91 and before line 93.

```bash
# OBSERVABILITY HOOK — insert here
if [ -f "${LOG_DIR}/claude-output.json" ]; then
    node /usr/local/lib/parse-job-output.js "${LOG_DIR}" 2>/dev/null || true
fi
```

**Data flow:** claude-output.json → parse-job-output.js → observability.md + tool-usage.json → committed to repo → visible in notify-pr-complete webhook payload (via `changed_files`)

**Build dependency:** Requires Component 1 to be working first (confirms claude-output.json is being produced).

---

### Component 3: Test Harness (Local Docker + CI)

**What:** A test script that triggers a known job locally via `docker run`, with a fixed job description that requires GSD usage, and validates the output log.

**Responsibility:**
- Provide a `test-job.sh` script that runs the job image locally
- Inject a test job.md that explicitly requests `/gsd:quick` for a trivial task
- After `docker run` completes, inspect `logs/*/tool-usage.json` for GSD calls
- Report PASS/FAIL with specific evidence (which tools were called)
- Optionally add a `test-job.yml` GitHub Actions workflow for CI validation

**Structure:**
```
tests/
├── test-job.sh              # local docker run with fixed job.md
├── fixtures/
│   └── gsd-test-job.md     # test job description requiring /gsd:quick
└── validate-output.sh       # parses tool-usage.json, exits non-zero if no GSD calls
```

**Data flow:** test-job.sh → docker run → entrypoint.sh → claude -p → observability.md + tool-usage.json → validate-output.sh → PASS/FAIL

**Build dependency:** Requires Component 1 (pre-flight) and Component 2 (output parser) to exist. Test harness validates both.

---

## Data Flow: Verification + Observability End-to-End

```
Event Handler creates job
         |
         v
job/* branch push → run-job.yml fires
         |
         v
docker run [job image]
         |
         v
entrypoint.sh
    1. Clone branch
    2. Build system prompt (SOUL.md + AGENT.md)
    3. Read job.md
    4. [PRE-FLIGHT] verify_gsd_environment()
         writes: logs/{jobId}/preflight.md
    5. claude -p --output-format json
         writes: logs/{jobId}/claude-output.json    ← KEY: existing output
    6. [OBSERVABILITY] parse-job-output.js
         reads: logs/{jobId}/claude-output.json
         writes: logs/{jobId}/observability.md      ← human summary
         writes: logs/{jobId}/tool-usage.json        ← structured GSD evidence
    7. git add -A && git commit && git push
         (all logs/ files committed to branch)
    8. gh pr create
         |
         v
notify-pr-complete.yml
    reads: logs/{jobId}/*.jsonl               ← BUG: needs fixing to *.json
    sends: webhook payload to /api/github/webhook
         |
         v
Event Handler summarizes + notifies Slack/Telegram
```

---

## Recommended Project Structure (additions only)

```
docker/job/
├── Dockerfile              # existing — no changes needed for Phase 1
├── entrypoint.sh           # existing — add verification + observability hooks
└── parse-job-output.js     # NEW — Node script to parse claude-output.json

tests/
├── test-job.sh             # NEW — local harness to trigger test job
├── fixtures/
│   └── gsd-test-job.md    # NEW — deterministic test job description
└── validate-output.sh      # NEW — parse tool-usage.json, assert GSD was used

templates/docker/job/
├── Dockerfile              # NEEDS SYNC — add GSD install (missing vs live)
└── entrypoint.sh           # NEEDS SYNC — add Task+Skill to ALLOWED_TOOLS
```

---

## Architectural Patterns

### Pattern 1: Append-Only Log Files as Verification Evidence

**What:** All verification data is written as new files inside `logs/{jobId}/` which are already committed to the job branch and appear in the PR diff.

**When to use:** Any time you need to surface container-side data without modifying the Event Handler or GitHub Actions workflows.

**Trade-offs:** Simple. No new infrastructure. Log files grow with each job, but they are per-branch and auto-cleaned by GitHub's branch lifecycle. The downside is that verification data is only inspectable post-PR-creation — there is no real-time streaming to the Event Handler during job execution.

```bash
# Pattern: write evidence to logs/ during entrypoint execution
echo "GSD found at: ${HOME}/.claude/" >> "${LOG_DIR}/preflight.md"
```

---

### Pattern 2: jq-First Output Parsing (No External Deps)

**What:** Parse `claude-output.json` using `jq` in the entrypoint shell script rather than a separate Node.js script.

**When to use:** Lowest complexity option. `jq` is already installed in the Docker image.

**Trade-offs:** `jq` is available and fast, but complex JSON path queries for tool_use extraction are harder to maintain than a Node.js script. For Phase 1 (just detecting if Skill tool was called at all), `jq` is sufficient. For Phase 2 (semantic analysis of which GSD commands were called), Node.js is cleaner.

```bash
# jq pattern: check if Skill tool was called with a /gsd: argument
GSD_CALLS=$(jq -r '
  .[] | select(type == "object") |
  select(.type == "tool_use") |
  select(.name == "Skill") |
  .input.command // empty' \
  "${LOG_DIR}/claude-output.json" 2>/dev/null | grep -c "^/gsd:" || echo 0)
echo "GSD calls: ${GSD_CALLS}" >> "${LOG_DIR}/observability.md"
```

---

### Pattern 3: Fail-Fast Pre-Flight Before claude -p

**What:** Run environment validation before invoking Claude Code CLI and exit non-zero if critical dependencies are missing.

**When to use:** Always. Failing fast at pre-flight produces a clear GitHub Actions failure with a meaningful log message, rather than a silent GSD non-invocation.

**Trade-offs:** Adds 1-2 seconds to job startup. Worth the diagnostic clarity. Must not exit non-zero for soft warnings (GSD agents missing but GSD itself installed) — only hard failures (no API key, no claude binary).

```bash
# Pattern: fail fast only on hard requirements
if ! command -v claude &>/dev/null; then
    echo "ERROR: claude CLI not found on PATH"
    exit 1
fi
# Soft warning — GSD dir missing but job can still run without it
if [ ! -d "${HOME}/.claude/agents/" ]; then
    echo "WARNING: No GSD agents found at ${HOME}/.claude/agents/"
fi
```

---

## Anti-Patterns

### Anti-Pattern 1: Modifying the Event Handler to Add Observability

**What people do:** Add GSD usage detection to the GitHub webhook handler (`/api/github/webhook`) or to `summarizeJob()` in the Event Handler.

**Why it's wrong:** The Event Handler receives a summarized webhook payload from `notify-pr-complete.yml`. The raw tool usage data is not forwarded in that payload. Parsing for GSD usage in the Event Handler means parsing a summarized LLM output, not the actual tool call stream — this is unreliable.

**Do this instead:** Parse `claude-output.json` inside the job container immediately after `claude -p` completes (Component 2). The container has direct access to the raw output. Commit the parsed result to `logs/` so it propagates through the existing pipeline.

---

### Anti-Pattern 2: Using `--dangerously-skip-permissions` to Diagnose GSD

**What people do:** Switch from `--allowedTools` whitelist to `--dangerously-skip-permissions` to see if GSD starts being called.

**Why it's wrong:** Broadens the attack surface for prompt injection. The `--allowedTools` whitelist with `Skill` included is the correct configuration — if GSD isn't being called, the issue is path resolution or system prompt instructions, not the permission model.

**Do this instead:** Verify the `HOME` environment variable and `~/.claude/` path first (Component 1). The Skill tool must already be in `ALLOWED_TOOLS` — which it is in the live `entrypoint.sh`. The issue is most likely `HOME` not resolving to `/root` at runtime, or the GSD install path differing.

---

### Anti-Pattern 3: Testing GSD by Triggering a Real Slack Message

**What people do:** Send a Slack message to Archie or Epic and read the resulting PR log to see if GSD was used.

**Why it's wrong:** Slow feedback loop (minutes per iteration), requires production credentials, and produces non-deterministic jobs. If the job description doesn't specifically require GSD, the agent may solve it without GSD even if GSD is available.

**Do this instead:** Use the local test harness (Component 3) with a fixed `gsd-test-job.md` that explicitly requires `/gsd:quick`. This runs in seconds locally and produces deterministic, inspectable output without touching production systems.

---

### Anti-Pattern 4: Syncing Template Drift After Adding Verification

**What people do:** Add verification to `docker/job/entrypoint.sh` and `docker/job/Dockerfile` but forget to update `templates/docker/job/`.

**Why it's wrong:** Template drift already exists (GSD missing from template Dockerfile, Task+Skill missing from template ALLOWED_TOOLS). Adding verification to the live files without syncing the templates makes the drift worse.

**Do this instead:** Treat template sync as the first sub-task of any entrypoint change. The templates are what new instances scaffold from. Drift compounds across instances.

---

## Build Order (Component Dependencies)

```
[1] Template Sync (no deps)
    └── Sync templates/docker/job/ to match docker/job/
    └── Fixes template drift before new code is written
         |
         v
[2] Pre-Flight Verifier (no deps beyond entrypoint)
    └── Adds verify_gsd_environment() to entrypoint.sh
    └── Writes preflight.md to logs/
    └── Validates HOME, claude binary, GSD path
    └── Provides evidence for diagnosing Path resolution issue
         |
         v
[3] Output Log Parser (depends on [2] confirming claude-output.json exists)
    └── Adds parse-job-output.js (or jq pipeline) to entrypoint
    └── Writes observability.md + tool-usage.json
    └── Provides GSD call evidence
         |
         v
[4] Test Harness (depends on [2] + [3])
    └── tests/test-job.sh + fixtures/gsd-test-job.md
    └── validate-output.sh reads tool-usage.json
    └── Proves the full GSD chain end-to-end
         |
         v
[5] AGENT.md / SOUL.md tuning (depends on [4] evidence)
    └── If test harness shows GSD not being invoked despite availability,
        tighten the system prompt instruction in AGENT.md
    └── Should only be done after Component 2 confirms GSD IS discoverable
```

**Rationale:** Build order is dependency-driven. You cannot validate GSD usage (Component 3) until you know `claude-output.json` is being produced correctly (verified by Component 2). You cannot write a meaningful test (Component 4) until you have parseable evidence to assert against (Component 3). Template sync is a prerequisite to everything because it prevents the scaffolding diverging further during development.

---

## Integration Points

### Existing Entrypoint Hook Points

| Hook Point | Location in entrypoint.sh | What to Insert |
|------------|--------------------------|----------------|
| Post-prompt-build, pre-claude | After line 75 (`echo -e "$SYSTEM_PROMPT" > /tmp/system-prompt.md`) | verify_gsd_environment() call |
| Post-claude, pre-commit | After line 91 (`... | tee "${LOG_DIR}/claude-output.json"`) | parse-job-output invocation |
| Commit step | Line 93–96 (git add -A, commit) | No change needed — logs/ already committed via `git add -A` |

### notify-pr-complete.yml Bug (File Extension Mismatch)

The notify workflow on line 84 looks for `*.jsonl`:
```bash
LOG_FILE=$(find "$LOG_DIR" -name "*.jsonl" -type f | head -1)
```

But `entrypoint.sh` produces `claude-output.json` (not `.jsonl`). This means the `log` field in the webhook payload is always empty. This should be fixed as part of the observability work — either rename the output file to `.jsonl` or update the workflow's `find` pattern.

**Recommendation:** Change the notify workflow's `find` pattern to include both:
```bash
LOG_FILE=$(find "$LOG_DIR" \( -name "*.jsonl" -o -name "*.json" \) -type f | head -1)
```

This avoids renaming the existing output file and is backward-compatible.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| entrypoint.sh → parse-job-output.js | Direct file I/O (reads claude-output.json, writes observability.md) | No network I/O |
| Job container → GitHub | git push + gh pr create | Existing mechanism — logs/ files travel this path already |
| notify-pr-complete.yml → Event Handler | HTTP POST to `/api/github/webhook` | Existing. observability.md surfaces in `changed_files` list; full log content in `log` field (once bug fixed) |
| tests/test-job.sh → docker run | docker run with mounted fixture | Local only — no GitHub Actions credentials needed |

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 concurrent jobs | Current entrypoint hook approach is fine. File I/O for observability adds <1s. |
| 10-100 concurrent jobs | Pre-flight and output parsing remain container-side — no shared state, scales linearly. Each job has isolated `logs/{jobId}/` directory. |
| 100+ concurrent jobs | Bottleneck is GitHub Actions runner pool and SQLite (Event Handler side), not the observability layer. No changes to observability design needed. |

The observability layer is stateless and container-scoped. It does not write to shared storage. It cannot become a bottleneck at the job container level.

---

## Sources

- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/Dockerfile` (live)
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker/job/entrypoint.sh` (live)
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/.github/workflows/run-job.yml`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/.github/workflows/notify-pr-complete.yml`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/config/AGENT.md`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/ARCHITECTURE.md`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/PROJECT.md`
- Confidence: HIGH for all entrypoint hook locations (verified against actual file line numbers)
- Confidence: MEDIUM for claude-output.json schema (JSON stream format from `claude -p --output-format json` — structure inferred from Claude Code docs patterns, not directly observed from a real run)

---

*Architecture research for: ClawForge — Claude Code CLI verification and observability in Docker*
*Researched: 2026-02-23*
