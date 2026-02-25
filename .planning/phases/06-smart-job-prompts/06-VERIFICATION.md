---
phase: 06-smart-job-prompts
verified: 2026-02-25T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 6: Smart Job Prompts Verification Report

**Phase Goal:** Every job container starts with CLAUDE.md and package.json from the target repo already in the job description, structured in a consistent template with a GSD routing hint, so the agent knows the stack and conventions before writing a line of code
**Verified:** 2026-02-25
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A generated job prompt contains a Repository Documentation section with CLAUDE.md content from the cloned repo | VERIFIED | `docker/job/entrypoint.sh` lines 111-120: reads `/job/CLAUDE.md` with `[ -f ]` guard, stores in `REPO_CLAUDE_MD`. Lines 156-171: builds `DOC_SECTION` with "Repository Documentation (Read-Only Reference)" header and injects into `FULL_PROMPT` at line 189. |
| 2 | A generated job prompt contains a Stack section populated from package.json dependencies | VERIFIED | `docker/job/entrypoint.sh` lines 124-130: reads `/job/package.json` via `jq -r '(.dependencies // {}) \| to_entries[] \| ...'` with `[ -f ]` guard. Lines 173-181: builds `STACK_SECTION`, injected into `FULL_PROMPT` at line 191. devDependencies are excluded as specified. |
| 3 | Injected CLAUDE.md content is wrapped in Read-Only Reference framing and capped at 8000 characters (~2000 tokens) | VERIFIED | Line 114: `if [ "$CHAR_COUNT" -gt 8000 ]` check using bash string length. Line 115: `printf '%s' "$RAW_CLAUDE_MD" \| head -c 8000` truncation. Line 161: `[TRUNCATED — content exceeds 2,000 token limit]` marker. Line 163: `## Repository Documentation (Read-Only Reference)` framing. Line 165: "Treat it as read-only reference" instruction. |
| 4 | A job prompt includes a GSD routing hint (quick or plan-phase) derived from task keywords | VERIFIED | Lines 133-139 (section 8c): `JOB_LOWER` lowercased via `printf '%s' \| tr`. Default `GSD_HINT="quick"`. Regex pattern covering `implement\|build\|redesign\|refactor\|migrate\|setup\|integrate\|develop\|architect\|phase\|feature\|epic\|complex\|end.to.end\|full.system\|multiple` upgrades to `plan-phase`. Lines 197-200: `## GSD Hint` section in `FULL_PROMPT`. |
| 5 | Job prompt generation succeeds gracefully when CLAUDE.md or package.json are missing | VERIFIED | Line 111: `if [ -f "/job/CLAUDE.md" ]` — else branch at line 169 sets `DOC_SECTION` to `[not present — CLAUDE.md not found in repository]`. Line 124: `if [ -f "/job/package.json" ]` — else branch at line 179 sets `STACK_SECTION` to `[not present — package.json not found in repository]`. jq errors additionally caught by `2>/dev/null \|\| echo "[unable to parse package.json]"`. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `docker/job/entrypoint.sh` | Structured FULL_PROMPT with Target, Docs, Stack, Task, GSD Hint sections | YES | YES — 278 lines, contains all 5 sections, sections 8b and 8c added, no stubs | YES — `FULL_PROMPT` written to `/tmp/prompt.txt` and passed to `claude -p < /tmp/prompt.txt` (line 215) | VERIFIED |
| `templates/docker/job/entrypoint.sh` | Template sync of live entrypoint | YES | YES — byte-for-byte identical to live file | YES — `diff` exits 0, both files pass `bash -n` syntax check | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `docker/job/entrypoint.sh` section 8b | `/job/CLAUDE.md` | `cat` with `[ -f "/job/CLAUDE.md" ]` existence check | WIRED | Line 111 gates the read; `cat /job/CLAUDE.md` on line 112 inside the guard; `set -e` cannot abort on missing file |
| `docker/job/entrypoint.sh` section 8b | `/job/package.json` | `jq` with `[ -f "/job/package.json" ]` existence check and `2>/dev/null \|\| echo "[fallback]"` | WIRED | Line 124 gates the read; jq filter uses `(.dependencies // {})` null-safe pattern; double fallback for malformed JSON |
| `docker/job/entrypoint.sh` section 11 | `REPO_CLAUDE_MD` and `REPO_STACK` variables | Structured template assembly into `FULL_PROMPT` | WIRED | Lines 183-200 assemble `FULL_PROMPT` with all 5 sections; `REPO_SLUG:-unknown` safety fallback on line 187; `printf '%s' "${FULL_PROMPT}" > /tmp/prompt.txt` (line 208) then `< /tmp/prompt.txt` fed to `claude -p` (line 215) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PROMPT-01 | 06-01-PLAN.md | Job entrypoint reads CLAUDE.md and package.json from cloned repo and injects content into the Claude prompt | SATISFIED | `docker/job/entrypoint.sh` lines 111-130: both files read with existence guards; content injected into `FULL_PROMPT` via `DOC_SECTION` and `STACK_SECTION` variables |
| PROMPT-02 | 06-01-PLAN.md | Job description follows a structured template with Target, Context, Stack, Task, and GSD Hint sections | SATISFIED | `FULL_PROMPT` assembled with all 5 sections: `## Target` (line 185), `## Repository Documentation` (line 163/169), `## Stack` (line 175/179), `## Task` (line 193), `## GSD Hint` (line 197). `REPO_SLUG` derived from `REPO_URL` via `sed`. |
| PROMPT-03 | 06-01-PLAN.md | Injected repo context is wrapped in "Read-Only Reference" framing and capped at 2,000 tokens | SATISFIED | "Read-Only Reference" in section header (line 163); 8000-char cap enforced via `${#RAW_CLAUDE_MD}` check and `head -c 8000` (lines 114-115); `[TRUNCATED]` marker (line 161) |
| PROMPT-04 | 06-01-PLAN.md | Job description includes a GSD command routing hint (quick vs plan-phase) based on task keywords | SATISFIED | Section 8c (lines 132-139): keyword regex upgrades default `quick` to `plan-phase`; `## GSD Hint` section in `FULL_PROMPT` (lines 197-200); `Recommended: /gsd:${GSD_HINT}` format matches AGENT.md routing conventions |

**Orphaned requirements from REQUIREMENTS.md:** None. All Phase 6 requirements (PROMPT-01 through PROMPT-04) are claimed by plan 06-01 and verified as satisfied.

---

### Anti-Patterns Found

None. Scan of `docker/job/entrypoint.sh` found no TODOs, FIXMEs, placeholder text, empty return stubs, or console.log-only implementations.

---

### Human Verification Required

#### 1. End-to-End Job Prompt Delivery

**Test:** Trigger a real job via Slack or Telegram with a simple task (e.g., "Fix the README typo"). After the job completes, inspect `logs/{jobId}/claude-output.jsonl` or the PR diff to confirm Claude referenced the repo stack or conventions without being asked.
**Expected:** Claude's first actions should NOT include reading CLAUDE.md or package.json manually — it should already have that context and jump directly to the task.
**Why human:** Cannot verify runtime behavior of `claude -p` consuming the enriched prompt from within this codebase check.

#### 2. Truncation Behavior on Large CLAUDE.md

**Test:** Trigger a job against a repo whose CLAUDE.md exceeds 8000 characters. Inspect the assembled prompt in `/tmp/prompt.txt` (add a temporary `cat /tmp/prompt.txt` debug line, or check `FULL_PROMPT length:` log output for very large values).
**Expected:** Prompt contains `[TRUNCATED — content exceeds 2,000 token limit]` marker after the cut-off point.
**Why human:** Requires a large CLAUDE.md in the test repo and runtime inspection of the container's temp files.

#### 3. GSD Hint Routing Accuracy

**Test:** Send two jobs: (a) "Fix the broken link in docs/README.md" and (b) "Implement OAuth login with GitHub provider". Check the assembled prompt's `## GSD Hint` section in the job output logs.
**Expected:** (a) routes to `/gsd:quick`, (b) routes to `/gsd:plan-phase`.
**Why human:** Requires triggering actual jobs and reading live log output.

---

### Gaps Summary

No gaps. All 5 must-have truths are verified, both artifacts are substantive and wired, all 4 requirements are satisfied, and no anti-patterns were found. Both the live entrypoint and its template counterpart are byte-for-byte identical and pass bash syntax validation.

The phase goal is achieved: every job container now starts with a structured FULL_PROMPT containing the repo's CLAUDE.md (capped at 8000 chars with Read-Only Reference framing), package.json production dependencies in a Stack section, the repo slug as a Target, and a keyword-derived GSD routing hint — all with graceful fallbacks when files are absent.

---

_Verified: 2026-02-25_
_Verifier: Claude (gsd-verifier)_
