# Phase 13: Tool Infrastructure - Research

**Researched:** 2026-02-27
**Domain:** LangGraph tool() registration, Zod v4 schema validation, SQLite checkpoint safety
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTAKE-01 | Operator can trigger instance creation by describing intent in natural language to Archie ("create an instance for Jim", "set up a new agent", etc.) | Tool must exist in the agent tools array so the LLM can emit a tool-call for it; Zod schema must define the config contract that intake (Phase 14) collects |
</phase_requirements>

## Summary

Phase 13 is a focused infrastructure wiring task: register `createInstanceJobTool` in `lib/ai/tools.js` and add it to the agent tools array in `lib/ai/agent.js`. The tool is a stub at this phase — it accepts a validated Zod schema and dispatches a job using the existing `createJob()` function, but `buildInstanceJobDescription()` (Phase 15) is not yet implemented. The tool name must exactly match what the LLM will call, because LangGraph routes tool calls by string name.

The project uses `@langchain/core@1.1.24` with `zod@4.3.6`. Zod v4 support in LangChain landed at `@langchain/core@0.3.58`, and the installed version is well past that threshold. Simple `z.object()` schemas with `.describe()` fields work without transforms and are confirmed safe with the current versions. There are no compatibility issues to worry about for this specific use case. The `yaml@^2.8.2` dependency needed in later phases is not yet installed and should be added here because STATE.md records this as the one new dependency for the v1.3 milestone.

The agent uses a lazy singleton pattern (`_agent = null`; rebuilt on restart) with `SqliteSaver` checkpointing. Adding a new tool to the tools array does not corrupt existing SQLite checkpoint threads because checkpoints store message history (human/AI message pairs and tool call results), not the tool registry itself. The tool registry lives only in the running process. Restarting the server rebuilds `_agent` with the new tool list from scratch, leaving existing SQLite rows untouched.

**Primary recommendation:** Add `createInstanceJobTool` to `lib/ai/tools.js` following the exact pattern of `createJobTool`, export it, and add it to the tools array in `lib/ai/agent.js`. Install `yaml@^2.8.2` in the same PR. Reset the agent singleton with `resetAgent()` is not needed — normal server restart picks up the new tool registration.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/core` (tool) | 1.1.24 (installed) | Tool definition and registration in LangGraph agents | Already used by all three existing tools; provides name/description/schema contract |
| `zod` | 4.3.6 (installed) | Input schema definition and validation | Already used project-wide; Zod v4 support confirmed in @langchain/core >=0.3.58 |
| `createJob` (internal) | — | Dispatches the GitHub branch job | Already used by `createJobTool`; same dispatch mechanism for instance jobs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yaml` | ^2.8.2 | ESM-native YAML parsing with comment preservation | Needed for Phase 15 docker-compose.yml modification; install here, use later |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `yaml@^2.8.2` | `js-yaml` | js-yaml is CommonJS-only; project is `"type": "module"` — incompatible without dynamic import workaround |
| Zod v4 `z.object()` | Manual JSON Schema | No benefit; Zod v4 is confirmed working with installed @langchain/core version |

**Installation (yaml only — everything else already installed):**
```bash
npm install yaml@^2.8.2
```

## Architecture Patterns

### Recommended Project Structure
No new directories needed. All changes are additive to existing files:

```
lib/
├── ai/
│   ├── tools.js         # ADD: createInstanceJobTool definition + export
│   └── agent.js         # MODIFY: add createInstanceJobTool to tools array
└── tools/
    └── create-job.js    # UNCHANGED — createJob() already handles job dispatch
```

### Pattern 1: LangGraph Tool Definition (Existing Pattern)
**What:** Define a tool with `tool()` from `@langchain/core/tools`, pass an async handler + config object with name, description, and Zod schema.
**When to use:** Anytime a new LangGraph tool capability is added. Match the exact pattern used by `createJobTool`.

```javascript
// Source: lib/ai/tools.js (existing createJobTool pattern)
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createJob } from '../tools/create-job.js';

const createInstanceJobTool = tool(
  async (config, runConfig) => {
    // Phase 13: stub — calls createJob with a placeholder description
    // Phase 15 will replace this with buildInstanceJobDescription(config)
    const description = `Create a new ClawForge instance named "${config.name}".\n\nConfig:\n${JSON.stringify(config, null, 2)}`;
    const result = await createJob(description);
    return JSON.stringify({ success: true, job_id: result.job_id, branch: result.branch });
  },
  {
    name: 'create_instance_job',
    description:
      'Create a new ClawForge instance. Dispatches an autonomous job that generates all instance files (Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example) and updates docker-compose.yml. Call this only after operator has confirmed the configuration.',
    schema: z.object({
      name: z.string().describe('Instance slug/name (lowercase, no spaces, e.g. "jim" or "strategyES2")'),
      purpose: z.string().describe('What this instance is for — used to author SOUL.md and AGENT.md content'),
      allowed_repos: z.array(z.string()).describe('List of GitHub repo slugs this instance can target (e.g. ["strategyes-lab"])'),
      enabled_channels: z.array(z.enum(['slack', 'telegram', 'web'])).describe('Channels to enable for this instance'),
      slack_user_ids: z.array(z.string()).optional().describe('Slack user IDs allowed to use this instance'),
      telegram_chat_id: z.string().optional().describe('Telegram chat ID for this instance'),
    }),
  }
);

export { createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool, createInstanceJobTool };
```

### Pattern 2: Agent Tools Array Registration
**What:** Add the new tool to the tools array passed to `createReactAgent`. The agent singleton is rebuilt on server restart, picking up the new tool automatically.
**When to use:** Every time a new tool is defined in tools.js.

```javascript
// Source: lib/ai/agent.js (existing pattern)
import { createInstanceJobTool } from './tools.js';

export async function getAgent() {
  if (!_agent) {
    const model = await createModel();
    const tools = [
      createJobTool,
      getJobStatusTool,
      getSystemTechnicalSpecsTool,
      createInstanceJobTool,  // ADD THIS
    ];
    const checkpointer = SqliteSaver.fromConnString(clawforgeDb);
    _agent = createReactAgent({ llm: model, tools, checkpointSaver: checkpointer, prompt: ... });
  }
  return _agent;
}
```

### Pattern 3: Zod v4 Schema for Tool Input Validation
**What:** LangGraph's `tool()` function calls Zod's `safeParse` on incoming tool arguments before passing them to the handler. Validation errors surface as ToolMessage content, not thrown exceptions that crash the agent.
**When to use:** Always. Use `z.string()`, `z.array()`, `z.enum()`, `.optional()`, `.describe()`. Avoid `.transform()` to stay safe from any residual transform/JSON-schema edge cases.

```javascript
// Source: Verified against @langchain/core 1.1.24 + zod 4.3.6
schema: z.object({
  name: z.string().describe('...'),
  allowed_repos: z.array(z.string()).describe('...'),
  enabled_channels: z.array(z.enum(['slack', 'telegram', 'web'])).describe('...'),
  slack_user_ids: z.array(z.string()).optional().describe('...'),
})
```

### Anti-Patterns to Avoid
- **Using `.transform()` in tool schemas:** Transforms have had historical JSON-schema conversion issues in LangChain. Not needed here — use plain field types.
- **Naming the tool `createInstanceJob` (camelCase):** LangGraph tool names must be `snake_case`. The LLM will call `create_instance_job`, not `createInstanceJob`. The name in the `tool()` config is what the LLM sees.
- **Putting buildInstanceJobDescription logic in this phase:** Phase 13 is a stub. The real prompt builder belongs in Phase 15. A simple JSON.stringify of the config is enough for Phase 13 to prove the tool dispatches.
- **Manually invalidating the SQLite DB when adding tools:** Tool registration changes don't touch SQLite at all. Just restart the server. No migration or wipe needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool input validation | Custom validator function | `z.object()` schema in `tool()` config | LangGraph automatically runs Zod parse before calling handler; validation errors are returned as ToolMessage |
| YAML modification | String manipulation / regex | `yaml@^2.8.2` `parseDocument()` + `Document.addIn()` | Comments (like Traefik TLS block) would be destroyed; yaml preserves them |
| Tool name routing | Custom dispatch logic | LangGraph's built-in ToolNode | ToolNode does the name-to-handler mapping; names must match what the LLM emits |

**Key insight:** LangGraph's `tool()` + Zod v4 provides automatic input validation, error propagation back to the LLM, and type-safe handler invocation — none of this needs to be built manually.

## Common Pitfalls

### Pitfall 1: Tool Name Casing Mismatch
**What goes wrong:** Tool is registered as `create_instance_job` but LLM emits `createInstanceJob` (or vice versa), causing "Tool not found" error that crashes the agent turn.
**Why it happens:** LLM names come from training; `tool()` name in config is the exact string that must match.
**How to avoid:** Use `snake_case` for the `name` field in `tool()` config. Verify EVENT_HANDLER.md (Phase 14) refers to the tool by the same snake_case name.
**Warning signs:** ToolNode throws "Tool not found" error in agent logs; LLM response contains a tool_call block but agent returns an error message instead of executing.

### Pitfall 2: Zod v4 Transform Usage
**What goes wrong:** Using `.transform()` on a schema field causes JSON Schema serialization failure in LangChain's tool input conversion.
**Why it happens:** Zod v4's `toJSONSchema()` treats transforms as unrepresentable by default; LangChain fixed this with input-mode serialization at @langchain/core >=0.3.58, but only for the default case — nested transforms in complex scenarios may still be fragile.
**How to avoid:** Use plain Zod types (`z.string()`, `z.array()`, `z.enum()`, `.optional()`) — no transforms needed for a config object schema.
**Warning signs:** Error "Transforms cannot be represented in JSON Schema" thrown when the agent server starts up.

### Pitfall 3: Singleton Agent Not Picking Up New Tool
**What goes wrong:** Tool is added to tools.js and agent.js, but running server still doesn't recognize the new tool because `_agent` singleton was initialized before the change.
**Why it happens:** `getAgent()` only creates the agent once; subsequent calls return the cached instance.
**How to avoid:** Restart the server after adding the tool. In production (Docker), restart the container. The singleton pattern is correct — there is no bug here, just deployment procedure.
**Warning signs:** Sending "create a new instance" still produces "I don't have a tool for that" instead of a `create_instance_job` tool call.

### Pitfall 4: Optional Fields Causing Required Array Errors
**What goes wrong:** `.optional()` on an array field causes Anthropic API to return "required is required to be supplied" validation error when the LLM omits that field.
**Why it happens:** Older versions of LangChain did not correctly mark optional fields in the JSON Schema `required` array. Fixed in @langchain/core >=0.3.58.
**How to avoid:** The installed version (1.1.24) handles this correctly. Use `.optional()` normally for `slack_user_ids` and `telegram_chat_id`.
**Warning signs:** 400 error from Anthropic API mentioning "required" when calling the tool with missing optional fields.

### Pitfall 5: yaml Package Not Installed Before Phase 15 Needs It
**What goes wrong:** Phase 15 begins without `yaml` installed; job containers would be missing the dependency.
**Why it happens:** npm install is required before the package is available.
**How to avoid:** Install `yaml@^2.8.2` in Phase 13's PR, even though it is not used until Phase 15.
**Warning signs:** `import { parseDocument } from 'yaml'` throws MODULE_NOT_FOUND at runtime in Phase 15.

## Code Examples

Verified patterns from official sources:

### Complete createInstanceJobTool Definition (Phase 13 Stub)
```javascript
// Source: mirrors createJobTool pattern from lib/ai/tools.js (verified against project code)
// Phase 13 = stub; Phase 15 replaces the job description string with buildInstanceJobDescription(config)

const createInstanceJobTool = tool(
  async (config) => {
    // Stub: build a minimal job description — Phase 15 replaces this
    const description = [
      `# Create ClawForge Instance: ${config.name}`,
      '',
      `**Purpose:** ${config.purpose}`,
      `**Allowed repos:** ${config.allowed_repos.join(', ')}`,
      `**Channels:** ${config.enabled_channels.join(', ')}`,
      config.slack_user_ids?.length ? `**Slack users:** ${config.slack_user_ids.join(', ')}` : '',
      config.telegram_chat_id ? `**Telegram chat ID:** ${config.telegram_chat_id}` : '',
      '',
      'Generate all instance files per the ClawForge instance generator spec.',
    ].filter(Boolean).join('\n');

    const result = await createJob(description);
    return JSON.stringify({ success: true, job_id: result.job_id, branch: result.branch });
  },
  {
    name: 'create_instance_job',
    description:
      'Create a new ClawForge instance. Dispatches an autonomous job that generates all instance files and updates docker-compose.yml. Call this only after collecting all required config and receiving operator approval.',
    schema: z.object({
      name: z.string().describe('Instance slug — lowercase, no spaces (e.g. "jim", "acmecorp")'),
      purpose: z.string().describe('What this instance is for, used to author persona files'),
      allowed_repos: z
        .array(z.string())
        .describe('GitHub repo slugs this instance can target (e.g. ["strategyes-lab"])'),
      enabled_channels: z
        .array(z.enum(['slack', 'telegram', 'web']))
        .describe('Communication channels to enable'),
      slack_user_ids: z
        .array(z.string())
        .optional()
        .describe('Slack user IDs that can interact with this instance'),
      telegram_chat_id: z
        .string()
        .optional()
        .describe('Telegram chat ID for this instance'),
    }),
  }
);
```

### Zod Validation Error Behavior (How LangGraph surfaces schema failures)
```javascript
// Source: LangGraph ToolNode behavior — when z.safeParse fails,
// LangGraph returns a ToolMessage with the Zod error, not a thrown exception.
// The LLM receives the error and can retry with corrected arguments.

// Example: LLM sends { name: "jim" } with missing required fields
// Result: ToolMessage content = ZodError with field names
// The agent stays running — it does NOT crash.
```

### Agent Tools Array (agent.js modification)
```javascript
// Source: lib/ai/agent.js (existing pattern, additive change only)
import {
  createJobTool,
  getJobStatusTool,
  getSystemTechnicalSpecsTool,
  createInstanceJobTool,  // new import
} from './tools.js';

const tools = [
  createJobTool,
  getJobStatusTool,
  getSystemTechnicalSpecsTool,
  createInstanceJobTool,  // appended — order does not matter for routing
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod v3 in LangChain | Zod v4 supported | @langchain/core 0.3.58 (2025) | No migration needed; installed v1.1.24 already supports Zod 4 natively |
| `createReactAgent` (LangGraph) | `createAgent` (LangChain) | LangGraph v1 (2025) | `createReactAgent` still works in installed LangGraph 1.1.4; deprecation is soft — no breaking change required for this phase |

**Deprecated/outdated:**
- `createReactAgent` from `@langchain/langgraph/prebuilt`: Soft-deprecated in LangGraph v1 in favor of `createAgent` from `langchain`. The project uses `createReactAgent` and it still works — migration to `createAgent` is a future concern, not blocking Phase 13.

## Open Questions

1. **Does Zod v4 validate `z.enum(['slack', 'telegram', 'web'])` correctly with LangChain's tool schema serialization?**
   - What we know: Simple `z.object()` with `z.string()`, `z.array()`, `.optional()` is confirmed safe. `z.enum()` is a standard Zod primitive with no transforms.
   - What's unclear: `z.enum()` specifically hasn't been tested in this codebase yet.
   - Recommendation: Use it — if there's an issue, fallback is `z.string().describe('one of: slack, telegram, web')`. But this is very unlikely to be a problem given how standard `z.enum()` is.

2. **Should the tool accept `thread_id` from config for job origin tracking (like `createJobTool` does)?**
   - What we know: `createJobTool` reads `config?.configurable?.thread_id` and calls `saveJobOrigin()` so notifications route back correctly.
   - What's unclear: The success criteria for Phase 13 don't mention notification routing for instance jobs.
   - Recommendation: Include `saveJobOrigin()` in the stub for consistency — it's 3 lines and prevents a Phase 15 regression where instance job completions don't route back to the conversation.

## Sources

### Primary (HIGH confidence)
- `lib/ai/tools.js` (project source) — existing `createJobTool` pattern verified directly
- `lib/ai/agent.js` (project source) — singleton pattern and tools array structure verified directly
- `package.json` (project source) — confirmed `zod@4.3.6`, `@langchain/core@1.1.24`, `@langchain/langgraph@1.1.4` installed
- GitHub: langchain-ai/langchainjs issue #8357 — Zod v4 support confirmed landed, @langchain/core >=0.3.58 required

### Secondary (MEDIUM confidence)
- https://eemeli.org/yaml/ — yaml v2.x ESM support, comment preservation, parseDocument API confirmed
- LangGraph v1 release notes — createReactAgent soft-deprecated, existing usage still works

### Tertiary (LOW confidence)
- WebSearch results on "tool not found" behavior in LangGraph ToolNode — suggests errors are surfaced as ToolMessages not crashes, but not verified against @langchain/langgraph 1.1.4 specifically

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed with exact versions; Zod v4 compatibility verified via closed GitHub issue with confirmed fix
- Architecture: HIGH — createInstanceJobTool follows identical pattern to createJobTool, which is working production code
- Pitfalls: MEDIUM — tool name casing and singleton restart issues are verified patterns; Zod transform pitfall is documented but may not apply to this specific schema

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable libraries; LangGraph/LangChain releases are active but no breaking changes expected in 30 days for these specific APIs)
