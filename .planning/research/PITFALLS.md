# Pitfalls Research

**Domain:** Instance Generator — adding multi-turn conversational intake, template-based file generation, and docker-compose.yml modification to the existing ClawForge LangGraph/Docker architecture
**Researched:** 2026-02-27
**Confidence:** HIGH (direct codebase inspection of agent.js, tools.js, index.js, entrypoint.sh, docker-compose.yml, instances/) / MEDIUM (LangGraph state management from official docs + community patterns) / LOW (provisioning system architecture patterns — flagged where applicable)

---

## Critical Pitfalls

### Pitfall 1: Agent Singleton Rebuilt After Tool Addition Corrupts In-Flight Conversations

**What goes wrong:**
`getAgent()` in `lib/ai/agent.js` uses a module-level singleton `_agent`. The singleton is compiled once at startup with the current tool list: `[createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool]`. When a new `createInstanceTool` is added to this array, the singleton must be rebuilt — either by server restart or by calling `resetAgent()`. During a rolling deployment or hot-reload, a conversation thread that started with the old agent (3 tools) may be resumed against the new agent (4 tools). The SQLite checkpoint contains the old tool call schema. LangGraph's replay logic attempts to re-hydrate the state with tool call references from the old graph structure, and the `createInstanceTool` name is absent from the checkpoint's tool registry.

The failure mode is silent: the agent resumes but ignores the pending intake state, responds as if the conversation just started, and the user has to repeat their request. More severe: if an instance creation was mid-intake (Archie had collected name and channels but not repos), the resume strips the partially-collected data and Archie asks from scratch, producing duplicate data collection.

**Why it happens:**
LangGraph `createReactAgent` stores the tool list at compile time in the graph's node definitions. SQLite checkpoints store tool call messages by tool name. Adding a tool does not automatically update existing checkpoints. When old checkpoints reference a tool that no longer exists in the compiled graph, LangGraph's behavior is version-dependent and not guaranteed to be safe. The `_agent = null` reset path in `resetAgent()` forces a full rebuild but is only called explicitly — it does not trigger automatically on tool list changes, and there is no checkpoint migration.

**How to avoid:**
1. Define `createInstanceTool` in the same `tools.js` file as the existing tools and include it in the initial `tools` array from day one of the instance (even before the intake flow is built). This way, existing checkpoints are never interrupted by a new tool appearing mid-conversation.
2. Never add tools to a live LangGraph agent without a full server restart (not just module reload). Add this as a deployment note.
3. If the intake flow has already started when deployment happens, the user-facing risk is a reset conversation, not a crash. Document the "restart gracefully" behavior in AGENT.md so Archie knows to say "It looks like I lost our conversation context — let's start over."

**Warning signs:**
- After deployment, users report Archie "forgot" what they were discussing.
- LangGraph checkpoint errors appear in server logs referencing unknown tool names.
- `resetAgent()` is called mid-intake by any code path — trace all callers.

**Phase to address:**
Phase 1 (Add `createInstanceTool` to tools array) — include the tool in the tools array from the first commit, even if the tool body is a stub. Never add it after conversations are live.

---

### Pitfall 2: Multi-Turn Intake State Lives Only in LangGraph Checkpoints — Not in a Queryable Store

**What goes wrong:**
The intake flow asks Archie to collect: instance name, channels, allowed repos, access restrictions, and persona. This data accumulates across multiple messages in the LangGraph conversation history (SQLite checkpoints, thread-scoped). There is no separate "intake session" record in the application database — the data only exists as unstructured text in the message history.

When Archie calls `createInstanceTool` to dispatch the scaffolding job, it must pass all collected fields as a structured payload. The only source of truth for those fields is the conversation history — Archie must re-extract them from messages or the operator must include them in the tool call. If the conversation history is long (the thread also has prior job discussions), extracting the right fields becomes fragile. If the operator says "actually, change the name to 'jupiter'" mid-intake, the history has two conflicting values and the LLM must resolve the ambiguity at tool-call time.

The scaffolding job receives a `job_description` string (how `createJob` works today). That string is free text injected into a job container. The Claude Code agent inside the container must parse the job description to extract structured config and generate files. If the job description is ambiguous or incomplete, the container-level agent generates incorrect files, but the operator doesn't know until they inspect the PR diff.

**Why it happens:**
The existing `createJob` tool passes a free-text `job_description`. There is no structured config handoff between the Event Handler agent and the job container. For simple one-shot jobs, this is fine. For instance scaffolding (which requires precise values for Dockerfile `COPY` paths, REPOS.json structure, docker-compose service names, and env var prefixes), free-text is insufficient — small ambiguities produce broken configs.

**How to avoid:**
1. Define the intake schema upfront as a Zod object mirroring the exact fields the job container needs. Make `createInstanceTool` accept this structured schema, not free text. The tool validates completeness before dispatching.
2. Structure the `job_description` for scaffolding jobs as a well-defined JSON block embedded in the markdown prompt — not prose. The entrypoint or Claude Code agent in the container parses the JSON, not the prose.
3. Build Archie's intake prompts around explicit confirmation: after collecting all fields, Archie outputs a summary ("Here's what I'll create: ...") and asks for confirmation before calling `createInstanceTool`. This is the last chance to catch ambiguity before the job runs.
4. Store the confirmed config as a JSON block in the job's `logs/{uuid}/job.md` in addition to the prose description. The container agent reads the JSON block first, falls back to prose only if JSON is absent.

**Warning signs:**
- The generated Dockerfile uses wrong instance name in `COPY instances/{name}/...` lines.
- REPOS.json is generated with placeholder values rather than the repos the operator specified.
- `docker-compose.yml` PR has service name that differs from what Archie said during intake.
- Archie calls `createInstanceTool` with missing fields (no channels specified, no REPOS.json content).

**Phase to address:**
Phase 1 (`createInstanceTool` schema) and Phase 2 (job description format) — the structured schema must be decided before any intake flow is built. Changing the schema after intake conversations are running breaks the handoff.

---

### Pitfall 3: LangGraph Context Window Bloat From Long Intake Conversations

**What goes wrong:**
The LangGraph ReAct agent appends every message (human, AI, tool call, tool result) to the thread's message history. The SQLite checkpoint stores the full accumulated history. For a multi-turn instance creation intake (8-12 messages to collect all fields plus confirmation), plus the prior job context that already exists in the thread, plus tool call/result pairs, the message history for an active operator's thread can grow to 20,000+ tokens by the time `createInstanceTool` is called.

This approaches context limits for Claude Sonnet (200k tokens total, but the prompt itself — SOUL.md + AGENT.md + full history + current message — can exceed practical limits for API latency and cost). The instance creation conversation is especially dense because operators ask clarifying questions that generate long AI explanations about channels, scopes, and Docker networking.

The SQLite checkpoint grows proportionally — a new checkpoint is written after every graph node execution. For a 12-message intake conversation on one thread, 24+ checkpoints accumulate (each containing the full message history at that point, not deltas). The `@langchain/langgraph-checkpoint-sqlite` package stores full state snapshots, not diffs.

**Why it happens:**
`createReactAgent` uses an append-only message history by default. There is no message trimming configured in the current `getAgent()` implementation. The SQLite checkpoint database at `data/clawforge.sqlite` has no pruning strategy for old checkpoints. At 2 instances with moderate usage, this has not been a problem. Adding the instance creation flow (which is by nature more conversational than job-dispatching) accelerates the per-thread message count.

**How to avoid:**
1. When implementing `createInstanceTool`, immediately after the tool call completes and the job is dispatched, inject a "conversation reset hint" into the thread state: `addToThread(threadId, "[INTAKE COMPLETE] Instance configuration has been dispatched as job {jobId}. The intake conversation is complete.")`. This signals to future invocations that prior messages before this marker are no longer relevant.
2. Consider a message trimmer in `getAgent()` that preserves the last N messages and the system prompt. LangGraph's `trimMessages` utility (available in `@langchain/core`) can be applied as a pre-processor on the messages state. Set the threshold conservatively (e.g., last 30 messages or 40k tokens).
3. After the instance creation job completes and the PR lands, clear the thread state (or start a new thread) rather than carrying the intake history into subsequent conversations.
4. Monitor the SQLite checkpoint file size. If `data/clawforge.sqlite` exceeds 100MB, the checkpoint history needs pruning. Add a note in the operator setup docs.

**Warning signs:**
- Archie's responses become slow (>10s) for threads that have had instance creation conversations — LLM latency grows with context.
- Claude API returns 400 errors citing context length exceeded.
- `data/clawforge.sqlite` grows faster than usual after instance creation conversations.
- Archie starts confusing fields from one instance creation with another (context contamination from overloaded history).

**Phase to address:**
Phase 2 (intake flow implementation) — implement the conversation reset hint immediately after `createInstanceTool` dispatches. Do not defer message management to a later phase.

---

### Pitfall 4: Template Generation Produces Syntactically Valid But Semantically Broken Config Files

**What goes wrong:**
The scaffolding job generates: `Dockerfile`, `SOUL.md`, `AGENT.md`, `REPOS.json`, `.env.example`, and a `docker-compose.yml` patch/addition. Each file is generated by Claude Code from a template plus the structured config passed in `job_description`. The generated files can be syntactically valid (parseable) but semantically broken in ways that are not obvious until the operator tries to use them:

- **Dockerfile**: The `COPY instances/{name}/config/SOUL.md ./config/SOUL.md` path works only if the instance directory name matches exactly (case-sensitive). If Archie collected "Jupiter" (capitalized) and the Dockerfile uses `instances/Jupiter/` but the PR creates `instances/jupiter/`, the Docker build fails with `COPY failed: file not found`.
- **REPOS.json**: The `owner` field must be the exact GitHub organization or user slug (`ScalingEngine`, not `scaling-engine` or `Scaling Engine`). If the operator says "Scaling Engine" during intake and Claude Code generates `"owner": "Scaling Engine"`, the gh CLI calls in the entrypoint fail silently.
- **docker-compose.yml addition**: The service name (`jupiter-event-handler`) must be unique, DNS-safe (no underscores for some compose versions), and the Traefik router label hostname must match the operator's actual DNS record. Claude Code generating a plausible-looking but incorrect hostname causes TLS provisioning to fail days later.
- **`.env.example`**: Missing env vars cause the operator to unknowingly run the instance without required secrets. Claude Code may omit uncommon vars (e.g., `TELEGRAM_CHAT_ID`) if the operator said "Telegram channel" without the chat ID.

**Why it happens:**
Claude Code inside the job container operates from the `job_description` string. The container agent has the existing instances (`noah/`, `strategyES/`) as reference, but template generation requires precise values that are context-dependent. The agent uses the best available information — if the job description says "owner: ScalingEngine" but the operator actually wants a different org, the error is in the input, not the generation. The PR diff will show the generated files, but the operator reviews it quickly and misses the subtle errors.

**How to avoid:**
1. Include explicit validation instructions in the job prompt: "After generating all files, verify: (a) Dockerfile COPY paths match the instance directory name exactly as lowercase; (b) REPOS.json owner fields are exact GitHub slugs; (c) docker-compose service name is lowercase-hyphenated with no special characters; (d) all env var names from the existing noah/.env.example are present in the new .env.example."
2. The PR description must include a "Generated file checklist" that the operator executes before merging. Each item is a specific thing to verify — not general advice.
3. Store the exact canonical values (GitHub org slug, instance name in lowercase) in the job's JSON config block and instruct the container agent to use these verbatim, not to infer or reformat them.
4. The generated REPOS.json should include only the repos Archie confirmed during intake, in the exact format of the existing `instances/noah/config/REPOS.json` — the container agent should copy the structure directly, not invent new field names.

**Warning signs:**
- Docker build fails with `COPY failed: file not found` after applying the PR.
- `gh api repos/{owner}/{repo}` returns 404 because the owner slug is formatted incorrectly.
- `docker compose config` reports validation errors after applying the docker-compose.yml addition.
- The new instance container starts but Traefik returns 404 because the router hostname doesn't match DNS.

**Phase to address:**
Phase 3 (scaffolding job prompt) — the job prompt must include the validation instructions and the JSON config block. This is the single point where precision is enforced.

---

### Pitfall 5: docker-compose.yml Modification via PR Creates Merge Conflicts With Concurrent Changes

**What goes wrong:**
The scaffolding job generates a new service block to add to `docker-compose.yml` and a new network to add to the `networks:` section. This is delivered as a PR that modifies `docker-compose.yml`. If any other change to `docker-compose.yml` has been merged to `main` since the PR was created, the merge will conflict.

More critically: if two instance creation jobs run concurrently (unlikely for 2-instance production but possible in testing), both PRs modify `docker-compose.yml`. The second PR to merge will conflict on the `volumes:` and `networks:` sections even if the service blocks are distinct. The operator must resolve the conflict manually — but the context for what each PR added is now split across two PR descriptions, making it easy to accidentally drop one service block.

Additionally, the existing pattern of `git add -A` + `git commit` in the entrypoint followed by `--base main` PR creation means the PR is always branched from `main` at job start time. If `main` changes before the PR is reviewed (another service added, traefik config updated), the diff grows stale but the PR shows no conflict — Docker Compose is YAML and line-based diff tools may not surface semantic conflicts.

**Why it happens:**
`docker-compose.yml` is a single file shared across all instances. There is no modular compose file strategy currently (no `docker-compose.override.yml` per instance). Adding a service block is a direct modification to the shared file. PR-based delivery of infrastructure changes is correct for audit trail but introduces the conflict risk of any shared-file modification.

**How to avoid:**
1. Use Docker Compose `include:` directive (supported since Compose v2.20) to split each instance into its own `docker-compose.{name}.yml`. The main `docker-compose.yml` uses `include:` to pull in instance-specific files. The scaffolding job then only creates the new `docker-compose.{name}.yml` — it never modifies the shared `docker-compose.yml` beyond adding one `include:` line (low conflict risk). Each instance's compose file is its own PR artifact.
2. If keeping a monolithic `docker-compose.yml` is preferred (simpler for the operator), include a note in the PR: "If another compose PR has merged since this branch was created, manually rebase before merging." Add `docker compose config` to the PR checklist.
3. The job prompt must instruct Claude Code to append the new service at the end of the `services:` block, add the new network at the end of `networks:`, and add volumes at the end of `volumes:`. Consistent append-at-end reduces the surface area of line-level conflicts.
4. Do not run two instance creation jobs simultaneously. The `createInstanceTool` should check for an existing open instance-creation PR before dispatching.

**Warning signs:**
- Git merge conflict markers appear in `docker-compose.yml` after the PR is merged.
- `docker compose up` fails after the PR is applied because a service definition is malformed from a bad conflict resolution.
- `docker compose config` shows duplicate network or volume names.
- The Traefik container fails to start because its network list in the compose file is incomplete.

**Phase to address:**
Phase 3 (scaffolding job prompt) and Phase 4 (PR description) — the job prompt must specify the correct append-at-end strategy; the PR description must include the `docker compose config` verification step.

---

### Pitfall 6: Incomplete Intake Abandonment Leaves No Cleanup Path

**What goes wrong:**
An operator starts the instance creation flow with Archie, provides some information (name, channels), then stops responding or changes their mind. The LangGraph thread retains the partial intake state. The next time the operator messages Archie (even days later on the same thread), Archie's context includes the partial intake — it may resume the intake instead of responding to the new unrelated question. Worse: if the operator says "never mind" and Archie interprets this as a signal to dispatch with partial data, the scaffolding job creates an incomplete instance with missing REPOS.json or placeholder values.

There is also no recovery path if the dispatched job creates broken files and the PR is merged by accident. The broken files (`instances/{name}/Dockerfile`, etc.) now exist in `main` and must be manually deleted.

**Why it happens:**
LangGraph conversation threads are persistent and stateful. The intake conversation context does not expire. There is no "cancel intake" operation that clears the partial state from the thread. The `create_job` tool only has a gate (missing fields), but a partially-filled intake with plausible placeholder values may pass validation.

**How to avoid:**
1. Define explicit cancellation phrases in EVENT_HANDLER.md: "If the operator says 'cancel', 'never mind', 'stop', or 'forget it' during an instance creation flow, do NOT dispatch the job. Confirm cancellation and clear your context."
2. Do not store intake state in LangGraph conversation history alone. Use a short-lived DB record (or a `pending_instances` table in SQLite) that tracks in-progress intakes with a TTL. If the intake is not confirmed within 30 minutes, mark it expired. The `createInstanceTool` checks for an active record before dispatching.
3. Generate the PR description with a prominent "DRAFT — DO NOT MERGE until setup checklist is complete" warning. Even if an incomplete instance PR is merged, the warning prevents the operator from deploying it immediately.
4. The `createInstanceTool` must validate all required fields before calling `createJob`. Required fields: instance name (lowercase, alphanumeric+hyphen only), at least one channel configured (Slack or Telegram), at least one allowed repo in REPOS.json.

**Warning signs:**
- Archie asks "What's the instance name?" in the middle of an unrelated conversation on the same thread.
- An instance creation PR is opened with placeholder values (`my-instance`, `YOUR_REPO_HERE`).
- The operator reports confusion about why Archie is asking about instance creation when they asked about something else.

**Phase to address:**
Phase 2 (intake flow) — cancellation handling and required field validation must be part of the initial intake implementation, not added after.

---

### Pitfall 7: Generated AGENT.md Uses Wrong Tool Allowlist Format — Claude Code Ignores It

**What goes wrong:**
The `AGENT.md` file is the instruction file baked into the Docker image at `/defaults/AGENT.md` and read by the entrypoint to construct the system prompt for Claude Code jobs. It contains the `--allowedTools` instructions. The generated AGENT.md for a new instance must match the exact format and tool names expected by the `claude -p --allowedTools` CLI flag.

Claude Code's tool names are case-sensitive and version-specific. If the generated AGENT.md uses `"read"` instead of `"Read"`, or `"bash"` instead of `"Bash"`, the Claude Code CLI either ignores the directive or throws a parse error. If it ignores it, Claude Code runs with no tool access and produces empty output. If it throws, the job fails at the `claude` stage with a cryptic error that is not surfaced in the failure_stage detection (which looks for `preflight.md` presence, not `claude -p` flag errors).

Similarly, the `SOUL.md` persona must be in a format that the `--append-system-prompt` flag accepts cleanly. Markdown characters that are special in shell (backticks, dollar signs) must not appear unescaped in the SOUL.md content — or the `echo -e "$SYSTEM_PROMPT"` in the entrypoint will expand them as shell variables, corrupting the prompt.

**Why it happens:**
Claude Code is responsible for generating AGENT.md from a template. The container agent sees the existing `instances/noah/config/AGENT.md` as reference. But if the LLM deviates slightly from the format (different capitalization, added explanatory comments that break the allowedTools list format), the generated file is syntactically valid markdown but behaviorally incorrect. This failure mode is invisible in the PR diff — the file looks correct to a reviewer who doesn't know the exact expected format.

**How to avoid:**
1. Include the exact AGENT.md content as a literal template in the job prompt — instruct Claude Code to use it verbatim except for the instance-specific persona name. Do not ask the LLM to "write a similar AGENT.md" — give it the exact source.
2. Add to the PR checklist: "Open AGENT.md and confirm `--allowedTools` line matches exactly: `Read,Write,Edit,Bash,Glob,Grep,Task,Skill`."
3. Include `SOUL.md` as a similar literal template with clear markers for the instance-specific sections that should be filled in.
4. In the job prompt, add a constraint: "SOUL.md must not contain backtick characters, `$`, or `\`` outside of code blocks, as these will be expanded by the entrypoint shell." This constraint is specific to the entrypoint's `echo -e "$SYSTEM_PROMPT"` pattern.

**Warning signs:**
- New instance Claude Code jobs produce empty output (no files changed, no PR content beyond log files).
- Entrypoint log shows `claude: unrecognized option '--allowedTools read,write'` (lowercase tool names).
- System prompt for the new instance contains literal `$VARIABLE_NAME` text instead of resolved values.
- GSD invocations are zero for all jobs from the new instance — AGENT.md did not correctly mandate Skill tool use.

**Phase to address:**
Phase 3 (scaffolding job prompt) — the job prompt must include the exact AGENT.md template content, not instructions to "write something similar."

---

### Pitfall 8: Instance Name Collisions Produce Ambiguous docker-compose Service Names and Network Names

**What goes wrong:**
The `docker-compose.yml` uses service name, container name, network name, and volume name all derived from the instance name. For a new instance "marketing", the job generates:
- Service: `marketing-event-handler`
- Container: `clawforge-marketing`
- Network: `marketing-net`
- Volumes: `marketing-data`, `marketing-config`

If an operator previously created and deleted an instance named "marketing", the Docker volumes `marketing-data` and `marketing-config` may still exist on the host. `docker compose up` will reuse those volumes, which may contain stale configuration from the old instance (old SQLite db, old config files). The new instance starts with a prior instance's conversation history and API keys in its database.

Additionally, if the instance name contains characters that are valid in the intake conversation but invalid in docker-compose service names (uppercase, underscores, spaces), the generated compose file causes `docker compose config` validation errors.

**Why it happens:**
Docker Compose volume names persist until explicitly deleted with `docker volume rm`. The scaffolding job has no awareness of existing volumes. The `createInstanceTool` has no pre-check for naming conflicts. Instance name validation during intake does not account for the full set of docker-compose naming constraints.

**How to avoid:**
1. During intake, validate the instance name immediately: lowercase, alphanumeric, hyphens only, max 20 characters. Reject anything else at the Event Handler layer (in `createInstanceTool` validation) before the job is dispatched.
2. The job prompt must include a check: "Before writing docker-compose.yml additions, verify the service name `{name}-event-handler` does not already appear in the current docker-compose.yml."
3. The PR description must include: "If this instance name was previously used, run `docker volume rm {name}-data {name}-config` before `docker compose up` to avoid state contamination from prior runs."
4. The generated docker-compose.yml service block must include a `restart: unless-stopped` policy and a clear `container_name` so the operator can identify which container corresponds to which instance.

**Warning signs:**
- `docker compose up` starts the new instance but it already has chat history in its database.
- `docker compose config` returns a validation error about the service name.
- The Traefik router for the new instance conflicts with an existing router label.

**Phase to address:**
Phase 2 (intake flow) for name validation, Phase 3 (job prompt) for collision detection in compose file.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Free-text `job_description` for intake config | No schema change needed | Container agent must parse prose for precise config values; ambiguous values produce broken files silently | Never for instance creation — use JSON config block |
| Store intake state only in LangGraph checkpoints | No new DB table | State is unretrievable without replaying the conversation; no TTL; no cancellation | Never for multi-turn flows that dispatch irreversible actions |
| Monolithic `docker-compose.yml` modification | Simpler file structure | Merge conflicts when multiple instance PRs are in flight; single-file blast radius | Acceptable only if instance creation is strictly serialized |
| Copy AGENT.md template by instruction ("write something similar") | Faster job prompt | LLM deviates from exact tool name format; Claude Code silently fails | Never — provide exact template as literal |
| Skip instance name validation in intake | Faster implementation | Invalid names produce broken Docker resources that require manual cleanup | Never — validate on input, before the job is dispatched |
| Dispatch job with partial intake (missing repos) | Faster UX | Generated REPOS.json has placeholders; instance cannot target any repo; operator confused | Never — enforce required field gate before dispatch |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LangGraph agent singleton + new tool | Adding `createInstanceTool` to tools array requires `resetAgent()` + server restart to take effect | Include tool in initial tools array; never add mid-session; restart server on deploy |
| LangGraph checkpoint + long intake | Default append-only history grows to 20k+ tokens for conversational intake threads | Implement `trimMessages` preprocessor in `getAgent()`; inject completion marker after dispatch |
| `addToThread()` for job completion injection | Injecting completion message into thread that already has 15+ messages may confuse Archie about intake state | Always inject with explicit marker prefix: `[INTAKE COMPLETE]` so EVENT_HANDLER.md can pattern-match |
| `createJob` free-text + container agent | Passing intake config as prose in `job_description` lets container agent guess at field values | Embed JSON config block at top of `job_description` in a fenced code block; instruct container agent to parse JSON first |
| `docker-compose.yml` + include directive | docker-compose `include:` requires Compose v2.20+ — older `docker-compose` v1 does not support it | Verify `docker compose version` on target host before using `include:`; document minimum version |
| `echo -e "$SYSTEM_PROMPT"` in entrypoint | SOUL.md content with `$` or backticks gets shell-expanded during echo | Sanitize generated SOUL.md content: escape `$` as `\$` in template; use `printf '%s'` instead of `echo -e` for safer expansion |
| GitHub Actions `--base main` in same-repo PR | Instance scaffolding PR targets clawforge's `main` — if this is a branch-protected environment, it may require review | Same as existing jobs — same-repo PRs go through `auto-merge.yml`; instance creation PRs should go through same path with path-restriction allow for `instances/` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Long intake conversation accumulates checkpoint writes | SQLite grows rapidly; every LangGraph step writes full state snapshot | Add message trimmer; clear checkpoints after intake completes | After 5+ instance creation conversations on same thread |
| Container agent generates all files with one long Write call | Single `claude -p` run generating 6+ files often hits the 30-min timeout if the LLM is verbose | Instruct container agent to write each file independently and commit incrementally; use GSD plan-phase routing | Any scaffolding job with a verbose LLM model |
| `createInstanceTool` dispatches job with full conversation history in description | Job description grows to 10k+ characters including conversation context | Pass only the confirmed config JSON block as job description; strip conversation prose | When Archie summarizes the intake verbosely in the tool call |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Generated `.env.example` contains actual secret values (copied from operator's message during intake) | Real API keys committed to repo history if operator pastes secrets during intake | AGENT.md must instruct Archie to never include actual secret values in `.env.example` — placeholders only (`YOUR_ANTHROPIC_API_KEY`); include warning in intake prompt |
| Instance name accepted from intake without validation | Operator can name instance `../../etc` or `$(rm -rf)` — path traversal in Dockerfile COPY paths | Validate instance name to `^[a-z][a-z0-9-]{0,18}[a-z0-9]$` in `createInstanceTool` before dispatching |
| Generated REPOS.json allows unrestricted repos | If intake collects repos loosely ("any repo I own"), REPOS.json could allow broad access | `createInstanceTool` must require explicit repo slugs (`owner/repo`) — no wildcards, no org-level access grants |
| New instance Slack bot token injected into PR | Operator provides bot token during intake; Archie includes it in docker-compose env section | createInstanceTool must never include secret values in the PR; only placeholder names go in compose file; instruct operator to set secrets manually |
| Auto-merge enabled for instance scaffolding PRs | A broken instance PR auto-merges and is immediately deployed by `docker compose up` | Exclude `instances/` path from `auto-merge.yml` ALLOWED_PATHS; all instance scaffolding PRs require human review |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Archie asks for all fields sequentially (one per message) | 8-turn intake feels tedious; operator abandons halfway | Ask for groups of related fields together: "What's the instance name and which channels (Slack/Telegram/Web)?" — 3-4 turns max |
| PR description lacks operator action items | Operator merges PR, runs compose up, instance fails silently | PR description must include step-by-step checklist: create Slack app, set GitHub secrets, verify DNS, run `docker compose up --build` |
| Archie confirms dispatch before collecting repos | Instance scaffolding job creates REPOS.json with empty array | REPOS.json with at least one repo is a required field — gate dispatch on this |
| No confirmation before dispatching scaffolding job | Operator can't correct mistakes before the job runs | Always show summary and ask "Shall I create this instance?" before calling `createInstanceTool` |
| Generated PR title is generic "clawforge: job {uuid}" | Operator can't identify instance creation PRs in PR list | Job prompt must instruct container agent to open PR with title "feat(instances): add {name} instance" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Intake validation:** Ask Archie to create an instance with name "My Instance!" — confirm it rejects the name before dispatching (special characters and spaces are invalid).

- [ ] **Structured config handoff:** Inspect the `logs/{uuid}/job.md` for an instance creation job. Confirm a JSON config block is present with all required fields, not just prose.

- [ ] **AGENT.md tool format:** Open the generated `instances/{name}/config/AGENT.md`. Confirm the allowedTools list is `Read,Write,Edit,Bash,Glob,Grep,Task,Skill` — exact casing, exact format.

- [ ] **SOUL.md shell safety:** Check generated SOUL.md for unescaped `$` characters. Run `grep -n '\$' instances/{name}/config/SOUL.md` — any `$WORD` pattern will be shell-expanded by entrypoint.

- [ ] **docker-compose.yml syntax:** After applying the PR, run `docker compose config` on the host. Zero errors required before `docker compose up`.

- [ ] **No actual secrets in PR:** Review the PR diff. Confirm no API keys, bot tokens, or passwords appear in any generated file — only placeholder names like `YOUR_ANTHROPIC_API_KEY`.

- [ ] **Instance name in all paths:** Verify the Dockerfile has `COPY instances/{name}/` (exact lowercase name) in every COPY line. Run `grep -n "instances/" instances/{name}/Dockerfile` and confirm all paths match the directory name.

- [ ] **REPOS.json format:** Open generated REPOS.json. Confirm it matches the exact schema of `instances/noah/config/REPOS.json` — `repos` array, each entry has `owner`, `slug`, `name`, `aliases`. No extra fields, no missing fields.

- [ ] **PR auto-merge disabled:** Confirm the instance scaffolding PR is NOT auto-merged. It should appear as "Open" in GitHub, requiring manual review and merge.

- [ ] **Conversation context after dispatch:** After `createInstanceTool` is called, send Archie a new unrelated message on the same thread. Confirm Archie responds to the new message normally and does not resume the intake flow.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Intake dispatched with wrong instance name | MEDIUM | Close the PR; if instance directory was created, delete it with a new PR; restart intake on a new thread |
| Generated AGENT.md has wrong tool format — Claude Code jobs fail silently | LOW | Edit AGENT.md directly in `instances/{name}/config/AGENT.md`, open a fix PR; no rebuild needed until next deploy |
| docker-compose.yml merge conflict | LOW | Manually resolve conflict locally; run `docker compose config` to verify; push resolution to PR |
| docker-compose.yml applied with broken config — container fails to start | MEDIUM | `docker compose down {name}-event-handler`; fix compose file via new PR; `docker compose up -d {name}-event-handler` |
| Stale volumes from prior deleted instance | LOW | `docker volume rm {name}-data {name}-config`; `docker compose up -d {name}-event-handler` |
| Actual secret in PR diff — committed to history | HIGH | Immediately rotate the exposed secret; use `git filter-repo` or GitHub's secret removal tool to purge from history; audit access logs for the exposed token |
| Archie resume mid-intake on wrong thread | LOW | Tell Archie "cancel this instance creation" and start intake on a new thread |
| Container agent generates files with placeholder values | LOW | Close the PR; fix the job prompt to include explicit values; re-dispatch with corrected config JSON block |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Agent singleton corrupts on tool addition | Phase 1: Add `createInstanceTool` to tools array from first commit | Deploy and confirm existing conversations resume normally |
| Multi-turn intake state in LangGraph only (no queryable store) | Phase 1: Define structured Zod schema for `createInstanceTool` | Inspect `job.md` for JSON config block before container runs |
| Context window bloat from long intake | Phase 2: Implement conversation reset marker after dispatch | Monitor SQLite size; send long intake then unrelated message — confirm normal response |
| Template generates valid but semantically wrong config | Phase 3: Include literal template content in job prompt | Run `docker compose config` after PR; inspect REPOS.json schema |
| docker-compose.yml merge conflicts | Phase 3: Use append-at-end strategy; Phase 4: Include compose verify in PR checklist | Apply two concurrent instance PRs in test; confirm no conflict |
| Incomplete intake abandonment leaves dangling state | Phase 2: Required field gate in `createInstanceTool`; cancellation in EVENT_HANDLER.md | Say "cancel" mid-intake; confirm no job dispatched |
| Generated AGENT.md wrong tool name format | Phase 3: Provide exact AGENT.md template in job prompt | Run a Claude Code job from new instance; confirm GSD invocations > 0 |
| Instance name collision in Docker resources | Phase 2: Name validation in `createInstanceTool`; Phase 3: Collision check in job prompt | Try creating instance with previously-used name; confirm warning in PR |
| Secrets in PR from operator input | Phase 2: AGENT.md instruction to Archie; Phase 3: Container agent instruction | Review PR diff for any token/key patterns |
| Auto-merge on instance scaffolding PR | Phase 4: Exclude `instances/` from `auto-merge.yml` ALLOWED_PATHS | Open instance PR; confirm it stays open for manual review |

---

## Sources

### PRIMARY (HIGH confidence — direct codebase inspection)

- `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/agent.js` — Singleton pattern `_agent`, `resetAgent()`, tools array at line 19; confirmed no message trimmer configured
- `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/tools.js` — `createJobTool` schema (job_description only, no structured instance fields); `detectPlatform()` at lines 16-21
- `/Users/nwessel/Claude Code/Business/Products/clawforge/lib/ai/index.js` — `chat()` append-only invocation at line 69; `addToThread()` state injection at line 288; no message trimming in place
- `/Users/nwessel/Claude Code/Business/Products/clawforge/templates/docker/job/entrypoint.sh` — `echo -e "$SYSTEM_PROMPT"` at line 156 (shell expansion risk); `ALLOWED_TOOLS` at line 215; `--append-system-prompt` at line 287
- `/Users/nwessel/Claude Code/Business/Products/clawforge/docker-compose.yml` — Monolithic file with all services; network/volume naming convention (`noah-net`, `noah-data`); no `include:` directive
- `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/Dockerfile` — `COPY instances/noah/config/` paths (case-sensitive, exact match required)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/instances/noah/config/REPOS.json` — Exact schema required for generated REPOS.json
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/PROJECT.md` — v1.3 requirements; confirmed 2 existing instances; out-of-scope items (secrets auto-provisioning, Slack app auto-creation)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/CONCERNS.md` — Database singleton vulnerability (line 13-17); LangGraph streaming format fragility (line 123-127); LangChain breaking changes risk (line 172-175)
- `/Users/nwessel/Claude Code/Business/Products/clawforge/.planning/codebase/ARCHITECTURE.md` — State management section (conversation memory in SQLite checkpointer at line 103); error handling patterns (best-effort, no retry for tool errors)

### SECONDARY (MEDIUM confidence — official docs and verified community patterns)

- [LangGraph JS Persistence Docs](https://langchain-ai.github.io/langgraphjs/concepts/persistence/) — Checkpoint-per-step behavior; full state snapshot (not delta) written at each node; confirmed no automatic pruning
- [LangGraph Breaking Change: langgraph-prebuilt 1.0.2](https://github.com/langchain-ai/langgraph/issues/6363) — Breaking changes on minor versions without proper constraints; confirms pinning `@langchain/*` to exact versions is necessary
- [LangGraph Breaking Change: checkpoint-postgres serialization](https://github.com/langchain-ai/langgraph/issues/5862) — Minor version upgrades can break checkpoint deserialization; confirms checkpoint format is not stable across minor versions
- [LangGraph: Modify graph state from tools](https://changelog.langchain.com/announcements/modify-graph-state-from-tools-in-langgraph) — ToolNode cannot handle InjectedState without Command objects; confirms tool schema changes require graph rebuild
- [Docker Compose Merge Behavior](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/) — Lists replaced entirely (not merged); ports override behavior; `include:` directive for modular compose files
- [Docker Compose `include:` directive](https://docs.docker.com/compose/how-tos/multiple-compose-files/include/) — Requires Compose v2.20+; import-time conflict detection; safe for per-instance files
- [LangGraph State Bloat: checkpoint per step](https://focused.io/lab/customizing-memory-in-langgraph-agents-for-better-conversations) — Full state stored at every step; 50MB state * 10 steps = 500MB checkpoint bloat; recommendation to store only references
- [NeurIPS 2025: Why Multi-Agent LLM Systems Fail](https://arxiv.org/pdf/2503.13657) — Conflicting state updates, timeout/retry ambiguity, message misinterpretation in multi-agent flows; 40% of pilots fail within 6 months of production
- [Claude Code Security: Shell injection via `${VAR}`](https://flatt.tech/research/posts/pwning-claude-code-in-8-different-ways/) — Claude Code fails to filter Bash variable expansion syntax; fixed in v1.0.93; relevant to SOUL.md template content safety

### TERTIARY (LOW confidence — single source, pattern inference)

- [LangGraph Human-in-the-Loop: interrupt()](https://blog.langchain.com/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt/) — Interrupt-based intake patterns; confirmation before irreversible actions; persistence across interrupt points
- [Multi-Agent Failure Modes: Production Reliability](https://www.getmaxim.ai/articles/multi-agent-system-reliability-failure-patterns-root-causes-and-production-validation-strategies/) — State corruption from concurrent writes; retry ambiguity; downstream cascade failures from early misinterpretation

---

*Pitfalls research for: ClawForge v1.3 — Instance Generator (multi-turn conversational intake, template-based file generation, docker-compose.yml modification via PR)*
*Researched: 2026-02-27*
