# Phase 14: Intake Flow - Research

**Researched:** 2026-02-27
**Domain:** LLM instruction-driven multi-turn slot filling, EVENT_HANDLER.md authoring patterns
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTAKE-02 | Archie collects required configuration (name/slug, purpose, allowed repos, enabled channels) across 3-4 conversational turns — groups related questions, does not ask one field per turn | EVENT_HANDLER.md instruction section defines the slot-filling protocol; LangGraph SQLite checkpointing persists slot state across turns naturally via message history |
| INTAKE-03 | Archie captures optional fields (Slack user IDs, Telegram chat ID) if volunteered without requiring a dedicated question turn | Instruction pattern: "capture if volunteered; do not ask a dedicated question" — the LLM extracts volunteered values from user messages without requiring a separate Q&A turn |
| INTAKE-04 | Archie presents a configuration summary and requires explicit operator approval before dispatching the job | Existing Job Creation Flow in EVENT_HANDLER.md already mandates explicit approval before `create_job`; the same pattern applies to `create_instance_job` |
| INTAKE-05 | Operator can cancel the intake at any point; conversation resets cleanly without leaving dangling state | State lives only in LangGraph SQLite message history; cancellation is a behavioral instruction — Archie acknowledges cancel intent, resets its tracking, and confirms the intake is cleared |
</phase_requirements>

## Summary

Phase 14 is an instruction engineering task, not a code change. The mechanism for multi-turn slot filling already exists: the LangGraph agent with SQLite checkpointing maintains message history per `thread_id`, so partial intake state is carried across turns automatically. No StateGraph extensions, custom interrupt() calls, or application-level state are needed — the conversation IS the state.

The entire implementation is a new section added to `instances/noah/config/EVENT_HANDLER.md`. This file is the agent's system prompt (loaded via `render_md()` and injected by `agent.js`'s prompt function). Adding a well-scoped "Instance Creation Intake" section with explicit slot-filling rules, turn grouping guidance, optional-field capture rules, a summary/approval gate, and cancellation handling is sufficient to satisfy all four requirements.

The key architectural insight is that the `create_instance_job` tool already enforces the config contract at the Zod schema level (Phase 13 output). The LLM just needs instructions about *when* to call that tool (only after approval) and *how* to gather the required fields conversationally before calling it. The slot fields map exactly to the Zod schema: `name`, `purpose`, `allowed_repos`, `enabled_channels`, and optionally `slack_user_ids`, `telegram_chat_id`.

**Primary recommendation:** Write a single "Instance Creation Intake" section in `instances/noah/config/EVENT_HANDLER.md` that defines intent recognition, slot-filling protocol (3-4 turns, grouped), optional-field capture, approval gate, and cancellation reset. No code changes required for this phase.

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `instances/noah/config/EVENT_HANDLER.md` | — | System prompt delivered to the LangGraph agent | This is the established instruction-driven pattern; STATE.md explicitly records "Instruction-driven slot filling via EVENT_HANDLER.md is the intake model" |
| LangGraph SQLite checkpointing (`SqliteSaver`) | Installed (`@langchain/langgraph-checkpoint-sqlite`) | Persists conversation history per thread_id across turns | Already used; multi-turn state is FREE — no extra plumbing needed |
| `create_instance_job` tool (from Phase 13) | Registered | The tool the agent calls only after full intake + approval | Already registered in tools array; Zod schema defines exactly what fields to collect |

### Supporting
| Component | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `render_md()` (`lib/utils/render-md.js`) | — | Resolves `{{datetime}}` and `{{filepath}}` includes in the system prompt | No change needed; EVENT_HANDLER.md is already rendered through this function at agent startup |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| EVENT_HANDLER.md instruction section | Custom LangGraph StateGraph with `interrupt()` for each slot | StateGraph approach requires JavaScript code changes, re-registration, and risk of breaking existing SQLite checkpoints. Instruction-driven is zero code, safe, and reversible. |
| EVENT_HANDLER.md instruction section | Separate intake route/endpoint with its own state machine | More complex, requires new API surface. The LLM's existing memory (SQLite) already handles partial state — no need to duplicate it. |

**Installation:** No new packages needed. Phase 13 installed yaml; no further dependencies for Phase 14.

## Architecture Patterns

### Where the File Lives vs. Where It Runs

```
instances/noah/config/EVENT_HANDLER.md    ← EDIT THIS (source of truth)
    ↓ (Dockerfile COPY at build time)
config/EVENT_HANDLER.md                   ← runtime path the agent reads
    ↓ (lib/paths.js: eventHandlerMd)
agent.js prompt function → render_md() → system message injected every turn
```

**Critical:** Always edit `instances/noah/config/EVENT_HANDLER.md`, not `config/EVENT_HANDLER.md`. The Dockerfile copies the instance file over the config path at build time.

### Pattern 1: Instruction-Driven Slot Filling

**What:** An EVENT_HANDLER.md section tells the LLM which fields to collect, in what order/grouping, and what to do with them. The LLM tracks partial state naturally in its message history context window (backed by SQLite).

**When to use:** Whenever multi-turn structured data collection is needed without requiring code changes to the application layer.

**Structure of the intake section:**

```markdown
## Instance Creation Intake

### Recognizing Intent
When the operator signals intent to create a new ClawForge instance (e.g., "create an instance for Jim",
"set up a new agent", "I want a new instance"), begin the intake flow.

### Required Fields
Collect these across no more than 4 turns. Group related fields together to minimize turns:
- **name** (slug): lowercase, no spaces — e.g., "jim", "acmecorp"
- **purpose**: what this instance is for (used to write SOUL.md and AGENT.md)
- **allowed_repos**: GitHub repo slugs this instance can target (list)
- **enabled_channels**: which channels to enable — slack, telegram, and/or web

### Optional Fields (capture if volunteered; do not ask a dedicated question)
- **slack_user_ids**: if the operator mentions a Slack user ID, capture it silently
- **telegram_chat_id**: if the operator mentions a Telegram chat ID, capture it silently

### Turn Grouping Strategy
Group related questions to stay within 4 turns:
- Turn 1: name + purpose (identity and goal)
- Turn 2: allowed_repos (which repos can this instance access?)
- Turn 3: enabled_channels (which channels should be active?)
- Turn 4 (if needed): any unclear or missing fields

If the operator provides multiple fields in a single message, advance past those turns.

### Approval Gate
Before calling `create_instance_job`, present a complete summary of all collected fields and
wait for explicit operator confirmation ("yes", "confirmed", "go ahead", "looks good").
Do NOT call the tool until you receive explicit approval.

### Cancellation
If the operator says "cancel", "never mind", "stop", "abort", or similar at any point,
acknowledge the cancellation, discard all collected intake state, and confirm the intake is reset.
Do not carry partial intake state into the next message.
```

### Pattern 2: Summary + Approval Gate

**What:** Before dispatching, Archie presents the full config summary as a structured list and waits for an affirmative. This mirrors the existing job creation approval pattern already in EVENT_HANDLER.md.

**Example summary format:**
```
Here's the instance configuration I'll use to create the job:

- **Name:** jim
- **Purpose:** StrategyES dev agent scoped to Jim's workspace
- **Allowed repos:** strategyes-lab
- **Channels:** slack
- **Slack user IDs:** U0XXXXXXXXX

Confirm with "yes" to dispatch the job, or tell me what to change.
```

### Pattern 3: Cancellation as Behavioral Reset

**What:** Cancellation in this architecture is purely behavioral — the LLM is instructed to treat cancel signals as a reset. The SQLite checkpoint retains the full message history (including the cancelled intake turns), but since the LLM is instructed to discard the partial state and treat the next message fresh, no dangling state contaminates future messages.

**Key clarification:** SQLite stores ALL message history permanently. "Resetting" the intake means the LLM is instructed not to use partial intake data from a cancelled flow when processing the next user message. There is no database delete operation. The LLM's instruction to "discard" is behavioral, not transactional.

**Warning signs:** If instructions are too vague (e.g., "forget the intake"), the LLM may sometimes carry over partial values. Explicit language — "treat the next unrelated message as if no intake was in progress" — is more reliable than ambiguous "forget" instructions.

### Anti-Patterns to Avoid

- **One field per turn:** Asking "What should the instance name be?" then "What is its purpose?" in separate turns is slow and frustrating. Group name+purpose in turn 1.
- **Asking for optional fields as required:** slack_user_ids and telegram_chat_id must never appear as required questions. The instructions must say "do not ask a dedicated question."
- **Calling create_instance_job before approval:** The existing EVENT_HANDLER.md already prohibits this for create_job; the same rule must be explicit for create_instance_job.
- **Relying on "forget" language for cancellation:** Use specific, unambiguous language: "discard all collected instance configuration from this intake session and confirm to the operator that the intake has been reset."
- **Editing config/EVENT_HANDLER.md directly:** That path is overwritten by Docker build. Always edit `instances/noah/config/EVENT_HANDLER.md`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-turn state tracking | Application-level state machine, Redis, or custom DB table for intake state | LangGraph SQLite checkpoint (already in use) | Message history IS the state; SQLite already persists it per thread_id across turns |
| Slot completion detection | Code that parses messages to check which fields are filled | LLM judgment guided by EVENT_HANDLER.md instructions | The LLM tracks what it has and hasn't collected via its context window; no parser needed |
| Intent detection | Regex or keyword matching on user messages | LLM intent recognition guided by EVENT_HANDLER.md examples | Examples in the instruction section teach intent patterns; the LLM generalizes naturally |
| Approval gating | Code that checks for approval keywords before calling tool | Behavioral instruction in EVENT_HANDLER.md | Existing approval gate pattern in EVENT_HANDLER.md already does this for create_job |
| Cancellation state cleanup | DELETE query or state reset endpoint | Behavioral instruction + LLM acknowledgment | No state to delete; message history stays, but LLM is instructed to ignore partial intake data |

**Key insight:** This entire phase is instruction engineering. The LangGraph agent with SQLite memory is already a multi-turn state machine. The job is to configure it with the right rules, not to build new machinery.

## Common Pitfalls

### Pitfall 1: Partial State Leaking Across Cancellation
**What goes wrong:** Operator cancels intake, asks an unrelated question, and Archie still references the cancelled instance config (e.g., "Based on the Jim instance you were setting up...").
**Why it happens:** SQLite stores the full message history including the cancelled intake turns. If the cancellation instruction is too vague, the LLM may treat prior intake messages as relevant context for the next message.
**How to avoid:** Write cancellation instructions with explicit, strong language: "Treat the next message as if no instance creation intake was in progress. Do not reference or use any configuration values from the cancelled intake."
**Warning signs:** After cancelling intake and asking "what's the weather in Tokyo?", Archie responds with anything that mentions the cancelled instance.

### Pitfall 2: Optional Fields Asked as Required Questions
**What goes wrong:** Archie asks "What is the Slack user ID for this instance?" as a separate turn, even though it's optional.
**Why it happens:** If the instruction says "collect slack_user_ids" without specifying "do not ask a dedicated question," the LLM treats it like a required field.
**How to avoid:** Use explicit language: "Do NOT ask a dedicated question for these fields. Only capture them if the operator volunteers the information."
**Warning signs:** During testing, Archie asks about slack_user_ids even when the operator hasn't mentioned Slack.

### Pitfall 3: Approval Gate Bypassed on Confident Operator Signals
**What goes wrong:** Operator says "yes create it" before Archie has presented the summary, and Archie dispatches the job without showing the config.
**Why it happens:** The LLM may treat strong operator approval signals as permission to skip the summary step.
**How to avoid:** Instruction must be: "ALWAYS present the complete configuration summary before calling `create_instance_job`, even if the operator says 'yes' or 'go ahead' before you have presented it."
**Warning signs:** Testing shows the job dispatches without a summary message appearing in the conversation.

### Pitfall 4: Too Many Turns for Simple Intakes
**What goes wrong:** Operator says "create an instance for Jim in strategyES on Slack" (providing all info in one message), but Archie still asks 3-4 questions one by one.
**Why it happens:** Fixed-turn instructions don't account for operators who front-load information.
**How to avoid:** Add instruction: "If the operator volunteers multiple fields in a single message, advance past those questions and only ask for genuinely missing fields."
**Warning signs:** Testing shows Archie asking for info the operator already provided.

### Pitfall 5: Tool Name Reference Mismatch in Instructions
**What goes wrong:** EVENT_HANDLER.md says to call `createInstanceJob` (camelCase) instead of `create_instance_job` (snake_case), causing a "Tool not found" error when the LLM tries to call it.
**Why it happens:** Instruction author uses camelCase habitually.
**How to avoid:** Reference the tool name exactly as registered: `create_instance_job`. Match Phase 13's tool registration (`name: 'create_instance_job'`).
**Warning signs:** Agent logs show "Tool not found: createInstanceJob" after approval.

### Pitfall 6: Intake Instructions Conflict with Existing "Bias Toward Action" Rules
**What goes wrong:** Archie's general instructions say "bias toward action — propose immediately for clear tasks." The instance creation intake requires multi-turn collection. The LLM may treat "create an instance for Jim" as a "clear task" and try to dispatch immediately with incomplete config.
**How to avoid:** The intake section must explicitly state that instance creation is an exception to the bias-toward-action rule and REQUIRES the multi-turn collection protocol before dispatch.
**Warning signs:** Archie dispatches a job immediately on "create an instance for Jim" without asking for name, purpose, repos, and channels.

## Code Examples

### Section to Add to instances/noah/config/EVENT_HANDLER.md

```markdown
---

## Instance Creation Intake

When an operator signals intent to create a new ClawForge instance (e.g., "create an instance
for Jim", "set up a new agent", "I want a new instance"), follow this intake protocol exactly.
**Do not apply the bias-toward-action rule here — this flow always requires multi-turn collection.**

### Required Fields

Collect ALL of these before dispatching the job:

| Field | Description | Example |
|-------|-------------|---------|
| `name` | Instance slug — lowercase, no spaces | `jim`, `acmecorp` |
| `purpose` | What this instance is for (used for SOUL.md and AGENT.md authoring) | "StrategyES dev agent restricted to Jim's workspace" |
| `allowed_repos` | GitHub repo slugs this instance can target (list) | `["strategyes-lab"]` |
| `enabled_channels` | Communication channels: `slack`, `telegram`, `web` | `["slack"]` |

### Optional Fields — Capture Silently, Do NOT Ask

If the operator mentions either of these at any point during intake, capture it. Do NOT ask a
dedicated question for either field. Only include them if volunteered.

- `slack_user_ids` — one or more Slack user IDs (format: `U0XXXXXXXXX`)
- `telegram_chat_id` — a Telegram chat ID (numeric)

### Turn Grouping (max 4 turns)

Group questions to minimize turns. Do not ask one field per turn:

- **Turn 1:** Ask for both `name` and `purpose` together
- **Turn 2:** Ask for `allowed_repos`
- **Turn 3:** Ask for `enabled_channels`
- **Turn 4 (only if needed):** Clarify any missing or ambiguous field

If the operator provides multiple fields in their opening message, skip those questions and only
ask for what's still missing. Adjust turn count accordingly.

### Approval Gate (MANDATORY)

Before calling `create_instance_job`:

1. Present a complete configuration summary listing all collected fields
2. Wait for explicit approval: "yes", "confirmed", "go ahead", "looks good", "do it", or similar
3. **Only then** call `create_instance_job` with the exact approved config

ALWAYS present the summary before dispatching, even if the operator says "yes" or "go ahead"
before you have shown it.

**Example summary format:**
```
Here's the instance configuration I'll use to create the job:

- **Name:** jim
- **Purpose:** StrategyES dev agent scoped to Jim's workspace
- **Allowed repos:** strategyes-lab
- **Channels:** slack
- **Slack user IDs:** U0XXXXXXXXX (if provided)

Confirm with "yes" to dispatch the job, or tell me what to change.
```

### Cancellation

If the operator says "cancel", "never mind", "stop", "abort", or equivalent at any point:

1. Acknowledge the cancellation clearly
2. Discard all collected instance configuration from this intake session
3. Confirm to the operator that the intake has been reset
4. Treat the next message as if no instance creation intake was in progress

Do NOT reference or use any configuration values from a cancelled intake in subsequent messages.

---
```

### How render_md Delivers This to the Agent

```javascript
// Source: lib/ai/agent.js (existing — no change needed)
// The prompt function is called fresh every agent invocation
_agent = createReactAgent({
  llm: model,
  tools,
  checkpointSaver: checkpointer,
  prompt: (state) => [new SystemMessage(render_md(eventHandlerMd)), ...state.messages],
});

// render_md reads instances/noah/config/EVENT_HANDLER.md (via COPY to config/EVENT_HANDLER.md)
// and resolves {{datetime}} before injecting as the system prompt.
// The new "Instance Creation Intake" section appears in every agent invocation automatically.
```

### How LangGraph Maintains Slot State Across Turns

```javascript
// Source: lib/ai/index.js (existing chat() function — no change)
// Each call passes the same thread_id, so SQLite restores full message history
const result = await agent.invoke(
  { messages: [new HumanMessage({ content: messageContent })] },
  { configurable: { thread_id: threadId } }   // ← thread_id is the persistence key
);

// Result: the LLM sees the full conversation including prior intake turns as context.
// Turn 1: operator provides name + purpose → stored in SQLite
// Turn 2: operator provides allowed_repos → LLM already knows name + purpose from history
// Turn 3: operator provides channels → LLM knows all prior fields
// Turn 4: LLM calls create_instance_job with all collected fields
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom intake state machine in application code | Instruction-driven slot filling via system prompt + LLM memory | Settled design (recorded in STATE.md) | No code changes required for multi-turn collection |
| Separate "intake mode" with flag in DB | Conversation history IS the state (SQLite per thread_id) | LangGraph architecture | Cancellation is behavioral reset, not DB delete |

**Deprecated/outdated:**
- StateGraph `interrupt()` for human-in-the-loop: Viable but overkill here; requires code changes, risks checkpoint corruption. Instruction-driven approach handles the same problem with zero risk.

## Open Questions

1. **Does the LLM reliably extract volunteered optional fields mid-intake?**
   - What we know: The LLM is capable of extracting structured values (Slack user IDs match a clear format: `U0XXXXXXXXX`; Telegram chat IDs are numeric) from natural language. This is standard LLM capability.
   - What's unclear: Reliability may vary if the user volunteers info in a roundabout way (e.g., "Jim's ID is U0123ABC" mid-flow).
   - Recommendation: Include explicit examples in the instruction for what volunteered optional fields look like. E.g., "If the operator says 'Jim's Slack is U0ABC123', capture `U0ABC123` as a Slack user ID." Phase 17 end-to-end validation will confirm this works.

2. **Does EVENT_HANDLER.md need to be re-deployed (Docker rebuild) to take effect?**
   - What we know: The Dockerfile COPYs `instances/noah/config/EVENT_HANDLER.md` to `config/EVENT_HANDLER.md` at build time. In a live deployment, this means a container rebuild is needed to pick up changes.
   - What's unclear: Whether the dev environment mounts the file as a volume (bypassing the build step) or relies on a rebuild.
   - Recommendation: Document that testing Phase 14 requires either (a) a Docker rebuild or (b) directly editing `config/EVENT_HANDLER.md` in a dev setup where the volume is mounted. This is a deployment concern, not a code defect.

3. **Should the approval gate accept partial affirmatives ("sure", "fine", "k")?**
   - What we know: The existing `create_job` approval section lists: "approved", "yes", "go ahead", "do it", "lgtm."
   - What's unclear: Whether the instance creation intake should match exactly or be more permissive.
   - Recommendation: Match the existing approval gate language exactly to keep behavior consistent. Add "sounds good", "confirmed" for slightly broader coverage. The LLM handles colloquial affirmatives naturally when the instruction lists representative examples.

## Sources

### Primary (HIGH confidence)
- `instances/noah/config/EVENT_HANDLER.md` (project source) — existing approval gate pattern, bias-toward-action rules, and Job Creation Flow section verified directly; these establish the instruction patterns Phase 14 extends
- `lib/ai/agent.js` (project source) — `render_md(eventHandlerMd)` injection into system prompt confirmed; singleton pattern understood
- `lib/ai/index.js` (project source) — `thread_id` configurable passed to `agent.invoke()`; SQLite persistence per thread confirmed
- `lib/paths.js` (project source) — `eventHandlerMd` path confirmed as `config/EVENT_HANDLER.md` (runtime location)
- `instances/noah/Dockerfile` (project source) — COPY from `instances/noah/config/EVENT_HANDLER.md` to `config/EVENT_HANDLER.md` confirmed
- `lib/ai/tools.js` (project source) — `create_instance_job` tool schema confirmed; field names match what intake must collect
- `.planning/STATE.md` (project decisions) — "Instruction-driven slot filling via EVENT_HANDLER.md is the intake model — no custom StateGraph or interrupt() calls needed" confirmed as locked decision

### Secondary (MEDIUM confidence)
- LangGraph documentation on `SqliteSaver` checkpointing — message history persistence per `thread_id` is the documented behavior; multi-turn state is inherent

### Tertiary (LOW confidence)
- None — all findings are grounded in project source code inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked by STATE.md decision; verified against actual source files
- Architecture: HIGH — file paths, render_md flow, and Docker COPY chain all verified from source
- Pitfalls: HIGH — derived from careful analysis of the existing EVENT_HANDLER.md instruction patterns and LangGraph SQLite checkpoint behavior

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (instruction-driven approach is stable; no external library dependencies for this phase)
