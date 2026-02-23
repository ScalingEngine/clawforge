/**
 * Next.js instrumentation hook for ClawForge.
 * Loaded by Next.js on server start when instrumentationHook is enabled.
 */

let initialized = false;

export async function register() {
  // Only run on the server, and only once
  if (typeof window !== 'undefined' || initialized) return;
  initialized = true;

  // Skip database init and cron scheduling during `next build`
  if (process.argv.includes('build')) return;

  // Load .env from project root
  const dotenv = await import('dotenv');
  dotenv.config();

  // Validate AUTH_SECRET is set (required by Auth.js for session encryption)
  if (!process.env.AUTH_SECRET) {
    console.error('\n  ERROR: AUTH_SECRET is not set in your .env file.');
    console.error('  This is required for session encryption.');
    console.error('  Run "openssl rand -base64 32" to generate one.\n');
    throw new Error('AUTH_SECRET environment variable is required');
  }

  // Initialize auth database
  const { initDatabase } = await import('../lib/db/index.js');
  initDatabase();

  // Start cron scheduler
  const { loadCrons } = await import('../lib/cron.js');
  loadCrons();

  // Start built-in crons
  const { startBuiltinCrons } = await import('../lib/cron.js');
  startBuiltinCrons();

  console.log('ClawForge initialized');
}
