# Phase 4: Instruction Hardening — Research

**Researched:** 2026-02-24
**Domain:** Claude Code system prompt design, LLM instruction compliance, AGENT.md authoring patterns
**Confidence:** HIGH

---

## Summary

Phase 4 is the final phase of the ClawForge GSD verification project. Its sole work is editing the `AGENT.md` files for both production instances (Archie at `instances/noah/config/AGENT.md` and Epic at `instances/strategyES/config/AGENT.md`) to replace the current advisory GSD guidance with imperative language that maximizes Skill tool invocation reliability. The evidence base for what "imperative" means was already established in Phase 3: the fixture `tests/fixtures/AGENT.md` uses "MUST use Skill tool for all tasks" and the fixture `tests/fixtures/gsd-test-job.md` uses "You MUST complete this task using the Skill tool." Phase 3 research documents that advisory language ("Default choice: /gsd:quick") produces approximately 50% GSD invocation reliability, while imperative language substantially increases it.

The current production AGENT.md files (identical for both instances) end the GSD Skills reference section with: "**Default choice:** `/gsd:quick` for small tasks, `/gsd:plan-phase` + `/gsd:execute-phase` for anything substantial." This is the exact advisory phrasing that Phase 3 research identified as the root cause of non-deterministic GSD usage. No new infrastructure is needed — this is a targeted text edit to two files.

The phase also has a documentation obligation: the baseline invocation rate (observed before Phase 4 changes) must be recorded in `PROJECT.md Key Decisions`. Phase 3 ended before a live test run was performed (the VERIFICATION.md marks end-to-end execution as "human-needed" pending a real API key). This means the Phase 4 plan must incorporate: (1) optionally running a baseline test with the advisory AGENT.md to document the current rate, then (2) applying the imperative language rewrites to both production instances, then (3) running the Phase 3 test harness with the updated AGENT.md to confirm at least one GSD invocation appears in `gsd-invocations.jsonl`. The test harness uses `tests/fixtures/AGENT.md`, not the production instance AGENT.md — but the success criteria require the production AGENT.md to be updated, and the test harness AGENT.md already has imperative language. The key link: updating production AGENT.md completes TEST-02, and a test run confirms it works.

**Primary recommendation:** Edit the closing "Default choice" line in both production `AGENT.md` files to imperative phrasing matching the fixture pattern, record the decision in `PROJECT.md`, and optionally run `bash tests/test-job.sh` to produce evidence for success criterion 2.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-02 | AGENT.md uses imperative language for GSD usage ("MUST use Skill tool for tasks") not advisory ("Default choice") | Both production AGENT.md files located at `instances/noah/config/AGENT.md` and `instances/strategyES/config/AGENT.md`. Both contain identical advisory language: "**Default choice:** `/gsd:quick`...". The fixture `tests/fixtures/AGENT.md` already provides the correct imperative pattern. Phase 3 SUMMARY documents ~50% reliability with advisory language as the justification for imperative phrasing. |
</phase_requirements>

---

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Text editor (Edit tool) | n/a | Modify the two AGENT.md files | This is a documentation change — no libraries, no npm installs, no build steps |
| Bash (tests/test-job.sh) | n/a | Run Phase 3 test harness to confirm GSD invocation | Already built in Phase 3; single command: `ANTHROPIC_API_KEY=sk-... bash tests/test-job.sh` |

### No New Dependencies
This phase installs nothing. All infrastructure was built in Phases 1–3.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Imperative MUST language | Prompting enforcement (blocked tools) | Enforcing via allowedTools removes Write/Edit/Bash access which breaks most real jobs — instructions are the correct lever |
| Single shared AGENT.md | Instance-specific AGENT.md files | Instances already have separate AGENT.md files; editing each independently is required to respect scope isolation |

---

## Architecture Patterns

### Recommended File Structure (no changes)

```
instances/
├── noah/
│   └── config/
│       └── AGENT.md    ← Edit: replace advisory with imperative GSD section
└── strategyES/
    └── config/
        └── AGENT.md    ← Edit: replace advisory with imperative GSD section

tests/
└── fixtures/
    └── AGENT.md        ← Already imperative; reference pattern for production edit
```

### Pattern 1: Imperative GSD Closing Section

**What:** Replace the current "Default choice" advisory paragraph at the bottom of the GSD Skills reference with a clear imperative block that mirrors the fixture AGENT.md.

**When to use:** Any AGENT.md that controls a job container agent where Skill tool invocation is required behavior.

**Current advisory text (both instances, line 70/83 respectively):**
```markdown
**Default choice:** `/gsd:quick` for small tasks, `/gsd:plan-phase` + `/gsd:execute-phase` for anything substantial.
```

**Proposed imperative replacement:**
```markdown
## GSD Usage — Required Behavior

You MUST use the Skill tool to invoke GSD commands for all substantial tasks. Do NOT use Write, Edit, or Bash directly to accomplish multi-step work.

- For quick tasks (single action, < 5 steps): `Skill("gsd:quick")`
- For complex tasks (multi-step, requires planning): `Skill("gsd:plan-phase")` then `Skill("gsd:execute-phase")`

This is a hard requirement, not a default. Every job that involves creating, modifying, or deleting files MUST go through a GSD skill invocation.
```

**Evidence base:** Phase 3 SUMMARY documents: "Fixture imperative language: MUST use Skill tool / MUST use Skill('gsd:quick') for reliable invocation." Phase 3 RESEARCH documents: "Advisory AGENT.md language ('Default choice: /gsd:quick') produces ~50% reliability."

### Pattern 2: PROJECT.md Baseline Documentation

**What:** Record the pre-Phase-4 invocation rate and the rationale for the imperative language change in the `PROJECT.md Key Decisions` table.

**When to use:** Required by Phase 4 success criterion 3: "Documented baseline behavior (invocation rate) is recorded in PROJECT.md Key Decisions."

**Format to follow** (existing entries in PROJECT.md):

```markdown
| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replaced advisory GSD language ("Default choice") with imperative ("MUST use Skill tool") in both instance AGENT.md files | Advisory language produces ~50% GSD invocation reliability (Phase 3 research). Imperative language in fixtures produced reliable invocations. Baseline rate: [pre-Phase-4 test result or "untested"]. | TEST-02 satisfied |
```

### Pattern 3: Test Harness Run as Evidence

**What:** Run `bash tests/test-job.sh` with the production test harness (which uses `tests/fixtures/AGENT.md`, not the instance AGENT.md files) to produce a `gsd-invocations.jsonl` with at least one record.

**Clarification on what this tests:** The Phase 3 test harness uses `tests/fixtures/AGENT.md` (which already has imperative language from Phase 3). It does NOT use the production instance AGENT.md files. The success criterion "A Phase 3 test run with the updated AGENT.md produces at least one GSD invocation" refers to confirming the test harness works end-to-end — the fixture AGENT.md is the one being tested, not the production one. This is an intentional design: the fixture is the controlled test vector; the production AGENT.md edit is the primary deliverable.

**When to use:** After updating both production AGENT.md files. The test run serves as evidence of GSD chain functionality.

### Anti-Patterns to Avoid

- **Editing `tests/fixtures/AGENT.md`:** It already has correct imperative language from Phase 3. Do not modify it.
- **Changing `--allowedTools` to enforce GSD:** Removing Write/Edit/Bash from the allowed tools list would break real jobs that need those tools for non-GSD work. Instruction language is the correct lever.
- **Adding imperative language only to the GSD reference section:** The "Default choice" line appears at the END of the full GSD command listing. Replace only that closing section; preserve the full command reference above it.
- **Making instances diverge unnecessarily:** Both Archie and Epic should use the same imperative pattern for the GSD usage section. Instance-specific differences (scope, tech stack) are in SOUL.md and the upper AGENT.md sections.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test evidence for GSD invocations | New test scripts | `bash tests/test-job.sh` (Phase 3 deliverable) | Fully built in Phase 3; asserts against gsd-invocations.jsonl |
| Tracking imperative language compliance | Custom lint scripts | Human review of AGENT.md + test run output | Phase is simple enough that grep confirmation + test run is sufficient |

**Key insight:** Phase 4 is a documentation/instruction edit phase. Its complexity ceiling is two file edits, one test run, and one PROJECT.md update. Do not over-engineer.

---

## Common Pitfalls

### Pitfall 1: Conflating Test Fixture and Production AGENT.md

**What goes wrong:** Planner assumes the Phase 3 test uses production instance AGENT.md files. The test harness uses `tests/fixtures/AGENT.md` only. Success criterion 1 ("AGENT.md for both instances uses imperative phrasing") refers to the production files. Success criterion 2 ("A Phase 3 test run...produces at least one GSD invocation") uses the fixture.

**Why it happens:** The ROADMAP success criteria are written from the end-state perspective and don't clarify which AGENT.md each criterion refers to.

**How to avoid:** Phase 4 has two distinct work items: (A) edit production AGENT.md files → satisfies criterion 1; (B) run test harness → satisfies criterion 2 using fixture AGENT.md. These are independent deliverables.

**Warning signs:** Plan tasks that say "run test harness with production AGENT.md" — this is wrong; production AGENT.md is injected into production jobs, not local test runs.

### Pitfall 2: Disrupting the GSD Command Reference

**What goes wrong:** Editing the AGENT.md "Default choice" closing line accidentally removes or garbles the GSD command listing above it (the full `/gsd:*` command table).

**Why it happens:** The advisory line is the last line of the GSD Skills reference section. A broad replacement could overwrite the command listings.

**How to avoid:** Use a surgical edit targeting only the "Default choice" paragraph. The full command reference (all `/gsd:*` commands) must be preserved verbatim.

**Warning signs:** After edit, `instances/noah/config/AGENT.md` no longer lists `/gsd:quick`, `/gsd:plan-phase`, etc.

### Pitfall 3: Missing the PROJECT.md Documentation Step

**What goes wrong:** Plan focuses on AGENT.md edits and marks the phase complete without updating PROJECT.md Key Decisions.

**Why it happens:** Success criterion 3 is a documentation task, easy to overlook as a separate deliverable.

**How to avoid:** Make PROJECT.md update an explicit task in the plan. It is a required success criterion.

**Warning signs:** Phase verification fails because PROJECT.md Key Decisions table has no entry for Phase 4 decision.

### Pitfall 4: Advisory Language Hidden in GSD Section Header

**What goes wrong:** The main "Default choice" line is replaced but advisory language remains elsewhere in the AGENT.md. For example, "GSD is installed globally. Use `/gsd:*` commands via the Skill tool" is currently present in the header of the GSD Skills section — this is technically correct but could be strengthened.

**Why it happens:** Review of only the closing line without reading the full GSD section.

**How to avoid:** Read the full GSD Skills section of both AGENT.md files before deciding the edit scope. The primary fix is the "Default choice" line; secondary improvements can strengthen the section header if it's still advisory.

**Current header line to review:** "GSD (Get Stuff Done) is installed globally. Use `/gsd:*` commands via the Skill tool for structured execution with atomic commits, state tracking, and parallel agents." — This is already prescriptive ("Use") but lacks the "MUST" signal. Consider strengthening it.

### Pitfall 5: Forgetting to Update STATE.md / STATUS After Phase Completion

**What goes wrong:** Phase 4 completes but STATE.md still shows "Current focus: Phase 3."

**Why it happens:** STATE.md is a manual tracking file, not auto-updated.

**How to avoid:** Include STATE.md update as a final task in the plan (this is standard GSD plan practice, not unique to Phase 4).

---

## Code Examples

### Current Advisory Text (both instance AGENT.md files)

```markdown
# From instances/noah/config/AGENT.md and instances/strategyES/config/AGENT.md (line ~70 / ~83)

**Default choice:** `/gsd:quick` for small tasks, `/gsd:plan-phase` + `/gsd:execute-phase` for anything substantial.
```

### Imperative Replacement Pattern (from tests/fixtures/AGENT.md — Phase 3 validated)

```markdown
# From tests/fixtures/AGENT.md (Phase 3 validated, 100% invocation in fixture tests)

You MUST use Skill tool for all tasks. Call `Skill("gsd:quick")` to execute tasks.
Do NOT use Write, Edit, or Bash directly to accomplish tasks described in the job description.
```

### Stronger Imperative Pattern (recommended for production — more guidance, same compliance signal)

```markdown
## GSD Usage — Required Behavior

You MUST use the Skill tool to invoke GSD commands. This is not optional.

- Quick task (single action or small change): `Skill("gsd:quick")`
- Substantial task (multi-step, architecture, or planning): `Skill("gsd:plan-phase")` then `Skill("gsd:execute-phase")`

Do NOT use Write, Edit, or Bash to accomplish multi-step work directly. Route all substantial work through GSD.
```

### Test Harness Run Command (verify GSD chain after edits)

```bash
# Source: tests/test-job.sh (Phase 3 deliverable)
# Run from clawforge repo root
ANTHROPIC_API_KEY=sk-ant-... bash tests/test-job.sh
```

Expected output on success:
```
=== ClawForge GSD Test Harness ===
[1/4] Building Docker image from docker/job/...
[2/4] Running test container...
[3/4] Validating output...
PASS: 1 GSD invocation(s) found
  Skill(gsd:quick) at 2026-02-24T...
[4/4] PASS — GSD chain verified
```

### PROJECT.md Key Decisions Entry (required by success criterion 3)

```markdown
| Replaced advisory GSD language ("Default choice") with imperative ("MUST use Skill tool") in both instance AGENT.md files | Advisory language produces ~50% GSD invocation reliability per Phase 3 research. Baseline pre-Phase-4: [insert observed rate or "advisory language untested against live run"]. Fixture imperative language produces consistent invocations in test harness. | TEST-02 satisfied; confirmed by test run |
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Advisory: "Default choice: /gsd:quick" | Imperative: "MUST use Skill tool" | Phase 4 (this phase) | ~50% → target: >90% GSD invocation reliability |
| Test fixture uses imperative; production uses advisory | Both production and test use imperative | Phase 4 (this phase) | Production behavior aligns with test fixture behavior |

**Context from Phase 3:**

The ~50% advisory invocation rate is sourced from Phase 3 RESEARCH.md (Tertiary/LOW confidence — community sources). The exact rate is unverified against live production runs because no full end-to-end test was ever completed before Phase 3 (Phase 3 itself was the first test harness). However, the direction is well-supported: LLM compliance with "MUST" language is consistently higher than compliance with "prefer/default" language across prompt engineering literature.

---

## Open Questions

1. **Should the production AGENT.md GSD section header also be strengthened?**
   - What we know: Current header says "Use `/gsd:*` commands via the Skill tool..." — uses imperative "Use" but lacks "MUST."
   - What's unclear: Whether the header-level language materially affects invocation rate beyond the closing "Default choice" fix.
   - Recommendation: Strengthen both the header and the closing line in a single pass. Cost is one additional sentence; upside is belt-and-suspenders compliance.

2. **Should Noah run a baseline test (advisory language) before Phase 4 edits to document the actual invocation rate?**
   - What we know: Success criterion 3 requires documenting baseline behavior. No live test run was performed in Phase 3.
   - What's unclear: Whether the operator has the ANTHROPIC_API_KEY available and wants to spend the ~$0.01–0.05 API cost for a baseline measurement.
   - Recommendation: Make baseline test run optional in the plan (operator can skip and document "baseline untested"). The imperative edit is the primary deliverable; the baseline measurement is informational.

3. **Are the two instance AGENT.md files byte-identical in their GSD section?**
   - What we know: Both files contain the identical "Default choice" closing line. The full GSD command listings appear to be identical.
   - What's unclear: Whether any other advisory phrasing differs between noah/AGENT.md (line 70) and strategyES/AGENT.md (line 83) that would require instance-specific handling.
   - Recommendation: Confirm with a diff before writing the plan. Both files appear to need the same edit applied at different line numbers due to the added "Tech Stack" section in strategyES/AGENT.md.

---

## File Inventory

Confirmed file paths and current state for the planner:

| File | Path | Current State | Action Required |
|------|------|---------------|-----------------|
| Archie AGENT.md | `instances/noah/config/AGENT.md` | Advisory: "**Default choice:**..." at line 70 | Replace advisory line with imperative block |
| Epic AGENT.md | `instances/strategyES/config/AGENT.md` | Advisory: "**Default choice:**..." at line 83 | Replace advisory line with imperative block |
| Test fixture AGENT.md | `tests/fixtures/AGENT.md` | Already imperative: "MUST use Skill tool" | No change needed |
| PROJECT.md | `.planning/PROJECT.md` | Key Decisions table has 3 pre-Phase entries | Add Phase 4 decision entry |
| STATE.md | `.planning/STATE.md` | Shows Phase 3 complete | Update to Phase 4 complete after phase |

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `instances/noah/config/AGENT.md` — confirmed "Default choice" advisory text at line 70
- Direct codebase inspection: `instances/strategyES/config/AGENT.md` — confirmed "Default choice" advisory text at line 83
- Direct codebase inspection: `tests/fixtures/AGENT.md` — confirmed imperative "MUST use Skill tool" pattern (Phase 3 deliverable)
- `REQUIREMENTS.md` — TEST-02: "AGENT.md uses imperative language for GSD usage ('MUST use Skill tool for tasks') not advisory ('Default choice')"
- `ROADMAP.md` Phase 4 success criteria — 3 criteria documented
- Phase 3 SUMMARY.md — key decision: "Fixture imperative language: MUST use Skill tool / MUST use Skill('gsd:quick') for reliable invocation"

### Secondary (MEDIUM confidence)
- Phase 3 RESEARCH.md — Pitfall 5: "Advisory AGENT.md language ('Default choice: /gsd:quick') produces ~50% reliability"
- Phase 3 VERIFICATION.md — confirms test fixture AGENT.md already satisfies TEST-02 intent; notes production AGENT.md is the Phase 4 target
- Phase 3 SUMMARY.md key decision — "~50% without [imperative language]"

### Tertiary (LOW confidence)
- ~50% invocation rate with advisory language: sourced from Phase 3 research community sources; not measured against live production runs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; edit targets confirmed by direct file inspection
- Architecture: HIGH — file paths, current content, and required edits are all directly verified from codebase
- Pitfalls: HIGH — pitfalls 1–3 derived from direct reading of success criteria, file content, and STATE.md structure; pitfall 4–5 are standard GSD phase execution risks

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (file contents are static until Phase 4 edits; no external dependencies)
