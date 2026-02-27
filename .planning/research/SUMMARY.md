# Project Research Summary

**Project:** ClawForge v1.3 — Instance Generator
**Domain:** Multi-turn conversational intake + instance provisioning via Claude Code job
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

ClawForge v1.3 adds a single capability to the existing system: Archie (the LangGraph ReAct agent) can create a fully-configured new ClawForge instance through a guided multi-turn Slack/Telegram/Web conversation. The operator provides a name, purpose, repos, and channel preferences; Archie gathers these across turns using its existing SQLite-persisted thread memory; the agent dispatches a Claude Code job that generates all instance files as a pull request. The research conclusion is unambiguous: almost no new infrastructure is needed. The existing `createReactAgent`, SQLite checkpointer, `createJob` mechanism, and Docker job pipeline handle the heavy lifting. The new work is one new tool (`createInstanceJobTool`), one helper module (`lib/tools/instance-job.js`), a 1-line change in `lib/ai/agent.js`, a new section in `instances/noah/config/EVENT_HANDLER.md`, and one new npm package.

The recommended approach for multi-turn intake is instruction-driven slot filling via the system prompt, not a custom LangGraph StateGraph or `interrupt()` calls. The conversation history in the SQLite checkpointer is the intake state — the LLM reads what has been asked and answered at each turn. This pattern is already proven in production via the existing `create_job` approval gate. The only new npm dependency is `yaml@^2.8.2` for comment-preserving round-trip modification of `docker-compose.yml`. All template engines (Handlebars, EJS, Mustache) are CommonJS-only and incompatible with ClawForge's `"type": "module"` project; JavaScript template literals are the correct zero-dependency alternative.

The critical risks are not architectural — they are correctness risks in generated file content. Generated configs that are syntactically valid but semantically broken (wrong Dockerfile COPY paths, incorrect REPOS.json owner slugs, malformed docker-compose service names, `$` characters in SOUL.md that shell-expand in the entrypoint) will fail silently during deployment rather than at PR creation time. The mitigations are: a strict structured JSON config payload from agent to job container, explicit validation instructions embedded in the job prompt, provision of literal file templates in the job prompt (especially AGENT.md, where tool name casing is critical), and exclusion of `instances/` paths from auto-merge so every instance scaffolding PR requires operator review before merge.

---

## Key Findings

### Recommended Stack

The existing stack is unchanged. One new runtime dependency is justified: `yaml@^2.8.2` (ESM-native, comment-preserving) for `docker-compose.yml` modification. All template engine alternatives (`handlebars`, `ejs`, `mustache`, `js-yaml`) are disqualified by ESM incompatibility or comment-destructive serialization. JavaScript template literals with `fs.writeFileSync` handle file generation with zero new dependencies. The `createReactAgent` from `@langchain/langgraph/prebuilt` is deprecated in v1.x but functional in v1.1.4; migration to `createAgent` from the `langchain` package is flagged as a post-v1.3 task, not bundled into this milestone.

**Core technologies:**
- `@langchain/langgraph@^1.1.4`: ReAct agent orchestration — existing, no change
- `@langchain/langgraph-checkpoint-sqlite@^1.0.1`: Thread-scoped multi-turn memory — existing, no change; conversation history IS the intake state
- `zod@^4.3.6`: Tool schema validation for structured instance config handoff — existing, provides the Zod object that defines the config contract between intake and job
- `yaml@^2.8.2`: Round-trip YAML modification with comment preservation — the only new dependency; required to preserve the commented TLS/HTTPS blocks in `templates/docker-compose.yml` that operators uncomment for production
- JavaScript template literals + `fs.writeFileSync`: Zero-dependency file generation for instance scaffolding — correct approach for ESM `"type": "module"` project

### Expected Features

The feature research confirms a tightly scoped MVP. The agent handles conversational intake and approval gating; the Claude Code job handles all file generation. There is no feature in v1.3 that requires new database tables, new GitHub Actions workflows, new Docker images, or changes to the job container entrypoint.

**Must have (table stakes):**
- Intent detection — EVENT_HANDLER.md section teaches Archie to recognize "create an instance" from natural language; no code changes to agent loop
- Multi-turn intake — agent collects: instance name/slug, agent purpose, allowed repos, enabled channels (Slack/Telegram/Web); 3-4 turns max, not one-question-per-turn
- Confirmation before dispatch — agent presents gathered config summary and waits for explicit operator approval; same pattern as existing `create_job` approval gate
- Claude Code job: generate 6 instance files — Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example under `instances/{name}/`
- Claude Code job: update `docker-compose.yml` — new service block, network, volumes appended following existing pattern
- Claude Code job: update `.env.example` — new instance section with prefixed env vars
- Claude Code job: instance-specific operator setup checklist in PR body

**Should have (competitive — natural Claude Code behavior, low cost):**
- SOUL.md and AGENT.md scoped to stated purpose — LLM-authored content calibrated to the operator's description, not generic boilerplate
- EVENT_HANDLER.md for generated instance scoped to its allowed repos and channels only
- Setup checklist is instance-specific (exact secret names with correct prefix, exact scopes, exact commands)
- Agent captures optional fields if volunteered (Slack user IDs, Telegram chat ID) without requiring a separate question

**Defer (v2+):**
- Instance update/deletion via conversation — requires a safe model for modifying live config; out of scope for v1.3
- Automated GitHub secrets provisioning — security risk; requires elevated permissions beyond current scope; intentionally excluded
- Automated Slack app creation — not possible via Slack API (platform limitation); revisit if Slack adds programmatic support
- Instance health dashboard — requires additional job_outcomes aggregation

### Architecture Approach

The v1.3 architecture is additive, not structural. The Event Handler (LangGraph agent) owns conversational intake and approval gating. The Claude Code job container owns all file generation, YAML modification, and PR creation. Component boundaries are clear: the agent passes a structured JSON config block to the job via `job.md`; the job reads the JSON and generates deterministic file content. The same-repo PR pipeline (more reliable than the cross-repo path from v1.2) handles delivery. No new state machine, no new graph structure, no custom StateGraph, no new DB tables, no changes to GitHub Actions workflows or the Docker job image.

**Major components:**
1. `createInstanceJobTool` (lib/ai/tools.js) — new tool accepting structured `instanceConfig` Zod schema; builds job description via `buildInstanceJobDescription()`; calls existing `createJob()` function unchanged; registered with 1-line change in `lib/ai/agent.js`
2. `buildInstanceJobDescription()` (lib/tools/instance-job.js) — new helper that serializes the validated config as a JSON block embedded in a structured job.md prompt, with explicit file-generation instructions for each of the 7 output artifacts; includes literal AGENT.md template and validation checklist
3. EVENT_HANDLER.md intake section (instances/noah/config/EVENT_HANDLER.md) — instruction-driven slot filling: detect intent, ask for fields in groups of 2-3, present summary, gate on approval, call `create_instance_job`; includes cancellation handling

### Critical Pitfalls

1. **Agent singleton corrupts in-flight conversations when a new tool is added mid-session** — LangGraph `createReactAgent` compiles tool list at startup; existing SQLite checkpoints reference tools by name; adding a tool after live conversations begin causes checkpoint replay to fail. Fix: add `createInstanceJobTool` to the tools array from the first commit as a stub, even before the tool body is complete. Never add tools to a live agent without a full server restart.

2. **Generated configs are syntactically valid but semantically broken** — Dockerfile COPY paths are case-sensitive (instance name must be lowercase in all paths); REPOS.json `owner` must be exact GitHub org slug (not display name); docker-compose service names must be lowercase-hyphenated; SOUL.md content with `$` characters shell-expands via `echo -e "$SYSTEM_PROMPT"` in the entrypoint. Fix: embed explicit post-generation validation instructions in the job prompt; use structured JSON config block (not prose) so the container agent uses exact values verbatim.

3. **Generated AGENT.md with wrong tool name casing causes silent Claude Code job failure** — `--allowedTools` is case-sensitive; `read` instead of `Read` causes Claude Code to run with no tools, producing empty job output. Fix: provide the exact AGENT.md content as a literal template in the job prompt, not as an instruction to "write something similar to noah."

4. **docker-compose.yml merge conflicts when multiple instance PRs are in flight** — Single shared file; concurrent PRs both modifying it conflict. Fix: job prompt must append new service at end of `services:` block (not inline); PR checklist must require `docker compose config` before merge; instance PRs excluded from auto-merge.

5. **Incomplete intake abandonment leaves dangling state that contaminates later conversations** — LangGraph thread history persists indefinitely; if operator says "never mind" mid-intake, the next unrelated message on the same thread may resume intake context. Fix: define explicit cancellation phrases in EVENT_HANDLER.md; validate all required fields in `createInstanceJobTool` before dispatching; instance name must match `^[a-z][a-z0-9-]{0,18}[a-z0-9]$` (validates at intake time, not just at job dispatch).

---

## Implications for Roadmap

The research points to a 5-phase build order with strict dependencies. Tool schema must exist before intake can be written against it. Intake must be validated before the job prompt is refined. Job prompt must be complete before end-to-end execution is tested. Phases 1 and 2 can be worked in parallel (tool definition and intake instructions are independent); Phases 3-5 are sequential.

### Phase 1: Tool Infrastructure

**Rationale:** The `createInstanceJobTool` Zod schema is the single source of truth for all downstream work — intake questions map to its required fields, the job prompt serializes its output, and the PR checklist reflects its structure. Defining this schema first prevents drift between intake design and job execution. Critically, the tool must be registered in the agent's tools array from the first commit (even as a stub) to avoid the checkpoint corruption pitfall.
**Delivers:** `lib/tools/instance-job.js` with `buildInstanceJobDescription()` skeleton, `createInstanceJobTool` registered in `lib/ai/tools.js` and `lib/ai/agent.js`, `npm install yaml@^2.8.2`
**Addresses:** Structured config handoff (Zod schema defines the payload contract); tool registered before any live conversation
**Avoids:** Pitfall 1 (agent singleton corruption from mid-session tool addition), Pitfall 2 (unstructured free-text config handoff)

### Phase 2: Intake Flow and Agent Instructions

**Rationale:** With the tool schema defined, the EVENT_HANDLER.md intake section can be written against concrete field names. This phase also establishes the cancellation handling and name validation that prevent abandoned intakes from producing phantom jobs or broken instance names.
**Delivers:** Updated `instances/noah/config/EVENT_HANDLER.md` with instance creation section — intent detection, field grouping strategy (3-4 turns max, not one-field-per-turn), cancellation handling, approval gate, post-dispatch conversation reset marker injected into thread
**Avoids:** Pitfall 3 (context window bloat — conversation reset marker injected after dispatch signals future turns to ignore prior intake messages), Pitfall 5 (incomplete intake abandonment — cancellation handling and required field gate), Pitfall 8 (instance name collision — name validated as `^[a-z][a-z0-9-]{0,18}[a-z0-9]$` before dispatch)

### Phase 3: Job Prompt Completeness

**Rationale:** The job prompt (`buildInstanceJobDescription()` output) is what Claude Code executes. This phase refines it based on what Phase 2 reveals about intake conversation patterns, then adds explicit post-generation validation instructions, the literal AGENT.md template, semantic validation checklist, and docker-compose append-at-end strategy. This is the highest-effort phase.
**Delivers:** Refined `buildInstanceJobDescription()` with complete file-generation instructions for all 7 artifacts, literal AGENT.md template embed, semantic validation checklist (Dockerfile paths, REPOS.json schema, SOUL.md shell safety, docker-compose service name format), `yaml@^2.8.2` usage for docker-compose modification, PR body generation with instance-specific values
**Uses:** `yaml@^2.8.2` — `parseDocument()` + `addIn()` for comment-preserving docker-compose modification
**Avoids:** Pitfall 4 (semantically broken generated configs), Pitfall 6 (docker-compose merge conflicts — append-at-end strategy), Pitfall 7 (wrong AGENT.md tool name format — literal template in job prompt)

### Phase 4: PR Pipeline and Auto-Merge Exclusion

**Rationale:** Instance scaffolding PRs must not auto-merge — broken instance configs must be reviewed before they reach `main`. This is a short phase but must be completed before end-to-end testing to prevent a test PR from auto-merging. The PR title convention also needs to be set so instance PRs are identifiable in the PR list.
**Delivers:** `auto-merge.yml` updated to exclude `instances/` path from ALLOWED_PATHS; verified PR title convention (`feat(instances): add {name} instance`); `--body-file` or `--body` approach confirmed against entrypoint.sh implementation
**Avoids:** Security risk (auto-merge on broken instance scaffolding PR), Pitfall 6 (compose validation step in PR checklist)

### Phase 5: End-to-End Validation

**Rationale:** Full integration proof. Run a real multi-turn conversation through Slack, approve the gathered config, receive the PR, execute the "looks done but isn't" checklist from PITFALLS.md against the generated files, run `docker compose config`, and confirm the new instance builds. All prior phases are unit-level; this phase is the acceptance gate.
**Delivers:** A verified test instance provisioned end-to-end via Archie; all 10 items from PITFALLS.md verification checklist executed; any job prompt refinements from real execution fed back to Phase 3 artifacts; PR closed (not merged) unless the test instance is intentional
**Uses:** All components from Phases 1-4; real Slack/Telegram channel; real GitHub Actions → Docker → PR pipeline

### Phase Ordering Rationale

- Tool schema first because the Zod object in `createInstanceJobTool` is the contract between intake (Phase 2) and job execution (Phase 3). Building intake before the schema exists guarantees drift.
- Phases 1 and 2 are independent and can be developed in parallel if two developers are available. Phase 1 is a prerequisite for Phase 3; Phase 2 informs Phase 3 but does not block starting it.
- Job prompt after intake because Phase 2 reveals which field names, question groupings, and edge cases produce clean operator input — the job prompt in Phase 3 is refined against that reality.
- Auto-merge exclusion (Phase 4) is separated to prevent it from being forgotten when it's most at risk: just before end-to-end testing when real PRs start landing.
- End-to-end last because it requires all prior components in place and requires real execution against the live GitHub Actions pipeline.

### Research Flags

Phases with standard patterns (no additional research needed):
- **Phase 1 (Tool Infrastructure):** Mirrors `createJobTool` exactly; `yaml` package API is clearly documented with official examples; no novel patterns
- **Phase 2 (Intake Flow):** Instruction-driven slot filling is proven in the existing EVENT_HANDLER.md approval gate; no new LangGraph patterns
- **Phase 4 (Auto-merge exclusion):** Simple YAML edit to existing workflow; no research needed

Phases that may benefit from targeted review during planning:
- **Phase 3 (Job Prompt Completeness):** The exact prompt structure for Claude Code to generate 7 files correctly from a JSON config block may need iteration. Recommend a sample `job.md` dry-run review before treating this phase as complete. The `yaml` package's `parseDocument()` + `addIn()` API for docker-compose modification warrants a focused test against the actual `docker-compose.yml` (nested structure, Traefik command arrays) before including in the job prompt.
- **Phase 5 (End-to-End Validation):** The 10-item "looks done but isn't" checklist from PITFALLS.md should be the formal acceptance criteria. Decide upfront whether the test instance PR will be merged or closed — if merged, it creates a `instances/test-alpha/` directory that needs cleanup tracking.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | One new dependency (`yaml@^2.8.2`); all others are existing and production-validated. ESM incompatibility of all template engine alternatives confirmed against official npm packages and package source. LangGraph deprecation warning on `createReactAgent` confirmed from official issue #1602 and migration guide. |
| Features | HIGH | Feature scope derived from direct codebase inspection of production instances (noah, strategyES) and the existing job pipeline. MVP is minimal and well-bounded. Anti-features are explicitly justified with specific reasons (Slack API limitation, security blast radius, etc.). |
| Architecture | HIGH | All major architectural decisions (no custom StateGraph, same-repo job, instruction-driven intake, structured JSON config payload, literal AGENT.md template in job prompt) are validated against direct codebase analysis of the production system. One medium-confidence point: `createReactAgent` + custom stateSchema incompatibility inferred from GitHub issue #803 rather than current official docs (docs returned redirects during research). |
| Pitfalls | HIGH (codebase-based) / MEDIUM (LangGraph-specific) | Primary pitfalls grounded in direct codebase inspection: entrypoint.sh `echo -e "$SYSTEM_PROMPT"` shell expansion (confirmed line 156), agent singleton pattern in agent.js, monolithic docker-compose.yml structure. LangGraph context window bloat and checkpoint format stability pitfalls are from official LangGraph persistence docs and confirmed community patterns but not empirically measured in this codebase. |

**Overall confidence:** HIGH

### Gaps to Address

- **`createReactAgent` + custom stateSchema incompatibility (GitHub issue #803):** The recommendation to avoid a custom StateGraph is directionally correct and consistent with all research, but confirm the incompatibility persists in `@langchain/langgraph@1.1.4` specifically before treating it as a hard constraint. If it turns out custom state is possible, the architecture remains valid — instruction-driven intake is still the simpler approach.

- **PR body via `--body-file` convention:** FEATURES.md notes that the Claude Code job must write the PR checklist to a file (e.g., `pr-checklist.md`) for entrypoint's `gh pr create --body-file` flag. Confirm whether entrypoint.sh supports `--body-file` or uses `--body "$(cat ...)"` inline — this affects the job prompt instructions for how Claude Code should write the checklist file.

- **Message trimming threshold:** PITFALLS.md recommends a 30-message or 40k-token trim threshold to prevent context window bloat, but ClawForge has no message trimmer currently. The right threshold for instance creation threads (8-12 messages) vs. ongoing job threads is not empirically determined. Implement conservatively and monitor `data/clawforge.sqlite` size after first 3 instance creation conversations.

- **`createAgent` migration timing:** `createReactAgent` shows deprecation warnings in v1.1.4 and is removed in v2.0 alpha. Flag as a named post-v1.3 task. Do not adopt any `@langchain/langgraph@next` or v2 alpha builds during v1.3 development — `createReactAgent` import breaks on v2.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `lib/ai/agent.js` — agent singleton pattern (`_agent`), `resetAgent()`, tools array, no message trimmer configured
- Direct codebase inspection: `lib/ai/tools.js` — `createJobTool` schema (job_description only), `detectPlatform()`, Zod + `tool()` pattern to mirror
- Direct codebase inspection: `lib/ai/index.js` — `chat()` append-only invocation, `addToThread()` state injection, no message trimming
- Direct codebase inspection: `templates/docker/job/entrypoint.sh` — `echo -e "$SYSTEM_PROMPT"` at line 156 (shell expansion risk), `ALLOWED_TOOLS` format, `--append-system-prompt` flag
- Direct codebase inspection: `docker-compose.yml` — monolithic file, commented TLS blocks requiring comment preservation, service/network/volume naming convention
- Direct codebase inspection: `instances/noah/Dockerfile` — `COPY instances/noah/config/` paths (case-sensitive), canonical scaffold baseline
- Direct codebase inspection: `instances/noah/config/REPOS.json` — exact schema required for generated REPOS.json
- Direct codebase inspection: `instances/noah/config/EVENT_HANDLER.md` — existing approval gate pattern ("CRITICAL: NEVER call create_job without explicit user approval")
- [LangGraph V1 Alpha issue #1602](https://github.com/langchain-ai/langgraphjs/issues/1602) — `createReactAgent` deprecated, moved to `langchain` package, `createAgent` migration path
- [LangGraph v1 migration guide](https://docs.langchain.com/oss/javascript/migrate/langgraph-v1) — breaking changes, Node.js 20+ requirement, `prompt` → `systemPrompt` rename
- [yaml package GitHub: eemeli/yaml](https://github.com/eemeli/yaml) — v2.8.2 (Nov 30, 2025), comment preservation documented, ESM-native, `parseDocument()` + `addIn()` API

### Secondary (MEDIUM confidence)
- [LangGraph JS Persistence Docs](https://langchain-ai.github.io/langgraphjs/concepts/persistence/) — checkpoint-per-step behavior, full state snapshot (not delta) written at each node; confirmed no automatic pruning
- [LangGraph interrupt docs](https://docs.langchain.com/oss/javascript/langgraph/interrupts) — `interrupt()` + `Command` resume model requires single long-running invocation; incompatible with ClawForge per-message invocation model
- [LangGraph createReactAgent + custom stateSchema issue #803](https://github.com/langchain-ai/langgraphjs/issues/803) — incompatibility between `createReactAgent` and custom `stateSchema` types
- [LangGraph Breaking Change: langgraph-prebuilt 1.0.2](https://github.com/langchain-ai/langgraph/issues/6363) — minor version upgrades can break checkpoints; confirms pinning `@langchain/*` to exact versions
- [Docker Compose `include:` directive docs](https://docs.docker.com/compose/how-tos/multiple-compose-files/include/) — modular compose strategy for conflict mitigation (requires Compose v2.20+)
- Creating Task-Oriented Dialog systems with LangGraph and LangChain (Medium) — slot filling via conversation history as state
- [Conversational AI Design in 2025 (Botpress)](https://botpress.com/blog/conversation-design) — one question at a time, progressive disclosure, confirmation before action

### Tertiary (LOW confidence)
- [NeurIPS 2025: Why Multi-Agent LLM Systems Fail](https://arxiv.org/pdf/2503.13657) — conflicting state updates, multi-agent failure patterns; general risk framing
- [Claude Code Security: Shell injection via `${VAR}`](https://flatt.tech/research/posts/pwning-claude-code-in-8-different-ways/) — SOUL.md shell expansion risk; confirmed as known issue, fixed in Claude Code v1.0.93; relevant to entrypoint.sh `echo -e` pattern

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
