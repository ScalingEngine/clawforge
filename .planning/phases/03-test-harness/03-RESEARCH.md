# Phase 3: Test Harness — Research

**Researched:** 2026-02-24
**Domain:** Docker local integration testing, bash test harness scripts, JSONL assertion
**Confidence:** HIGH

---

## Summary

Phase 3 builds a local Docker test harness that proves the full GSD chain end-to-end without production credentials or Slack round-trips. The technical work is straightforward: build the existing Docker image locally, run a container with a synthetic `job.md` fixture and a fake `ANTHROPIC_API_KEY`, then assert that the container's output contains evidence of a GSD Skill invocation in `gsd-invocations.jsonl`.

There is one important divergence from the ROADMAP success criteria: the roadmap says "tool-usage.json" but Phase 2 never produced a `tool-usage.json`. Phase 2 delivered `gsd-invocations.jsonl` (via PostToolUse hook) and `observability.md` (jq-generated markdown). The test harness must assert against `gsd-invocations.jsonl`, not `tool-usage.json`. The success criteria terminology is a documentation artifact from early architecture research — the artifact that actually proves GSD invocations is `gsd-invocations.jsonl`.

The central challenge is not the bash scripting — it is the entrypoint's `git clone` step. The production entrypoint clones a GitHub branch to get the job description and config files. A local test cannot clone a branch from GitHub without real credentials and a live job branch. The solution is to build a thin entrypoint bypass: mount the fixture files directly into the container and set `REPO_URL=""` plus a custom `JOB_ID`, then skip the git operations and assert only on the Claude Code execution output. However, the entrypoint currently exits if `REPO_URL` is empty. The cleanest path is a minimal `test-entrypoint.sh` that inlines the core steps (step 6 through step 12a in the current entrypoint) without git clone/push/PR creation.

**Primary recommendation:** Create a dedicated `tests/test-entrypoint.sh` that bypasses git clone and PR creation, mounts fixture files into `/job/`, runs `claude -p` with the same tool whitelist, then writes `gsd-invocations.jsonl` and `observability.md` to a mounted output directory. `validate-output.sh` reads the output directory and checks for at least one JSONL record.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | A synthetic test job can be triggered that invokes `/gsd:quick` and proves the full chain works | Docker local build confirmed available (v28.2.2). gsd-invocations.jsonl is the correct assertion target (Phase 2 output). test-entrypoint.sh bypass pattern avoids git/GitHub dependency. validate-output.sh reads JSONL and exits non-zero on zero records. |
</phase_requirements>

---

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Docker | 28.2.2 | Build and run test container | The job container is Docker; testing it requires Docker |
| Bash | system (zsh on macOS host) | `test-job.sh` runner and `validate-output.sh` asserter | No framework overhead; operators already work in bash |
| `jq` | system (in Docker image) | Assert JSONL content inside `validate-output.sh` | Already in Docker image; `jq` empty/length checks are the most reliable JSONL assertions |

### No New NPM Packages
The test harness uses only tools already present in the Docker image or the macOS host. No `npm install` is needed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `test-entrypoint.sh` | Mock the full entrypoint with env vars | A test entrypoint is explicit; mocking env vars still requires the production entrypoint to have a test code path, adding complexity to production code |
| Bash `validate-output.sh` | Node.js assertion script | Bash + jq matches the existing project shell scripting style; no additional runtime needed |
| Docker volume mount for output | Named Docker volume | Bind mount (`-v $(pwd)/tests/output:/output`) is simpler and readable; operator can inspect output directly |

---

## Architecture Patterns

### Recommended Project Structure

```
tests/
├── test-job.sh                   # Runner: docker build + docker run + invoke validate-output.sh
├── test-entrypoint.sh            # Bypass entrypoint: skips git clone/push/PR, runs core claude -p steps
├── validate-output.sh            # Asserter: reads output/, exits non-zero if no GSD calls found
├── fixtures/
│   ├── gsd-test-job.md           # Synthetic job description — explicitly requires Skill(gsd:quick)
│   ├── AGENT.md                  # Minimal AGENT.md with GSD instructions
│   └── SOUL.md                   # Minimal SOUL.md for identity
└── output/                       # Created at test runtime, gitignored
    ├── gsd-invocations.jsonl     # Written by PostToolUse hook during test run
    └── observability.md          # Written by entrypoint after claude -p
```

The `output/` directory is created by `test-job.sh` before `docker run` and destroyed/recreated on each run. It is bind-mounted into the container at `/output` so `validate-output.sh` can read it from the host after the container exits.

### Pattern 1: Test Entrypoint Bypass

**What:** A separate `test-entrypoint.sh` that replicates only the core execution steps (steps 6–12a in the production entrypoint) without the git clone, git push, or gh pr create steps.

**When to use:** Any time a local test cannot satisfy the production entrypoint's dependency on a live GitHub repo URL and branch.

**Why not modify the production entrypoint:** Adding test-mode flags to `entrypoint.sh` creates a maintenance burden. The test entrypoint is a thin wrapper that calls the same claude binary with the same flags — it proves that the Docker image's Claude + GSD + hook configuration works, which is the actual claim being tested.

```bash
#!/bin/bash
# test-entrypoint.sh — runs inside the job Docker image for local testing
set -e

JOB_ID="${TEST_JOB_ID:-test-$(date +%s)}"
LOG_DIR="/output"
mkdir -p "${LOG_DIR}"

# Same hook wiring as production
export LOG_DIR

# Baseline JSONL file so hook always has a target
touch "${LOG_DIR}/gsd-invocations.jsonl"

# Preflight (same checks as production entrypoint)
echo "HOME: ${HOME}"
echo "claude: $(which claude)"
echo "GSD: ${HOME}/.claude/commands/gsd/"
ls "${HOME}/.claude/commands/gsd/" 2>/dev/null || echo "WARNING: GSD missing"

if [ ! -d "${HOME}/.claude/commands/gsd/" ]; then
    echo "ERROR: GSD not installed"
    exit 1
fi

# Read fixture files (mounted by test-job.sh)
SYSTEM_PROMPT=""
if [ -f "/fixtures/SOUL.md" ]; then
    SYSTEM_PROMPT=$(cat /fixtures/SOUL.md)
    SYSTEM_PROMPT="${SYSTEM_PROMPT}\n\n"
fi
if [ -f "/fixtures/AGENT.md" ]; then
    SYSTEM_PROMPT="${SYSTEM_PROMPT}$(cat /fixtures/AGENT.md)"
fi

JOB_DESCRIPTION=""
if [ -f "/fixtures/gsd-test-job.md" ]; then
    JOB_DESCRIPTION=$(cat /fixtures/gsd-test-job.md)
fi

FULL_PROMPT="# Your Job

${JOB_DESCRIPTION}"

# Run claude -p with same flags as production
printf '%s' "${FULL_PROMPT}" | claude -p \
    --output-format json \
    --append-system-prompt "$(echo -e "$SYSTEM_PROMPT")" \
    --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Task,Skill" \
    2>&1 | tee "${LOG_DIR}/claude-output.json" || true

# Generate observability.md (same logic as production)
JSONL_FILE="${LOG_DIR}/gsd-invocations.jsonl"
OBS_FILE="${LOG_DIR}/observability.md"
INVOCATION_COUNT=0
if [ -f "${JSONL_FILE}" ]; then
    INVOCATION_COUNT=$(wc -l < "${JSONL_FILE}" | tr -d ' ')
fi

{
  echo "# GSD Invocations — Test Job ${JOB_ID}"
  echo ""
  echo "**Total invocations:** ${INVOCATION_COUNT}"
  echo ""
  if [ "${INVOCATION_COUNT}" -gt 0 ]; then
    echo "## Invocations"
    echo "| # | Skill | Arguments | Timestamp |"
    echo "|---|-------|-----------|-----------|"
    jq -r --slurp 'to_entries[] | "| \(.key + 1) | `\(.value.skill)` | \(.value.args | .[0:80]) | \(.value.ts) |"' "${JSONL_FILE}"
  else
    echo "_No GSD skills were invoked._"
  fi
} > "${OBS_FILE}"

echo "Test run complete. Output in /output/"
```

### Pattern 2: test-job.sh Runner

**What:** The top-level script an operator runs (`bash tests/test-job.sh`). Handles docker build, volume setup, docker run, then calls `validate-output.sh`.

**When to use:** Single command to run the full test.

```bash
#!/bin/bash
# test-job.sh — local Docker test for ClawForge GSD chain
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"

echo "=== ClawForge GSD Test Harness ==="

# Build Docker image from docker/job/
echo "[1/4] Building Docker image..."
docker build -t clawforge-job-test "${REPO_ROOT}/docker/job" --quiet

# Clean previous output
rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# Run test container
echo "[2/4] Running test container..."
docker run --rm \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
    -e TEST_JOB_ID="test-$(date +%s)" \
    -v "${SCRIPT_DIR}/fixtures:/fixtures:ro" \
    -v "${OUTPUT_DIR}:/output:rw" \
    --entrypoint /test-entrypoint.sh \
    clawforge-job-test

echo "[3/4] Validating output..."
bash "${SCRIPT_DIR}/validate-output.sh" "${OUTPUT_DIR}"
echo "[4/4] PASS"
```

Note: `ANTHROPIC_API_KEY` must be set in the environment. The test harness requires a real key because `claude -p` will not run without one. This is the only production credential needed — no GitHub token, no Slack webhook, no repo access.

### Pattern 3: validate-output.sh Asserter

**What:** Reads the output directory and checks for at least one JSONL record in `gsd-invocations.jsonl`. Exits 0 on success, non-zero on failure.

```bash
#!/bin/bash
# validate-output.sh — assert that gsd-invocations.jsonl contains at least one GSD call
set -e
OUTPUT_DIR="${1:-$(dirname "${BASH_SOURCE[0]}")/output}"
JSONL_FILE="${OUTPUT_DIR}/gsd-invocations.jsonl"

echo "=== Validating GSD invocations ==="

# File must exist
if [ ! -f "${JSONL_FILE}" ]; then
    echo "FAIL: ${JSONL_FILE} not found"
    exit 1
fi

# Count records (non-empty lines)
RECORD_COUNT=$(grep -c . "${JSONL_FILE}" 2>/dev/null || echo 0)

if [ "${RECORD_COUNT}" -eq 0 ]; then
    echo "FAIL: gsd-invocations.jsonl is empty — GSD Skill tool was not invoked"
    echo ""
    echo "Observability summary:"
    cat "${OUTPUT_DIR}/observability.md" 2>/dev/null || echo "(no observability.md)"
    exit 1
fi

echo "PASS: ${RECORD_COUNT} GSD invocation(s) detected"
jq -r '"  - \(.skill) (\(.ts))"' "${JSONL_FILE}"
exit 0
```

### Pattern 4: Synthetic Fixture Job Description

**What:** A `gsd-test-job.md` that explicitly requires GSD Skill invocation. The job must be simple enough to complete in under 60 seconds but explicit enough that the agent cannot solve it without invoking the Skill tool.

**Key insight:** The job description must use imperative language that leaves no ambiguity about whether GSD is required. "Use `Skill('gsd:quick')` to..." is more reliable than "Use GSD to..." because it names the exact tool call.

```markdown
# Test Job: GSD Chain Verification

**Purpose:** Verify that the GSD Skill tool is wired correctly in this container.

## Task

You MUST invoke the Skill tool with `gsd:quick` to complete this task.

Use `Skill("gsd:quick")` with the following task:

> Add a single line to /output/test-result.md: "GSD test completed successfully at [timestamp]"

Do not use any other approach. The test harness validates that the Skill tool was invoked.
```

### Anti-Patterns to Avoid

- **Relying on advisory job description language:** "Prefer using GSD" or "Default choice is /gsd:quick" produces ~50% invocation reliability. The fixture must say "MUST use Skill('gsd:quick')".
- **Testing against `tool-usage.json`:** This file was in the original architecture plan but was never built in Phase 2. The assertion target is `gsd-invocations.jsonl`.
- **Mounting the full production `.claude/` directory from host:** Breaks isolation; the test proves the Docker image's configuration, not the host's.
- **Requiring GitHub credentials for the test:** The production entrypoint's git clone step is the only part that requires a GH token. Bypassing it via `test-entrypoint.sh` is the correct isolation boundary.
- **Running `claude -p` without `ANTHROPIC_API_KEY` set:** Claude Code will fail immediately. The test requires a real Anthropic API key. Document this clearly in `test-job.sh`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONL line counting | Custom parser | `grep -c .` or `wc -l` | Both are available, single-purpose, and reliable for counting non-empty lines |
| Hook environment passing | Re-implement env inheritance | `export LOG_DIR` (already in entrypoint pattern) | Phase 2 already proved this works; replicate the exact export pattern |
| Docker image caching | `--no-cache` on every build | Let Docker layer cache work | The `docker build` step is slow; rebuilding from scratch every test run is impractical. Only rebuild when `docker/job/` changes. |

**Key insight:** The test harness is infrastructure — not a feature. Keep it minimal. Every line of custom test logic is a line that can fail for test-infrastructure reasons rather than product reasons.

---

## Common Pitfalls

### Pitfall 1: git clone Dependency
**What goes wrong:** The production entrypoint immediately tries `git clone --single-branch --branch "$BRANCH" --depth 1 "$REPO_URL" /job` and exits 1 if `REPO_URL` is unset. Running the production entrypoint locally fails at this step.
**Why it happens:** The entrypoint was designed for GitHub Actions where `REPO_URL`, `BRANCH`, and a valid GH token are always present.
**How to avoid:** Use `--entrypoint /test-entrypoint.sh` in `docker run` to bypass the production entrypoint entirely. The test entrypoint replicates only steps 6–12a.
**Warning signs:** `docker run` exits immediately with "No REPO_URL provided".

### Pitfall 2: LOG_DIR Not Exported to Hook
**What goes wrong:** The PostToolUse hook checks `process.env.LOG_DIR` and silently exits (no-op) if `LOG_DIR` is not set. `gsd-invocations.jsonl` stays empty even when GSD is invoked.
**Why it happens:** `export LOG_DIR` must precede `claude -p` in the test entrypoint, exactly as it does in the production entrypoint.
**How to avoid:** Copy the `export LOG_DIR="/output"` line from the production entrypoint verbatim. Verify with `echo "LOG_DIR: ${LOG_DIR}"` in test-entrypoint.sh.
**Warning signs:** `gsd-invocations.jsonl` exists but has zero lines after a run that showed GSD activity in `claude-output.json`.

### Pitfall 3: Output Directory Bind Mount Permission
**What goes wrong:** Docker container runs as root; host user may not own the output directory after the run. `validate-output.sh` fails to read files.
**Why it happens:** Files written by the root user inside the container appear as root-owned on the bind-mounted host directory.
**How to avoid:** Either `chmod -R 777` the output directory after `docker run`, or add `--user "$(id -u):$(id -g)"` to `docker run` (though this may conflict with Claude Code's root assumption).
**Warning signs:** `validate-output.sh` gets "Permission denied" reading `gsd-invocations.jsonl`.

### Pitfall 4: test-entrypoint.sh Not In Docker Image
**What goes wrong:** `docker run --entrypoint /test-entrypoint.sh` fails with "exec: /test-entrypoint.sh: no such file".
**Why it happens:** The test entrypoint must be copied into the Docker image, or mounted as a volume. Mounting is simpler.
**How to avoid:** Bind-mount the test entrypoint: `-v "${SCRIPT_DIR}/test-entrypoint.sh:/test-entrypoint.sh:ro"`. No Dockerfile change needed.
**Warning signs:** Container exits immediately with entrypoint not found error.

### Pitfall 5: Fixture AGENT.md Missing Imperative Language
**What goes wrong:** Claude solves the test job without invoking GSD — uses `Write` tool directly instead of `Skill('gsd:quick')`. `validate-output.sh` exits non-zero. Test fails for the wrong reason.
**Why it happens:** Advisory AGENT.md language ("Default choice: /gsd:quick") produces ~50% reliability. Without imperative wording in both AGENT.md and gsd-test-job.md, the test is non-deterministic.
**How to avoid:** The fixture `gsd-test-job.md` must say "MUST invoke `Skill('gsd:quick')`" and the fixture `AGENT.md` must say "MUST use Skill tool for all tasks". Both must be imperative.
**Warning signs:** Multiple test runs produce inconsistent PASS/FAIL results.

### Pitfall 6: tool-usage.json Expectation in validate-output.sh
**What goes wrong:** If `validate-output.sh` is written to check for `tool-usage.json` (following the ROADMAP description), it will always fail because Phase 2 never created that file.
**Why it happens:** The ROADMAP success criteria says "tool-usage.json" — this was the original Component 2 architecture (a Node.js output parser). Phase 2 pivoted to the PostToolUse hook producing `gsd-invocations.jsonl` instead. The roadmap was not updated.
**How to avoid:** `validate-output.sh` MUST assert against `gsd-invocations.jsonl`, not `tool-usage.json`.
**Warning signs:** Validation script always fails with "file not found" even after a successful run.

---

## Code Examples

### Complete test-job.sh (operator-facing runner)
```bash
#!/bin/bash
# tests/test-job.sh — local Docker test for ClawForge GSD chain
# Usage: ANTHROPIC_API_KEY=sk-... bash tests/test-job.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"

echo "=== ClawForge GSD Test Harness ==="
echo "Docker image: clawforge-job-test"
echo "Output: ${OUTPUT_DIR}"
echo ""

if [ -z "${ANTHROPIC_API_KEY}" ]; then
    echo "ERROR: ANTHROPIC_API_KEY must be set"
    echo "Usage: ANTHROPIC_API_KEY=sk-... bash tests/test-job.sh"
    exit 1
fi

# [1] Build Docker image
echo "[1/4] Building Docker image from docker/job/..."
docker build -t clawforge-job-test "${REPO_ROOT}/docker/job" --quiet
echo "      Built: clawforge-job-test"

# [2] Prepare output dir
rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# [3] Run test container
echo "[2/4] Running test container..."
docker run --rm \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
    -e TEST_JOB_ID="test-$(date +%s)" \
    -v "${SCRIPT_DIR}/fixtures:/fixtures:ro" \
    -v "${SCRIPT_DIR}/test-entrypoint.sh:/test-entrypoint.sh:ro" \
    -v "${OUTPUT_DIR}:/output:rw" \
    --entrypoint /bin/bash \
    clawforge-job-test \
    /test-entrypoint.sh

# [4] Validate
echo "[3/4] Validating output..."
bash "${SCRIPT_DIR}/validate-output.sh" "${OUTPUT_DIR}"

echo "[4/4] PASS — GSD chain verified"
echo ""
echo "Artifacts:"
ls -la "${OUTPUT_DIR}/"
```

### validate-output.sh (complete)
```bash
#!/bin/bash
# tests/validate-output.sh — assert GSD invocations present in output
# Usage: bash tests/validate-output.sh [output_dir]
# Exit: 0=PASS, 1=FAIL
set -e

OUTPUT_DIR="${1:-$(dirname "${BASH_SOURCE[0]}")/output}"
JSONL_FILE="${OUTPUT_DIR}/gsd-invocations.jsonl"

echo "=== Validate GSD Invocations ==="
echo "Output dir: ${OUTPUT_DIR}"
echo ""

# gsd-invocations.jsonl must exist
if [ ! -f "${JSONL_FILE}" ]; then
    echo "FAIL: gsd-invocations.jsonl not found at ${JSONL_FILE}"
    exit 1
fi

# Count non-empty lines (each line is one JSONL record)
RECORD_COUNT=$(grep -c . "${JSONL_FILE}" 2>/dev/null || echo 0)

if [ "${RECORD_COUNT}" -eq 0 ]; then
    echo "FAIL: gsd-invocations.jsonl is empty — GSD Skill tool was NOT invoked"
    echo ""
    echo "--- observability.md ---"
    cat "${OUTPUT_DIR}/observability.md" 2>/dev/null || echo "(no observability.md)"
    echo ""
    echo "--- claude-output.json (tail) ---"
    tail -20 "${OUTPUT_DIR}/claude-output.json" 2>/dev/null || echo "(no claude-output.json)"
    exit 1
fi

echo "PASS: ${RECORD_COUNT} GSD invocation(s) found"
echo ""
# Show what was called
jq -r '"  Skill(\(.skill)) at \(.ts)"' "${JSONL_FILE}" 2>/dev/null || cat "${JSONL_FILE}"
exit 0
```

### gsd-test-job.md fixture (GSD invocation guarantee)
```markdown
# Test Job: GSD Chain Verification

**Purpose:** Confirm that the GSD Skill tool is correctly wired in this Docker container.

## Instructions

You MUST complete this task using the Skill tool with `gsd:quick`. Do not use Write, Edit, or Bash to accomplish this task directly.

Call:
```
Skill("gsd:quick")
```

With the argument:
> Create the file /output/test-result.md containing exactly this text: "GSD test completed successfully."

The test harness is validating that `Skill` was invoked. If you complete the task without calling `Skill`, the test will fail.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tool-usage.json` (planned Component 2 output parser) | `gsd-invocations.jsonl` (PostToolUse hook) | Phase 2 implementation | Phase 3 asserts against JSONL, not JSON; validate-output.sh design changes accordingly |
| Testing via real Slack message → GitHub Actions | Local Docker run with synthetic fixture | Phase 3 goal | Removes GitHub credentials requirement; feedback in <5 min instead of >15 min |

**Deprecated/outdated:**
- `tool-usage.json`: Never built. The original architecture planned a Node.js output log parser that would produce this file. Phase 2 used the PostToolUse hook approach instead. Do not reference `tool-usage.json` in Phase 3 implementation.

---

## Open Questions

1. **Does claude -p require network access beyond api.anthropic.com?**
   - What we know: Claude Code CLI contacts api.anthropic.com for inference. GSD runs locally (it's slash commands, not API calls).
   - What's unclear: Whether Docker's default bridge network provides internet access on the development machine.
   - Recommendation: Test with `docker run --network bridge` (default). If blocked, add `--network host`. Docker Desktop on macOS uses a VM that has internet by default.

2. **How long does a minimal claude -p run take?**
   - What we know: The test job invokes `/gsd:quick` which may spawn sub-agents. A trivial task should complete in 20-60 seconds.
   - What's unclear: Whether the `Task` tool spawning a sub-agent in headless mode significantly extends runtime.
   - Recommendation: Set a `timeout 120` wrapper in `test-job.sh` around the `docker run` call. If it exceeds 2 minutes, that itself is diagnostic.

3. **Does the test require a real ANTHROPIC_API_KEY or can it be mocked?**
   - What we know: `claude -p` calls the Anthropic API. Without a valid key, it exits immediately with an auth error.
   - What's unclear: Whether there is a test/sandbox key mode.
   - Recommendation: Require a real API key. Document this explicitly in `test-job.sh`. The test will consume API credits (~$0.01-0.05 per run).

---

## Validation Architecture

> Skipped — `workflow.nyquist_validation` is not set in `.planning/config.json`.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `docker/job/entrypoint.sh` — production entrypoint steps 1–13 (live, Phase 1+2 complete)
- Direct codebase inspection: `docker/job/hooks/gsd-invocations.js` — PostToolUse hook that writes gsd-invocations.jsonl
- Direct codebase inspection: `docker/job/Dockerfile` — image configuration with hook registration
- Phase 2 VERIFICATION.md — confirmed 7/7 truths including: gsd-invocations.jsonl created by hook, LOG_DIR exported, observability.md generated
- Phase 1 VERIFICATION.md — confirmed: GSD installed at /root/.claude/commands/gsd/, build-time verification passes, templates synced
- Docker daemon: v28.2.2 available on development machine

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md TEST-01: Confirmed target requirement for this phase
- ROADMAP.md Phase 3 success criteria: Confirmed success criteria (interpreting `tool-usage.json` as `gsd-invocations.jsonl`)
- ARCHITECTURE.md research: Component 3 "Test Harness" design (from initial research, pre-Phase 2 pivot)

### Tertiary (LOW confidence)
- GSD auto-invocation rate ~50%: Community sources (SUMMARY.md research). Mitigation: imperative fixture language.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Docker available locally, all tools confirmed present in image, no new dependencies
- Architecture: HIGH — direct codebase analysis of Phase 2 outputs; test-entrypoint pattern is straightforward
- Pitfalls: HIGH — 3 of 6 pitfalls (LOG_DIR, git clone dependency, tool-usage.json confusion) directly observed from Phase 2 implementation details; remainder from general Docker test patterns

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable domain — Docker test harness patterns and Phase 2 outputs are fixed)
