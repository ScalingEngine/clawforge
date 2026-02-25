---
status: testing
phase: 08-polish-test-sync
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md]
started: 2026-02-25T18:10:00Z
updated: 2026-02-25T18:10:00Z
---

## Current Test

number: 1
name: Failure stage flows to notification context
expected: |
  In api/index.js, the `results` object in handleGithubWebhook extracts `failure_stage` from the webhook payload. In lib/ai/index.js, `summarizeJob` conditionally includes a `## Failure Stage` section in the LLM's userMessage when failure_stage is present. A failed job with stage "docker_pull" would produce a notification mentioning that stage.
awaiting: user response

## Tests

### 1. Failure stage flows to notification context
expected: In api/index.js, the `results` object extracts `failure_stage` from webhook payload. In lib/ai/index.js, `summarizeJob` conditionally includes `## Failure Stage` in the LLM userMessage when present. Empty strings are filtered out via `.filter(Boolean)`.
result: [pending]

### 2. JSONL lookup uses explicit filename
expected: `.github/workflows/notify-pr-complete.yml` uses `find ... -name "gsd-invocations.jsonl"` (not `*.jsonl` wildcard). The template copy at `templates/.github/workflows/notify-pr-complete.yml` is byte-for-byte identical.
result: [pending]

### 3. Test entrypoint uses 5-section structured prompt
expected: `tests/test-entrypoint.sh` constructs a FULL_PROMPT with five sections: `## Target`, `## Repository Documentation`, `## Stack`, `## Task`, `## GSD Hint`. Uses stub values for non-test sections.
result: [pending]

### 4. Test entrypoint uses file-redirect delivery
expected: `tests/test-entrypoint.sh` writes the prompt to `/tmp/prompt.txt` via `printf > /tmp/prompt.txt` and passes it to Claude via `< /tmp/prompt.txt` (not the old pipe pattern `printf | claude`).
result: [pending]

### 5. Documentation tracking artifacts correct
expected: `.planning/phases/07-previous-job-context/07-01-SUMMARY.md` has `requirements-completed: [HIST-01, HIST-04]` in frontmatter. `.planning/REQUIREMENTS.md` shows HIST-01 as "Complete" in the traceability table.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0

## Gaps

[none yet]
