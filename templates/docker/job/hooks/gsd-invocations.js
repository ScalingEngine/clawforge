#!/usr/bin/env node
// gsd-invocations.js — PostToolUse hook: logs Skill invocations to gsd-invocations.jsonl
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // Only log Skill tool invocations
    if (data.tool_name !== 'Skill') {
      process.exit(0);
    }

    // Get log dir from environment (set by entrypoint.sh: export LOG_DIR=...)
    const logDir = process.env.LOG_DIR;
    if (!logDir) {
      process.exit(0); // Not in a job container context — skip silently
    }

    const record = {
      ts: new Date().toISOString(),
      tool_name: data.tool_name,
      skill: data.tool_input?.skill || 'unknown',
      args: (data.tool_input?.args || '').slice(0, 200), // Truncate long args
      cwd: data.cwd || ''
    };

    const logFile = path.join(logDir, 'gsd-invocations.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
  } catch (e) {
    // Silent fail — never block tool execution
    process.exit(0);
  }
});
