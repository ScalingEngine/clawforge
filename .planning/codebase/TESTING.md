# Testing Patterns

**Analysis Date:** 2026-02-23

## Test Framework

**Status:** No tests currently configured

**Placeholder:**
From `package.json`:
```json
"test": "echo \"No tests yet\" && exit 0"
```

**No test framework installed:**
- Jest, Vitest, or similar testing runners not in `dependencies` or `devDependencies`
- No test config files detected (no `jest.config.*`, no `vitest.config.*`)
- No `.spec.*` or `.test.*` files in codebase

## Test File Organization

**When tests are added, follow this structure:**

**Location Pattern: Colocated with source**
```
lib/db/
├── chats.js          ← source
├── chats.test.js     ← tests (colocated)
├── schema.js
├── schema.test.js
└── index.js
```

Rationale: Easier to find tests, single import path for both, tests stay with source during refactoring.

**Naming:**
- Test files: `{module}.test.js` (not `.spec.js`)
- Test suites: Describe the module: `describe('chats', () => { ... })`
- Test cases: Describe behavior: `it('creates a chat with generated UUID', () => { ... })`

**Test Folder Alternative (if preferred):**
```
lib/
├── db/
│   ├── chats.js
│   └── schema.js
└── __tests__/
    ├── db/
    │   ├── chats.test.js
    │   └── schema.test.js
```

## Test Structure

**Recommended Test Suite Organization:**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'; // or jest
import { createChat, getChatById, updateChatTitle, deleteChat } from '../lib/db/chats.js';
import { getDb } from '../lib/db/index.js';

describe('chats', () => {
  let db;

  beforeEach(() => {
    // Set up: get fresh DB for each test
    db = getDb();
  });

  afterEach(() => {
    // Tear down: clean up test data if needed
    // (Skip if DB is in-memory or isolated per test)
  });

  describe('createChat', () => {
    it('creates a chat with generated UUID', () => {
      const chat = createChat('user-123', 'Test Chat');
      expect(chat.id).toBeDefined();
      expect(chat.userId).toBe('user-123');
      expect(chat.title).toBe('Test Chat');
      expect(chat.createdAt).toBeGreaterThan(0);
    });

    it('accepts optional ID parameter', () => {
      const customId = 'my-chat-id';
      const chat = createChat('user-123', 'Test', customId);
      expect(chat.id).toBe(customId);
    });
  });

  describe('getChatById', () => {
    it('returns undefined for non-existent chat', () => {
      const chat = getChatById('missing-id');
      expect(chat).toBeUndefined();
    });

    it('retrieves created chat', () => {
      const created = createChat('user-123', 'Found Me');
      const retrieved = getChatById(created.id);
      expect(retrieved.title).toBe('Found Me');
    });
  });
});
```

**Patterns:**

- **Setup/teardown:** Use `beforeEach`/`afterEach` for isolation
- **Assertions:** Prefer `expect()` over assertions
- **Nested describes:** Organize by function and behavior
- **Meaningful names:** `it('returns undefined for non-existent chat')` not `it('test getChatById')`

## Mocking

**Framework Recommendation:** Vitest (compatible with Jest API)

**When to Mock:**

**DO mock:**
- External HTTP calls (GitHub API, Telegram API, Slack API) → use `fetch` mock
- LLM model responses → mock `createModel()` or mock LangChain classes
- Date/time → use `vi.useFakeTimers()`
- File system for config loading → mock `fs`

**DON'T mock:**
- Database (use in-memory SQLite or test database)
- Local modules that are testable in isolation
- Simple helper functions (test them directly)
- Channel adapters receiving webhook data (test with real webhook payloads)

**Example: Mocking GitHub API**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createJob } from '../lib/tools/create-job.js';

vi.mock('node:fetch'); // Mock fetch globally

describe('createJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock GitHub API responses
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ object: { sha: 'abc123' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ object: { sha: 'abc123' } })
      });
  });

  it('creates a job branch with job.md', async () => {
    process.env.GH_OWNER = 'test-owner';
    process.env.GH_REPO = 'test-repo';
    process.env.GH_TOKEN = 'test-token';

    const result = await createJob('Test job description');

    expect(result.job_id).toBeDefined();
    expect(result.branch).toMatch(/^job\//);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/repos/test-owner/test-repo/'),
      expect.any(Object)
    );
  });
});
```

**Example: Mocking LLM Model**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { chat } from '../lib/ai/index.js';

vi.mock('../lib/ai/agent.js', () => ({
  getAgent: vi.fn(() => ({
    invoke: vi.fn(() => Promise.resolve({
      messages: [{
        content: 'Test response',
        _getType: () => 'ai'
      }]
    }))
  }))
}));

describe('chat', () => {
  it('processes a user message and returns AI response', async () => {
    const response = await chat('thread-1', 'Hello');
    expect(response).toBe('Test response');
  });
});
```

**Spy Pattern (Verify behavior without full mock):**

```javascript
import { describe, it, expect, vi, spyOn } from 'vitest';
import { persistMessage, chat } from '../lib/ai/index.js';

describe('chat', () => {
  it('saves user message before processing', async () => {
    const persistSpy = spyOn(module, 'persistMessage');
    await chat('thread-1', 'Hello');
    expect(persistSpy).toHaveBeenCalledWith('thread-1', 'user', 'Hello', expect.any(Object));
  });
});
```

## Fixtures and Factories

**Test Data:**

Store reusable test data in a separate file:

**File: `lib/__tests__/fixtures.js`**
```javascript
import { randomUUID } from 'crypto';

export function createTestUser(overrides = {}) {
  return {
    id: randomUUID(),
    email: `test-${Date.now()}@example.com`,
    passwordHash: 'hashed-password-here',
    role: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createTestChat(overrides = {}) {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    title: 'Test Chat',
    starred: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createTestMessage(overrides = {}) {
  return {
    id: randomUUID(),
    chatId: randomUUID(),
    role: 'user',
    content: 'Test message',
    createdAt: Date.now(),
    ...overrides,
  };
}

export function createTestJobOrigin(overrides = {}) {
  return {
    jobId: randomUUID(),
    threadId: randomUUID(),
    platform: 'telegram',
    createdAt: Date.now(),
    ...overrides,
  };
}
```

**Usage in tests:**

```javascript
import { describe, it, expect } from 'vitest';
import { createTestChat, createTestMessage } from './__tests__/fixtures.js';

describe('chats', () => {
  it('preserves custom attributes', () => {
    const chat = createTestChat({ title: 'Custom Title', starred: 1 });
    expect(chat.title).toBe('Custom Title');
    expect(chat.starred).toBe(1);
  });
});
```

**Location:**
- `lib/__tests__/fixtures.js` ← Central fixtures for all db module tests
- `lib/channels/__tests__/fixtures.js` ← Channel-specific test data
- `lib/ai/__tests__/fixtures.js` ← LLM response fixtures

## Coverage

**Requirements:** None enforced

**Recommended targets (when tests are added):**
- Critical paths (auth, job creation, message persistence): 80%+
- Utility/helper functions: 100%
- Channel adapters: 70%+ (integration tests may be harder)
- Database layer: 90%+ (fast to test, high value)

**View Coverage:**
```bash
vitest --coverage
# or
npm run test:coverage
```

**In package.json (once tests exist):**
```json
"scripts": {
  "test": "vitest",
  "test:watch": "vitest --watch",
  "test:coverage": "vitest --coverage",
  "test:ui": "vitest --ui"
}
```

## Test Types

**Unit Tests:**

Test single functions in isolation with mocked dependencies.

**Scope:** One function, one behavior
**Approach:** Mock external calls (fetch, LLM, filesystem), test happy path + error cases

Example: `lib/db/chats.js::getChatById()`
- Happy path: returns chat when found
- Edge case: returns undefined when not found
- No DB mocking needed (test directly against in-memory DB)

**Integration Tests:**

Test multiple functions working together, real database.

**Scope:** A workflow (e.g., create chat → save message → retrieve messages)
**Approach:** Use real SQLite in-memory DB, no mocking of application code

Example: Chat persistence workflow
```javascript
describe('chat persistence workflow', () => {
  it('creates chat, saves message, retrieves all', () => {
    const chat = createChat('user-1', 'My Chat');
    saveMessage(chat.id, 'user', 'Hello');
    saveMessage(chat.id, 'assistant', 'Hi there');

    const messages = getMessagesByChatId(chat.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });
});
```

**E2E Tests:**

Test full flows through real API endpoints (not currently in use).

**Framework:** Not implemented
**When to add:** After API layer stabilizes, use `supertest` or `vitest` with `fetch` to test:
- Job creation endpoint returns job ID
- Webhook validation (Telegram signature, Slack signing secret)
- Rate limiting works correctly

**Example structure (future):**
```javascript
import request from 'supertest';

describe('POST /api/create-job', () => {
  it('rejects request without x-api-key header', async () => {
    const res = await request(app).post('/api/create-job').send({});
    expect(res.status).toBe(401);
  });
});
```

## Common Patterns

**Async Testing:**

```javascript
// Using async/await
it('resolves with chat response', async () => {
  const response = await chat('thread-1', 'Hello');
  expect(response).toContain('text');
});

// Using done() callback (older style, not preferred)
it('handles callback', (done) => {
  chat('thread-1', 'Hello').then(response => {
    expect(response).toBeDefined();
    done();
  });
});

// Using returnPromise (implicit)
it('returns a promise', () => {
  return chat('thread-1', 'Hello').then(response => {
    expect(response).toBeDefined();
  });
});
```

**Error Testing:**

```javascript
// Test synchronous error
it('throws when API key missing', () => {
  delete process.env.ANTHROPIC_API_KEY;
  expect(() => createModel()).toThrow('ANTHROPIC_API_KEY environment variable is required');
});

// Test async error
it('rejects with error message', async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error('Network failed'));
  await expect(createJob('test')).rejects.toThrow('Network failed');
});

// Test error handling (graceful)
it('logs error but does not throw', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  await persistMessage('thread-1', 'user', 'Hello', {}); // DB will fail safely
  expect(consoleSpy).toHaveBeenCalled();
  consoleSpy.mockRestore();
});
```

**Stream Testing:**

```javascript
it('yields text chunks from stream', async () => {
  const chunks = [];
  for await (const chunk of chatStream('thread-1', 'Hello')) {
    chunks.push(chunk);
  }
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0].type).toMatch(/text|tool-call/);
});
```

**Testing Webhooks (Channel Adapters):**

```javascript
describe('TelegramAdapter', () => {
  it('rejects invalid webhook signature', async () => {
    const adapter = new TelegramAdapter('bot-token');
    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'x-telegram-bot-api-secret-token': 'wrong-secret'
      },
      body: JSON.stringify({ message: {} })
    });
    const result = await adapter.receive(request);
    expect(result).toBeNull();
  });

  it('parses valid telegram message', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';
    process.env.TELEGRAM_CHAT_ID = '12345';

    const adapter = new TelegramAdapter('bot-token');
    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'x-telegram-bot-api-secret-token': 'correct-secret'
      },
      body: JSON.stringify({
        message: {
          chat: { id: '12345' },
          text: 'Hello',
          message_id: 1
        }
      })
    });

    const result = await adapter.receive(request);
    expect(result.text).toBe('Hello');
    expect(result.threadId).toBe('12345');
  });
});
```

---

*Testing analysis: 2026-02-23*
