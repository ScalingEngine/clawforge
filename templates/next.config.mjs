export default {
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  serverExternalPackages: ['better-sqlite3', 'drizzle-orm'],
};
