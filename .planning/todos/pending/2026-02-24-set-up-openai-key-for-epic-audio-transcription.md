---
created: 2026-02-24T19:22:50.943Z
title: Set up OpenAI key for Epic audio transcription
area: infra
files:
  - instances/strategyES/.env.example
  - docker-compose.yml
---

## Problem

Quick task 1 added Slack audio transcription to the Epic (strategyES) instance via Whisper (`lib/tools/openai.js`). The code gracefully skips transcription when `OPENAI_API_KEY` is not set, but the key needs to be configured in the strategyES environment for the feature to actually work.

Without it, any Slack audio clips sent to Epic will be silently ignored rather than transcribed.

## Solution

1. Add `OPENAI_API_KEY` to the strategyES instance's live environment (VPS `.env` or Docker secrets)
2. Verify the key has Whisper API access (any OpenAI key with standard permissions works)
3. Test by sending a voice clip in Slack and confirming transcription appears in Epic's response
