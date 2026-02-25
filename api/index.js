import { createHash, timingSafeEqual } from 'crypto';
import { createJob } from '../lib/tools/create-job.js';
import { setWebhook } from '../lib/tools/telegram.js';
import { getJobStatus } from '../lib/tools/github.js';
import { getTelegramAdapter, getSlackAdapter } from '../lib/channels/index.js';
import { chat, summarizeJob, addToThread } from '../lib/ai/index.js';
import { createNotification } from '../lib/db/notifications.js';
import { getJobOrigin } from '../lib/db/job-origins.js';
import { saveJobOutcome } from '../lib/db/job-outcomes.js';
import { loadTriggers } from '../lib/triggers.js';
import { verifyApiKey } from '../lib/db/api-keys.js';

// Bot token from env, can be overridden by /telegram/register
let telegramBotToken = null;

// Cached trigger firing function (initialized on first request)
let _fireTriggers = null;

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter — sliding window per IP, per route
// ─────────────────────────────────────────────────────────────────────────────

const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute per IP per route

function checkRateLimit(ip, route) {
  const key = `${ip}:${route}`;
  const now = Date.now();
  let timestamps = rateLimitStore.get(key);
  if (!timestamps) {
    timestamps = [];
    rateLimitStore.set(key, timestamps);
  }
  // Remove expired entries
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }
  timestamps.push(now);
  return true;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitStore) {
    while (timestamps.length > 0 && timestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
      timestamps.shift();
    }
    if (timestamps.length === 0) rateLimitStore.delete(key);
  }
}, 300_000);

function getTelegramBotToken() {
  if (!telegramBotToken) {
    telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || null;
  }
  return telegramBotToken;
}

function getFireTriggers() {
  if (!_fireTriggers) {
    const result = loadTriggers();
    _fireTriggers = result.fireTriggers;
  }
  return _fireTriggers;
}

// Routes that have their own authentication
const PUBLIC_ROUTES = ['/telegram/webhook', '/github/webhook', '/slack/events', '/ping'];

/**
 * Timing-safe string comparison.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Centralized auth gate for all API routes.
 * Public routes pass through; everything else requires a valid API key from the database.
 * @param {string} routePath - The route path
 * @param {Request} request - The incoming request
 * @returns {Response|null} - Error response or null if authorized
 */
function checkAuth(routePath, request) {
  if (PUBLIC_ROUTES.includes(routePath)) return null;

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = verifyApiKey(apiKey);
  if (!record) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * Extract job ID from branch name (e.g., "job/abc123" -> "abc123")
 */
function extractJobId(branchName) {
  if (!branchName || !branchName.startsWith('job/')) return null;
  return branchName.slice(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleWebhook(request) {
  const body = await request.json();
  const { job } = body;
  if (!job) return Response.json({ error: 'Missing job field' }, { status: 400 });

  try {
    const result = await createJob(job);
    return Response.json(result);
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to create job' }, { status: 500 });
  }
}

async function handleTelegramRegister(request) {
  const body = await request.json();
  const { bot_token, webhook_url } = body;
  if (!bot_token || !webhook_url) {
    return Response.json({ error: 'Missing bot_token or webhook_url' }, { status: 400 });
  }

  try {
    const result = await setWebhook(bot_token, webhook_url, process.env.TELEGRAM_WEBHOOK_SECRET);
    telegramBotToken = bot_token;
    return Response.json({ success: true, result });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to register webhook' }, { status: 500 });
  }
}

async function handleTelegramWebhook(request) {
  const botToken = getTelegramBotToken();
  if (!botToken) return Response.json({ ok: true });

  const adapter = getTelegramAdapter(botToken);
  const normalized = await adapter.receive(request);
  if (!normalized) return Response.json({ ok: true });

  // Process message asynchronously (don't block the webhook response)
  processChannelMessage(adapter, normalized, { userId: 'telegram', chatTitle: 'Telegram' }).catch((err) => {
    console.error('Failed to process message:', err);
  });

  return Response.json({ ok: true });
}

/**
 * Process a normalized message through the AI layer with channel UX.
 * Message persistence is handled centrally by the AI layer.
 *
 * @param {ChannelAdapter} adapter
 * @param {object} normalized - { threadId, text, attachments, metadata }
 * @param {object} [channelContext] - { userId, chatTitle } for AI layer
 */
async function processChannelMessage(adapter, normalized, channelContext = { userId: 'unknown', chatTitle: 'Unknown' }) {
  await adapter.acknowledge(normalized.metadata);
  const stopIndicator = adapter.startProcessingIndicator(normalized.metadata);

  try {
    const response = await chat(
      normalized.threadId,
      normalized.text,
      normalized.attachments,
      channelContext
    );
    await adapter.sendResponse(normalized.threadId, response, normalized.metadata);
  } catch (err) {
    console.error('Failed to process message with AI:', err);
    await adapter
      .sendResponse(
        normalized.threadId,
        'Sorry, I encountered an error processing your message.',
        normalized.metadata
      )
      .catch(() => {});
  } finally {
    stopIndicator();
  }
}

async function handleSlackEvents(request) {
  const { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_ALLOWED_USERS, SLACK_ALLOWED_CHANNELS, SLACK_REQUIRE_MENTION } = process.env;

  if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
    console.error('[slack] SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET not configured');
    return Response.json({ error: 'Slack not configured' }, { status: 500 });
  }

  const allowedUserIds = SLACK_ALLOWED_USERS
    ? SLACK_ALLOWED_USERS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const allowedChannelIds = SLACK_ALLOWED_CHANNELS
    ? SLACK_ALLOWED_CHANNELS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const adapter = getSlackAdapter({
    botToken: SLACK_BOT_TOKEN,
    signingSecret: SLACK_SIGNING_SECRET,
    allowedUserIds,
    allowedChannelIds,
    requireMention: SLACK_REQUIRE_MENTION === 'true',
  });

  const result = await adapter.receive(request);

  // URL verification challenge — must respond synchronously
  if (result && result.type === 'url_verification') {
    return Response.json({ challenge: result.challenge });
  }

  if (!result) return Response.json({ ok: true });

  // Process message asynchronously (don't block the webhook response)
  processChannelMessage(adapter, result, { userId: 'slack', chatTitle: 'Slack' }).catch((err) => {
    console.error('Failed to process Slack message:', err);
  });

  return Response.json({ ok: true });
}

async function handleGithubWebhook(request) {
  const { GH_WEBHOOK_SECRET } = process.env;

  // Validate webhook secret (timing-safe, required)
  if (!GH_WEBHOOK_SECRET || !safeCompare(request.headers.get('x-github-webhook-secret-token'), GH_WEBHOOK_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json();
  const jobId = payload.job_id || extractJobId(payload.branch);
  if (!jobId) return Response.json({ ok: true, skipped: true, reason: 'not a job' });

  try {
    const results = {
      job: payload.job || '',
      pr_url: payload.pr_url || payload.run_url || '',
      run_url: payload.run_url || '',
      status: payload.status || '',
      failure_stage: payload.failure_stage || '',
      merge_result: payload.merge_result || '',
      log: payload.log || '',
      changed_files: payload.changed_files || [],
      commit_message: payload.commit_message || '',
    };

    const message = await summarizeJob(results);
    await createNotification(message, payload);

    console.log(`Notification saved for job ${jobId.slice(0, 8)}`);

    // Route notification back to originating thread
    const origin = getJobOrigin(jobId);
    if (origin) {
      // Persist job outcome for future thread-scoped lookups
      try {
        saveJobOutcome({
          jobId,
          threadId: origin.threadId,
          status: results.status,
          mergeResult: results.merge_result,
          prUrl: results.pr_url,
          changedFiles: results.changed_files,
          logSummary: message,  // message = await summarizeJob(results)
        });
      } catch (err) {
        console.error('Failed to save job outcome:', err);
      }

      // Inject into LangGraph memory so agent knows the job finished
      addToThread(origin.threadId, `[Job completed] ${message}`).catch(() => {});

      // Send to Slack thread
      if (origin.platform === 'slack') {
        const [channel, threadTs] = origin.threadId.split(':');
        const { SLACK_BOT_TOKEN } = process.env;
        if (SLACK_BOT_TOKEN && channel && threadTs) {
          try {
            const { WebClient } = await import('@slack/web-api');
            const slack = new WebClient(SLACK_BOT_TOKEN);
            await slack.chat.postMessage({ channel, thread_ts: threadTs, text: message });
            console.log(`Slack notification sent for job ${jobId.slice(0, 8)}`);
          } catch (err) {
            console.error('Failed to send Slack notification:', err);
          }
        }
      }
    }

    return Response.json({ ok: true, notified: true });
  } catch (err) {
    console.error('Failed to process GitHub webhook:', err);
    return Response.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
}

async function handleJobStatus(request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('job_id');
    const result = await getJobStatus(jobId);
    return Response.json(result);
  } catch (err) {
    console.error('Failed to get job status:', err);
    return Response.json({ error: 'Failed to get job status' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Next.js Route Handlers (catch-all)
// ─────────────────────────────────────────────────────────────────────────────

async function POST(request) {
  const url = new URL(request.url);
  const routePath = url.pathname.replace(/^\/api/, '');
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  // Rate limit webhook endpoints
  if (['/slack/events', '/telegram/webhook', '/github/webhook'].includes(routePath)) {
    if (!checkRateLimit(clientIp, routePath)) {
      console.warn(`[rate-limit] ${clientIp} ${routePath} — blocked`);
      return Response.json({ error: 'Too many requests' }, { status: 429 });
    }
  }

  // Audit log
  console.log(`[api] POST ${routePath} from ${clientIp}`);

  // Auth check
  const authError = checkAuth(routePath, request);
  if (authError) return authError;

  // Fire triggers (non-blocking)
  try {
    const fireTriggers = getFireTriggers();
    // Clone request to read body for triggers without consuming it for the handler
    const clonedRequest = request.clone();
    const body = await clonedRequest.json().catch(() => ({}));
    const query = Object.fromEntries(url.searchParams);
    const headers = Object.fromEntries(request.headers);
    fireTriggers(routePath, body, query, headers);
  } catch (e) {
    // Trigger errors are non-fatal
  }

  // Route to handler
  switch (routePath) {
    case '/create-job':          return handleWebhook(request);
    case '/telegram/webhook':   return handleTelegramWebhook(request);
    case '/telegram/register':  return handleTelegramRegister(request);
    case '/slack/events':       return handleSlackEvents(request);
    case '/github/webhook':     return handleGithubWebhook(request);
    default:                    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

async function GET(request) {
  const url = new URL(request.url);
  const routePath = url.pathname.replace(/^\/api/, '');

  // Auth check
  const authError = checkAuth(routePath, request);
  if (authError) return authError;

  switch (routePath) {
    case '/ping':           return Response.json({ message: 'Pong!' });
    case '/jobs/status':    return handleJobStatus(request);
    default:                return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

export { GET, POST };
