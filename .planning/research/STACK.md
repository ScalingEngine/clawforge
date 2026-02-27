# Stack Research

**Domain:** AI agent gateway — instance generator with conversational intake, file scaffolding, and docker-compose modification
**Milestone:** v1.3 Instance Generator
**Researched:** 2026-02-27
**Confidence:** HIGH for existing stack integration; MEDIUM for LangGraph multi-turn pattern rationale; HIGH for file generation and YAML manipulation choices

---

## Scope

This document covers **additions and changes** needed for v1.3 Instance Generator only. The existing stack (LangGraph `createReactAgent`, SQLite checkpointer, Next.js API routes, Drizzle ORM, Slack/Telegram/Web adapters, REPOS.json resolver) is validated from v1.0-v1.2 and not re-researched here.

Three new capability areas:

1. **Multi-turn conversational state** — how LangGraph handles the intake flow for instance creation
2. **Template-based file generation** — scaffolding instance config files (Dockerfile, SOUL.md, AGENT.md, REPOS.json, .env.example, EVENT_HANDLER.md)
3. **Dynamic docker-compose.yml modification** — programmatic YAML read/write for adding a new instance service block

---

## Recommended Stack

### Core Technologies (Existing — No Change)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| `@langchain/langgraph` | `^1.1.4` | ReAct agent orchestration | Existing — keep |
| `@langchain/langgraph-checkpoint-sqlite` | `^1.0.1` | Agent state checkpointing | Existing — keep |
| `@langchain/core` | `^1.1.24` | Tool framework, message types | Existing — keep |
| `zod` | `^4.3.6` | Tool schema validation | Existing — keep |
| `better-sqlite3` | `^12.6.2` | SQLite storage | Existing — keep |

### New Additions for v1.3

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `yaml` | `^2.8.2` | Parse and serialize docker-compose.yml | Only ESM-native YAML library that preserves comments on round-trip. The existing `templates/docker-compose.yml` contains commented-out TLS/HTTPS blocks operators depend on — comment-destructive serializers break the operator experience. |

**That is the only new npm dependency.** Everything else uses existing patterns.

### Supporting Capabilities (No New Libraries — Existing)

| Capability | How It Works | v1.3 Usage |
|------------|--------------|------------|
| JavaScript template literals | Native ESM, Node built-in | Generate instance file contents (Dockerfile, SOUL.md, AGENT.md, REPOS.json, .env.example) as strings |
| `fs.writeFileSync` (Node built-in) | Node 18+ | Write scaffolded file strings to `instances/{name}/` paths |
| `path.join` (Node built-in) | Node 18+ | Resolve instance directory paths portably |
| LLM-driven multi-turn via tool return values | Existing LangGraph + SQLite checkpoint | Agent asks follow-up questions when `gather_instance_config` returns `{ status: "need_more_info" }` |

---

## Multi-Turn Conversational State in LangGraph

### The Right Approach: LLM-Driven Intake via Tool Return Values

The existing `createReactAgent` already supports multi-turn conversation natively. Each Slack/Telegram message invokes `chat(threadId, text)`, which creates a new LangGraph execution that reads full prior message history from the SQLite checkpoint using the `thread_id`. The agent has complete conversation context every time.

**Pattern for v1.3 intake:** Add a new `gather_instance_config` tool that accepts all instance parameters as optional Zod fields. The tool checks which required fields are present and returns either:

- `{ status: "need_more_info", question: "What channels should this instance use? (slack, telegram, or both)" }` — when required fields are missing
- `{ status: "ready", config: { ... complete config object ... } }` — when all required fields are present

The LLM receives the `need_more_info` response, understands it cannot proceed, and asks the user the provided question in natural language. The user replies in the same thread. The agent invokes `gather_instance_config` again with accumulated information from the conversation. This repeats until `status: "ready"`, at which point the agent calls `create_instance_scaffold`.

This is zero new infrastructure. The LangGraph ReAct loop + SQLite thread memory already does exactly this.

### Why Not LangGraph `interrupt()`

The `interrupt()` function from `@langchain/langgraph` pauses a graph mid-execution and resumes it when `Command({ resume: value })` is invoked with the same `thread_id`. It is designed for cases where a single graph invocation must halt to wait for external input.

ClawForge's architecture is incompatible with this model:

1. Each Slack/Telegram message calls `chat(threadId, text)` — a new graph invocation each time. The interrupt resume mechanism assumes a single long-running invocation.
2. Surfacing `__interrupt__` values requires changing `chat()`, `chatStream()`, and all three channel adapters (Slack, Telegram, Web) to detect interrupt state and route `Command` objects on subsequent messages.
3. The SQLite checkpointer already persists all message history across invocations — the state continuity that `interrupt()` provides for single invocations already exists across invocations via the checkpoint.

Using `interrupt()` here would require significant refactoring of the channel layer for zero UX benefit. The tool-return pattern achieves the same result with no infrastructure changes.

**Confidence: MEDIUM** — this conclusion is based on reading the LangGraph interrupt docs and understanding ClawForge's invocation model from codebase inspection. The `interrupt()` + `createReactAgent` combination's exact behavior is not fully documented in official sources; the incompatibility is inferred from the architectural mismatch.

### Why Not Migrate to `createAgent` from `langchain` for v1.3

`createReactAgent` from `@langchain/langgraph/prebuilt` is deprecated in LangGraph v1.x in favor of `createAgent` from the `langchain` package. It is not removed — it still functions in v1.1.4 and will continue to in v1.x. Removal is planned for v2.0.

Migrating to `createAgent` for v1.3 would require:
- Import changes (`@langchain/langgraph/prebuilt` → `langchain`)
- Parameter rename (`prompt` → `systemPrompt`)
- Behavior review to confirm all existing tool invocations, checkpointing, and streaming continue correctly

This migration is meaningful refactoring orthogonal to Instance Generator features. Bundling it into v1.3 creates two different risk areas in the same PR. Flag as post-v1.3 tech debt: plan a standalone `createAgent` migration task before v2.0 alpha adoption.

**Confidence: HIGH** — confirmed from LangGraph V1 Alpha issue #1602 and official migration guide at `docs.langchain.com/oss/javascript/migrate/langgraph-v1`.

### New Tool: `gather_instance_config`

Located in `lib/ai/tools.js`. All parameters optional in Zod schema so the tool can be called at any stage of the conversation.

**Required fields the tool collects:**

| Field | Type | Example | Used In |
|-------|------|---------|---------|
| `instance_name` | string | `"strategyES"` | Directory path, Docker container name, network name |
| `agent_name` | string | `"Epic"` | SOUL.md identity, .env.example comment |
| `owner_name` | string | `"Jim"` | SOUL.md owner reference |
| `channels` | string[] | `["slack"]` | Which channel adapters to configure |
| `allowed_repos` | object[] | `[{ owner, slug, name, aliases }]` | REPOS.json content |

**Fields documented in PR setup checklist (not gathered in conversation):**

- GitHub secrets (`SLACK_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, etc.) — operator provisions these
- Slack app creation steps and required scopes — operator creates the Slack app
- Docker network isolation name — derived from `instance_name`

### New Tool: `create_instance_scaffold`

Located in `lib/ai/tools.js`. Accepts the complete config object from `gather_instance_config`. Creates a Claude Code job via the existing `createJob` mechanism. The job container generates instance files and opens a PR.

### Tool Integration Point

Add both tools to the tools array in `lib/ai/agent.js` — no structural changes to `createReactAgent` call.

```javascript
// lib/ai/agent.js — append new tools to existing array, no other changes
const tools = [
  createJobTool,
  getJobStatusTool,
  getSystemTechnicalSpecsTool,
  gatherInstanceConfigTool,       // NEW
  createInstanceScaffoldTool,     // NEW
];
```

---

## Template-Based File Generation

### Approach: JavaScript Template Literals — Zero Dependencies

For scaffolding instance files, use JavaScript template literals with `fs.writeFileSync`. No template engine is needed.

**Why not Handlebars (v4.7.8):** Published 3 years ago. CommonJS only — no native ESM export. ClawForge is `"type": "module"` throughout. Using CommonJS in an ESM project requires either `createRequire` from `module` or `import()` with `.default` — workarounds that add friction with zero benefit. Handlebars' power features (partials, block helpers) are unnecessary for static file generation with simple variable substitution.

**Why not Mustache (v4.x):** Same CommonJS ESM problem. Mustache.js 4.x publishes CJS only.

**Why not EJS (v3.x):** Same CommonJS ESM problem.

**Why template literals are correct here:** Instance files are small (50-100 lines each), fixed-structure documents with straightforward variable interpolation. A dedicated `lib/scaffold/instance.js` module with one function per file type gives:
- Zero new dependencies
- Full ESM compatibility with zero workarounds
- IDE syntax highlighting inside template strings
- Trivial unit testing (call function, assert returned string matches expected)
- Maintainability directly alongside the live instance files they mirror

### Implementation: `lib/scaffold/instance.js`

One exported function per generated file. Each function takes a config object and returns the file contents as a string. The caller writes the string with `fs.writeFileSync`.

```javascript
// lib/scaffold/instance.js
export function generateDockerfile({ instanceName }) { /* ... */ }
export function generateSoulMd({ agentName, ownerName }) { /* ... */ }
export function generateAgentMd({ instanceName, channels }) { /* ... */ }
export function generateReposJson({ allowedRepos }) { /* ... */ }
export function generateEnvExample({ instanceName, channels }) { /* ... */ }
export function generateEventHandlerMd({ agentName, ownerName, allowedRepos }) { /* ... */ }
```

### Template Sources

Use the live `instances/noah/` files as the canonical template baseline — not `templates/config/`. The live instance files represent the validated production state; `templates/config/` may diverge.

Files to mirror:
- `instances/noah/Dockerfile` → Dockerfile generation
- `instances/noah/config/SOUL.md` → SOUL.md generation
- `instances/noah/config/AGENT.md` → AGENT.md generation
- `instances/noah/config/REPOS.json` → REPOS.json generation
- `instances/noah/.env.example` → .env.example generation
- `instances/noah/config/EVENT_HANDLER.md` → EVENT_HANDLER.md generation

### PR Delivery via Claude Code Job

The `create_instance_scaffold` tool does NOT write files directly from the Event Handler. It creates a Claude Code job via the existing `createJob` mechanism. The job container:

1. Receives the gathered config as a structured JSON block in the job description
2. Generates each file using the template functions (or equivalent generation logic for a JS environment in the container)
3. Writes files to `instances/{instanceName}/`
4. Updates `docker-compose.yml` with the new service block
5. Opens a PR with the operator setup checklist as the PR body

This preserves the git-as-audit-trail invariant. The operator reviews the PR before anything lands in the repo.

---

## Dynamic docker-compose.yml Modification

### Approach: `yaml` npm package (v2.8.2)

Use the `yaml` package (`npm: yaml`, `github: eemeli/yaml`) to parse, modify, and serialize `docker-compose.yml`.

**Why `yaml` over `js-yaml`:**

| Criterion | `yaml` v2.8.2 | `js-yaml` v4.x |
|-----------|---------------|----------------|
| ESM support | Native — `import { parseDocument } from 'yaml'` works directly | CommonJS only — requires `createRequire` workaround |
| Comment preservation | Yes — explicitly documented feature | No — `dump()` serializes from plain JS object, comments are lost during `load()` |
| Round-trip safety | Yes — preserves blank lines, comments, formatting | No — reformats on `dump()` |
| API for structural edits | `doc.addIn()`, `doc.set()` on AST nodes | Only object mutation before `dump()` |

The existing `templates/docker-compose.yml` has commented-out TLS/HTTPS configuration blocks (`--entrypoints.web.http.redirections...`, Let's Encrypt resolver settings) that operators uncomment during production deployment. Destroying these comments on the first programmatic edit breaks the operator workflow.

**Why not string/regex manipulation:** The docker-compose.yml has nested structure (Traefik command arrays, service labels, volume definitions). String insertion at incorrect indentation produces silently broken YAML. Parse-modify-serialize is the only correct approach for structural edits.

**Version:** `yaml@2.8.2` (released November 30, 2025). Latest stable.

### Usage Pattern in Claude Code Job

The scaffold job container receives the gathered instance config. It:

1. Reads `docker-compose.yml` with `fs.readFileSync`
2. Parses to a mutable AST with `parseDocument()`
3. Appends a new service block following the existing event-handler service pattern
4. Serializes back to string with `doc.toString()`
5. Writes to `docker-compose.yml` with `fs.writeFileSync`

```javascript
import { parseDocument } from 'yaml';
import fs from 'fs';

const raw = fs.readFileSync('docker-compose.yml', 'utf8');
const doc = parseDocument(raw);

// Append new instance service without destroying existing Traefik TLS comments
doc.addIn(['services'], newInstanceServicePair);

fs.writeFileSync('docker-compose.yml', doc.toString());
```

The new service block mirrors the structure of the existing `event-handler` service, substituting:
- Container name: `clawforge-{instanceName}`
- Image tag: parameterized per instance
- Traefik hostname label: derived from `APP_HOSTNAME` env var for the instance
- Docker network: `{instanceName}-net`

---

## Installation

```bash
# The one new runtime dependency
npm install yaml@^2.8.2
```

No dev dependency additions. No peer dependency changes. No build tooling changes.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| JavaScript template literals for file generation | Handlebars 4.7.8 | If the project were CommonJS. Not applicable here — `"type": "module"` throughout. |
| JavaScript template literals for file generation | EJS 3.x | Same CommonJS problem as Handlebars. |
| JavaScript template literals for file generation | Mustache 4.x | Same CommonJS problem. |
| `yaml` package for docker-compose modification | `js-yaml` 4.x | If comment preservation were not required and CommonJS were acceptable. Neither condition holds. |
| `yaml` package for docker-compose modification | String/regex YAML manipulation | Never correct for nested YAML structural edits — silently broken indentation risk. |
| LLM-driven multi-turn via tool return `{ status: "need_more_info" }` | LangGraph `interrupt()` | Use `interrupt()` if the graph is a single long-running invocation that needs to pause. ClawForge's channel adapter model uses independent per-message invocations — interrupt does not compose with this model without invasive channel adapter refactoring. |
| Stay on `createReactAgent` for v1.3 | Migrate to `createAgent` from `langchain` | Migrate in a dedicated task after v1.3 ships. `createReactAgent` is deprecated but functional in v1.1.4. Bundling migration into v1.3 adds orthogonal risk. |
| Claude Code job writes scaffolded files as PR | Event Handler writes files directly to disk | Direct writes bypass git-as-audit-trail. All file mutations in ClawForge go through the job → PR pipeline. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `handlebars` | CommonJS only — incompatible with `"type": "module"` without `createRequire` workaround | JavaScript template literals |
| `mustache` | CommonJS only — same ESM problem | JavaScript template literals |
| `ejs` | CommonJS only — same ESM problem | JavaScript template literals |
| `js-yaml` | CommonJS only; `dump()` destroys comments on round-trip | `yaml` package |
| `docker-compose` npm package | Wraps docker-compose CLI subprocess — not useful for static YAML file modification | `yaml` package |
| LangGraph `interrupt()` | Requires refactoring `chat()`, `chatStream()`, and all three channel adapters — invasive and incompatible with per-message invocation model | LLM-driven multi-turn via `{ status: "need_more_info" }` tool return pattern |
| `@langchain/langgraph@next` or any v2 alpha | `createReactAgent` is removed in v2 — breaking change on import | Remain on v1.1.4; plan `createAgent` migration as a dedicated post-v1.3 task |

---

## Stack Patterns by Variant

**If the new instance supports Slack only:**
- Generate `.env.example` with Slack vars populated, Telegram vars commented out
- `AGENT.md` channels section references Slack only
- PR setup checklist includes Slack app creation and bot token steps
- No Telegram webhook registration step in checklist

**If the new instance supports Telegram only:**
- Generate `.env.example` with Telegram vars populated, Slack vars commented out
- PR setup checklist includes Telegram bot creation via BotFather
- No Slack app steps in checklist

**If the new instance is repo-scoped (like StrategyES):**
- `REPOS.json` contains only the scoped repos for that instance
- `SOUL.md` notes the repo access restriction in the identity section
- `docker-compose.yml` service block uses a distinct Docker network (`{instanceName}-net`)

**If the new instance is for a different GitHub org:**
- `REPOS.json` uses the correct org as `owner`
- `.env.example` documents `GH_OWNER` override to the new org
- PR setup checklist notes GitHub runner registration at org level for the new org

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `yaml@^2.8.2` | Node 18+ | ESM-native; no peer dependency conflicts with existing packages |
| `yaml@^2.8.2` | `@langchain/langgraph@^1.1.4` | No interaction — independent modules |
| `yaml@^2.8.2` | `"type": "module"` projects | First-class support; no workaround needed |
| `@langchain/langgraph@^1.1.4` | Node 18+ (current project engines) | LangGraph v1.x docs state Node 20+ is required (Node 18 EOL March 2025). Current `package.json` specifies `"engines": { "node": ">=18.0.0" }`. This is acceptable for v1.3 — flag Node version upgrade as a separate task before major version bump. |

**Deprecation tracking:**
- `createReactAgent` from `@langchain/langgraph/prebuilt` — deprecated in v1.x, removed in v2.0. Shows deprecation warnings. Functional in v1.1.4. Do not upgrade to v2 alpha during v1.3.
- Plan `createAgent` migration from `langchain` package as a standalone post-v1.3 task.

---

## Sources

- Direct codebase inspection: `package.json` — existing dependencies, `"type": "module"`, Node 18+ engine (HIGH confidence)
- Direct codebase inspection: `lib/ai/agent.js` — `createReactAgent` singleton pattern, `SqliteSaver`, tool array (HIGH confidence)
- Direct codebase inspection: `lib/ai/tools.js` — tool structure, Zod schema patterns, `config` access for `thread_id` (HIGH confidence)
- Direct codebase inspection: `instances/noah/Dockerfile`, `instances/noah/config/SOUL.md`, `instances/noah/config/REPOS.json` — canonical template baseline for instance files (HIGH confidence)
- Direct codebase inspection: `templates/docker-compose.yml` — confirmed commented-out TLS blocks that must survive round-trip YAML modification (HIGH confidence)
- [LangGraph interrupt docs](https://docs.langchain.com/oss/javascript/langgraph/interrupts) — interrupt() pauses single execution, requires Command resume; available in JS (MEDIUM confidence — createReactAgent compatibility not addressed)
- [LangChain blog: interrupt announcement](https://blog.langchain.com/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt/) — interrupt in Python and JS, December 14, 2024 (MEDIUM confidence)
- [LangGraph V1 Alpha issue #1602](https://github.com/langchain-ai/langgraphjs/issues/1602) — `createReactAgent` deprecated, moved to `langchain` package; stable v1.0 late October 2025 (HIGH confidence — official LangChain team post)
- [LangGraph v1 migration guide](https://docs.langchain.com/oss/javascript/migrate/langgraph-v1) — breaking changes: `createReactAgent` deprecated, `prompt` → `systemPrompt`, Node.js 20+ (HIGH confidence — official docs)
- [yaml package GitHub: eemeli/yaml](https://github.com/eemeli/yaml) — v2.8.2 (Nov 30, 2025); comment preservation confirmed; ESM native; `parseDocument()` + `addIn()` API (HIGH confidence — official source)
- [js-yaml GitHub: nodeca/js-yaml](https://github.com/nodeca/js-yaml) — CommonJS only; `dump()` does not preserve comments (HIGH confidence — official source; limitation confirmed in README)
- [Handlebars npm](https://www.npmjs.com/package/handlebars) — v4.7.8, published 3 years ago, CommonJS (HIGH confidence — npm registry)
- [npm-compare: ejs vs handlebars vs mustache vs pug](https://npm-compare.com/ejs,handlebars,mustache,pug) — all major JS template engines surveyed; none with native ESM in stable releases as of 2025 (MEDIUM confidence — aggregator, cross-validated against individual npm pages)

---

*Stack research for: ClawForge v1.3 Instance Generator*
*Researched: 2026-02-27*
