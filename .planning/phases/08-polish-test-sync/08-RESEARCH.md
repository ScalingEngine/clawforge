# Phase 8: Polish & Test Sync — Research

**Researched:** 2026-02-25
**Domain:** Bash shell scripting, GitHub Actions YAML, Node.js webhook handlers, documentation tracking artifacts
**Confidence:** HIGH

## Summary

Phase 8 is a gap-closure phase with five discrete, independent changes identified in the v1.1 milestone audit. There are no new requirements — everything traces back to specific findings (FINDING-1, FINDING-2) and tech debt items catalogued in `.planning/v1.1-MILESTONE-AUDIT.md`. The scope is surgically narrow: two runtime behaviour fixes (failure_stage surfacing, notify-pr-complete wildcard), one test harness alignment, and two documentation/frontmatter corrections.

The changes span four files: `api/index.js` (Node.js webhook handler), `tests/test-entrypoint.sh` (bash), `.github/workflows/notify-pr-complete.yml` + `templates/.github/workflows/notify-pr-complete.yml` (GitHub Actions YAML), `.planning/REQUIREMENTS.md` (markdown), and `.planning/phases/07-previous-job-context/07-01-SUMMARY.md` (YAML frontmatter). None of these changes are architecturally coupled — each can be made independently.

One success criterion appears pre-satisfied: REQUIREMENTS.md traceability table at line 110 already shows `HIST-01 | Phase 7 (v1.1) | Complete`. This may be a result of changes made after the audit was written (the `.planning/REQUIREMENTS.md` file appears in the git working tree as modified per git status). The planner should verify this and skip the edit if already correct, or make the edit idempotent.

**Primary recommendation:** Group the five changes into two logical plans — Plan 01 covers the two runtime fixes (FINDING-1: failure_stage surfacing + JSONL wildcard), and Plan 02 covers the documentation/test alignment (FINDING-2: test-entrypoint.sh + two doc artifacts). This grouping respects the principle of "smallest PR that can be verified independently."

## Standard Stack

### Core

| File / Tool | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| Node.js `api/index.js` | ESM, existing | Webhook handler — extract `failure_stage` from payload | Already production code |
| `lib/ai/index.js` `summarizeJob()` | Existing | One-shot LLM job summarizer | Already production code |
| `tests/test-entrypoint.sh` | Bash | Test harness entrypoint | Already in use |
| GitHub Actions YAML | v4 actions | CI workflow orchestration | Already in use |
| `find ... -name "gsd-invocations.jsonl"` | POSIX find | Explicit file lookup (replaces wildcard) | POSIX standard, inode-order-independent |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| YAML frontmatter | — | SUMMARY.md structured metadata | Adding `requirements-completed` field to match 06-01-SUMMARY.md pattern |
| `printf '%s' ... > /tmp/prompt.txt` | bash builtin | Safe multi-line variable write + file redirect | Matches production entrypoint pattern — no race condition |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `find ... -name "*.jsonl" \| head -1` (current) | `find ... -name "gsd-invocations.jsonl"` | Explicit name eliminates inode-order dependency; `*.jsonl` works only if `gsd-invocations.jsonl` sorts before `claude-output.jsonl` in directory listing, which is fragile |
| `printf '%s' "${FULL_PROMPT}" \| claude -p` (old pipe) | `printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt && claude -p < /tmp/prompt.txt` | File redirect is the production-verified approach; pipe causes Node.js stdin race condition per Phase 6 decision |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Structure for Phase 8 Changes

```
Changes:
├── api/index.js                                      # FINDING-1: extract + pass failure_stage to summarizeJob
├── tests/test-entrypoint.sh                          # FINDING-2: align with production prompt format
├── .github/workflows/notify-pr-complete.yml          # Tech debt: fix *.jsonl wildcard (live)
├── templates/.github/workflows/notify-pr-complete.yml  # Tech debt: sync template to match live
├── .planning/REQUIREMENTS.md                         # Tech debt: verify/set HIST-01 to "Complete"
└── .planning/phases/07-previous-job-context/07-01-SUMMARY.md  # Tech debt: add requirements-completed frontmatter
```

### Pattern 1: failure_stage Extraction in handleGithubWebhook

**What:** `notify-job-failed.yml` sends `failure_stage` in its JSON payload (values: `docker_pull`, `auth`, `claude`). `handleGithubWebhook` in `api/index.js` builds a `results` object but does NOT include `failure_stage`. `summarizeJob(results)` therefore cannot include the stage in its output.

**Fix:** Add `failure_stage` to the `results` object extracted from `payload`, then add it as a section in `summarizeJob`'s `userMessage` assembly.

**Current code (api/index.js lines 258-268):**
```javascript
const results = {
  job: payload.job || '',
  pr_url: payload.pr_url || payload.run_url || '',
  run_url: payload.run_url || '',
  status: payload.status || '',
  merge_result: payload.merge_result || '',
  log: payload.log || '',
  changed_files: payload.changed_files || [],
  commit_message: payload.commit_message || '',
};
```

**After fix — add one field:**
```javascript
const results = {
  job: payload.job || '',
  pr_url: payload.pr_url || payload.run_url || '',
  run_url: payload.run_url || '',
  status: payload.status || '',
  failure_stage: payload.failure_stage || '',   // ← add this
  merge_result: payload.merge_result || '',
  log: payload.log || '',
  changed_files: payload.changed_files || [],
  commit_message: payload.commit_message || '',
};
```

**Then in `summarizeJob` (lib/ai/index.js lines 246-255), add a conditional section:**
```javascript
results.failure_stage ? `## Failure Stage\n${results.failure_stage}` : '',
```
Insert this after the `results.status` line. The LLM will then naturally incorporate the stage label (docker_pull/auth/claude) into the human-readable summary text.

**Confidence:** HIGH — payload field confirmed in `notify-job-failed.yml` lines 70-71 and 82-84. The `results` object gap confirmed at `api/index.js` lines 258-268. The `summarizeJob` template assembly at `lib/ai/index.js` lines 246-253.

### Pattern 2: JSONL Wildcard Fix in notify-pr-complete.yml

**What:** Both the live workflow (`.github/workflows/notify-pr-complete.yml`) and the template (`templates/.github/workflows/notify-pr-complete.yml`) use:
```bash
LOG_FILE=$(find "$LOG_DIR" -name "*.jsonl" -type f | head -1)
```
This is fragile because the log directory contains both `gsd-invocations.jsonl` and `claude-output.jsonl`. If filesystem inode ordering puts `claude-output.jsonl` first, the wrong file is sent as the GSD invocation log.

**Fix — both files, lines 86 (live) and 86 (template):**
```bash
LOG_FILE=$(find "$LOG_DIR" -name "gsd-invocations.jsonl" -type f | head -1)
```

The `head -1` is still correct — it guards against the case where no matching file is found (returns empty string).

**Confidence:** HIGH — confirmed in both live `.github/workflows/notify-pr-complete.yml` line 86 and `templates/.github/workflows/notify-pr-complete.yml` line 86. Files are byte-for-byte identical (confirmed by Phase 5 sync). Both must be updated together to maintain PIPE-05 compliance.

### Pattern 3: test-entrypoint.sh Alignment with Production

**What:** `tests/test-entrypoint.sh` diverged from production `docker/job/entrypoint.sh` in two ways after Phase 6:

1. **Prompt delivery mechanism:** Test uses `printf '%s' "${FULL_PROMPT}" | claude -p` (pipe). Production uses `printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt` then `claude -p < /tmp/prompt.txt` (file redirect). The file redirect was adopted in Phase 6 specifically to avoid Node.js stdin race conditions.

2. **FULL_PROMPT structure:** Test builds a minimal two-section prompt:
   ```bash
   FULL_PROMPT="# Your Job

   ${JOB_DESCRIPTION}"
   ```
   Production builds a 5-section structured prompt (Target, Repository Documentation, Stack, Task, GSD Hint). Test does not read `CLAUDE.md`, does not inject `package.json` deps, and does not derive a GSD routing hint.

**Fix:** Update `tests/test-entrypoint.sh` to:
- Replace the pipe delivery with file redirect (`printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt` + `claude -p < /tmp/prompt.txt`)
- Add sections from fixture files for Target, Docs, Stack, GSD Hint

For test purposes, the sections can use fixture file reads with graceful fallbacks (fixtures are mounted at `/fixtures/`). The test doesn't need the full REPO_URL/gh-cli context of production — it can use stub values for REPO_SLUG and STACK, or read fixture files if available.

**Production reference (entrypoint.sh lines 183-216):**
```bash
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

printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt

claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "${ALLOWED_TOOLS}" \
    < /tmp/prompt.txt \
    2>&1 | tee "${LOG_DIR}/claude-output.jsonl" || CLAUDE_EXIT=$?
```

**Confidence:** HIGH — confirmed in `tests/test-entrypoint.sh` lines 60-72 (old format) and `templates/docker/job/entrypoint.sh` (= live) lines 183-216 (new format). Phase 6 decision to use file redirect is documented in `STATE.md` and `06-01-SUMMARY.md`.

### Pattern 4: Documentation Artifact Fixes

**REQUIREMENTS.md HIST-01 traceability:**
- Audit claimed line 110 showed "Pending". Current file at line 110 shows `| HIST-01 | Phase 7 (v1.1) | Complete |`.
- The `.planning/REQUIREMENTS.md` file is in the git working tree as modified (` M` in git status from the initial snapshot).
- **Action:** Verify the current state of the file before making any edit. If it already reads "Complete", this item is already done and no change is needed.

**07-01-SUMMARY.md missing `requirements-completed` frontmatter:**
- Current frontmatter has `requirements: [HIST-01, HIST-04]` but lacks `requirements-completed:`.
- Reference pattern from `06-01-SUMMARY.md` line 46: `requirements-completed: [PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04]`.
- Fix: Add `requirements-completed: [HIST-01, HIST-04]` after the `requirements:` line.

**Confidence:** HIGH — both files read directly, issue confirmed by comparison.

### Anti-Patterns to Avoid

- **Touching notify-job-failed.yml:** The failure_stage field is already correctly computed and transmitted in `notify-job-failed.yml`. Do NOT modify that workflow — the fix is purely on the receiver side (`api/index.js` + `lib/ai/index.js`).
- **Adding fake fixture context to test-entrypoint.sh:** The test does not need real CLAUDE.md or package.json content. Stub values (e.g., `REPO_SLUG="test-repo"`, empty `DOC_SECTION`, empty `STACK_SECTION`) are sufficient — the goal is structural alignment (file redirect + 5-section FULL_PROMPT), not content fidelity.
- **Forgetting the template sync for notify-pr-complete.yml:** The live workflow and template must be kept byte-for-byte identical (PIPE-05 requirement). Fixing only the live file without syncing the template would create a new PIPE-05 violation.
- **Over-engineering the summarizeJob LLM prompt:** Do not modify the job summary system prompt (`lib/paths.js` → `jobSummaryMd`). The model already knows how to incorporate new sections from `userMessage`. Adding `failure_stage` to `userMessage` is the minimal correct change.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Making `failure_stage` appear in message | Custom notification template | Add field to `results` passed to existing `summarizeJob()` | summarizeJob already handles optional fields gracefully (`.filter(Boolean)`) |
| Determining correct JSONL file | Custom ordering logic | `find -name "gsd-invocations.jsonl"` | Explicit name is unambiguous, POSIX-standard |
| Test fixture prompt sections | Full entrypoint port | Minimal stub values for non-test sections | Test validates prompt delivery and GSD chain, not content accuracy |

**Key insight:** Every fix in this phase is a minimal delta to an existing mechanism. None require new abstractions.

## Common Pitfalls

### Pitfall 1: Modifying the Wrong Side of FINDING-1

**What goes wrong:** Developer edits `notify-job-failed.yml` to send more data, missing that it already sends `failure_stage` correctly.
**Why it happens:** FINDING-1 description mentions both the workflow and the webhook handler. The workflow side is correct. The bug is in `handleGithubWebhook` in `api/index.js`.
**How to avoid:** The audit evidence is explicit: "handleGithubWebhook does not extract it into results{} passed to summarizeJob()". Edit `api/index.js` and `lib/ai/index.js` only.
**Warning signs:** If you find yourself modifying `notify-job-failed.yml`, stop — the workflow already computes and sends `failure_stage` correctly.

### Pitfall 2: Breaking the test-entrypoint.sh Exit Code Handling

**What goes wrong:** The existing `test-entrypoint.sh` passes `|| true` to the claude invocation, preventing set -e from killing the script on claude failure. If the file redirect rewrite loses this, set -e will make the script fail hard when claude exits non-zero.
**Why it happens:** Refactoring the delivery mechanism without preserving the exit code pattern.
**How to avoid:** Production entrypoint uses `|| CLAUDE_EXIT=$?` to capture exit code without triggering set -e. Test can use `|| true` (existing approach) or `|| CLAUDE_EXIT=$?` (production approach). Either is acceptable; the point is to not lose the non-fatal pattern.

### Pitfall 3: notify-pr-complete.yml Template Sync Drift

**What goes wrong:** Fixing the wildcard in the live workflow but forgetting to update the template, creating a PIPE-05 violation.
**Why it happens:** Two files with identical content that must be kept in sync manually.
**How to avoid:** After fixing `.github/workflows/notify-pr-complete.yml`, immediately copy to `templates/.github/workflows/notify-pr-complete.yml` and diff to confirm byte-for-byte identity.

### Pitfall 4: REQUIREMENTS.md HIST-01 Already Fixed

**What goes wrong:** Making a "fix" edit to a line that is already correct, which would be a no-op at best or introduce whitespace drift at worst.
**Why it happens:** The audit was written at a point in time; the file has since been modified.
**How to avoid:** Read the exact current state of REQUIREMENTS.md line 110 before editing. If it already shows "Complete", mark success criterion 4 as already satisfied and skip the edit.

## Code Examples

### FINDING-1: Minimal Diff to api/index.js

```javascript
// BEFORE (lines 258-268 in api/index.js)
const results = {
  job: payload.job || '',
  pr_url: payload.pr_url || payload.run_url || '',
  run_url: payload.run_url || '',
  status: payload.status || '',
  merge_result: payload.merge_result || '',
  log: payload.log || '',
  changed_files: payload.changed_files || [],
  commit_message: payload.commit_message || '',
};

// AFTER
const results = {
  job: payload.job || '',
  pr_url: payload.pr_url || payload.run_url || '',
  run_url: payload.run_url || '',
  status: payload.status || '',
  failure_stage: payload.failure_stage || '',
  merge_result: payload.merge_result || '',
  log: payload.log || '',
  changed_files: payload.changed_files || [],
  commit_message: payload.commit_message || '',
};
```

### FINDING-1: Minimal Diff to lib/ai/index.js summarizeJob

```javascript
// BEFORE (lines 246-255 in lib/ai/index.js)
const userMessage = [
  results.job ? `## Task\n${results.job}` : '',
  results.commit_message ? `## Commit Message\n${results.commit_message}` : '',
  results.changed_files?.length ? `## Changed Files\n${results.changed_files.join('\n')}` : '',
  results.status ? `## Status\n${results.status}` : '',
  results.merge_result ? `## Merge Result\n${results.merge_result}` : '',
  results.pr_url ? `## PR URL\n${results.pr_url}` : '',
  results.run_url ? `## Run URL\n${results.run_url}` : '',
  results.log ? `## Agent Log\n${results.log}` : '',
].filter(Boolean).join('\n\n');

// AFTER — add failure_stage section after status
const userMessage = [
  results.job ? `## Task\n${results.job}` : '',
  results.commit_message ? `## Commit Message\n${results.commit_message}` : '',
  results.changed_files?.length ? `## Changed Files\n${results.changed_files.join('\n')}` : '',
  results.status ? `## Status\n${results.status}` : '',
  results.failure_stage ? `## Failure Stage\n${results.failure_stage}` : '',
  results.merge_result ? `## Merge Result\n${results.merge_result}` : '',
  results.pr_url ? `## PR URL\n${results.pr_url}` : '',
  results.run_url ? `## Run URL\n${results.run_url}` : '',
  results.log ? `## Agent Log\n${results.log}` : '',
].filter(Boolean).join('\n\n');
```

### Tech Debt: JSONL Wildcard Fix (notify-pr-complete.yml)

```yaml
# BEFORE (line 86 in both live and template workflows)
LOG_FILE=$(find "$LOG_DIR" -name "*.jsonl" -type f | head -1)

# AFTER
LOG_FILE=$(find "$LOG_DIR" -name "gsd-invocations.jsonl" -type f | head -1)
```

### FINDING-2: test-entrypoint.sh — Key Sections to Align

```bash
# Replace lines 59-72 in tests/test-entrypoint.sh

# Build sections matching production structure
FULL_PROMPT="# Your Job

## Target

test-repo

## Repository Documentation

[not present — test fixture does not include CLAUDE.md]

## Stack

[not present — test fixture does not include package.json]

## Task

${JOB_DESCRIPTION}

## GSD Hint

Recommended: /gsd:quick
Reason: test harness — always uses quick"

# Write prompt to temp file (matching production file-redirect approach)
printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt

# Run Claude Code (same flags as production)
claude -p \
    --output-format json \
    --append-system-prompt "$(cat /tmp/system-prompt.md)" \
    --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Task,Skill" \
    < /tmp/prompt.txt \
    2>&1 | tee "${LOG_DIR}/claude-output.jsonl" || true
```

### Tech Debt: 07-01-SUMMARY.md Frontmatter Fix

```yaml
# BEFORE (lines 31-32 in 07-01-SUMMARY.md)
requirements: [HIST-01, HIST-04]
---

# AFTER
requirements: [HIST-01, HIST-04]
requirements-completed: [HIST-01, HIST-04]
---
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `printf \| claude -p` pipe delivery | `printf > /tmp/prompt.txt; claude -p < file` | Phase 6 | Eliminates Node.js stdin race; test must match |
| Bare `# Your Job\n\n{task}` prompt | 5-section structured prompt (Target, Docs, Stack, Task, GSD Hint) | Phase 6 | Test must match structure |
| `find *.jsonl` wildcard | `find -name "gsd-invocations.jsonl"` | Phase 8 (this phase) | Eliminates inode-order fragility |
| `failure_stage` in payload only | `failure_stage` in human-readable notification | Phase 8 (this phase) | Operators can see stage in message |

## Open Questions

1. **Is REQUIREMENTS.md HIST-01 already fixed?**
   - What we know: Git status shows `.planning/REQUIREMENTS.md` is modified (` M`) in the working tree. Current file reads `| HIST-01 | Phase 7 (v1.1) | Complete |` at line 110.
   - What's unclear: The audit (written same day, 2026-02-25) claimed this showed "Pending". The modification may have happened after the audit was written.
   - Recommendation: Read the file at plan-time. If `Complete` is already there, mark success criterion 4 satisfied and skip. If the working tree change has not been committed, commit it as part of this phase's documentation fixes.

2. **Should summarizeJob system prompt be updated to explicitly mention failure_stage?**
   - What we know: The model assembles its summary from `## Failure Stage\n{value}` in userMessage. The current system prompt (jobSummaryMd) does not mention this field.
   - What's unclear: Whether the model will reliably surface `docker_pull`/`auth`/`claude` in the output without explicit instruction.
   - Recommendation: Do not modify the system prompt. The field names are self-explanatory to the LLM. If post-phase testing shows the stage is omitted, the system prompt can be updated then.

## Sources

### Primary (HIGH confidence)

- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/v1.1-MILESTONE-AUDIT.md` — All 5 tech debt items + FINDING-1 and FINDING-2 with evidence strings
- `/Users/nwessel/Claude Code/Business/Products/clawforge/api/index.js` — Confirmed `results` object at lines 258-268, `failure_stage` absent
- `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/index.js` — Confirmed `summarizeJob` userMessage assembly at lines 246-255
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/.github/workflows/notify-job-failed.yml` — Confirmed `failure_stage` transmitted at lines 70-71, 82-84
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.github/workflows/notify-pr-complete.yml` — Confirmed `*.jsonl` wildcard at line 86
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/.github/workflows/notify-pr-complete.yml` — Identical wildcard at line 86
- `/Users/nwessel/Claude Code/Business/Products/clawforge/tests/test-entrypoint.sh` — Confirmed old pipe delivery (line 68) and minimal FULL_PROMPT (lines 60-62)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/docker/job/entrypoint.sh` — Production prompt structure at lines 183-216
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/phases/07-previous-job-context/07-01-SUMMARY.md` — Confirmed `requirements:` without `requirements-completed:` at line 32
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/REQUIREMENTS.md` — Confirmed HIST-01 currently reads "Complete" at line 110

## Metadata

**Confidence breakdown:**
- Runtime fixes (FINDING-1, JSONL wildcard): HIGH — all files read directly, exact line numbers confirmed
- Test harness alignment (FINDING-2): HIGH — both test and production entrypoints read, diff is explicit
- Documentation fixes: HIGH — both files read, expected vs actual state confirmed
- HIST-01 pre-satisfied status: MEDIUM — file currently reads "Complete" but the working tree modification could be an uncommitted fix, an unrelated change, or something else; planner should verify git diff

**Research date:** 2026-02-25
**Valid until:** N/A — all findings based on static file reads, not external library state
