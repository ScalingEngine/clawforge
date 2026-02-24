# Coding Conventions

**Analysis Date:** 2026-02-23

## Naming Patterns

**Files:**
- Kebab-case for most files: `chat-page.jsx`, `create-job.js`, `api-keys.js`
- camelCase for component exports: `ChatPage`, `TelegramAdapter`
- Index files: `index.js` for barrel exports (e.g., `lib/channels/index.js`, `lib/db/index.js`)
- Config files: UPPERCASE for important configs: `CRONS.json`, `TRIGGERS.json`, `SOUL.md`

**Functions:**
- camelCase for all functions: `createChat()`, `getChatById()`, `saveMessage()`
- Async functions explicitly marked: `async function chat()`, `async function createJob()`
- Getter functions use `get` prefix: `getDb()`, `getAgent()`, `getChatsByUser()`
- Creator/setter functions use `create`/`update`/`delete` prefix: `createChat()`, `updateChatTitle()`, `deleteChat()`
- Toggle functions use `toggle` prefix: `toggleChatStarred()`
- Factory functions: `getTelegramAdapter()`, `getSlackAdapter()` return instances based on config

**Variables:**
- camelCase for all variables and parameters: `jobId`, `botToken`, `threadId`, `chatTitle`
- Constants use UPPER_SNAKE_CASE: `MAX_LENGTH`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `DEFAULT_MODELS`
- Private/internal singletons prefixed with underscore: `_db`, `_agent`, `_fireTriggers`, `telegramBotToken`
- Destructure from objects inline: `const { GH_OWNER, GH_REPO } = process.env`

**Types:**
- JSDoc for parameter and return types: `@param {string} threadId`, `@returns {Promise<string>}`
- Generics in inline comments: `{import('drizzle-orm/better-sqlite3').BetterSQLite3Database}`
- Object shape documented in JSDoc: `{ threadId: string, text: string, attachments: Array }`

## Code Style

**Formatting:**
- No linter or formatter configured (no `.eslintrc`, no `.prettierrc`)
- Code follows consistent manual formatting conventions:
  - 2-space indentation (inferred from source)
  - No semicolons at end of lines (optional in JS)
  - Trailing commas in multiline objects/arrays
  - Line breaks for readability in long function calls

**File Structure:**
- Imports first (all on top)
- Exports last (usually at bottom or `export` inline)
- Main implementation in middle
- Helper functions defined before use or at end

**Linting:**
- No linter enforced
- No type checking (plain JavaScript, no TypeScript)
- No pre-commit hooks detected

## Import Organization

**Order:**
1. Node.js built-in modules: `import { exec } from 'child_process'`, `import { randomUUID } from 'crypto'`
2. External packages: `import { HumanMessage } from '@langchain/core/messages'`, `import { clsx } from 'clsx'`
3. Internal lib imports: `import { chat } from '../lib/ai/index.js'`, `import { getDb } from './index.js'`
4. Relative sibling imports: `import { ChannelAdapter } from './base.js'`

**Path Aliases:**
- No TypeScript path aliases configured
- Relative imports use explicit paths: `./index.js`, `../lib/`, `../../config/`
- Absolute imports rare; local imports preferred for clarity

**Import Style:**
- Named imports preferred: `import { createChat } from '../db/chats.js'`
- Default imports for component classes: `import Database from 'better-sqlite3'`
- Mix of named and default acceptable when sensible

## Error Handling

**Patterns:**

**Graceful degradation (best-effort):**
```javascript
// From lib/ai/index.js - DB persistence is best-effort
function persistMessage(threadId, role, text, options = {}) {
  try {
    if (!getChatById(threadId)) {
      createChat(options.userId || 'unknown', options.chatTitle || 'New Chat', threadId);
    }
    saveMessage(threadId, role, text);
  } catch (err) {
    // DB persistence is best-effort — don't break chat if DB fails
    console.error('Failed to persist message:', err);
  }
}
```

**Fire-and-forget async operations:**
```javascript
// From lib/ai/index.js - auto-title generation with error swallowing
autoTitle(threadId, message).catch(() => {});
```

**Environment variable validation at startup:**
```javascript
// From lib/ai/model.js - throw early for missing required config
if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}
```

**Webhook authentication errors return null (silent rejection):**
```javascript
// From lib/channels/telegram.js
if (headerSecret !== TELEGRAM_WEBHOOK_SECRET) {
  return null; // Invalid signature — return null, don't throw
}
```

**User-facing errors via channel message:**
```javascript
// From lib/channels/telegram.js
if (!isWhisperEnabled()) {
  await sendMessage(this.botToken, chatId, 'Voice messages are not supported...');
  return null; // Tell user, don't throw
}
```

**Promise rejection handling:**
```javascript
// From lib/db/notifications.js - fire async task, log if fails
distributeNotification(notificationText).catch((err) => {
  console.error('Failed to distribute notification:', err);
});
```

## Logging

**Framework:** Native `console` object, no dedicated logging library

**Patterns:**

**Section/module prefix in brackets:**
```javascript
console.error('[telegram] TELEGRAM_WEBHOOK_SECRET not configured — rejecting webhook');
console.error('[slack] Invalid request signature — rejecting');
console.error('[chatStream] error:', err);
console.error('[autoTitle] Failed to generate title:', err.message);
```

**Contextual error logging:**
```javascript
// Include the specific failed operation
console.error('Failed to transcribe voice:', err);
console.error('Failed to persist message:', err);
console.error(`Failed to download photo:`, err);
```

**When to log:**
- Errors that are caught and handled gracefully
- Validation failures or security rejections
- Best-effort operations that fail silently
- Do NOT log in critical path unless debugging

## Comments

**When to Comment:**
- Complex algorithms: markdown-to-HTML conversion in `lib/tools/telegram.js` uses step-by-step comments
- Non-obvious logic: placeholder system in `markdownToTelegramHtml()` has explanation comments
- Security decisions: "Security: only accept messages from configured chat" in Telegram adapter
- Caveats: "import.meta.url doesn't survive webpack bundling" in `lib/db/index.js`
- Business rules: "DB persistence is best-effort" in `lib/ai/index.js`

**Avoid commenting:**
- Self-explanatory code
- What the code does (use better naming)
- Obvious if-statements or loops

**JSDoc/TSDoc:**
- All exported functions have JSDoc blocks
- Format: `/**` opening, `*` on each line, `*/` closing
- `@param` for each parameter with type and description
- `@returns` for return value with type and description
- `@deprecated` for obsolete functions (not used in codebase)

Example from `lib/channels/base.js`:
```javascript
/**
 * Handle an incoming webhook request from this channel.
 * Returns normalized message data or null if no action needed.
 *
 * @param {Request} request - Incoming HTTP request
 * @returns {Promise<{ threadId: string, text: string, attachments: Array, metadata: object } | null>}
 */
```

Example from `lib/db/chats.js`:
```javascript
/**
 * Save a message to a chat. Also updates the chat's updatedAt timestamp.
 * @param {string} chatId
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content
 * @param {string} [id] - Optional message ID
 * @returns {object} The created message
 */
export function saveMessage(chatId, role, content, id = null) {
```

## Function Design

**Size:** Most functions 10-50 lines; larger functions break down by concern:
- `chatStream()` in `lib/ai/index.js` is ~100 lines but handles single concern (streaming messages)
- Multi-step async functions may be longer if each step is sequential

**Parameters:**
- Positional for required params: `createChat(userId, title)`
- Options object for multiple optional params: `createModel(options = {})`
- Destructuring in function body for clarity: `const { GH_OWNER, GH_REPO } = process.env`

**Return Values:**
- Functions returning created objects return the object: `return chat` from `createChat()`
- Functions returning status return object with named fields: `{ job_id: jobId, branch }`
- Async functions return Promise<T>: `Promise<string>`, `Promise<object[]>`
- Stream functions use async generators: `async function* chatStream()`

**Error behavior:**
- Constructor functions (getters) throw on missing config
- Handlers (receive, sendResponse) return null on skip, throw on actual error
- Server actions throw on auth/validation failure
- Notifications/fire-and-forget operations catch and log

## Module Design

**Exports:**
- Named exports preferred: `export function createChat()`
- Default export rare (only for classes: `export { ChannelAdapter }`)
- Barrel files (`index.js`) re-export public API: `export { chat, chatStream, summarizeJob, addToThread, persistMessage }`
- Private implementation details not exported

**Barrel Files:**
- `lib/channels/index.js`: exports `getTelegramAdapter()`, `getSlackAdapter()`
- `lib/db/index.js`: exports `getDb()`, `initDatabase()`
- `lib/ai/index.js`: exports all AI functions: `chat`, `chatStream`, `summarizeJob`, `addToThread`, `persistMessage`
- Channel-specific exports kept private

**Module responsibilities (single concern):**
- `lib/db/chats.js`: only chat/message CRUD
- `lib/channels/telegram.js`: only Telegram webhook handling
- `lib/tools/github.js`: only GitHub API calls
- `lib/ai/index.js`: only AI message processing and persistence

**Singleton patterns:**
- Database: `_db` in `lib/db/index.js`, lazy-initialized on first `getDb()` call
- Agent: `_agent` in `lib/ai/agent.js`, lazy-initialized on first `getAgent()` call
- Telegram bot token: cached in `api/index.js`, refreshed by `/telegram/register`
- Rate limiter: in-memory Map in `api/index.js`, cleaned periodically

---

*Convention analysis: 2026-02-23*
