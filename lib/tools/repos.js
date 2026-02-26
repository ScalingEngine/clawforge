import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../paths.js';

/**
 * Load allowed repos from config/REPOS.json.
 * Reads on every call (no caching — file is small, changes require container rebuild).
 * @returns {Array<{owner: string, slug: string, name: string, aliases: string[]}>}
 */
function loadAllowedRepos() {
  const reposFile = path.join(PROJECT_ROOT, 'config', 'REPOS.json');
  try {
    const raw = fs.readFileSync(reposFile, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.repos || [];
  } catch {
    return [];
  }
}

/**
 * Resolve a natural language input to a canonical repo entry.
 * Matches case-insensitively against slug, name, and all aliases.
 * @param {string} input - User-supplied repo reference (e.g. "cf", "ClawForge", "the bot")
 * @param {Array<{owner: string, slug: string, name: string, aliases: string[]}>} repos - Repo list from loadAllowedRepos()
 * @returns {{owner: string, slug: string, name: string, aliases: string[]}|null}
 */
function resolveTargetRepo(input, repos) {
  if (!input || !Array.isArray(repos)) return null;
  const needle = input.toLowerCase();
  return repos.find((repo) => {
    if (repo.slug.toLowerCase() === needle) return true;
    if (repo.name.toLowerCase() === needle) return true;
    if (Array.isArray(repo.aliases) && repo.aliases.some((a) => a.toLowerCase() === needle)) return true;
    return false;
  }) ?? null;
}

export { loadAllowedRepos, resolveTargetRepo };
