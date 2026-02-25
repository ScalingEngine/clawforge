# Phase 6: Smart Job Prompts - Research

**Researched:** 2026-02-25
**Domain:** Bash prompt assembly, local file reading in Docker containers, keyword-based routing
**Confidence:** HIGH

## Summary

Phase 6 is a pure entrypoint.sh enhancement phase. The goal is to enrich the FULL_PROMPT passed to `claude -p` with structured context from the cloned repo — specifically `/job/CLAUDE.md` (repository documentation) and `/job/package.json` (stack dependencies) — plus a GSD command routing hint derived from task keywords. No new JavaScript libraries, no GitHub API calls, no schema changes.

The critical architectural decision (confirmed in STATE.md) is that context injection happens **entrypoint-side via local file reads** (`cat /job/CLAUDE.md`), not in the Event Handler. This means `create-job.js` and all `lib/` files remain unchanged. The entire implementation is concentrated in `docker/job/entrypoint.sh` (section 8-11: FULL_PROMPT construction), followed by a template sync to `templates/docker/job/entrypoint.sh`.

The key insight about repos: each ClawForge instance is locked to a single `GH_REPO`. When `run-job.yml` fires, `REPO_URL = github.server_url/github.repository.git` (the instance's own repo). The entrypoint clones that branch to `/job`. So `/job/CLAUDE.md` and `/job/package.json` ARE the target repo's files — they are always fresh because they come directly from the cloned branch, not a cached HTTP fetch.

**Primary recommendation:** Add one new section (8b) to `entrypoint.sh` that reads local files and derives the GSD hint, then replace the `FULL_PROMPT` construction block (section 11) with a structured template. Template sync to `templates/` is the final mandatory step.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bash | n/a | Entrypoint shell logic | Already the entrypoint language |
| `jq` | bundled in ubuntu-latest | Parse `package.json` dependencies | Already used in entrypoint for SECRETS parsing |
| GNU coreutils (`head -c`) | built-in | Truncate CLAUDE.md to byte limit | Available in Node 22-bookworm-slim image |
| `tr` | built-in | Lowercase job description for keyword matching | Available in the image |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `grep -qE` | built-in | Regex keyword matching for GSD routing | One-liner check, no external dep |
| `basename -s .git` | built-in | Parse repo name from REPO_URL | Extract `ScalingEngine/clawforge` from URL |
| `printf '%s'` | built-in | Write FULL_PROMPT to /tmp/prompt.txt without echo interpretation issues | Already used in entrypoint |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `head -c 8000` for token cap | Node.js script | `head -c` is simpler, always available, no dep; Node adds complexity for one operation |
| Local file reads in entrypoint | GitHub Contents API fetch in create-job.js | STATE.md decision: entrypoint-side is fresher (reads from cloned branch, not a separate API call) and simpler |
| Keyword grep in entrypoint | LLM-based classification in Event Handler | Keyword grep is deterministic, zero-latency, no extra LLM token cost |
| `jq` for package.json parsing | `python3 -c json.load` | `jq` already present and used in entrypoint |

**Installation:** None required.

## Architecture Patterns

### Recommended Project Structure

No structural changes. One file modified, one synced:

```
docker/job/
└── entrypoint.sh          # PROMPT-01,02,03,04 — enrich FULL_PROMPT construction

templates/docker/job/
└── entrypoint.sh          # Sync from live after changes land
```

### Pattern 1: Entrypoint File Injection (PROMPT-01, PROMPT-03)

**What:** After cloning the repo to `/job`, read `/job/CLAUDE.md` and `/job/package.json` into shell variables with graceful fallbacks.
**When to use:** In the new section 8b, after step 8 (read job.md) and before step 11 (build FULL_PROMPT).
**Token cap:** 2,000 tokens ≈ 8,000 characters (rule of thumb: 1 token ≈ 4 chars for English prose). Use `head -c 8000` to enforce. Add `[TRUNCATED]` marker if original file exceeded the limit.

```bash
# Section 8b: Read repo context files
REPO_CLAUDE_MD=""
REPO_CLAUDE_MD_TRUNCATED=false
if [ -f "/job/CLAUDE.md" ]; then
    FULL_CONTENT=$(cat /job/CLAUDE.md)
    CHAR_COUNT=${#FULL_CONTENT}
    if [ "$CHAR_COUNT" -gt 8000 ]; then
        REPO_CLAUDE_MD=$(echo "$FULL_CONTENT" | head -c 8000)
        REPO_CLAUDE_MD_TRUNCATED=true
    else
        REPO_CLAUDE_MD="$FULL_CONTENT"
    fi
fi

REPO_STACK=""
if [ -f "/job/package.json" ]; then
    # Extract dependencies and devDependencies as "name: version" pairs
    REPO_STACK=$(jq -r '
        (.dependencies // {}) + (.devDependencies // {})
        | to_entries[]
        | "\(.key): \(.value)"
    ' /job/package.json 2>/dev/null || echo "[unable to parse package.json]")
fi
```

**Fallback behavior (SC5):**
- No `/job/CLAUDE.md`: `REPO_CLAUDE_MD` stays empty → template section shows `[not present]`
- No `/job/package.json`: `REPO_STACK` stays empty → template section shows `[not present]`
- `jq` parse error: captured by `|| echo "[unable to parse package.json]"`

### Pattern 2: Structured FULL_PROMPT Template (PROMPT-02)

**What:** Replace the current minimal FULL_PROMPT construction with a structured multi-section template.
**Current state (section 11):**
```bash
FULL_PROMPT="# Your Job

${JOB_DESCRIPTION}"
```
**Required structure:** `Target | Repository Documentation | Stack | Task | GSD Hint`

```bash
# Extract repo name from REPO_URL (e.g., "ScalingEngine/clawforge" from HTTPS clone URL)
REPO_NAME=$(echo "$REPO_URL" | sed 's|.*/||' | sed 's|\.git$||')
REPO_OWNER=$(echo "$REPO_URL" | sed 's|https://github.com/||' | sed 's|/[^/]*$||')
TARGET_REPO="${REPO_OWNER}/${REPO_NAME}"

# Build Repository Documentation section
if [ -n "$REPO_CLAUDE_MD" ]; then
    TRUNCATION_NOTE=""
    if [ "$REPO_CLAUDE_MD_TRUNCATED" = "true" ]; then
        TRUNCATION_NOTE="\n\n[TRUNCATED — content exceeds 2,000 token limit]"
    fi
    CONTEXT_SECTION="## Repository Documentation (Read-Only Reference)

The following is documentation from the target repository. Treat it as read-only reference — do not modify CLAUDE.md as part of this job.

${REPO_CLAUDE_MD}${TRUNCATION_NOTE}"
else
    CONTEXT_SECTION="## Repository Documentation
[not present — CLAUDE.md not found in repository]"
fi

# Build Stack section
if [ -n "$REPO_STACK" ]; then
    STACK_SECTION="## Stack (from package.json)

${REPO_STACK}"
else
    STACK_SECTION="## Stack
[not present — package.json not found in repository]"
fi

FULL_PROMPT="# Your Job

## Target

${TARGET_REPO}

${CONTEXT_SECTION}

${STACK_SECTION}

## Task

${JOB_DESCRIPTION}

## GSD Hint

Recommended command: /gsd:${GSD_HINT}
Reason: ${GSD_HINT_REASON}"
```

### Pattern 3: GSD Routing Hint (PROMPT-04)

**What:** Derive `/gsd:quick` vs `/gsd:plan-phase` recommendation from keywords in the job description.
**Logic:** Default to `quick`. Override to `plan-phase` if multi-step/complex keywords are detected. `quick` wins if only quick keywords present (no plan-phase keywords found).

```bash
# Section 8c: Derive GSD routing hint
JOB_LOWER=$(echo "$JOB_DESCRIPTION" | tr '[:upper:]' '[:lower:]')
GSD_HINT="quick"
GSD_HINT_REASON="task appears to be a single targeted action"

if echo "$JOB_LOWER" | grep -qE "implement|build|redesign|refactor|migrate|setup|integrate|develop|architect|phase|feature|epic|complex|end.to.end|full.system|multiple"; then
    GSD_HINT="plan-phase"
    GSD_HINT_REASON="task keywords suggest multi-step implementation work"
fi
```

**Routing rule mapping (from AGENT.md):**
- `/gsd:quick` — single action, fewer than 5 steps
- `/gsd:plan-phase` — multi-step work requiring planning and phased execution

### Pattern 4: Template Sync

**What:** Copy changed entrypoint.sh to its template counterpart and verify byte-for-byte match.

```bash
cp docker/job/entrypoint.sh templates/docker/job/entrypoint.sh
diff docker/job/entrypoint.sh templates/docker/job/entrypoint.sh && echo "IDENTICAL"
```

This is the same sync pattern established in Phase 5 (PIPE-05). It must be the final step of the last plan.

### Anti-Patterns to Avoid

- **Pre-fetching context in create-job.js:** STATE.md locked decision — entrypoint-side reads only. Never add GitHub Contents API calls to the Event Handler for this purpose.
- **Using `echo "$VAR"` to write multi-line strings:** `echo` interprets escape sequences and can corrupt markdown content. Always use `printf '%s'` for writing to files (already established in the entrypoint).
- **Hardcoding the token character limit as a comment-only note:** Enforce it with `head -c 8000` — silent truncation without the `[TRUNCATED]` marker leaves the agent unaware content was cut.
- **Blocking on missing files with `set -e`:** The entrypoint already uses `set -e`, so any command that exits non-zero will abort. All file reads must use conditional checks (`[ -f ... ]`) or fallback operators (`|| echo "[fallback]"`). Never `cat /job/CLAUDE.md` without a file existence check.
- **Putting the CLAUDE.md content in the system prompt instead of FULL_PROMPT:** The system prompt (SOUL.md + AGENT.md) is the agent's identity and behavior rules. Repo context belongs in the task prompt (FULL_PROMPT) so it's scoped to the job, not baked into the agent identity.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom tokenizer script | `head -c 8000` character limit | 4 chars/token approximation is sufficient; exact tokenization not worth the dep |
| JSON parsing | awk/sed on package.json | `jq` | Already present; handles edge cases (nested deps, version ranges, null fields) |
| Target repo name extraction | GitHub API call | Parse from `$REPO_URL` | REPO_URL is already in the environment; no network call needed |
| Keyword classification | LLM-based analysis | `grep -qE` | Deterministic, instant, no cost; good enough for routing hint |
| File size check | `wc -c` pipeline | Bash string length `${#VAR}` | Variable expansion length check avoids a subprocess |

**Key insight:** This phase requires zero new tools. Everything needed is already in the container image (`jq`, GNU coreutils, bash). The complexity ceiling is low — it's string assembly in bash.

## Common Pitfalls

### Pitfall 1: Variable Newlines Breaking Heredoc or Printf

**What goes wrong:** When CLAUDE.md content contains backticks, `$`, or `\` characters, embedding it in a double-quoted bash string or heredoc can trigger unexpected expansion.
**Why it happens:** Bash interpolates `$VAR`, backtick commands, and `\n` inside double quotes.
**How to avoid:** Use single-quoted heredoc delimiters when writing static strings. For dynamic content like `$REPO_CLAUDE_MD`, use `printf '%s'` to write to a temp file, then read that file into FULL_PROMPT. The entrypoint already uses `printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt` for safe writing — extend this pattern.
**Warning signs:** CLAUDE.md content contains `$(` or `${` sequences that get executed/expanded in the prompt.

**Verified safe pattern (already in entrypoint):**
```bash
printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt
```

### Pitfall 2: `head -c` Cuts Mid-UTF8 Character

**What goes wrong:** `head -c 8000` cuts at a byte boundary, which may split a multi-byte UTF-8 character and produce invalid UTF-8.
**Why it happens:** CLAUDE.md may contain Unicode characters (smart quotes, emoji, non-ASCII names).
**How to avoid:** This is an acceptable tradeoff for a 2000-token cap — the last character may be garbled but the content up to that point is valid. The `[TRUNCATED]` marker after the cut makes the boundary explicit. Alternatively, use `head -c 7900` to leave a safe margin before the 8000-byte boundary.
**Warning signs:** Claude receives a `\xEF\xBF` partial sequence and logs a parse warning (uncommon in CLAUDE.md files).

### Pitfall 3: `set -e` Kills Script When CLAUDE.md is Missing

**What goes wrong:** The entrypoint uses `set -e`. A bare `cat /job/CLAUDE.md` without existence check exits non-zero when the file is missing, aborting the entire job.
**Why it happens:** `set -e` aborts on any command with non-zero exit code, including file-not-found from `cat`.
**How to avoid:** Always gate file reads: `if [ -f /job/CLAUDE.md ]; then ... fi`. Never rely on `|| true` after `cat` for content capture — it swallows the content on success too.
**Warning signs:** Job aborts immediately after clone with no error message about CLAUDE.md.

### Pitfall 4: jq Fails on Non-Standard package.json

**What goes wrong:** `jq` exits non-zero on malformed JSON, or the `dependencies`/`devDependencies` keys are absent (valid for some repos).
**Why it happens:** Not every repo has dependencies. Some `package.json` files only have `scripts`.
**How to avoid:** Use `.dependencies // {}` and `.devDependencies // {}` in the jq filter (already shown in Pattern 1) to default to empty objects. Wrap the whole jq call with `|| echo "[unable to parse]"` for malformed JSON.
**Warning signs:** jq exits 5 (compile error) or 3 (no matches found), script continues but STACK section is empty.

### Pitfall 5: Oversized package.json Stack Section

**What goes wrong:** A repo with 100+ dependencies produces a Stack section that consumes thousands of tokens, overwhelming the job description.
**Why it happens:** `to_entries[]` on a large `dependencies` object produces one line per package.
**How to avoid:** Cap the Stack section at a smaller limit. Either: (a) only extract `dependencies`, not `devDependencies`; or (b) apply a character cap (e.g., 2000 chars) to the Stack section separately. A practical approach: show `dependencies` only, which is what the agent needs to understand the runtime stack.
**Warning signs:** FULL_PROMPT for a large repo is 20K+ characters, crowding out the actual task.

**Recommended cap:** Show `dependencies` only (not devDeps) to keep Stack concise. DevDependencies (build tools, test frameworks) are rarely relevant to task execution.

### Pitfall 6: Template Sync Forgotten

**What goes wrong:** `docker/job/entrypoint.sh` is updated but `templates/docker/job/entrypoint.sh` diverges.
**Why it happens:** Template sync is easy to skip when focused on the live file.
**How to avoid:** Make sync an explicit numbered task in every plan that touches the live entrypoint. Established pattern from Phase 5.
**Warning signs:** `diff docker/job/entrypoint.sh templates/docker/job/entrypoint.sh` exits non-zero.

## Code Examples

Verified patterns from existing codebase:

### Current FULL_PROMPT Construction (section 11, to be replaced)

```bash
# Source: docker/job/entrypoint.sh lines 117-119 (current state)
FULL_PROMPT="# Your Job

${JOB_DESCRIPTION}"
```

### Safe Multi-Line Variable Writing (existing pattern to extend)

```bash
# Source: docker/job/entrypoint.sh lines 126-127
# Write prompt to temp file — piping via printf | claude | tee causes issues
printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt
```

### jq SECRETS Parsing (existing pattern to adapt for package.json)

```bash
# Source: docker/job/entrypoint.sh lines 16-17
eval $(echo "$SECRETS" | jq -r 'to_entries | .[] | "export \(.key)=\"\(.value)\""')

# Adapted for package.json stack:
REPO_STACK=$(jq -r '
    (.dependencies // {}) + (.devDependencies // {})
    | to_entries[]
    | "\(.key): \(.value)"
' /job/package.json 2>/dev/null || echo "[unable to parse package.json]")
```

### Complete New Section 8b (Read Repo Context)

```bash
# Section 8b: Read repo context for prompt enrichment
# Derive target repo name from REPO_URL
# REPO_URL = https://github.com/ScalingEngine/clawforge.git
REPO_SLUG=$(echo "$REPO_URL" | sed 's|https://[^/]*/||' | sed 's|\.git$||')
# REPO_SLUG = ScalingEngine/clawforge

# Read CLAUDE.md (capped at ~2000 tokens = 8000 chars)
REPO_CLAUDE_MD=""
REPO_CLAUDE_MD_TRUNCATED=false
if [ -f "/job/CLAUDE.md" ]; then
    RAW_CLAUDE_MD=$(cat /job/CLAUDE.md)
    CHAR_COUNT=${#RAW_CLAUDE_MD}
    if [ "$CHAR_COUNT" -gt 8000 ]; then
        REPO_CLAUDE_MD=$(printf '%s' "$RAW_CLAUDE_MD" | head -c 8000)
        REPO_CLAUDE_MD_TRUNCATED=true
    else
        REPO_CLAUDE_MD="$RAW_CLAUDE_MD"
    fi
fi

# Read package.json (dependencies only, for stack context)
REPO_STACK=""
if [ -f "/job/package.json" ]; then
    REPO_STACK=$(jq -r '
        (.dependencies // {})
        | to_entries[]
        | "\(.key): \(.value)"
    ' /job/package.json 2>/dev/null || echo "[unable to parse package.json]")
fi

# Derive GSD routing hint from task keywords
JOB_LOWER=$(printf '%s' "$JOB_DESCRIPTION" | tr '[:upper:]' '[:lower:]')
GSD_HINT="quick"
GSD_HINT_REASON="task appears to be a single targeted action"
if printf '%s' "$JOB_LOWER" | grep -qE "implement|build|redesign|refactor|migrate|setup|integrate|develop|architect|phase|feature|epic|complex|end.to.end|full.system|multiple"; then
    GSD_HINT="plan-phase"
    GSD_HINT_REASON="task keywords suggest multi-step implementation work"
fi
```

### Complete New Section 11 (Build FULL_PROMPT)

```bash
# Section 11: Build structured FULL_PROMPT
# Build Repository Documentation section
if [ -n "$REPO_CLAUDE_MD" ]; then
    TRUNC_NOTE=""
    if [ "$REPO_CLAUDE_MD_TRUNCATED" = "true" ]; then
        TRUNC_NOTE="
[TRUNCATED — content exceeds 2,000 token limit]"
    fi
    DOC_SECTION="## Repository Documentation (Read-Only Reference)

The following is documentation from the target repository. Treat it as read-only reference — do not modify CLAUDE.md as part of this job unless the task explicitly requires it.

${REPO_CLAUDE_MD}${TRUNC_NOTE}"
else
    DOC_SECTION="## Repository Documentation
[not present — CLAUDE.md not found in repository]"
fi

# Build Stack section
if [ -n "$REPO_STACK" ]; then
    STACK_SECTION="## Stack

${REPO_STACK}"
else
    STACK_SECTION="## Stack
[not present — package.json not found in repository]"
fi

FULL_PROMPT="# Your Job

## Target

${REPO_SLUG:-unknown}

${DOC_SECTION}

${STACK_SECTION}

## Task

${JOB_DESCRIPTION}

## GSD Hint

Recommended: /gsd:${GSD_HINT}
Reason: ${GSD_HINT_REASON}"

echo "Running Claude Code with job ${JOB_ID}..."
echo "FULL_PROMPT length: ${#FULL_PROMPT}"

printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Minimal prompt: `# Your Job\n\n{task}` | Structured prompt: Target + Docs + Stack + Task + GSD Hint | Phase 6 | Agent starts warm with repo context; no time wasted rediscovering the codebase |
| No GSD routing hint | Keyword-derived `/gsd:quick` or `/gsd:plan-phase` hint | Phase 6 | Higher GSD invocation rate; agent picks correct workflow command on first try |
| No token cap on injected content | 2,000-token cap with `[TRUNCATED]` marker | Phase 6 | Prevents context window bloat from large CLAUDE.md files |
| No repo documentation in prompt | CLAUDE.md injected as Read-Only Reference | Phase 6 | Agent understands conventions, architecture, and patterns before executing |
| No stack context in prompt | `package.json` dependencies listed in Stack section | Phase 6 | Agent knows the runtime stack without reading package.json during the job |

**No deprecated approaches** — this is additive to the existing prompt.

## Open Questions

1. **Should `devDependencies` be included in the Stack section?**
   - What we know: `devDependencies` includes build tools and test frameworks (esbuild, drizzle-kit, etc.) that are rarely relevant to runtime tasks
   - What's unclear: Whether omitting them hides useful context (e.g., the agent might want to know which test framework to use)
   - Recommendation: Include `devDependencies` but only if combined `dependencies + devDependencies` is under 50 entries. Above that threshold, show only `dependencies`. This balances completeness vs. noise.

2. **Where should the `Target` section get its value?**
   - What we know: `REPO_URL` is available in the container environment (passed by `run-job.yml`). Format: `https://github.com/ScalingEngine/clawforge.git`
   - What's unclear: Whether the Event Handler always passes a meaningful "target" beyond the GitHub repo (e.g., Noah's Event Handler jobs targeting `scaling-engine-portal` use a different GH_REPO instance)
   - Recommendation: Parse `REPO_SLUG` from `REPO_URL` using `sed`. This is always accurate because `REPO_URL` comes directly from `github.repository` in the Actions workflow. No ambiguity.

3. **Character vs byte limit for CLAUDE.md truncation?**
   - What we know: `head -c 8000` counts bytes, not characters. `${#VAR}` in bash counts characters.
   - What's unclear: Whether the discrepancy matters (most CLAUDE.md files are ASCII-dominant)
   - Recommendation: Use `${#RAW_CLAUDE_MD}` for the existence check and `printf '%s' "$VAR" | head -c 8000` for the actual truncation. This gives a consistent character-based length check with a byte-based truncation, which is acceptable for ASCII-dominant content.

4. **Should the GSD hint detection use the full job description or just the first line?**
   - What we know: `JOB_DESCRIPTION` is the full job.md content (often 1-3 sentences)
   - What's unclear: Whether multi-sentence jobs with a quick first line but complex follow-up body should route to `plan-phase`
   - Recommendation: Use the full description text. A single `grep -qE` across the full text correctly handles both "Fix the bug in X that causes Y" (quick) and "Implement a full login flow with OAuth" (plan-phase).

## Validation Architecture

> Skipped — workflow.nyquist_validation is not enabled in .planning/config.json

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROMPT-01 | Job entrypoint reads CLAUDE.md and package.json from cloned repo and injects content into the Claude prompt | Pattern 1 (local file reads from /job/ after clone); files always present in /job/ because the container clones the instance's GH_REPO which IS the target repo |
| PROMPT-02 | Job description follows a structured template with Target, Context, Stack, Task, and GSD Hint sections | Pattern 2 (new FULL_PROMPT construction in section 11); REPO_SLUG parsed from REPO_URL; sections conditionally populated from REPO_CLAUDE_MD and REPO_STACK variables |
| PROMPT-03 | Injected repo context is wrapped in "Read-Only Reference" framing and capped at 2,000 tokens | Pattern 1 (head -c 8000 = ~2000 tokens) + Pattern 2 ("Read-Only Reference" framing in CONTEXT_SECTION header + [TRUNCATED] marker) |
| PROMPT-04 | Job description includes a GSD command routing hint (quick vs plan-phase) based on task keywords | Pattern 3 (grep -qE keyword matching on lowercased JOB_DESCRIPTION; default quick, override to plan-phase on complex keywords) |
</phase_requirements>

## Sources

### Primary (HIGH confidence)

- Live codebase: `docker/job/entrypoint.sh` — read directly; current FULL_PROMPT construction is lines 117-119
- Live codebase: `.github/workflows/run-job.yml` — confirms REPO_URL environment variable and its format
- Live codebase: `lib/tools/create-job.js` — confirms job.md is written with raw task text; no enrichment happens here
- Live codebase: `instances/noah/config/AGENT.md` + `instances/strategyES/config/AGENT.md` — confirms GSD routing rules (quick < 5 steps, plan-phase for complex work)
- `.planning/STATE.md` — locked decision: entrypoint-side reads, not Event Handler pre-fetch
- `.planning/REQUIREMENTS.md` — PROMPT-01 through PROMPT-04 definitions

### Secondary (MEDIUM confidence)

- Token estimation: 1 token ≈ 4 characters for English prose (widely cited approximation; exact value varies by tokenizer)
- `jq` null-safe filter pattern `(.dependencies // {})` — from training data on jq documentation; verified by reasoning about package.json structure

### Tertiary (LOW confidence)

- `head -c` byte vs character behavior on multi-byte UTF-8 — known limitation acknowledged in pitfalls; acceptable for CLAUDE.md content which is typically ASCII-dominant

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new tools; all bash primitives already present in the image
- Architecture: HIGH — single-file change to a well-understood entrypoint; locked decision in STATE.md eliminates alternative approaches
- Pitfalls: HIGH — derived from reading actual entrypoint code and known bash variable expansion behavior

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (bash behavior is stable; GitHub Actions REPO_URL format is stable)
