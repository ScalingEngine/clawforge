# Architecture Research

**Domain:** Multi-turn conversational intake + instance provisioning via Claude Code job
**Researched:** 2026-02-27
**Confidence:** HIGH (based on direct codebase analysis) / MEDIUM (LangGraph patterns — docs redirect issues during research, supplemented by GitHub issues + blog sources)

---

## Standard Architecture

### System Overview — Current (v1.2)

```
User (Slack/Telegram/Web)
    |
    v
Channel Adapter (normalize to threadId + text)
    |
    v
LangGraph ReAct Agent  <-- SQLite checkpointer (thread-scoped memory)
    |     ^
    |     | (tool results)
    v     |
  Tools: create_job | get_job_status | get_system_technical_specs
    |
    v
createJob() --> job/{uuid} branch + logs/{uuid}/job.md [+ target.json]
    |
    v
GitHub Actions --> Docker container
    |
    v
Claude Code CLI (entrypoint.sh)
    |
    v
Files created in repo --> commit --> PR
    |
    v
GitHub webhook --> summarizeJob() --> addToThread() --> notification to user
```

### System Overview — Target (v1.3 Instance Generator)

```
User: "create a new instance"
    |
    v
LangGraph Agent -- detects intent, enters multi-turn intake mode
    |
    | Turn 1: "What should I name this instance?"
    | Turn 2: "Which channels? (Slack/Telegram/Web)"
    | Turn 3: "Which repos should it have access to?"
    | Turn 4: "What is the agent's persona (name, purpose, style)?"
    | Turn 5: Agent presents complete config, waits for approval
    |
    v
User approves --> Agent calls create_instance_job(instanceConfig)
    |
    v
createJob() -- with structured instance config JSON embedded in job.md
    |
    v
Docker container / Claude Code CLI
    |
    v
Claude Code generates all instance files:
    instances/{name}/Dockerfile
    instances/{name}/config/SOUL.md
    instances/{name}/config/AGENT.md
    instances/{name}/config/EVENT_HANDLER.md
    instances/{name}/config/REPOS.json
    instances/{name}/.env.example
    docker-compose.yml (updated with new service block)
    |
    v
PR created on clawforge repo with setup checklist in PR body
    |
    v
User receives notification with PR URL + operator setup checklist
```

---

## Component Boundaries

### What Stays in the LangGraph Agent (Event Handler)

The agent handles everything conversational, stateful across turns, or approval-gated. The agent does NOT generate files — it gathers intent and configuration.

| Responsibility | Rationale |
|---------------|-----------|
| Detecting "create instance" intent from natural language | Agent already owns intent routing for all requests |
| Asking follow-up questions (name, channels, repos, persona) | Uses existing thread-scoped SQLite memory; no new storage needed |
| Presenting the complete config summary for user review | Follows existing approval gate pattern in EVENT_HANDLER.md |
| Constructing the structured instance config payload | Transforms conversational answers into a deterministic JSON spec |
| Calling `create_instance_job(instanceConfig)` after approval | New tool following the existing `createJobTool` pattern |

The agent does NOT need a new state machine or separate graph. The existing `createReactAgent` with its SQLite checkpointer already provides thread-scoped multi-turn memory. The agent naturally accumulates intake answers across turns in its message history. The LLM reads that history at each step to know what has and has not yet been gathered.

### What Stays in the Claude Code Job (Docker Container)

The job handles everything that requires filesystem access, template rendering, and file creation. The container is the right location because it already owns the git workflow and PR creation.

| Responsibility | Rationale |
|---------------|-----------|
| Reading instance config from `job.md` (as structured JSON) | Same mechanism as all current jobs |
| Rendering Dockerfile from instance name and channel config | File generation is Claude Code's primary capability |
| Generating SOUL.md from persona fields in config | Template interpolation is straightforward for Claude Code |
| Generating AGENT.md from config (channels, repos, persona) | Copy from existing instance as base and customize |
| Generating EVENT_HANDLER.md from config | Per-instance system prompt customization |
| Generating REPOS.json from the allowed repos list in config | Simple JSON serialization |
| Generating .env.example with required variables | Derived from existing .env.example plus channels selected |
| Updating docker-compose.yml to add new service block | Read existing compose, insert new service, write back |
| Generating PR body with operator setup checklist | Templated markdown based on channels and config |

---

## Integration Points and Data Flow Changes

### New vs Modified Components

| Component | Status | Change |
|-----------|--------|--------|
| `lib/ai/tools.js` | MODIFIED | Add `createInstanceJobTool` export |
| `lib/ai/agent.js` | MODIFIED | Register `createInstanceJobTool` in tools array |
| `lib/tools/instance-job.js` | NEW | `buildInstanceJobDescription()` helper |
| `instances/noah/config/EVENT_HANDLER.md` | MODIFIED | Add instance creation intake section |
| Everything else | UNCHANGED | No changes to agent.js graph, entrypoint.sh, workflows, DB schema |

### New Component: `createInstanceJobTool` (lib/ai/tools.js)

This is a new tool alongside the existing three. It follows the exact same pattern as `createJobTool`.

```javascript
// lib/ai/tools.js — new export (schema sketch)
const createInstanceJobTool = tool(
  async ({ instanceConfig }, config) => {
    const threadId = config?.configurable?.thread_id;

    // Serialize config as structured job description
    const jobDescription = buildInstanceJobDescription(instanceConfig);

    const result = await createJob(jobDescription);

    if (threadId) {
      saveJobOrigin(result.job_id, threadId, detectPlatform(threadId));
    }

    return JSON.stringify({
      success: true,
      job_id: result.job_id,
      branch: result.branch,
      instance_name: instanceConfig.name,
    });
  },
  {
    name: 'create_instance_job',
    description:
      'Create a new ClawForge instance by generating all required files as a PR. ' +
      'Call this ONLY after gathering complete instance configuration from the user ' +
      'and receiving explicit approval. ' +
      'Required fields: name, channels, repos, persona.',
    schema: z.object({
      instanceConfig: z.object({
        name: z.string().describe('Slug name for the instance (lowercase, no spaces)'),
        displayName: z.string().describe('Human-readable name for the agent persona'),
        channels: z.array(z.enum(['slack', 'telegram', 'web'])).describe('Channels to enable'),
        repos: z.array(z.object({
          owner: z.string(),
          slug: z.string(),
          name: z.string(),
          aliases: z.array(z.string()),
        })).describe('Allowed repositories for this instance'),
        persona: z.object({
          name: z.string().describe('Agent name (e.g., "Archie")'),
          owner: z.string().describe('Owner name (e.g., "Noah Wessel")'),
          style: z.string().describe('Communication style description'),
          purpose: z.string().describe('What this agent helps with'),
        }),
        slackConfig: z.object({
          allowedUsers: z.string().optional(),
          allowedChannels: z.string().optional(),
          requireMention: z.boolean().optional(),
        }).optional(),
        telegramConfig: z.object({
          chatId: z.string().optional(),
        }).optional(),
      }),
    }),
  }
);
```

**Registration change in `lib/ai/agent.js`:**
```javascript
const tools = [createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool, createInstanceJobTool];
```

### Modified: `instances/noah/config/EVENT_HANDLER.md`

Add a section describing how the agent should handle instance creation requests. This is instruction-based guidance, not code.

The intake pattern for the agent:

1. Detect intent: "create an instance", "add a new agent", "set up instance for X"
2. Gather required fields across turns — ask one question at a time, not a form dump
3. Required fields before calling the tool: name/slug, persona name, owner/user, purpose, channels enabled, repos
4. Optional fields: Slack allowed users/channels, Telegram chat ID, communication style
5. When all required fields are gathered, present the complete configuration as a readable summary
6. Ask for explicit approval before calling `create_instance_job`
7. After the job is created, tell the user what to expect (PR with setup checklist, what to do after merging)

The existing SQLite checkpointer persists conversation state across Slack messages automatically. The agent reads its own message history at each turn to track what has been gathered.

### New: `lib/tools/instance-job.js`

A helper that constructs the structured job description for instance provisioning:

```javascript
// lib/tools/instance-job.js
function buildInstanceJobDescription(instanceConfig) {
  return `# Instance Generation Job

## Instance Configuration

\`\`\`json
${JSON.stringify(instanceConfig, null, 2)}
\`\`\`

## Task

Generate a complete new ClawForge instance at \`instances/${instanceConfig.name}/\`
using the configuration above.

Use /gsd:quick for this task.

### Files to Create

1. \`instances/${instanceConfig.name}/Dockerfile\`
   - Use \`instances/noah/Dockerfile\` as the reference baseline
   - Replace all \`noah\` references with \`${instanceConfig.name}\`
   - Update all COPY paths to point to this instance's config directory

2. \`instances/${instanceConfig.name}/config/SOUL.md\`
   - Agent identity: name="${instanceConfig.persona.name}", owner="${instanceConfig.persona.owner}"
   - Purpose: ${instanceConfig.persona.purpose}
   - Style: ${instanceConfig.persona.style}

3. \`instances/${instanceConfig.name}/config/AGENT.md\`
   - Copy verbatim from \`instances/noah/config/AGENT.md\`
   - The GSD reference and tool list applies identically to all instances

4. \`instances/${instanceConfig.name}/config/EVENT_HANDLER.md\`
   - Adapt from \`instances/noah/config/EVENT_HANDLER.md\`
   - Update persona name, owner, available repos section to match this instance

5. \`instances/${instanceConfig.name}/config/REPOS.json\`
   - Generate from the repos array in the configuration above

6. \`instances/${instanceConfig.name}/.env.example\`
   - Include variables for all enabled channels: ${instanceConfig.channels.join(', ')}
   - Use \`instances/noah/.env.example\` as the variable name reference

7. Update \`docker-compose.yml\`
   - Add new service \`${instanceConfig.name}-event-handler\`
   - Add network \`${instanceConfig.name}-net\`
   - Add volumes for \`${instanceConfig.name}-data\` and \`${instanceConfig.name}-config\`
   - Follow the existing noah/ses service block pattern exactly

### PR Body

The PR body must include a complete operator setup checklist covering:
- GitHub secrets required (exact variable names)
- Slack app creation steps (if Slack is enabled)
- Telegram bot registration steps (if Telegram is enabled)
- docker-compose env variables to populate in the host .env
- Commands to build and start the new instance
`;
}

export { buildInstanceJobDescription };
```

---

## Architectural Patterns

### Pattern 1: Instruction-Driven Intake — No New State Machine

**What:** Guide the LangGraph agent through multi-turn intake via EVENT_HANDLER.md instructions, not new graph nodes or custom state schemas.

**When to use:** When the agent already has thread-scoped memory (via SQLite checkpointer) and the intake is linear enough that the LLM can track completion by reading its message history.

**Trade-offs:**
- Pro: Zero changes to `agent.js` graph structure or state schema. Works with existing `createReactAgent` and its SQLite checkpointer.
- Pro: The LLM naturally handles partial answers, corrections, and follow-ups without explicit state tracking code.
- Pro: Proven approach — imperative instructions in EVENT_HANDLER.md already govern the approval gate for `create_job` and produce consistent behavior.
- Con: The agent cannot programmatically assert "all required fields are collected" — it reasons from message history. Risk of early tool invocation if instructions are not sufficiently explicit.
- Con: If the conversation is very long, message history grows. Not a concern at 2-instance scale with bounded intake flows.

**Why this beats building a custom StateGraph:** Adding a custom state schema to `createReactAgent` has confirmed compatibility issues in LangGraph JS (GitHub issue #803: `stateModifier` does not support custom `stateSchema` types). Building a separate StateGraph would require maintaining two parallel graph systems with separate checkpointers and channel adapter integration. The existing system's power comes from simplicity — one agent, one SQLite checkpointer, one `thread_id` per conversation.

**Mitigation for early firing:** The `create_instance_job` tool description explicitly states "Call this ONLY after gathering complete instance configuration from the user and receiving explicit approval." The EVENT_HANDLER.md instructions enumerate required fields. This mirrors the existing `create_job` approval gate, which works correctly in production (v1.0 verification).

### Pattern 2: Structured Config Payload in Job Description

**What:** Embed a JSON blob in the `job.md` task prompt that contains all instance configuration. Claude Code reads the structured config and generates all files from it.

**When to use:** When the job requires generating multiple related files that all derive from the same configuration source and consistency between files is critical.

**Trade-offs:**
- Pro: Single source of truth — the config JSON drives all generated files. No ambiguity about what name, channels, or repos were intended.
- Pro: Claude Code can validate the config against expected fields at the start of the job before generating anything.
- Pro: The PR body and setup checklist are generated from the same config JSON, guaranteeing they match the generated files.
- Con: Job description is longer than typical. Not a concern — the 8k char cap applies to the CLAUDE.md injection, not the job description itself.

**Format:**
```
# Instance Generation Job

## Instance Configuration
```json
{ "name": "epic", "channels": ["slack"], "repos": [...], "persona": {...} }
```

## Task
Generate all instance files at instances/epic/ using the config above.
...
```

### Pattern 3: Existing Instance as Scaffold Baseline

**What:** Instruct Claude Code to read an existing instance (noah) and transform it rather than generating from scratch, substituting config values.

**When to use:** When target output has a known-good reference with low risk of omission.

**Trade-offs:**
- Pro: No separate templates directory needed. The live `instances/noah/` is the effective template. Template sync concerns are eliminated.
- Pro: Claude Code reads existing files, understands their structure, and produces correct variants reliably. Files will always be structurally current.
- Con: Soft coupling to noah instance structure. If noah's Dockerfile changes substantially, generated instances may diverge in style (not correctness — they are independent after generation).

**This is preferred over adding a `templates/instance/` directory** because that would create a third source of truth alongside the live instances and require manual sync discipline.

---

## Data Flow

### Multi-Turn Intake Flow

```
Turn 1: User says "create a new instance"
    |
    v
Agent detects intent (reads message + thread history)
Agent asks: "What should this instance be called?"
    |
Turn 2: User: "Call it Epic, for Jim's team at StrategyES"
    |
    v
Agent records in conversation memory (SQLite checkpointer — automatic)
Agent asks: "Which channels should Epic support? (Slack, Telegram, Web)"
    |
Turn 3: User: "Just Slack"
    |
    v
Agent asks: "Which repos should Epic have access to?"
    |
Turn 4: User: "strategyes-lab only"
    |
    v
Agent asks: "Describe Epic's purpose and persona (name, who it serves)"
    |
Turn 5: User provides purpose
    |
    v
Agent has all required fields.
Agent presents complete config summary.
Agent: "Here's the configuration for Epic. Want me to create the PR?"
    |
Turn 6: User: "looks good, go ahead"
    |
    v
Agent calls create_instance_job({ name: "epic", channels: ["slack"], ... })
    |
    v
Returns: { job_id, branch, instance_name }
Agent: "Job started (id: {uuid}). I'll create all instance files in a PR..."
```

### Job Execution Flow (Instance Generation)

```
GitHub Actions triggers on job/{uuid} branch creation in clawforge
    |
    v
Docker container: entrypoint.sh runs (unchanged)
    |
    v
entrypoint.sh reads logs/{uuid}/job.md (same as all jobs)
    |
    v
Claude Code CLI receives FULL_PROMPT (instance config JSON in Task section)
No target.json = same-repo job (clawforge) — all generated files go here
    |
    v
Claude Code (via /gsd:quick):
  1. Reads instances/noah/ and instances/strategyES/ as reference
  2. Reads current docker-compose.yml
  3. Creates instances/{name}/ directory and all config files
  4. Writes Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example
  5. Updates docker-compose.yml (new service block, network, volumes)
    |
    v
entrypoint.sh: git add -A, commit, push, gh pr create (same-repo path)
    |
    v
notify-pr-complete.yml fires after auto-merge.yml (same-repo notification path)
    |
    v
summarizeJob() + addToThread() + Slack notification with PR URL
```

**Key point:** This is a same-repo job (clawforge), not cross-repo. The generated files go into the clawforge repository. The existing same-repo PR pipeline (which is the more reliable path) handles everything. No changes to entrypoint.sh or GitHub Actions workflows are needed.

### State Management — What Changes vs What Stays

```
UNCHANGED:
- LangGraph SQLite checkpointer (thread-scoped memory works as-is)
- createReactAgent singleton in agent.js
- Tool invocation pattern in tools.js (new tool follows exact same pattern)
- createJob() in lib/tools/create-job.js (instance job uses it unchanged)
- entrypoint.sh (reads job.md regardless of content format)
- All GitHub Actions workflows (run-job.yml, notify-pr-complete.yml, etc.)
- Docker job container image
- PR notification flow (same-repo path handles this)
- DB schema (no new tables needed)

NEW:
- createInstanceJobTool in lib/ai/tools.js
- buildInstanceJobDescription() in lib/tools/instance-job.js

MODIFIED:
- lib/ai/agent.js: register createInstanceJobTool in tools array (1 line)
- instances/noah/config/EVENT_HANDLER.md: add instance creation intake section
```

---

## Recommended File Structure Changes

```
lib/
├── ai/
│   ├── tools.js          # MODIFIED: add createInstanceJobTool export
│   └── agent.js          # MODIFIED: register createInstanceJobTool (1 line)
├── tools/
│   └── instance-job.js   # NEW: buildInstanceJobDescription() helper
instances/
└── noah/
    └── config/
        └── EVENT_HANDLER.md  # MODIFIED: add instance creation intake section
```

No new directories at the top level. No schema changes. No new DB tables. No new GitHub Actions workflows. No changes to the Docker job image.

---

## Build Order

Dependencies flow from instruction layer to tool layer to job content to generated output.

**Phase 1 — Tool Definition (no dependencies on other new work)**
- Write `lib/tools/instance-job.js` with `buildInstanceJobDescription()`
- Add `createInstanceJobTool` to `lib/ai/tools.js`
- Register in `lib/ai/agent.js`
- Verify: tool schema is correct and callable; `buildInstanceJobDescription()` produces valid job.md content

**Phase 2 — Agent Instructions (depends on Phase 1 for tool name)**
- Add instance creation intake section to `instances/noah/config/EVENT_HANDLER.md`
- Defines intake questions, required fields, approval gate behavior, and tool call trigger conditions
- Verify: agent asks appropriate questions in the right order, accumulates config, presents summary before firing tool

**Phase 3 — Job Content Completeness (depends on Phase 2 for config schema validation)**
- Refine `buildInstanceJobDescription()` with complete file-generation instructions
- Verify: manually review a sample generated `job.md` for coverage of all 7 file generation tasks

**Phase 4 — Claude Code Job Execution (depends on Phase 3)**
- Submit a real job with a sample instance config (e.g., a test instance)
- Verify Claude Code generates all required files
- Verify docker-compose.yml update is syntactically correct and structurally follows existing patterns
- Verify PR body includes complete setup checklist

**Phase 5 — End-to-End Conversation Test**
- Full multi-turn conversation through Slack → approval → job creation → PR → notification
- Verify PR URL in notification is correct
- Verify generated instance files are structurally valid (Dockerfile builds, configs parse)

**Rationale for this order:** Phase 1 and 2 can be done in parallel (tool and instructions are independent). Phase 3 refines based on what Phase 2 reveals about how the agent uses the schema. Phase 4 requires Phase 3 to be complete because the job content is what Claude Code executes. Phase 5 is the full integration proof.

---

## Anti-Patterns

### Anti-Pattern 1: Separate Intake Graph with Custom State

**What people do:** Build a dedicated LangGraph StateGraph for the intake flow with custom state annotations (name, channels, repos, persona as explicit state slots) and `interrupt()` calls between each question.

**Why it's wrong for this codebase:** The existing `createReactAgent` uses `MessagesAnnotation` internally. LangGraph JS has documented incompatibility between `createReactAgent` and custom `stateSchema` types (GitHub issue #803). Building a second graph creates two parallel agent systems that need separate checkpointers, thread management, and channel adapter wiring. The existing system's power comes from its simplicity — one agent, one thread-scoped SQLite checkpointer. The LangChain `interrupt()` pattern requires resuming with `Command({ resume: value })` on the same thread, which would require changes to every channel adapter's message processing path.

**Do this instead:** Put intake instructions in EVENT_HANDLER.md. The LLM reads conversation history and can determine what has been gathered. This is already proven to work at the approval gate level for `create_job`.

### Anti-Pattern 2: Storing Instance Config in a New DB Table

**What people do:** Create an `instance_drafts` table to persist in-progress intake, tracking which fields have been collected per thread.

**Why it's wrong:** The SQLite LangGraph checkpointer already persists full conversation history per thread. The agent can read its own messages to determine what fields have been gathered. Adding a parallel DB table creates two sources of truth that can diverge (e.g., DB says channels = slack but message history shows user changed it to web). It also adds a migration, schema table, query helpers, and cleanup logic for abandoned drafts.

**Do this instead:** Let the agent's message history be the state. The conversation IS the state. When the agent calls `create_instance_job`, it synthesizes the config from the accumulated history — exactly the same way it synthesizes job descriptions for `create_job` today.

### Anti-Pattern 3: Instance Template Files in a Separate Directory

**What people do:** Create `templates/instance/SOUL.md`, `templates/instance/AGENT.md`, etc. as checked-in template files that the job copies and fills in.

**Why it's wrong:** The existing instances (noah, strategyES) are already the reference templates. Adding a separate `templates/instance/` directory creates a third source of truth alongside the live instances and requires manual sync discipline. The CLAUDE.md in `templates/` explicitly states: "Templates exist solely to scaffold a new user's project folder... NEVER add event handler code, API route handlers, or core logic here."

**Do this instead:** Instruct Claude Code to use `instances/noah/` as the reference baseline in the job description. The job reads existing files and generates adapted versions. No new template directory needed.

### Anti-Pattern 4: Auto-Provisioning GitHub Secrets or Slack Apps

**What people do:** Have the Claude Code job or Event Handler call the GitHub API or Slack API to create secrets and app credentials for the new instance.

**Why it's wrong:** Already explicitly out of scope in PROJECT.md. Requires broader infrastructure permissions than appropriate, creates a security surface area, and the actual secret values (ANTHROPIC_API_KEY, SLACK_BOT_TOKEN, etc.) are operator secrets that are not known at job creation time.

**Do this instead:** Generate a complete `.env.example` and a PR body setup checklist listing every required secret with its exact variable name and where to obtain it. The human operator performs the actual secret provisioning.

### Anti-Pattern 5: Generating the Instance as a Cross-Repo Job

**What people do:** Set `target_repo` on the instance generation job to put the generated files in some other repository.

**Why it's wrong:** Instance files belong in the clawforge repository (`instances/{name}/`). They are part of the clawforge project structure. Putting them elsewhere breaks the Dockerfile build context (which uses repo root), the docker-compose.yml service discovery, and the existing instance management conventions.

**Do this instead:** Instance generation is always a same-repo job (clawforge). The generated PR goes into clawforge. No `target.json` sidecar needed.

---

## Integration Points

### External Services

| Service | Integration Pattern | Change Required |
|---------|---------------------|-----------------|
| GitHub API | Unchanged — createJob() creates job branch + job.md | None |
| Slack | Unchanged — same SlackAdapter | None |
| SQLite Checkpointer | Unchanged — thread_id persists intake across turns | None |

### Internal Boundaries

| Boundary | Communication | Change |
|----------|---------------|--------|
| Agent → createInstanceJobTool | Tool call with instanceConfig Zod schema | New tool registration |
| createInstanceJobTool → createJob() | Direct function call, same as createJobTool | None — reuses existing function |
| createJob() → entrypoint.sh | job.md content (config JSON in Task section) | None — entrypoint reads job.md format-agnostically |
| Claude Code → repo files | Read/Write/Bash tools | None — Claude Code operates on clawforge working tree |
| entrypoint.sh → PR | Same same-repo PR creation path | None — same-repo job, no cross-repo logic needed |
| PR → notification | notify-pr-complete.yml → summarizeJob → addToThread | None — standard same-repo notification flow |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Instruction-driven intake approach | HIGH | Validated by existing EVENT_HANDLER.md approval gate pattern in production |
| No custom StateGraph needed | HIGH | Direct analysis: createReactAgent + SQLite checkpointer handles all required state |
| createReactAgent custom state limitations | MEDIUM | GitHub issue #803 confirms incompatibility; LangGraph official docs were unreachable (redirects) during research |
| Tool schema approach | HIGH | Mirrors createJobTool exactly; same Zod + tool() pattern |
| Claude Code generating instance files | HIGH | Claude Code generates files routinely; instance files are well-understood patterns with clear reference |
| docker-compose.yml update by Claude Code | MEDIUM | Claude Code can read/write YAML; update is additive. Verified by reading existing compose structure. |
| No DB schema changes needed | HIGH | Conversation history in LangGraph checkpointer is sufficient; no new persistence layer required |
| Same-repo job path (not cross-repo) | HIGH | Instance files belong in clawforge; same-repo PR pipeline is simpler and more reliable |

---

## Sources

- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/agent.js`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/tools.js`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/index.js`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/tools/create-job.js`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/docker/job/entrypoint.sh`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/config/EVENT_HANDLER.md`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/config/AGENT.md`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/config/SOUL.md`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/config/REPOS.json`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/.env.example`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/docker-compose.yml`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/ARCHITECTURE.md`
- Direct codebase analysis: `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/CONCERNS.md`
- [LangGraph human-in-the-loop interrupt patterns](https://blog.langchain.com/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt/)
- [LangGraph JS interrupt() documentation](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph createReactAgent + custom stateSchema incompatibility (issue #803)](https://github.com/langchain-ai/langgraphjs/issues/803)
- [LangGraph Command for state updates from tools](https://changelog.langchain.com/announcements/modify-graph-state-from-tools-in-langgraph)
- [LangGraph state management patterns](https://medium.com/@bharatraj1918/langgraph-state-management-part-1-how-langgraph-manages-state-for-multi-agent-workflows-da64d352c43b)

---

*Architecture research for: ClawForge v1.3 — Instance Generator*
*Researched: 2026-02-27*
