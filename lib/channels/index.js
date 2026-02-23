import { TelegramAdapter } from './telegram.js';
import { SlackAdapter } from './slack.js';

let _telegramAdapter = null;
let _slackAdapter = null;

/**
 * Get the Telegram channel adapter (lazy singleton).
 * @param {string} botToken - Telegram bot token
 * @returns {TelegramAdapter}
 */
export function getTelegramAdapter(botToken) {
  if (!_telegramAdapter || _telegramAdapter.botToken !== botToken) {
    _telegramAdapter = new TelegramAdapter(botToken);
  }
  return _telegramAdapter;
}

/**
 * Get the Slack channel adapter (lazy singleton).
 * @param {object} config
 * @param {string} config.botToken - Slack Bot User OAuth Token
 * @param {string} config.signingSecret - Slack app signing secret
 * @param {string[]} [config.allowedUserIds] - Restrict to these Slack user IDs
 * @param {string[]} [config.allowedChannelIds] - Restrict to these channel IDs
 * @returns {SlackAdapter}
 */
export function getSlackAdapter(config) {
  if (
    !_slackAdapter ||
    _slackAdapter.botToken !== config.botToken ||
    _slackAdapter.signingSecret !== config.signingSecret
  ) {
    _slackAdapter = new SlackAdapter(config);
  }
  return _slackAdapter;
}
