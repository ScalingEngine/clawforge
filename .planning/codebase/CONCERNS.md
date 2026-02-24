# Codebase Concerns

**Analysis Date:** 2025-02-23

## Tech Debt

**Incomplete Error Handling in Channel Message Processing:**
- Issue: Asynchronous message processing in `/api/index.js` at line 163 fires without awaiting and swallows errors with `.catch()`. If `processChannelMessage()` fails, the webhook response is already sent (200 OK) but the user never sees a response or error notification.
- Files: `api/index.js:162-165`, `lib/channels/base.js:29, 36-38`
- Impact: Telegram/Slack users may send messages and never receive acknowledgment or error feedback. Silent failures in channel message pipelines make debugging difficult and create poor UX.
- Fix approach: Implement a retry queue (Redis/SQLite) for failed channel messages. Add separate error notification path to notify admin of channel message failures. Consider moving message processing into a background job rather than fire-and-forget.

**Database Singleton Pattern Vulnerability:**
- Issue: `lib/db/index.js` uses a module-level singleton `_db` that is only reset once. If database connection is lost, reconnection is not automatic. The pattern `_db = null` at line 55 never gets called after initial setup.
- Files: `lib/db/index.js:9-26, 54-56`
- Impact: Long-running servers (>24 hours) may experience stale database connections. WAL mode (`journal_mode = WAL`) helps but doesn't handle connection pool exhaustion or database file locks.
- Fix approach: Implement connection health checks in cron job. Add retry logic with exponential backoff to `getDb()`. Consider using `better-sqlite3` connection pool options if available, or add graceful reconnect on error.

**Rate Limiter Memory Leak:**
- Issue: `api/index.js:22-54` implements in-memory rate limiting with `Map()` that stores timestamp arrays. While cleanup runs every 5 minutes (line 46-54), the Map can grow unbounded during high traffic, and stale IPs may accumulate between cleanup intervals.
- Files: `api/index.js:22-54`
- Impact: On high-traffic instances or under DDoS, memory usage grows linearly. No safeguards prevent the rate limiter itself from consuming significant RAM.
- Fix approach: Add maximum Map size enforcement. Consider using a time-series DB (Prometheus) or Redis for rate limiting instead. Add monitoring for rate limiter memory footprint.

**Message Persistence Best-Effort Silencing:**
- Issue: Database errors in `lib/ai/index.js:17-27` (persistMessage) are silently caught and logged only to console. If the SQLite database is locked or corrupted, messages don't get saved, but the chat continues as if nothing happened.
- Files: `lib/ai/index.js:17-27`
- Impact: Chat history can be incomplete or lost without user awareness. In critical workflows where message audit trail matters (compliance, legal), missing messages are undetectable.
- Fix approach: Surface database errors to user (e.g., "Chat history temporarily unavailable"). Implement circuit breaker pattern — after N consecutive failures, pause chat until DB recovers. Add monitoring alert for persistence failures.

**API Key Cache Invalidation Race Condition:**
- Issue: `lib/db/api-keys.js:31-48` uses a manual cache (`_cache`) that can get out of sync. If multiple processes call `verifyApiKey()` after a key rotation, some processes may see stale keys until all call `invalidateApiKeyCache()`.
- Files: `lib/db/api-keys.js:8-48, 53-55`
- Impact: In multi-process deployments (Vercel Edge Runtime, Docker Compose with multiple handlers), API key rotation may not take effect immediately. Legitimate requests could be rejected briefly or unauthorized requests could be accepted.
- Fix approach: Use shared cache layer (Redis) with TTL. Alternatively, always query DB without caching and use query-level caching if performance is critical. Document that key rotation requires restart in single-process deployments.

## Known Bugs

**Telegram Webhook Path Parsing Missing:**
- Symptoms: Telegram adapter receives `receive(request)` but does not validate that the request body is valid JSON before `await request.json()` at line 34 of `lib/channels/telegram.js`.
- Files: `lib/channels/telegram.js:34`
- Trigger: If Telegram webhook is misconfigured or a malicious actor sends malformed JSON, the adapter crashes without graceful error handling.
- Workaround: Wrap `request.json()` in try-catch. Current code assumes request is always valid JSON.

**Platform Detection Regex Too Loose:**
- Symptoms: `lib/ai/tools.js:15-19` detects platform from `threadId` using regex. Web UUIDs and numeric Telegram IDs cannot be distinguished if a user passes a numeric string as web chat ID.
- Files: `lib/ai/tools.js:15-19`
- Trigger: Create a web chat with ID `"12345"` (numeric). Job origin will be misdetected as Telegram.
- Workaround: None. Relies on channel adapters using specific formats. Future: add metadata field to `normalized` object.

**Unhandled Promise Rejection in File Download:**
- Symptoms: `lib/channels/telegram.js:95-118` downloads files and logs errors, but returns null implicitly. If download fails, `attachments` array may be incomplete without warning.
- Files: `lib/channels/telegram.js:65-72, 85-93, 96-106, 109-118`
- Trigger: Network timeout or invalid file_id causes silent attachment drop. User message is processed without the attachment they sent.
- Workaround: Check error logs. No in-app notification to user that attachment failed.

## Security Considerations

**API Key Hashing with SHA-256 Without Salt:**
- Risk: `lib/db/api-keys.js:24-26` hashes API keys using `createHash('sha256')` without salt. SHA-256 is fast, making rainbow table attacks feasible for low-entropy keys.
- Files: `lib/db/api-keys.js:24-26`
- Current mitigation: API keys are 32 random bytes (256 bits), high entropy. Timing-safe comparison prevents timing attacks.
- Recommendations: Consider PBKDF2 or Argon2 for extra security even though key entropy is high. Add rate limiting on `/api/create-job` and other endpoints that accept API keys.

**Webhook Secret Comparison Not Timing-Safe in Telegram:**
- Risk: `lib/channels/telegram.js:29-31` compares webhook secret using string equality (`!==`), not timing-safe comparison. Slack uses timing-safe comparison (`api/index.js:80-86`), but Telegram does not.
- Files: `lib/channels/telegram.js:29-31` vs `api/index.js:80-86`
- Current mitigation: `TELEGRAM_WEBHOOK_SECRET` is loaded from env, not user input.
- Recommendations: Import `timingSafeEqual` and use it in Telegram adapter.

**Unencrypted Stored API Key Prefix:**
- Risk: `lib/db/api-keys.js:70` stores `keyPrefix` (first 8 chars of API key) in the database. While the full key is hashed, the prefix is stored plaintext for display purposes.
- Files: `lib/db/api-keys.js:70, 114`
- Current mitigation: Prefix is only first 8 chars (4 random hex after `tpb_`), low entropy.
- Recommendations: Consider storing prefix separately or hashing it. Audit UI to ensure full key is never logged/displayed.

**Database Connection String in Logs:**
- Risk: If database path contains secrets or is on a network mount with credentials, the path could be logged in instrumentation or error messages.
- Files: `lib/db/index.js:21, 38`
- Current mitigation: ClawForge uses local SQLite file, no credentials in path.
- Recommendations: Sanitize database paths in error messages. Use `DATABASE_PATH` env var instead of hardcoded paths if deploying to multi-tenant environments.

**GitHub Token Not Scoped in Whitelist:**
- Risk: `lib/tools/github.js:8, 12` uses `GH_TOKEN` without documenting required scopes. If token has full admin access, a compromised job container can delete repos, disable branch protection, or modify secrets.
- Files: `lib/tools/github.js:8, 12, 28-32`
- Current mitigation: Job container runs in isolated Docker network. GitHub token is not passed to Claude Code CLI (uses `AGENT_GH_TOKEN` prefix to filter).
- Recommendations: Document minimum required GitHub token scopes (e.g., `repo:read`, `actions:read`). Use fine-grained personal access tokens with scope limits. Audit `GH_TOKEN` rotation policy.

**Job Description Passed as User Input to Claude Code:**
- Risk: `lib/tools/create-job.js:9-38` writes user-provided job description directly to `logs/{jobId}/job.md` without validation. If description contains shell metacharacters or malicious Claude Code directives, it could trigger unintended behavior.
- Files: `lib/tools/create-job.js:21-35`
- Current mitigation: Claude Code CLI runs in sandboxed job container with `--allowedTools` whitelist.
- Recommendations: Add input validation/sanitization for job descriptions. Consider length limits (e.g., max 10KB). Log job descriptions for audit trail.

## Performance Bottlenecks

**GitHub API Rate Limiting Not Implemented:**
- Problem: `lib/tools/github.js` makes multiple API calls without batching or rate limit awareness. `getJobStatus()` calls `getWorkflowRunJobs()` for each run (line 80-81), multiplying API calls.
- Files: `lib/tools/github.js:62-125`
- Cause: No caching of workflow run data. Each call to `get_job_status` tool can make 10+ API calls. GitHub has rate limits: 5,000 requests/hour (authenticated).
- Improvement path: Implement client-side rate limit tracking. Cache workflow data for 30 seconds. Batch workflow runs queries. Use GraphQL API instead of REST for more efficient querying.

**Attachment Download and Transcription Blocking:**
- Problem: `lib/channels/telegram.js:65-93` downloads files and transcribes audio synchronously. Transcript API call (OpenAI Whisper) blocks the entire message handler.
- Files: `lib/channels/telegram.js:56-93`
- Cause: No async queue or background job for transcription.
- Improvement path: Move transcription to background queue (Bull, RabbitMQ, or simple Redis queue). Return a placeholder message to user while transcription happens asynchronously. Notify user when transcription completes.

**Database Query Without Indexes:**
- Problem: `lib/db/chats.js` (referenced in `lib/chat/actions.js:40-45`) queries all chats for a user without explicit indexes. Large user chat histories will do full table scans.
- Files: `lib/db/schema.js:12-19` (no indexes defined on `userId` or `createdAt`)
- Cause: Drizzle schema doesn't define indexes. SQLite will scan all rows.
- Improvement path: Add indexes on `userId`, `createdAt` in schema. Run `db:generate` to create migration. Benchmark queries on 10k+ chats.

**SQLite WAL Mode Unbounded Checkpoints:**
- Problem: `lib/db/index.js:22` enables WAL mode but doesn't configure checkpoint strategy. WAL files can grow large on high-write workloads.
- Files: `lib/db/index.js:22`
- Cause: Default WAL checkpoint is passive (background). No explicit pragma for checkpoint frequency.
- Improvement path: Add `pragma("wal_autocheckpoint = 100")` to configure checkpoint interval. Monitor WAL file size in production. Consider PRAGMA `journal_size_limit`.

## Fragile Areas

**LangChain Message Streaming Parsing:**
- Files: `lib/ai/index.js:141-189`
- Why fragile: Code relies on undocumented LangChain streaming format (`streamMode: 'messages'` yields `[message, metadata]` tuples). If LangChain updates stream format, code breaks silently.
- Safe modification: Add version lock in package.json for `@langchain/langgraph`. Add unit tests that validate stream format (e.g., assert message._getType exists). Wrap stream parsing in try-catch with fallback.
- Test coverage: No tests for `chatStream()`. Stream format changes would be undetected until runtime.

**SQL Injection Risk in Dynamic Schema Imports:**
- Files: `lib/chat/actions.js:36-39` (dynamic import of Drizzle modules)
- Why fragile: Dynamic imports are necessary but obscure. If schema or Drizzle import changes, imports fail at runtime.
- Safe modification: Add type validation before using imported modules. Consider static imports if possible (bundle size impact).
- Test coverage: No unit tests validating schema imports work at runtime.

**Job Branch Naming Dependency:**
- Files: `lib/ai/tools.js:15-19`, `lib/tools/github.js:71-76`
- Why fragile: Job ID detection relies on branch naming convention `job/{uuid}`. If a user manually creates a branch matching this pattern, it will be treated as a job.
- Safe modification: Use GitHub issue/PR labels instead of branch naming. Add metadata file `.github/job-metadata.json` with job info. Document branch naming as internal API.
- Test coverage: No tests for edge cases (user creates `job/fake-id`).

**File Download in Channel Adapters:**
- Files: `lib/channels/telegram.js:66, 86, 99, 111`, `lib/tools/telegram.js` (not shown but called)
- Why fragile: Downloading large files without timeout or size limits. Malicious actor could send 500MB file, blocking the handler.
- Safe modification: Add timeout (5 seconds) and size limit (50MB) to file downloads. Stream downloads instead of buffering full file. Add circuit breaker if download fails.
- Test coverage: No tests for large file scenarios or timeouts.

## Scaling Limits

**SQLite Concurrent Write Limit:**
- Current capacity: SQLite supports ~1 concurrent write with WAL mode (multiple readers, 1 writer). ClawForge architecture avoids this by using SQLite only for metadata (chats, messages), not high-frequency operations.
- Limit: If you add real-time collaborative features or high-frequency updates, SQLite will become bottleneck.
- Scaling path: Migrate to PostgreSQL before scaling to 10k+ concurrent users. For now, SQLite is fine for <1000 daily active users.

**Docker Job Container Concurrency:**
- Current capacity: Limited by available system resources (CPU, memory, disk). Each job needs ~500MB RAM, 2 GB workspace disk.
- Limit: 16 concurrent jobs on 8-core, 16GB machine. Beyond that, queue backlog grows.
- Scaling path: Implement job queue with priority levels. Distribute jobs across multiple workers. Use Kubernetes for elastic scaling.

**GitHub API Rate Limits:**
- Current capacity: 5,000 requests/hour (authenticated).
- Limit: `getJobStatus()` tool can exhaust quota with ~500 concurrent status checks.
- Scaling path: Implement GitHub API caching layer. Use GraphQL API (more efficient). Implement rate limit awareness in agent tools.

**LangGraph Checkpoint SQLite Storage:**
- Current capacity: Checkpoints stored in SQLite `@langchain/langgraph-checkpoint-sqlite`. Each conversation thread creates checkpoints.
- Limit: SQLite checkpoint storage is not optimized for 1000+ concurrent threads.
- Scaling path: Migrate to PostgreSQL checkpointer (`@langchain/langgraph-checkpoint-postgres`) or Redis. For now, archive old checkpoints.

## Dependencies at Risk

**LangChain Breaking Changes:**
- Risk: `@langchain/*` packages (lines 1-6 in `lib/ai/agent.js`, `lib/ai/tools.js`, `lib/ai/index.js`) are pre-1.0 and may have breaking changes between minor versions.
- Impact: `.tool()` API, `.stream()` mode, checkpoint format could change. Streaming parsing (line 141-189 in `lib/ai/index.js`) is especially vulnerable.
- Migration plan: Pin `@langchain/*` packages to exact versions in package.json (currently using `^`). Monitor LangChain releases. Add integration tests for agent streaming. Consider moving to LangChain v1.0+ stable once available.

**SQLite via better-sqlite3 (Native Binding):**
- Risk: `better-sqlite3` is a native Node.js module (compiled C++). It requires compilation on install. On systems with mismatched Node/libc versions, installation fails silently.
- Impact: Deployments to Alpine Linux, older glibc, or ARM64 may fail. Docker builds for `node:22-bookworm-slim` work fine, but other base images are risky.
- Migration plan: Test Docker builds on target platform before production. Use `npm ci` instead of `npm install` for reproducibility. Add prebuilt binaries to artifact cache if possible.

**next-auth v5 Beta:**
- Risk: `next-auth` in package.json is `"^5.0.0-beta.30"`. Beta versions may have security issues or breaking API changes.
- Impact: If ClawForge reaches production, running beta auth library poses risk.
- Migration plan: Upgrade to `next-auth@5.x` stable when released. Add periodic security audits for next-auth. Consider adding SAML/OAuth support if needed (next-auth v5 improvements).

## Missing Critical Features

**No Audit Trail for Administrative Actions:**
- Problem: No logging of API key creation/deletion, user registration, or config changes. If a security incident occurs, cannot trace who did what.
- Blocks: Compliance workflows, security investigations.
- Recommendation: Implement audit table in `lib/db/schema.js`. Log all state changes with timestamp, user, action, old/new values. Expose audit log in admin UI.

**No Job Timeout/Cancellation:**
- Problem: Job containers run indefinitely. If Claude Code CLI hangs, job runs until GitHub Actions timeout (6 hours). No manual cancel.
- Blocks: Stopping stuck jobs without re-deploying.
- Recommendation: Implement job timeout in `templates/.github/workflows/run-job.yml`. Add cancel endpoint to `/api/cancel-job/{jobId}`. Implement graceful shutdown in job container.

**No Multi-Instance Job Distribution:**
- Problem: All jobs route to single GitHub Actions runner pool. No load balancing or worker pool orchestration.
- Blocks: Scaling to 100+ concurrent jobs.
- Recommendation: Implement job queue with worker pool (BullMQ, Temporal, or GitHub Actions matrix). Distribute jobs across multiple runners.

**No Chat Export or Backup:**
- Problem: Chat history is only stored in SQLite. No automatic backup, export, or disaster recovery.
- Blocks: Data preservation if instance crashes.
- Recommendation: Add chat export (JSON, markdown) to UI. Implement automated SQLite backups to cloud storage (S3, GCS). Add restore from backup feature.

## Test Coverage Gaps

**Agent/Tool Integration Not Tested:**
- What's not tested: `lib/ai/agent.js`, `lib/ai/tools.js` interaction with `createReactAgent`. The agent flow (tool loop, retries, failures) has no test coverage.
- Files: `lib/ai/agent.js`, `lib/ai/tools.js`, `lib/ai/index.js`
- Risk: Agent may fail silently on tool errors, loop infinitely, or hallucinate tool results. Bugs only surface in production.
- Priority: High

**Channel Adapter Message Normalization Not Tested:**
- What's not tested: `lib/channels/telegram.js:receive()` and `lib/channels/slack.js:receive()` don't have unit tests. Edge cases (missing fields, malformed JSON, invalid attachments) are untested.
- Files: `lib/channels/telegram.js`, `lib/channels/slack.js`, `lib/channels/base.js`
- Risk: Malformed channel messages crash adapters or get silently dropped.
- Priority: High

**Database Transactions and Constraints Not Tested:**
- What's not tested: `lib/db/users.js:60-79` uses transactions but has no test coverage. Constraint violations (duplicate email, foreign key) are untested.
- Files: `lib/db/users.js`, `lib/db/api-keys.js`, `lib/db/chats.js`
- Risk: Race conditions in user creation, API key rotation. Database constraints are not validated before use.
- Priority: High

**Rate Limiting Edge Cases Not Tested:**
- What's not tested: `api/index.js:26-43` rate limiter has no tests. Concurrent requests, clock skew, stale entry cleanup are untested.
- Files: `api/index.js:26-54`
- Risk: Rate limiter may fail under load or allow bypass.
- Priority: Medium

**Streaming Message Format Not Tested:**
- What's not tested: `lib/ai/index.js:141-189` chat stream parsing assumes LangChain message format. No validation that messages have expected structure.
- Files: `lib/ai/index.js:141-189`
- Risk: Stream parsing crashes if LangChain format changes.
- Priority: Medium

---

*Concerns audit: 2025-02-23*
