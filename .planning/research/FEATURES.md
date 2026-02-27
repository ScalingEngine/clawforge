# Feature Research

**Domain:** Conversational instance provisioning — AI agent that creates new AI agent instances through guided chat
**Researched:** 2026-02-27
**Milestone:** v1.3 Instance Generator
**Confidence:** HIGH for file generation mechanics (verified against live codebase); HIGH for conversational UX patterns (verified against multiple sources + live LangGraph code); MEDIUM for LangGraph slot-filling approach (pattern confirmed, specific implementation is design work)

---

## Context: What Is Being Built

v1.3 adds one capability: Archie can create a new fully-configured ClawForge instance through a guided multi-turn conversation in Slack/Telegram/Web Chat. The output is a PR containing all instance files, plus an operator setup checklist in the PR description.

The work touches three surfaces:

1. **Conversation layer** — The LangGraph agent recognizes "create an instance" intent, conducts a structured intake conversation (name, repos, channels, purpose), and accumulates gathered config in memory before dispatching a job
2. **Job layer** — A Claude Code job receives the gathered config and generates all instance files from templates: `instances/{name}/Dockerfile`, `instances/{name}/config/SOUL.md`, `instances/{name}/config/AGENT.md`, `instances/{name}/config/EVENT_HANDLER.md`, `instances/{name}/config/REPOS.json`, `instances/{name}/.env.example`, plus docker-compose.yml update
3. **PR layer** — The PR description is the operator's setup guide: exact GitHub secrets to create, Slack app scopes to set, PAT permissions needed, commands to run

Constraint: This is a small platform (2 active instances, 1-2 operators). The Instance Generator serves the operator, not end-users. Complexity of the conversation flow should be minimal.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the instance generator must have to be functional. Missing any of these means the operator still has to do manual file creation.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Intent recognition — agent detects "create an instance" from natural language | Without detection, the agent treats instance creation requests like ordinary job requests and dispatches a badly-framed job. Detection is the entry point for everything else. | LOW | The existing LangGraph ReAct agent already routes intent through EVENT_HANDLER.md system prompt. A new section in EVENT_HANDLER.md describing the instance creation flow is sufficient — no code changes to the agent loop. The LLM recognizes the intent and switches into intake mode. |
| Multi-turn intake — agent asks for required fields one group at a time | Operators are humans; they won't provide all config in one message. The agent must ask follow-up questions and accumulate answers across turns. | MEDIUM | LangGraph's SQLite checkpointer already persists conversation state across turns — the "slot filling" state is the conversation history itself. The system prompt tells the agent what fields to gather and in what order. No custom state machine needed; the LLM manages it. Conversational state = already-answered questions visible in the thread. |
| Required fields collected before job dispatch | Minimum required to generate valid files: instance name (slug), at least one allowed repo (owner/slug), at least one channel (Slack or Telegram), agent purpose/description. Dispatching with missing fields creates broken instances. | LOW | System prompt instructs the agent not to call `create_job` until all required fields are confirmed. Same pattern as the existing "CRITICAL: NEVER call create_job without explicit user approval" rule. |
| Confirmation step — agent presents gathered config summary before dispatching | Without explicit confirmation, operators can't catch mistakes before the job runs. The confirmation shows what will be generated so the operator can correct anything. | LOW | The existing "present complete job description, wait for approval" pattern in EVENT_HANDLER.md already handles this. For instance creation, the agent summarizes gathered config and waits for "go ahead." Pattern is already proven. |
| File generation — all instance files created by the job | The job must produce a working instance directory: Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example. Missing any file means the instance can't be built. | MEDIUM | Claude Code job reads the gathered config from job.md (the job description), uses the existing instances/noah/ and instances/strategyES/ directories as template sources, and generates parameterized versions. Uses Write tool. Template-based generation is simpler than programmatic templating since Claude Code handles the substitution naturally. |
| docker-compose.yml update included in PR | Without the compose update, the new instance can't be deployed via `docker compose up`. Operators expect a single PR that is deployment-ready. | LOW | The Claude Code job appends a new service block to docker-compose.yml following the existing noah/strategyES pattern. The job also needs to add the new network and volume entries. One file edit, well-understood pattern from the existing file. |
| .env.example updated with new instance vars | Operators copy .env.example to .env. If new instance vars aren't in .env.example, they have no reference for what to set. | LOW | Job appends a new instance section to .env.example following the NOAH_ / SES_ prefix pattern, using the instance slug as the prefix. Simple string append. |
| Operator setup checklist in PR description | The PR is the handoff document. Operators need exact steps: GitHub secrets to create, Slack app scopes, PAT permissions, webhook URLs to register. Without this, instance setup requires digging through documentation. | MEDIUM | The entrypoint.sh for cross-repo jobs already uses `gh pr create --body "..."`. The Claude Code job generates the PR description as part of its output, populated with instance-specific values (instance name, domain, channel types, repos). The checklist is a markdown document, not code. |

### Differentiators (Competitive Advantage)

Features that make the instance generator genuinely useful rather than just technically functional.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent adapts generated SOUL.md and AGENT.md to stated purpose | If the operator says "this agent helps sales reps close deals," the generated SOUL.md reflects that purpose — agent name, personality tone, capability focus. Stock boilerplate requires manual editing after the fact. | LOW | The Claude Code job receives the purpose description in the job.md prompt. Claude Code generates the SOUL.md and AGENT.md with LLM-authored content calibrated to the stated purpose, not just variable substitution. This is the main advantage of using Claude Code for generation vs. a templating script. |
| EVENT_HANDLER.md scoped correctly to the instance's allowed repos | The generated EVENT_HANDLER.md should list only the repos specified during intake, with correct alias suggestions. A generic EVENT_HANDLER.md listing "ScalingEngine/clawforge" as an available repo for a client-facing sales agent is confusing and potentially unsafe. | LOW | Claude Code generates the EVENT_HANDLER.md repos section using the repos gathered during intake. Same for channel sections (Slack-only vs. Slack + Telegram + Web). The LLM knows which sections to include based on the gathered config. |
| Checklist is instance-specific, not generic | A checklist that says "create ANTHROPIC_API_KEY secret" is useless. A checklist that says "create ACME_ANTHROPIC_API_KEY secret on ScalingEngine/clawforge with value from 1Password" is actionable. The prefix, the repo, and the secret names should be populated. | MEDIUM | The Claude Code job generates the checklist with the specific env var names (prefixed with the instance slug), the GH repo path (always ScalingEngine/clawforge), and the exact scopes needed based on which channels are being set up. More work than a static template, but dramatically better operator UX. |
| Agent collects optional fields if operator volunteers them | If the operator says "this is for Jim, Slack only, Jim's user ID is U1234ABC," the agent captures the Slack allowed user ID without asking a separate question. Conversational intake is better than a rigid wizard that ignores context already provided. | LOW | The LangGraph LLM already reads all context in the thread. The system prompt instructs the agent to extract any config fields mentioned proactively, not just respond to explicit questions. This is natural LLM behavior — no code needed, just prompt instruction. |
| Intake recognizes corrections mid-flow without restarting | If the operator says "actually make that a Slack-only agent, not Telegram too," the agent updates the accumulated config without losing previously-confirmed values. | LOW | LangGraph conversation history is the accumulated state. The agent's system prompt should instruct it to treat corrections as config updates, not flow restarts. The LLM naturally handles this given clear instructions. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Automated GitHub secrets provisioning (auto-create secrets via API) | "Skip the manual setup steps, just create the secrets automatically" | Requires storing elevated GitHub API tokens in the Event Handler with org-level secret write access — much broader permissions than ClawForge currently needs. If the Event Handler is compromised, all secrets are exposed. The manual checklist is intentional security friction. | Generate the exact commands to run. Operator copy-pastes them. One extra step, much smaller blast radius. |
| Automated Slack app creation via Slack API | "Register the bot automatically, don't make me click through the Slack UI" | Slack API does not support programmatic app creation. App manifests exist but require a user-authenticated session (not a bot token). This is a Slack platform limitation, not an implementation choice. | Generate a Slack app manifest file in the PR that operators can copy into the Slack API dashboard. One paste operation replaces multi-step UI navigation. |
| Instance update / deletion via conversation | "I created an instance, now let me change its repos or delete it" | Creating files via PR is safe — operator reviews and merges. Deleting or modifying live instance config via an agent-dispatched job is dangerous if the job runs against the wrong instance. Define creation first; update/delete flows add complexity that requires a separate safety model. | For now: update instances manually (edit files, open PR). If update frequency justifies it, add an "update instance" flow in v1.4+ using the same PR-based model. |
| Instance generator as a separate specialized sub-agent | "Build a dedicated instance-creation agent separate from Archie" | A separate agent requires separate LangGraph configuration, separate thread management, separate prompting. The existing ReAct agent with a new system prompt section handles this correctly. Adding a sub-agent creates routing complexity with no UX benefit for 1-2 operators. | Extend Archie's EVENT_HANDLER.md with an instance creation section. One system prompt, one agent, one thread context. |
| Full interactive wizard with numbered steps displayed to operator | "Show me 'Step 1 of 7: Enter instance name'" | Step counters and rigid ordered wizards are brittle — if the operator jumps ahead or backs up, the counter breaks. Natural conversation handles out-of-order responses better. The LLM tracks what's been gathered without displaying progress state. | The agent knows what fields remain and asks about them conversationally. It can confirm "I still need your allowed repos and which channels to enable" without displaying a progress bar. |
| Generating Telegram webhook registration automatically | "Call the Telegram API to register the webhook as part of instance setup" | Webhook registration requires a running instance with a live HTTPS URL. The instance isn't running at PR creation time — it's running after the operator deploys it. Registering before deployment creates a dangling webhook. | Add webhook registration as a checklist step after deployment: "Run `POST /api/telegram/register` against your live instance URL." Already documented in the codebase. |

---

## Feature Dependencies

```
[Intent detection in EVENT_HANDLER.md]
    └──enables──> [Multi-turn intake conversation]
                      └──requires──> [LangGraph SQLite checkpointer (already exists)]
                      └──produces──> [Gathered config in conversation history]
                          └──required by──> [Confirmation step: config summary]
                              └──required by──> [create_job dispatch with gathered config]
                                  └──required by──> [Claude Code job: file generation]
                                      └──produces──> [instances/{name}/ directory files]
                                      └──produces──> [docker-compose.yml update]
                                      └──produces──> [.env.example update]
                                      └──produces──> [PR with operator checklist]

[Template source files (instances/noah/, instances/strategyES/)]
    └──required by──> [Claude Code job: file generation]
    (Used as reference, not copied verbatim — Claude Code adapts them to gathered config)

[create_job tool (existing)]
    └──used by──> [Agent: dispatch instance generation job]
    └──no schema change needed]
    (job_description contains gathered config as structured text; target_repo=clawforge)

[entrypoint.sh / PR creation (existing)]
    └──handles──> [PR with checklist in body]
    (existing gh pr create --body mechanism used; Claude Code generates the body text)
```

### Dependency Notes

- **Intent detection is the only new prompt work.** The agent loop, checkpointing, and tool calling all exist. Adding an instance creation section to EVENT_HANDLER.md is the sole change to the conversation layer. Everything else is in the Claude Code job.
- **LangGraph conversation history IS the slot-filling state.** No custom state machine, no separate DB schema, no new LangGraph nodes. The LLM tracks what has been gathered by reading the conversation history on each turn. This is why the existing SQLite checkpointer is sufficient.
- **The job description IS the config payload.** The gathered config is passed to the Claude Code job via the job.md prompt (the job description field). No new data structures, no new DB tables. The job_description already handles arbitrary-length structured text.
- **target_repo defaults to clawforge.** Instance files live in the clawforge repo. The cross-repo targeting from v1.2 is not needed — this is a same-repo job by definition.
- **PR body generation is new work for the Claude Code job.** The entrypoint.sh creates the PR, but the body is populated from a file written by Claude Code. Claude Code must write the checklist to a file that the entrypoint reads for the `--body` flag. This is a new convention to establish.

---

## MVP Definition

### Launch With (v1.3 — this milestone)

Minimum viable instance generator. Archie can provision a new instance end-to-end.

- [ ] **Intent detection** — EVENT_HANDLER.md section teaching Archie to recognize "create an instance" requests and switch to intake mode
- [ ] **Required field intake** — agent asks for: instance name/slug, agent purpose/description, allowed repos (at least one, owner/slug/name/aliases), enabled channels (Slack / Telegram / Web, with relevant auth field names surfaced)
- [ ] **Confirmation before dispatch** — agent presents all gathered config as a summary, waits for operator approval before calling create_job
- [ ] **Claude Code job: generate instance directory** — Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example under `instances/{name}/`
- [ ] **Claude Code job: docker-compose.yml update** — new service block, network, volume appended following existing pattern
- [ ] **Claude Code job: .env.example update** — new instance section with prefixed env vars appended
- [ ] **Claude Code job: operator checklist in PR body** — populated with instance-specific secret names, required scopes, and numbered setup steps

### Add After Validation (v1.3.x)

Once a real instance has been successfully provisioned end-to-end via the generator.

- [ ] **Slack app manifest generation** — include a `slack-manifest.json` or formatted manifest block in the PR so operators can paste it into the Slack API dashboard instead of configuring manually
- [ ] **Optional field intake** — agent captures Slack allowed user IDs, allowed channels, Telegram chat ID if provided during conversation (currently these would be left as placeholder values for operator to fill)
- [ ] **Post-deploy webhook registration reminder** — checklist step is already there, but a follow-up prompt reminder after operator confirms "I deployed it" would close the loop

### Future Consideration (v2+)

Defer until there is demonstrated need from using v1.3.

- [ ] **Instance update flow** — conversational flow for modifying an existing instance's repos, channels, or purpose; requires a safe model for modifying live config
- [ ] **Instance health visibility** — job success rate per instance surfaced in conversation; requires additional job_outcomes aggregation
- [ ] **Automated Slack app creation** — not possible with current Slack API; revisit if Slack platform adds programmatic app creation support

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Intent detection (EVENT_HANDLER.md section) | HIGH | LOW | P1 |
| Required field intake (name, repos, channels, purpose) | HIGH | LOW | P1 |
| Confirmation before dispatch | HIGH | LOW | P1 |
| Claude Code job: instance directory file generation | HIGH | MEDIUM | P1 |
| Claude Code job: docker-compose.yml update | HIGH | LOW | P1 |
| Claude Code job: .env.example update | HIGH | LOW | P1 |
| Operator checklist in PR body (instance-specific) | HIGH | MEDIUM | P1 |
| SOUL.md / AGENT.md scoped to stated purpose | MEDIUM | LOW | P1 (natural LLM behavior in Claude Code) |
| Slack app manifest in PR | MEDIUM | LOW | P2 |
| Optional field intake (Slack user IDs, Telegram chat IDs) | MEDIUM | LOW | P2 |
| Instance update flow | LOW | HIGH | P3 |
| Instance health dashboard | LOW | HIGH | P3 |

**Priority key:**
- P1: Required for v1.3 milestone goal — Archie can provision a working instance
- P2: Clear value, add once v1.3 core is proven
- P3: Future milestone consideration

---

## Analog System Analysis

Instance generators are a niche category. The closest analogs are "create a new bot" flows in conversational AI platforms and infrastructure-as-code with conversational intake.

| Surface | Botpress "Create Bot" UI | n8n Agent Builder | ClawForge v1.3 Approach |
|---------|--------------------------|-------------------|-------------------------|
| Config intake | Wizard form in browser UI | Node-graph configuration | Conversational chat via existing channel (Slack/Telegram/Web) |
| Intent detection | Explicit "Create Bot" button click | Explicit "New Agent" UI action | LLM recognizes "create an instance" from natural language |
| Required fields | Name, template selection, channels | Trigger selection, model config | Name, purpose, repos, channels via multi-turn chat |
| Config state tracking | Browser session / form state | Graph state | LangGraph SQLite checkpointer (existing conversation memory) |
| File generation | Platform-managed (no user files) | Exports workflow JSON | Claude Code job generates files in clawforge repo |
| Confirmation | "Create Bot" button click | Graph save + deployment | Agent presents summary, waits for explicit operator approval |
| Setup guide | Platform UI walkthrough | Documentation | PR description with instance-specific checklist |
| Output | Running bot on platform | Running n8n workflow | PR with all files, operator deploys manually |

**Key UX insight:** Commercial platforms hide the config files entirely — operators never see them. ClawForge deliberately exposes files via PR because: (1) operators are technical, (2) git history provides auditability, (3) manual deployment review is a security checkpoint. The conversational intake matches how operators already interact with Archie, which is better than switching to a separate configuration UI.

---

## LangGraph Implementation Pattern for Intake

Based on research into task-oriented dialog systems with LangGraph:

**Pattern: Instruction-driven slot filling via system prompt**

The simplest approach for a 1-2 operator system is to extend EVENT_HANDLER.md with an explicit instance creation section. The LangGraph ReAct agent (already in production) handles this without custom nodes or state machines.

The system prompt instructs:
1. Recognize instance creation intent
2. Extract any config already provided in the initial message
3. Ask for remaining required fields — one group at a time (name + purpose together, repos together, channels together)
4. Present a structured summary for confirmation
5. Only then call `create_job` with a structured payload

**State tracking:** The conversation history (SQLite-persisted) is the slot state. The LLM reads what has been asked and answered. No external state object needed.

**Confirmation pattern:** Same as existing "present complete job description, wait for approval" pattern — proven in production.

**Job dispatch:** `create_job` called with `job_description` containing all gathered config as structured text. The Claude Code job reads this prompt to generate files. No new tool schema needed.

**Confidence:** MEDIUM — the pattern is architecturally sound given the existing codebase, but the specific prompt wording for intake flow requires iteration. Recommend a prompt review/test step in the execution plan.

---

## What the Claude Code Job Receives and Produces

**Input (in job.md prompt):**
```
Instance name: acme
Agent purpose: Sales assistant for ACME Corp reps closing deals in HubSpot
Allowed repos:
  - owner: ScalingEngine, slug: acme-portal, name: ACME Portal, aliases: [acme, portal]
Channels: Slack only
Slack allowed users: U1234ABC, U5678DEF
Slack allowed channels: C9999ZZZ
```

**Output (files to create/modify):**
```
instances/acme/
├── Dockerfile                    (parameterized from instances/noah/Dockerfile)
├── config/
│   ├── SOUL.md                   (LLM-authored to "sales assistant for ACME Corp reps")
│   ├── AGENT.md                  (LLM-authored with acme-portal scope)
│   ├── EVENT_HANDLER.md          (LLM-authored with acme repos + Slack-only sections)
│   └── REPOS.json                (generated from gathered repos)
└── .env.example                  (generated with ACME_ prefix vars)

docker-compose.yml                (updated: new acme-net network, acme-event-handler service)
.env.example                      (updated: new ACME_ section appended)
PR body: pr-checklist.md          (written to job branch, read by gh pr create --body-file)
```

---

## Sources

- Live codebase: `instances/noah/config/EVENT_HANDLER.md` — existing approval pattern, "CRITICAL: NEVER call create_job without explicit user approval" (HIGH confidence — production code)
- Live codebase: `lib/ai/agent.js` — LangGraph ReAct agent with SQLite checkpointer; no custom state machine needed (HIGH confidence — production code)
- Live codebase: `docker-compose.yml`, `.env.example`, `instances/noah/Dockerfile` — exact patterns for generated files to follow (HIGH confidence — production code)
- [Creating Task-Oriented Dialog systems with LangGraph and LangChain](https://medium.com/data-science/creating-task-oriented-dialog-systems-with-langgraph-and-langchain-fada6c9c4983) — slot filling via conversation history as state, system prompt-driven approach (MEDIUM confidence — community article, consistent with LangGraph docs)
- [LangGraph State Machines: Managing Complex Agent Task Flows in Production](https://dev.to/jamesli/langgraph-state-machines-managing-complex-agent-task-flows-in-production-36f4) — "State in LangGraph is like a form that gets filled out as it moves through the workflow" (MEDIUM confidence — community article)
- [Mastering LangGraph State Management in 2025](https://sparkco.ai/blog/mastering-langgraph-state-management-in-2025) — conversation history as the accumulated slot state (MEDIUM confidence — community article)
- [8 Chatbot Flow Examples](https://rasa.com/blog/chatbot-flow-examples) — one question at a time, progressive disclosure, confirmation before action (MEDIUM confidence — platform vendor docs, general patterns)
- [Conversational AI Design in 2025](https://botpress.com/blog/conversation-design) — "ask one question at a time," recovery paths, progressive disclosure principles (MEDIUM confidence — platform vendor docs)
- [The ultimate LLM agent build guide](https://www.vellum.ai/blog/the-ultimate-llm-agent-build-guide) — "define workflow as strict chronological sequence," "agents pattern-match exceptionally well with concrete templates" (MEDIUM confidence — industry guide)
- [Intent Recognition and Auto-Routing in Multi-Agent Systems](https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa) — LLM classifier for intent routing, confirmed pattern in ClawForge v1.2 research (MEDIUM confidence — community reference, validated against live codebase pattern)

---

*Feature research for: ClawForge v1.3 — Instance Generator*
*Researched: 2026-02-27*
