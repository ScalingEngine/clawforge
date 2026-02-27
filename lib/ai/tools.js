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

export { createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool };
