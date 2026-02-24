# Phase 2: Output Observability — Research

**Researched:** 2026-02-23
**Domain:** Claude Code hooks (PostToolUse), shell scripting, GitHub Actions YAML
**Confidence:** HIGH for hook API and Skill tool_name; MEDIUM for hook delivery mechanism in Docker

---

## Summary

Phase 2 adds two new artifacts to every job PR — `gsd-invocations.jsonl` and `observability.md` — and ensures the notification workflow sends their content. The implementation has three moving parts: (1) a PostToolUse hook that fires every time the Skill tool is invoked and appends a JSONL record, (2) a post-`claude` shell script that converts the JSONL into a human-readable `observability.md`, and (3) confirming that the existing `notify-pr-complete.yml` workflow's `*.jsonl` search successfully finds the file the hook creates.

The PostToolUse hook API is fully verified from official Claude Code docs and confirmed with real transcript evidence. The `tool_name` for Skill invocations is `"Skill"` (not `"skill"`) — this is confirmed by parsing live transcript data where Claude invoked GSD skills like `gsd:add-todo`. The `tool_input` contains `{ "skill": "gsd:skill-name", "args": "..." }`.

The OBSV-03 "mismatch" is not a workflow bug — the workflow already correctly searches `*.jsonl`. The issue is that the file doesn't exist until Phase 2 creates the hook that writes it. Once the hook is in place, the workflow will find `gsd-invocations.jsonl` and populate the `log` field in the notification payload. Both artifacts (`gsd-invocations.jsonl` and `observability.md`) must be committed to the job branch so the workflow can read them after checkout.

**Primary recommendation:** Deliver the hook as a Node.js script baked into the Docker image (`/root/.claude/hooks/gsd-invocations.js`) with a global settings file (`/root/.claude/settings.json`) configuring the PostToolUse hook, then generate `observability.md` in `entrypoint.sh` after `claude -p` completes using `jq` (already installed in the Docker image).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OBSV-02 | PostToolUse hook logs Skill invocations to `logs/{jobId}/gsd-invocations.jsonl` | Hook API confirmed: tool_name="Skill", tool_input.skill="gsd:name". Hook reads LOG_DIR from env. Node.js approach matches existing hook pattern in project. |
| OBSV-03 | `notify-pr-complete.yml` correctly references output file extension (fix `.json`/`.jsonl` mismatch) | Workflow already searches `*.jsonl`. Once hook creates `gsd-invocations.jsonl`, the search finds it and `log` field in payload is non-empty. No workflow edit needed beyond a comment fix and validation. |
</phase_requirements>

---

## Standard Stack

### Core (Already Present in Docker Image)
| Tool | Version | Purpose | Why Use |
|------|---------|---------|---------|
| Node.js | 22 (in image) | Hook script runtime | Same runtime as existing GSD hooks in project |
| `jq` | System (bookworm) | JSONL → observability.md generation | Already installed in Dockerfile for secrets parsing |
| Bash | System | Entrypoint scripting + calling parser | Already in use |

### No New Packages Required
Phase 2 uses only tooling already present in the Docker image and existing hook patterns. No `npm install` needed.

### Alternatives Considered
| Standard Approach | Alternative | Why Standard Wins |
|-------------------|-------------|-------------------|
| Node.js hook (global in image) | Bash hook | Node.js matches existing hooks (`gsd-context-monitor.js`); handles JSON parsing safely |
| Global settings in Dockerfile | Project settings in entrypoint | Global settings are simpler; no entrypoint changes needed for hook config delivery |
| `jq` for observability.md | Node.js parser script | `jq` is already present; avoids adding a second script file |

---

## Architecture Patterns

### Current Docker/Job File Layout (Phase 1 state)
```
/root/.claude/
├── commands/gsd/      ← GSD skills (31 .md files)
└── (no hooks, no settings.json)

/job/                  ← Cloned repo (BRANCH=job/{UUID})
└── logs/{JOB_ID}/
    ├── preflight.md   ← Written by entrypoint (Phase 1)
    └── claude-output.json  ← Written by tee (Phase 1)
```

### Phase 2 Target Layout
```
/root/.claude/
├── commands/gsd/      ← GSD skills (unchanged)
├── hooks/
│   └── gsd-invocations.js  ← NEW: PostToolUse hook (written to image in Dockerfile)
└── settings.json      ← NEW: Hook configuration (written to image in Dockerfile)

/job/
└── logs/{JOB_ID}/
    ├── preflight.md         ← Phase 1 (unchanged)
    ├── claude-output.json   ← Phase 1 (unchanged)
    ├── gsd-invocations.jsonl  ← NEW: Written by hook during claude -p
    └── observability.md       ← NEW: Generated from JSONL after claude -p
```

### Pattern 1: PostToolUse Hook — Skill Invocation Logger

**What:** A Node.js script registered as a PostToolUse hook. Fires after every Skill tool call. Appends one JSONL record per invocation.

**Hook input schema (verified from official docs + live transcripts):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/root/.claude/projects/.../transcript.jsonl",
  "cwd": "/job",
  "permission_mode": "bypassPermissions",
  "hook_event_name": "PostToolUse",
  "tool_name": "Skill",
  "tool_input": {
    "skill": "gsd:quick",
    "args": "Implement the feature described in job.md"
  },
  "tool_response": "...",
  "tool_use_id": "toolu_01ABC123..."
}
```

**JSONL record written by the hook:**
```json
{"ts":"2026-02-23T12:00:00.000Z","tool_name":"Skill","skill":"gsd:quick","args":"Implement the feature...","cwd":"/job"}
```

**Hook script pattern (matches existing `gsd-context-monitor.js` style):**
```javascript
#!/usr/bin/env node
// gsd-invocations.js — PostToolUse hook: logs Skill invocations to gsd-invocations.jsonl
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // Only log Skill tool invocations
    if (data.tool_name !== 'Skill') {
      process.exit(0);
    }

    // Get log dir from environment (set by entrypoint.sh: export LOG_DIR=...)
    const logDir = process.env.LOG_DIR;
    if (!logDir) {
      process.exit(0); // Not in a job container context — skip silently
    }

    const record = {
      ts: new Date().toISOString(),
      tool_name: data.tool_name,
      skill: data.tool_input?.skill || 'unknown',
      args: (data.tool_input?.args || '').slice(0, 200), // Truncate long args
      cwd: data.cwd || ''
    };

    const logFile = path.join(logDir, 'gsd-invocations.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
  } catch (e) {
    // Silent fail — never block tool execution
    process.exit(0);
  }
});
```

**Hook settings configuration (`/root/.claude/settings.json`):**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "node /root/.claude/hooks/gsd-invocations.js"
          }
        ]
      }
    ]
  }
}
```

**Dockerfile additions (after existing GSD verification step):**
```dockerfile
# Install PostToolUse hook for GSD invocation logging
COPY hooks/gsd-invocations.js /root/.claude/hooks/gsd-invocations.js
COPY hooks/settings.json /root/.claude/settings.json
RUN chmod +x /root/.claude/hooks/gsd-invocations.js
```

### Pattern 2: observability.md Generator

**What:** A `jq` one-liner run in `entrypoint.sh` after `claude -p` exits. Reads the JSONL and produces a markdown summary.

**Generated `observability.md` format:**
```markdown
# GSD Invocations — Job {JOB_ID}

**Job:** {JOB_ID}
**Generated:** {TIMESTAMP}
**Total invocations:** {COUNT}

## Invocations

| # | Skill | Arguments | Timestamp |
|---|-------|-----------|-----------|
| 1 | gsd:quick | Implement feature... | 2026-02-23T12:00:00Z |
```

**Entrypoint shell code (runs after `claude -p` exits):**
```bash
# 12b. Generate observability.md from gsd-invocations.jsonl
JSONL_FILE="${LOG_DIR}/gsd-invocations.jsonl"
OBS_FILE="${LOG_DIR}/observability.md"

INVOCATION_COUNT=0
if [ -f "${JSONL_FILE}" ]; then
    INVOCATION_COUNT=$(wc -l < "${JSONL_FILE}" | tr -d ' ')
fi

cat > "${OBS_FILE}" << EOF
# GSD Invocations — Job ${JOB_ID}

**Job:** ${JOB_ID}
**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**Total invocations:** ${INVOCATION_COUNT}
EOF

if [ "${INVOCATION_COUNT}" -gt 0 ]; then
    echo "" >> "${OBS_FILE}"
    echo "## Invocations" >> "${OBS_FILE}"
    echo "" >> "${OBS_FILE}"
    echo "| # | Skill | Arguments | Timestamp |" >> "${OBS_FILE}"
    echo "|---|-------|-----------|-----------|" >> "${OBS_FILE}"
    jq -r --slurp 'to_entries[] | "| \(.key + 1) | \(.value.skill) | \(.value.args[:80]) | \(.value.ts) |"' "${JSONL_FILE}" >> "${OBS_FILE}"
else
    echo "" >> "${OBS_FILE}"
    echo "_No GSD skills were invoked in this job._" >> "${OBS_FILE}"
fi
```

### Pattern 3: Workflow Reads gsd-invocations.jsonl (OBSV-03)

**What it is now (already correct):**
```yaml
# Step 5 in notify-pr-complete.yml — already searching for *.jsonl
LOG_CONTENT=""
LOG_DIR="logs/${JOB_ID}"
if [ -d "$LOG_DIR" ]; then
  LOG_FILE=$(find "$LOG_DIR" -name "*.jsonl" -type f | head -1)
  if [ -n "$LOG_FILE" ]; then
    LOG_CONTENT=$(cat "$LOG_FILE")
  fi
fi
```

**What was missing:** The `*.jsonl` file didn't exist because no hook was creating it. After Phase 2, `gsd-invocations.jsonl` will be present in `logs/{JOB_ID}/`, the `find` will match it, and `LOG_CONTENT` will be non-empty.

**OBSV-03 work items:**
1. Verify the workflow correctly reads the hook-created file after a real job run (or a test job from Phase 3)
2. Add a comment clarifying the relationship between the hook output and the `*.jsonl` search
3. Sync the template file (`templates/.github/workflows/notify-pr-complete.yml`) if it differs from the live file

### Anti-Patterns to Avoid

- **Matching on tool_name substring:** Do NOT use `matcher: ".*skill.*"` — the exact value is `"Skill"` (capital S, no wildcards needed).
- **Writing to /tmp instead of LOG_DIR:** The hook must write to `${LOG_DIR}` so the file is inside the git-tracked `/job/logs/{jobId}/` directory and gets committed.
- **Blocking on hook error:** Always `process.exit(0)` on error in the hook — PostToolUse hooks cannot block (tool already ran), but failing with non-zero would feed error to Claude as noise.
- **Hardcoding LOG_DIR in hook:** The hook must read LOG_DIR from environment. The value differs per job (UUID-based path).
- **Missing `export` for LOG_DIR:** The entrypoint must `export LOG_DIR` (not just set it) so the claude subprocess and its hook child processes inherit it.
- **Template drift:** Any changes to `docker/job/` must also be applied to `templates/docker/job/`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hook registration | Custom mechanism | Claude Code `settings.json` + `--settings` flag | Built-in, no extra code |
| JSONL parsing in bash | Custom awk/sed parser | `jq --slurp` | `jq` is installed; handles edge cases (quotes, escaping) |
| Skill name extraction | Regex on raw stdin | `JSON.parse(input).tool_input.skill` | Structured JSON is reliable; regex on JSON is fragile |

**Key insight:** The hook system handles all the plumbing (when to fire, input format, error handling). The implementation only needs to: parse stdin JSON, check `tool_name === 'Skill'`, write one line.

---

## Common Pitfalls

### Pitfall 1: LOG_DIR Not Exported
**What goes wrong:** Hook runs, reads `process.env.LOG_DIR`, gets `undefined`, silently exits. No JSONL file is created. Everything appears to work (no errors) but the file never appears.
**Why it happens:** `LOG_DIR="/job/logs/..."` sets a shell variable but does not export it. Child processes (including `claude` and its hook subprocesses) don't inherit unexported variables.
**How to avoid:** Use `export LOG_DIR="/job/logs/${JOB_ID}"` in `entrypoint.sh`. Also add a defensive null-check in the hook (`if (!logDir) process.exit(0)`).
**Warning signs:** `gsd-invocations.jsonl` is absent from the PR even though GSD skills were run.

### Pitfall 2: Skill tool_name Case Sensitivity
**What goes wrong:** Hook matcher set to `"skill"` (lowercase) or `"SKILL"` (uppercase). Hook never fires.
**Why it happens:** The matcher is a regex compared case-sensitively against `tool_name`. The real value is `"Skill"` (capital S, as confirmed in live transcripts).
**How to avoid:** Use exactly `"matcher": "Skill"` in settings.json.
**Warning signs:** `gsd-invocations.jsonl` is empty or absent despite Skill tool being in ALLOWED_TOOLS and a skill being invoked.

### Pitfall 3: Settings File Collision
**What goes wrong:** The Dockerfile writes `/root/.claude/settings.json`. GSD also uses `/root/.claude/settings.json` (or similar). One overwrites the other.
**Why it happens:** Both GSD and the new hook need to register in settings.json. If the Dockerfile COPY step overwrites an existing file written by GSD's install, hooks may be lost.
**How to avoid:** Check what GSD writes to `/root/.claude/settings.json` during image build. If GSD writes a settings file, merge the hooks configuration rather than overwriting. Alternatively, write the hook config AFTER `npx get-shit-done-cc` in the Dockerfile using a shell RUN step.
**Warning signs:** The preflight shows the hook file exists but it never fires.

### Pitfall 4: JSONL File Not Committed
**What goes wrong:** `gsd-invocations.jsonl` and `observability.md` are created in `${LOG_DIR}` but the `git add` step doesn't include them.
**Why it happens:** The entrypoint uses `git add -A` followed by `git add -f "${LOG_DIR}"`. If LOG_DIR is in `.gitignore`, the `-f` flag is needed. If the JSONL is created AFTER `git add -A`, it would be included in the `-A`, not the separate step.
**How to avoid:** Verify `git add -f "${LOG_DIR}"` at step 12 happens AFTER the JSONL and observability.md are written. The current entrypoint commits at step 12; JSONL writing happens during step 11 (claude -p), and observability.md at step 12b (new). So write observability.md BEFORE `git add`.

### Pitfall 5: GSD Settings File Already Exists
**What goes wrong:** GSD installs a `settings.json` at `/root/.claude/settings.json` during Docker build. Dockerfile `COPY` of hook settings.json overwrites it.
**Why it happens:** Build steps execute sequentially. COPY after `npx get-shit-done-cc` may overwrite GSD's file.
**How to avoid:** Use a Dockerfile `RUN` step to write hook config with `node -e` or inline shell, merging with any existing settings. OR use a project-level `.claude/settings.json` written by the entrypoint at runtime (never conflicts with global).
**Warning signs:** GSD skills stop working (their hooks/settings disappear) after adding the observability hook.

---

## Code Examples

### Complete Hook Script
```javascript
// Source: Pattern derived from /Users/nwessel/.claude/hooks/gsd-context-monitor.js (live project)
// File: /root/.claude/hooks/gsd-invocations.js

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    if (data.tool_name !== 'Skill') {
      process.exit(0);
    }

    const logDir = process.env.LOG_DIR;
    if (!logDir) {
      process.exit(0);
    }

    const record = {
      ts: new Date().toISOString(),
      tool_name: data.tool_name,
      skill: data.tool_input?.skill || 'unknown',
      args: (data.tool_input?.args || '').slice(0, 200),
      cwd: data.cwd || ''
    };

    const logFile = path.join(logDir, 'gsd-invocations.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
  } catch (e) {
    // Silent fail — never block tool execution
    process.exit(0);
  }
});
```

### Hook Settings JSON
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "node /root/.claude/hooks/gsd-invocations.js"
          }
        ]
      }
    ]
  }
}
```

### Dockerfile Additions (after existing GSD verification block)
```dockerfile
# Install PostToolUse hook for GSD invocation observability
RUN mkdir -p /root/.claude/hooks
COPY docker/job/hooks/gsd-invocations.js /root/.claude/hooks/gsd-invocations.js
# Merge hook settings — write settings.json, preserving any GSD config if it exists
RUN node -e "
  const fs = require('fs');
  const settingsPath = '/root/.claude/settings.json';
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch(e) {}
  existing.hooks = existing.hooks || {};
  existing.hooks.PostToolUse = existing.hooks.PostToolUse || [];
  existing.hooks.PostToolUse.push({
    matcher: 'Skill',
    hooks: [{ type: 'command', command: 'node /root/.claude/hooks/gsd-invocations.js' }]
  });
  fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
"
```

### entrypoint.sh Export Fix
```bash
# In entrypoint.sh, change LOG_DIR declaration from:
LOG_DIR="/job/logs/${JOB_ID}"
mkdir -p "${LOG_DIR}"

# TO (add export so claude subprocess and hook inherit it):
export LOG_DIR="/job/logs/${JOB_ID}"
mkdir -p "${LOG_DIR}"
```

### entrypoint.sh Post-Claude observability.md Generation
```bash
# 12b. Generate observability.md from gsd-invocations.jsonl
# (runs after step 11: printf '%s' "${FULL_PROMPT}" | claude -p ... | tee)
JSONL_FILE="${LOG_DIR}/gsd-invocations.jsonl"
OBS_FILE="${LOG_DIR}/observability.md"

INVOCATION_COUNT=0
if [ -f "${JSONL_FILE}" ]; then
    INVOCATION_COUNT=$(wc -l < "${JSONL_FILE}" | tr -d ' ')
fi

{
  echo "# GSD Invocations — Job ${JOB_ID}"
  echo ""
  echo "**Job:** ${JOB_ID}"
  echo "**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "**Total invocations:** ${INVOCATION_COUNT}"
  echo ""

  if [ "${INVOCATION_COUNT}" -gt 0 ]; then
    echo "## Invocations"
    echo ""
    echo "| # | Skill | Arguments | Timestamp |"
    echo "|---|-------|-----------|-----------|"
    jq -r --slurp 'to_entries[] | "| \(.key + 1) | `\(.value.skill)` | \(.value.args | .[0:80]) | \(.value.ts) |"' "${JSONL_FILE}"
  else
    echo "_No GSD skills were invoked in this job._"
  fi
} > "${OBS_FILE}"
```

---

## Key Discoveries

### Skill Tool_name Confirmed
From live transcript parsing (`/Users/nwessel/.claude/projects/-Users-nwessel-Claude-Code/...`):
```json
{
  "type": "tool_use",
  "name": "Skill",
  "input": {
    "skill": "gsd:add-todo",
    "args": "Configure GHL API keys..."
  }
}
```
- `tool_name` in PostToolUse hook input = `"Skill"` (capital S)
- `tool_input.skill` = `"gsd:skill-name"` (namespace:name format)
- `tool_input.args` = arguments string

This resolves the STATE.md blocker: "PostToolUse tool_name value for Skill tool is not officially documented — validate with --verbose."

### OBSV-03 Nature Clarified
The `.json`/`.jsonl` "mismatch" requirement means:
- Current state: entrypoint writes `claude-output.json`; workflow searches `*.jsonl` — finds nothing; `log` field in notification payload is always empty
- After Phase 2: hook writes `gsd-invocations.jsonl`; workflow finds it; `log` field contains actual GSD invocation data

The workflow does NOT need to be changed to fix OBSV-03. The fix is creating the hook (OBSV-02) that produces the `.jsonl` file the workflow is already looking for.

The only workflow work in Phase 2 is:
1. Verifying end-to-end the `log` field is populated (not a code change, just validation)
2. Syncing template if workflow template differs from live workflow

### Hook Delivery Mechanism
The recommended approach is to bake the hook into the Docker image:
- `docker/job/hooks/gsd-invocations.js` → copied to `/root/.claude/hooks/` in Dockerfile
- Settings merged via `node -e` RUN step (avoids overwriting any GSD-written settings)
- No entrypoint.sh changes needed for hook delivery (only for `export LOG_DIR` and observability.md generation)

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| No logging of Skill invocations | PostToolUse hook writes JSONL per invocation | GSD usage is visible in every PR |
| `log` field in notification always empty | Hook creates `*.jsonl` that workflow reads | Operators see actual skill call data in Slack/Telegram |
| Manual inspection of Actions log | `observability.md` committed to PR | Human-readable summary without downloading log artifacts |

---

## Open Questions

1. **Does GSD write `/root/.claude/settings.json` during `npx get-shit-done-cc` install?**
   - What we know: GSD installs 31 `.md` files to `/root/.claude/commands/gsd/`. It may also write settings.
   - What's unclear: Whether it registers any hooks or settings in `settings.json`.
   - Recommendation: Use the `node -e` merge approach in Dockerfile instead of COPY to avoid collision regardless of what GSD writes.

2. **Does `--output-format json` suppress PostToolUse hooks from firing?**
   - What we know: `--output-format json` changes the stdout output format but hooks run separately.
   - What's unclear: Whether print mode (`-p`) affects hook execution.
   - Recommendation: Treat as LOW risk — hooks fire independently of output format; if hooks don't fire, the JSONL file will be empty (not errored), which is the safe fallback.

3. **What is the exact content of `tool_response` for a Skill invocation?**
   - What we know: `tool_response` is present in PostToolUse input per docs.
   - What's unclear: Whether it contains the full skill output (could be very large) or a summary.
   - Recommendation: Do not log `tool_response` in the JSONL record — it could be megabytes. Log only `skill`, `args`, `ts`, `cwd`.

---

## Sources

### Primary (HIGH confidence)
- Official Claude Code hooks docs: `https://code.claude.com/docs/en/hooks` — PostToolUse input schema, exit codes, JSON output format, matcher syntax
- Live transcript file: `/Users/nwessel/.claude/projects/-Users-nwessel-Claude-Code-Business-Products-se-portal/74da7a25-74bf-4085-ac31-3d69d6fc63d5.jsonl` — confirmed `"name": "Skill"` with `"input": {"skill": "gsd:add-todo", "args": "..."}` in real tool_use entries
- Live hook file: `/Users/nwessel/.claude/hooks/gsd-context-monitor.js` — verified Node.js hook pattern (stdin read → JSON.parse → process.exit(0) on silent fail)
- Live settings file: `/Users/nwessel/.claude/settings.json` — verified PostToolUse hook registration syntax
- Live codebase: `docker/job/entrypoint.sh` — current LOG_DIR assignment, git add pattern, position of claude -p call
- Live codebase: `.github/workflows/notify-pr-complete.yml` — confirmed `find "$LOG_DIR" -name "*.jsonl"` search already in place

### Secondary (MEDIUM confidence)
- Official skills docs: `https://code.claude.com/docs/en/skills` — permission syntax `Skill(name)` confirms `"Skill"` is the tool identifier used in hooks
- Pre/PostToolUse docs section: tool name list (`Bash, Edit, Write, Read, Glob, Grep, Task, WebFetch, WebSearch`) — note Skill is NOT listed here, but live transcript evidence and permission syntax override this omission

### Tertiary (LOW confidence)
- None — all critical claims verified against live evidence

---

## Metadata

**Confidence breakdown:**
- Hook API (PostToolUse input schema, output format): HIGH — verified from official docs
- Skill tool_name (`"Skill"`, capital S): HIGH — confirmed from live transcript evidence
- Skill tool_input schema (`{ skill, args }`): HIGH — confirmed from live transcripts
- Hook delivery (Dockerfile approach): MEDIUM — pattern is sound but GSD settings.json collision not confirmed
- OBSV-03 nature (workflow already correct): HIGH — verified from current workflow file contents
- observability.md generation via jq: HIGH — jq is confirmed present in Dockerfile, syntax pattern is standard

**Research date:** 2026-02-23
**Valid until:** 2026-03-25 (hook API is stable; Skill tool_name only changes if Anthropic renames the tool)
