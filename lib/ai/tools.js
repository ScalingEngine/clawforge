import fs from 'fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createJob } from '../tools/create-job.js';
import { getJobStatus } from '../tools/github.js';
import { claudeMd } from '../paths.js';
import { saveJobOrigin } from '../db/job-origins.js';
import { getLastMergedJobOutcome } from '../db/job-outcomes.js';
import { loadAllowedRepos, resolveTargetRepo } from '../tools/repos.js';

/**
 * Detect platform from thread ID format.
 * Slack: "C0AGVADJDKK:1234567890.123456" (channel:ts)
 * Telegram: numeric chat ID
 * Web: UUID
 */
function detectPlatform(threadId) {
  if (/^C[A-Z0-9]+:\d+\.\d+$/.test(threadId)) return 'slack';
  if (/^\d+$/.test(threadId)) return 'telegram';
  return 'web';
}

const createJobTool = tool(
  async ({ job_description, target_repo }, config) => {
    // Capture originating thread so we can route notifications back and look up prior context
    const threadId = config?.configurable?.thread_id;

    // Enrich job_description with prior job context if a merged outcome exists
    let enrichedDescription = job_description;
    if (threadId) {
      try {
        const prior = getLastMergedJobOutcome(threadId);
        if (prior) {
          const changedFiles = JSON.parse(prior.changedFiles || '[]');
          const priorContext = [
            '## Prior Job Context',
            '',
            `**Previous PR:** ${prior.prUrl || '(no URL)'}`,
            `**Status:** ${prior.status} (${prior.mergeResult})`,
            changedFiles.length ? `**Files changed:** ${changedFiles.join(', ')}` : '',
            prior.logSummary ? `**What happened:** ${prior.logSummary}` : '',
          ].filter(Boolean).join('\n');

          enrichedDescription = `${priorContext}\n\n---\n\n${job_description}`;
        }
      } catch (err) {
        console.error('Failed to load prior job context:', err);
        // Non-fatal — proceed with original description
      }
    }

    // Resolve target repo if specified
    let resolvedTarget = null;
    if (target_repo) {
      const repos = loadAllowedRepos();
      resolvedTarget = resolveTargetRepo(target_repo, repos);
      if (!resolvedTarget) {
        return JSON.stringify({
          success: false,
          error: `Target repo "${target_repo}" not recognized or not in allowed repos list. ` +
                 `Available: ${repos.map(r => r.name).join(', ')}`,
        });
      }
    }

    const result = await createJob(enrichedDescription, { targetRepo: resolvedTarget });

    if (threadId) {
      try {
        saveJobOrigin(result.job_id, threadId, detectPlatform(threadId));
      } catch (err) {
        console.error('Failed to save job origin:', err);
      }
    }

    return JSON.stringify({
      success: true,
      job_id: result.job_id,
      branch: result.branch,
      ...(resolvedTarget && { target_repo: `${resolvedTarget.owner}/${resolvedTarget.slug}` }),
    });
  },
  {
    name: 'create_job',
    description:
      'Create an autonomous job that runs Claude Code CLI in an isolated Docker container. Claude Code has full filesystem access, tool use (Read, Write, Edit, Bash, Glob, Grep), and GSD workflow skills. The job description you provide becomes the task prompt. Returns the job ID and branch name.',
    schema: z.object({
      job_description: z
        .string()
        .describe(
          'Detailed job description including context and requirements. Be specific about what needs to be done.'
        ),
      target_repo: z.string().optional().describe(
        'Optional: target repository name or alias (e.g., "neurostory", "ns"). ' +
        'Must match an entry in the allowed repos list. ' +
        'If omitted, job runs against the default clawforge repo.'
      ),
    }),
  }
);

const getJobStatusTool = tool(
  async ({ job_id }) => {
    const result = await getJobStatus(job_id);
    return JSON.stringify(result);
  },
  {
    name: 'get_job_status',
    description:
      'Check status of running jobs or look up completed job outcomes. For live jobs, returns active workflow runs with timing and current step. For completed jobs (when a job_id is provided), returns the outcome including PR URL and target repo if applicable. Use when user asks about job progress, running jobs, job status, or what happened with a specific job.',
    schema: z.object({
      job_id: z
        .string()
        .optional()
        .describe(
          'Optional: specific job ID to check. If omitted, returns all running jobs.'
        ),
    }),
  }
);

const getSystemTechnicalSpecsTool = tool(
  async () => {
    try {
      return fs.readFileSync(claudeMd, 'utf8');
    } catch {
      return 'No technical documentation found (CLAUDE.md not present in project root).';
    }
  },
  {
    name: 'get_system_technical_specs',
    description:
      'Read the system architecture and technical documentation (CLAUDE.md). Use this when you need to understand how the system itself works — the event handler, Docker agent, API routes, database, cron/trigger configuration, GitHub Actions, deployment, or file structure.',
    schema: z.object({}),
  }
);

/**
 * LangGraph tool for creating a new ClawForge instance.
 * Phase 13 stub — handler builds a minimal job description.
 * Phase 15 will replace the description with buildInstanceJobDescription(config).
 */
const createInstanceJobTool = tool(
  async ({ name, purpose, allowed_repos, enabled_channels, slack_user_ids, telegram_chat_id }, runConfig) => {
    // Capture originating thread so instance job completions route back to conversation
    const threadId = runConfig?.configurable?.thread_id;

    const description = [
      `# Create ClawForge Instance: ${name}`,
      '',
      `**Purpose:** ${purpose}`,
      `**Allowed repos:** ${allowed_repos.join(', ')}`,
      `**Channels:** ${enabled_channels.join(', ')}`,
      slack_user_ids?.length ? `**Slack users:** ${slack_user_ids.join(', ')}` : '',
      telegram_chat_id ? `**Telegram chat ID:** ${telegram_chat_id}` : '',
      '',
      'Generate all instance files per the ClawForge instance generator spec.',
    ].filter(Boolean).join('\n');

    const result = await createJob(description);

    if (threadId) {
      try {
        saveJobOrigin(result.job_id, threadId, detectPlatform(threadId));
      } catch (err) {
        console.error('Failed to save job origin:', err);
      }
    }

    return JSON.stringify({ success: true, job_id: result.job_id, branch: result.branch });
  },
  {
    name: 'create_instance_job',
    description:
      'Create a new ClawForge instance. Dispatches an autonomous job that generates all instance files (Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example) and updates docker-compose.yml. Call this only after collecting all required config and receiving operator approval.',
    schema: z.object({
      name: z.string().describe('Instance slug — lowercase, no spaces (e.g. "jim", "acmecorp")'),
      purpose: z.string().describe('What this instance is for, used to author persona files'),
      allowed_repos: z.array(z.string()).describe('GitHub repo slugs this instance can target (e.g. ["strategyes-lab"])'),
      enabled_channels: z.array(z.enum(['slack', 'telegram', 'web'])).describe('Communication channels to enable'),
      slack_user_ids: z.array(z.string()).optional().describe('Slack user IDs that can interact with this instance'),
      telegram_chat_id: z.string().optional().describe('Telegram chat ID for this instance'),
    }),
  }
);

export { createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool, createInstanceJobTool };
