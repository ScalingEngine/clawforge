import { createHmac, timingSafeEqual } from 'crypto';
import { WebClient } from '@slack/web-api';
import { ChannelAdapter } from './base.js';
import { isWhisperEnabled, transcribeAudio } from '../tools/openai.js';

/**
 * Slack channel adapter.
 * Handles incoming Slack events (messages, app_mention) via the Events API,
 * validates request signatures, and sends threaded responses.
 *
 * Uses @slack/web-api directly — NOT @slack/bolt — since we handle HTTP
 * ourselves in the Next.js API route.
 */
class SlackAdapter extends ChannelAdapter {
  /**
   * @param {object} config
   * @param {string} config.botToken - Slack Bot User OAuth Token (xoxb-...)
   * @param {string} config.signingSecret - Slack app signing secret
   * @param {string[]} [config.allowedUserIds] - Restrict to these Slack user IDs
   * @param {string[]} [config.allowedChannelIds] - Restrict to these channel IDs
   * @param {boolean} [config.requireMention] - When true, only respond to app_mention events (bot must be @-tagged)
   */
  constructor({ botToken, signingSecret, allowedUserIds, allowedChannelIds, requireMention }) {
    super();
    this.botToken = botToken;
    this.signingSecret = signingSecret;
    this.allowedUserIds = allowedUserIds || [];
    this.allowedChannelIds = allowedChannelIds || [];
    this.requireMention = requireMention || false;
    this.client = new WebClient(botToken);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Signature verification (Slack's HMAC-SHA256 scheme)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Verify that the request came from Slack.
   * @param {string} signature - x-slack-signature header
   * @param {string} timestamp - x-slack-request-timestamp header
   * @param {string} rawBody - Raw request body string
   * @returns {boolean}
   */
  verifySignature(signature, timestamp, rawBody) {
    if (!signature || !timestamp || !rawBody) return false;

    // Protect against replay attacks (reject if timestamp > 5 minutes old)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) return false;

    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const hmac = createHmac('sha256', this.signingSecret)
      .update(sigBasestring)
      .digest('hex');
    const expected = `v0=${hmac}`;

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(sigBuffer, expectedBuffer);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // receive — Normalize incoming Slack event into standard message format
  // ─────────────────────────────────────────────────────────────────────────

  async receive(request) {
    // Read raw body for signature verification
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    // ── URL verification challenge (before sig check — no side effects) ─
    if (body.type === 'url_verification') {
      return { type: 'url_verification', challenge: body.challenge };
    }

    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');

    if (!this.verifySignature(signature, timestamp, rawBody)) {
      console.error('[slack] Invalid request signature — rejecting');
      return null;
    }

    // Only handle event_callback
    if (body.type !== 'event_callback') return null;

    const event = body.event;
    if (!event) return null;

    // Only handle message and app_mention events
    if (event.type !== 'message' && event.type !== 'app_mention') return null;

    // When requireMention is true, only respond to app_mention events
    // (ignore regular message events — the bot must be @-tagged)
    if (this.requireMention && event.type !== 'app_mention') return null;

    // Ignore bot messages to prevent loops
    if (event.bot_id || event.subtype === 'bot_message') return null;

    // Ignore message subtypes that aren't actual user messages
    // (message_changed, message_deleted, channel_join, etc.)
    if (event.subtype && event.subtype !== 'file_share') return null;

    const userId = event.user;
    const channel = event.channel;

    // Security: reject if user not in allowedUserIds (if configured)
    if (this.allowedUserIds.length > 0 && !this.allowedUserIds.includes(userId)) {
      return null;
    }

    // Security: reject if channel not in allowedChannelIds (if configured)
    if (this.allowedChannelIds.length > 0 && !this.allowedChannelIds.includes(channel)) {
      return null;
    }

    const ts = event.ts;
    const threadTs = event.thread_ts || null;

    // Thread ID for conversation isolation: channel:thread_ts or channel:ts
    const threadId = threadTs ? `${channel}:${threadTs}` : `${channel}:${ts}`;

    let text = event.text || '';

    // Strip the leading @-mention from app_mention events so the AI
    // receives clean text (e.g., "<@U123> fix the bug" -> "fix the bug")
    if (event.type === 'app_mention') {
      text = text.replace(/^<@[A-Z0-9]+>\s*/, '');
    }

    const attachments = [];

    // ── File attachments ────────────────────────────────────────────────
    if (event.files && event.files.length > 0) {
      for (const file of event.files) {
        try {
          const downloaded = await this.downloadFile(file);
          if (downloaded) {
            attachments.push(downloaded);
          }
        } catch (err) {
          console.error(`[slack] Failed to download file ${file.id}:`, err.message);
        }
      }
    }

    // Transcribe audio attachments (Slack voice clips, huddle recordings)
    const audioAttachments = attachments.filter(a => a.category === 'audio');
    if (audioAttachments.length > 0) {
      if (!isWhisperEnabled()) {
        console.warn('[slack] Audio message received but OPENAI_API_KEY not set — skipping transcription');
      } else {
        for (const audio of audioAttachments) {
          try {
            const transcription = await transcribeAudio(audio.data, audio.filename);
            text = text ? `${text}\n\n[Voice message]: ${transcription}` : transcription;
          } catch (err) {
            console.error('[slack] Failed to transcribe audio:', err.message);
          }
        }
      }
      // Remove audio from attachments — transcription is now in text
      // (matches base.js contract: "Voice/audio messages are fully resolved by the adapter")
      const nonAudio = attachments.filter(a => a.category !== 'audio');
      attachments.length = 0;
      attachments.push(...nonAudio);
    }

    // Nothing actionable
    if (!text && attachments.length === 0) return null;

    return {
      threadId,
      text,
      attachments,
      metadata: {
        channel,
        ts,
        threadTs,
        userId,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File download helper
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Download a Slack file using the bot token for auth.
   * @param {object} file - Slack file object from event
   * @returns {Promise<object|null>} Normalized attachment or null
   */
  async downloadFile(file) {
    const url = file.url_private_download || file.url_private;
    if (!url) return null;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.botToken}` },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} downloading ${file.name}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = file.mimetype || 'application/octet-stream';

    // Categorize the file
    if (mimeType.startsWith('image/')) {
      return { category: 'image', mimeType, data: buffer };
    }

    if (mimeType.startsWith('audio/')) {
      return { category: 'audio', mimeType, data: buffer, filename: file.name || 'audio.webm' };
    }

    return { category: 'document', mimeType, data: buffer };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // acknowledge — Add :eyes: reaction to show the message was received
  // ─────────────────────────────────────────────────────────────────────────

  async acknowledge(metadata) {
    try {
      await this.client.reactions.add({
        channel: metadata.channel,
        name: 'eyes',
        timestamp: metadata.ts,
      });
    } catch (err) {
      // Non-fatal — reaction may already exist or permissions may be missing
      if (err.data?.error !== 'already_reacted') {
        console.error('[slack] Failed to add reaction:', err.message);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // startProcessingIndicator — No-op for Slack
  // Slack doesn't support typing indicators for bots in a useful way.
  // ─────────────────────────────────────────────────────────────────────────

  startProcessingIndicator(metadata) {
    return () => {};
  }

  // ─────────────────────────────────────────────────────────────────────────
  // sendResponse — Post message to channel, threaded if applicable
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send a response back to Slack.
   * Messages > 4000 chars are split into multiple messages.
   *
   * @param {string} threadId - channel:ts format
   * @param {string} text - Response text
   * @param {object} metadata - { channel, ts, threadTs }
   */
  async sendResponse(threadId, text, metadata) {
    const channel = metadata.channel;
    // Thread under the original thread, or start a new thread on the message
    const thread_ts = metadata.threadTs || metadata.ts;

    const chunks = this.splitMessage(text);

    for (const chunk of chunks) {
      await this.client.chat.postMessage({
        channel,
        text: chunk,
        thread_ts,
      });
    }
  }

  /**
   * Split a message into chunks that fit Slack's ~4000 char limit.
   * Tries to split at newline boundaries for readability.
   *
   * @param {string} text
   * @param {number} [maxLength=4000]
   * @returns {string[]}
   */
  splitMessage(text, maxLength = 4000) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to find a newline break point within the limit
      let splitIndex = remaining.lastIndexOf('\n', maxLength);

      // If no newline found, try a space
      if (splitIndex <= 0) {
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }

      // If still no good break point, hard split
      if (splitIndex <= 0) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).replace(/^\n/, '');
    }

    return chunks;
  }

  get supportsStreaming() {
    return false;
  }
}

export { SlackAdapter };
