import { randomUUID } from 'crypto';
import { eq, desc, and } from 'drizzle-orm';
import { getDb } from './index.js';
import { jobOutcomes } from './schema.js';

/**
 * Persist a completed job outcome linked to its originating thread.
 * changedFiles is stored as a JSON array string.
 * @param {object} params
 * @param {string} params.jobId
 * @param {string} params.threadId
 * @param {string} params.status
 * @param {string} params.mergeResult
 * @param {string} params.prUrl
 * @param {string[]|any} params.changedFiles
 * @param {string} params.logSummary
 */
export function saveJobOutcome({ jobId, threadId, status, mergeResult, prUrl, changedFiles, logSummary }) {
  const db = getDb();
  const id = randomUUID();
  db.insert(jobOutcomes)
    .values({
      id,
      jobId,
      threadId,
      status,
      mergeResult,
      prUrl: prUrl ?? '',
      changedFiles: JSON.stringify(Array.isArray(changedFiles) ? changedFiles : []),
      logSummary: logSummary ?? '',
      createdAt: Date.now(),
    })
    .run();
}

/**
 * Return the most recent merged job outcome for a given thread, or null if none exists.
 * Filters by both threadId and mergeResult='merged' at query level (HIST-03, HIST-04).
 * @param {string} threadId
 * @returns {{ id: string, jobId: string, threadId: string, status: string, mergeResult: string, prUrl: string, changedFiles: string, logSummary: string, createdAt: number } | null}
 */
export function getLastMergedJobOutcome(threadId) {
  const db = getDb();
  return (
    db
      .select()
      .from(jobOutcomes)
      .where(and(eq(jobOutcomes.threadId, threadId), eq(jobOutcomes.mergeResult, 'merged')))
      .orderBy(desc(jobOutcomes.createdAt))
      .limit(1)
      .get() ?? null
  );
}
