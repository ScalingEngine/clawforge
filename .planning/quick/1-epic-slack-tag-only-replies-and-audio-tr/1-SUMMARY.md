---
phase: quick-1
plan: "01"
subsystem: channels/slack
tags: [slack, audio, transcription, mention-only, whisper, strategyES]
dependency_graph:
  requires: [lib/tools/openai.js]
  provides: [requireMention filtering, audio transcription in SlackAdapter]
  affects: [lib/channels/slack.js, api/index.js, instances/strategyES/.env.example, .env.example]
tech_stack:
  added: []
  patterns: [env-flag feature toggle, adapter config injection, base.js contract (audio resolved in adapter)]
key_files:
  created: []
  modified:
    - lib/channels/slack.js
    - api/index.js
    - instances/strategyES/.env.example
    - .env.example
decisions:
  - "requireMention defaults to false so Noah instance needs no changes — pure opt-in for strategyES"
  - "Strip <@BOT_ID> prefix from app_mention text before returning to AI so prompt text is clean"
  - "Audio removed from attachments array after transcription — honors base.js contract that voice messages are fully resolved by adapter"
  - "Graceful no-op when OPENAI_API_KEY unset: console.warn + skip, never crash"
  - "Dockerfile does not need OPENAI_API_KEY — runtime env passes through docker-compose"
metrics:
  duration: "2 min"
  completed: "2026-02-24"
  tasks_completed: 2
  files_modified: 4
---

# Quick Task 1: Epic Slack Mention-Only Replies and Audio Transcription Summary

**One-liner:** SlackAdapter now gates on @-mention via `requireMention` config flag and transcribes voice clips via Whisper before returning text to the AI layer.

## What Was Built

Two independent capabilities added to the existing `SlackAdapter`:

**1. Mention-only mode (requireMention)**

When `SLACK_REQUIRE_MENTION=true` is set, the adapter drops regular `message` events and only processes `app_mention` events (where the bot was @-tagged). The bot mention prefix (`<@U123>`) is stripped from the text before it reaches the AI so prompts are clean.

strategyES (Epic) gets `requireMention=true` — it will only respond when @-mentioned. Noah's instance keeps the default (`requireMention=false`) — no behavior change.

**2. Slack audio transcription**

Audio attachments (voice clips, huddle recordings) with `audio/*` mimetype are now detected in `downloadFile()`, transcribed via the existing `transcribeAudio()` Whisper integration, and merged into the message `text` field. Audio entries are then removed from `attachments` per the `base.js` contract ("Voice/audio messages are fully resolved by the adapter"). If `OPENAI_API_KEY` is not set, a `console.warn` is logged and audio is silently skipped — no crash.

## Tasks Completed

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Add requireMention config to SlackAdapter | ca57283 | lib/channels/slack.js, api/index.js, instances/strategyES/.env.example, .env.example |
| 2 | Add Slack audio clip transcription | df5b765 | lib/channels/slack.js, instances/strategyES/.env.example, .env.example |

## Decisions Made

- **requireMention defaults to false** — backward compatible; Noah instance unchanged without any env var.
- **Mention prefix stripped before AI** — `<@UBOTID> do the thing` becomes `do the thing` so the LLM doesn't see raw Slack mrkdwn.
- **Audio resolved at adapter layer** — keeps the base.js contract clean: by the time `receive()` returns, voice messages are text.
- **Graceful degradation without OPENAI_API_KEY** — warn + skip, never error; useful during instance setup before the key is set.
- **Dockerfile unchanged** — runtime env vars flow through docker-compose; no build-time changes needed.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

**Files exist:**
- lib/channels/slack.js: found
- api/index.js: found
- instances/strategyES/.env.example: found
- .env.example: found

**Commits exist:**
- ca57283: found (feat(quick-1-01): add requireMention config to SlackAdapter)
- df5b765: found (feat(quick-1-01): add Slack audio clip transcription via Whisper)

## Self-Check: PASSED
