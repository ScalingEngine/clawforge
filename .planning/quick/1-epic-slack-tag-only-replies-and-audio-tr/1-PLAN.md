---
phase: quick-1
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/channels/slack.js
  - api/index.js
  - instances/strategyES/.env.example
  - .env.example
autonomous: true
requirements: [SLACK-MENTION-ONLY, SLACK-AUDIO-TRANSCRIPTION]

must_haves:
  truths:
    - "Epic (strategyES) only responds when @-mentioned in Slack, ignoring regular channel messages"
    - "Noah instance continues responding to all messages (no behavior change)"
    - "Slack audio clips/voice messages are transcribed to text via Whisper and processed as normal messages"
    - "When OPENAI_API_KEY is not set, audio messages are gracefully skipped with a user-facing note"
  artifacts:
    - path: "lib/channels/slack.js"
      provides: "requireMention filtering + audio transcription in SlackAdapter"
      contains: "requireMention"
    - path: "api/index.js"
      provides: "SLACK_REQUIRE_MENTION env var wiring"
      contains: "SLACK_REQUIRE_MENTION"
    - path: "instances/strategyES/.env.example"
      provides: "OPENAI_API_KEY and SLACK_REQUIRE_MENTION env placeholders"
      contains: "OPENAI_API_KEY"
  key_links:
    - from: "api/index.js"
      to: "lib/channels/slack.js"
      via: "requireMention config passed to SlackAdapter constructor"
      pattern: "requireMention"
    - from: "lib/channels/slack.js"
      to: "lib/tools/openai.js"
      via: "import transcribeAudio for Slack audio clips"
      pattern: "transcribeAudio"
---

<objective>
Add two capabilities to the Slack channel adapter: (1) optional mention-only mode so instances like strategyES (Epic) only respond when @-mentioned, and (2) audio clip transcription using the existing Whisper integration.

Purpose: Epic currently responds to every message in monitored Slack channels, which is noisy. Jim and the team want Epic to only respond when explicitly tagged. Additionally, Slack audio clips (voice messages, huddle recordings) are currently ignored — they need to be transcribed and processed like text messages.

Output: Updated SlackAdapter with configurable mention filtering and audio transcription, plus env config for strategyES.
</objective>

<execution_context>
@/Users/nwessel/.claude/get-shit-done/workflows/execute-plan.md
@/Users/nwessel/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@lib/channels/slack.js
@lib/channels/base.js
@lib/channels/telegram.js (reference for audio transcription pattern)
@lib/tools/openai.js (existing Whisper transcription)
@api/index.js (Slack event handler wiring)
@instances/strategyES/.env.example
@.env.example
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add requireMention config to SlackAdapter</name>
  <files>lib/channels/slack.js, api/index.js, instances/strategyES/.env.example, .env.example</files>
  <action>
1. In `lib/channels/slack.js` — SlackAdapter constructor:
   - Add `requireMention` to the destructured config: `{ botToken, signingSecret, allowedUserIds, allowedChannelIds, requireMention }`
   - Store as `this.requireMention = requireMention || false;`

2. In `lib/channels/slack.js` — `receive()` method, after the `app_mention`/`message` type check (line ~90) and before the bot_id check:
   - Add mention-only gate:
     ```js
     // When requireMention is true, only respond to app_mention events
     // (ignore regular message events — the bot must be @-tagged)
     if (this.requireMention && event.type !== 'app_mention') return null;
     ```
   - For `app_mention` events, Slack includes the bot's `<@BOT_ID>` mention prefix in `event.text`. Strip it so the AI doesn't see the raw mention tag:
     ```js
     // Strip the leading @-mention from app_mention events so the AI
     // receives clean text (e.g., "<@U123> fix the bug" -> "fix the bug")
     if (event.type === 'app_mention') {
       text = text.replace(/^<@[A-Z0-9]+>\s*/, '');
     }
     ```
     Place this after `let text = event.text || '';` (line ~118).

3. In `api/index.js` — `handleSlackEvents()` function:
   - Read `SLACK_REQUIRE_MENTION` from `process.env` alongside the other SLACK_ vars
   - Pass `requireMention: SLACK_REQUIRE_MENTION === 'true'` in the config object to `getSlackAdapter()`

4. In `instances/strategyES/.env.example`:
   - Add `SLACK_REQUIRE_MENTION=true` after the existing SLACK_ variables

5. In `.env.example`:
   - Add `SES_SLACK_REQUIRE_MENTION=true` in the strategyES section
   - Add `NOAH_SLACK_REQUIRE_MENTION=` (empty/unset, Noah keeps responding to all messages) in the Noah section

6. In `lib/channels/index.js` — `getSlackAdapter()`:
   - No changes needed (it already passes the full config object through to the constructor)
  </action>
  <verify>
    grep -n "requireMention" lib/channels/slack.js api/index.js && grep "SLACK_REQUIRE_MENTION" instances/strategyES/.env.example .env.example
  </verify>
  <done>
    - SlackAdapter accepts requireMention config
    - When requireMention=true, only app_mention events pass through; regular message events return null
    - When requireMention=false or unset, behavior is unchanged (both message and app_mention handled)
    - Bot mention prefix stripped from app_mention event text
    - strategyES .env.example has SLACK_REQUIRE_MENTION=true
  </done>
</task>

<task type="auto">
  <name>Task 2: Add Slack audio clip transcription</name>
  <files>lib/channels/slack.js, instances/strategyES/.env.example, .env.example</files>
  <action>
1. In `lib/channels/slack.js` — add import at the top:
   ```js
   import { isWhisperEnabled, transcribeAudio } from '../tools/openai.js';
   ```

2. In `lib/channels/slack.js` — update `downloadFile()` method to detect audio:
   - After the existing image detection block (`if (mimeType.startsWith('image/'))`), add:
     ```js
     if (mimeType.startsWith('audio/')) {
       return { category: 'audio', mimeType, data: buffer, filename: file.name || 'audio.webm' };
     }
     ```

3. In `lib/channels/slack.js` — in `receive()` method, after the file download loop (after the `for (const file of event.files)` block, around line ~133) and before the "Nothing actionable" check:
   - Process any audio attachments by transcribing them and prepending transcription to text:
     ```js
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
     ```

4. In `instances/strategyES/.env.example`:
   - Add `OPENAI_API_KEY=` with a comment: `# Required for Slack audio/voice message transcription (Whisper)`

5. In `.env.example`:
   - Add `SES_OPENAI_API_KEY=` in the strategyES section with comment about audio transcription

6. In `instances/strategyES/Dockerfile` (if it maps env vars):
   - Check if OPENAI_API_KEY needs to be added to the env mapping. If the Dockerfile just passes through all env vars, no change needed.
  </action>
  <verify>
    grep -n "transcribeAudio\|isWhisperEnabled\|audio" lib/channels/slack.js && grep "OPENAI_API_KEY" instances/strategyES/.env.example
  </verify>
  <done>
    - Slack audio files (audio/* mimetype) are detected and transcribed via Whisper
    - Transcribed text is prepended/appended to the message text field
    - Audio attachments are removed from the attachments array after transcription (per base.js contract)
    - When OPENAI_API_KEY is not set, audio messages log a warning and are silently skipped (no crash)
    - strategyES .env.example includes OPENAI_API_KEY placeholder
  </done>
</task>

</tasks>

<verification>
After both tasks complete:
1. `grep -c "requireMention" lib/channels/slack.js` returns >= 3 (constructor, property, gate check)
2. `grep -c "transcribeAudio" lib/channels/slack.js` returns >= 2 (import + usage)
3. `grep "SLACK_REQUIRE_MENTION" api/index.js` shows the env var being read and passed
4. `node -e "import('./lib/channels/slack.js').then(() => console.log('OK')).catch(e => console.error(e))"` — module loads without syntax errors
</verification>

<success_criteria>
- SlackAdapter in requireMention mode ignores regular messages, only responds to @-mentions
- SlackAdapter without requireMention continues handling all messages (backward compatible)
- Slack audio clips are transcribed to text via existing Whisper integration
- No changes to Telegram adapter or Noah instance behavior
- All env examples updated for strategyES
</success_criteria>

<output>
After completion, create `.planning/quick/1-epic-slack-tag-only-replies-and-audio-tr/1-SUMMARY.md`
</output>
