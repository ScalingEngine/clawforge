#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = process.argv[2];
const args = process.argv.slice(3);

function printUsage() {
  console.log(`
Usage: thepopebot <command>

Commands:
  init               Scaffold a new thepopebot project
  setup              Run interactive setup wizard
  setup-telegram     Reconfigure Telegram webhook
  reset-auth         Regenerate AUTH_SECRET (invalidates all sessions)
  reset [file]       Restore a template file (or list available templates)
`);
}

/**
 * Collect all template files as relative paths.
 */
function getTemplateFiles(templatesDir) {
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(path.relative(templatesDir, fullPath));
      }
    }
  }
  walk(templatesDir);
  return files;
}

function init() {
  const cwd = process.cwd();
  const packageDir = path.join(__dirname, '..');
  const templatesDir = path.join(packageDir, 'templates');

  console.log('\nScaffolding thepopebot project...\n');

  const templateFiles = getTemplateFiles(templatesDir);
  const created = [];
  const skipped = [];
  const changed = [];

  for (const relPath of templateFiles) {
    const src = path.join(templatesDir, relPath);
    const dest = path.join(cwd, relPath);

    if (!fs.existsSync(dest)) {
      // File doesn't exist — create it
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      created.push(relPath);
      console.log(`  Created ${relPath}`);
    } else {
      // File exists — check if template has changed
      const srcContent = fs.readFileSync(src);
      const destContent = fs.readFileSync(dest);
      if (srcContent.equals(destContent)) {
        skipped.push(relPath);
      } else {
        changed.push(relPath);
        console.log(`  Skipped ${relPath} (already exists)`);
      }
    }
  }

  // Create package.json if it doesn't exist
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    const dirName = path.basename(cwd);
    const pkg = {
      name: dirName,
      private: true,
      scripts: {
        dev: 'next dev --turbopack',
        build: 'next build',
        start: 'next start',
        setup: 'thepopebot setup',
        'setup-telegram': 'thepopebot setup-telegram',
        'reset-auth': 'thepopebot reset-auth',
      },
      dependencies: {
        thepopebot: '^1.0.0',
        next: '^15.5.12',
        'next-auth': '5.0.0-beta.30',
        'next-themes': '^0.4.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        tailwindcss: '^4.0.0',
        '@tailwindcss/postcss': '^4.0.0',
      },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('  Created package.json');
  } else {
    console.log('  Skipped package.json (already exists)');
  }

  // Create .gitkeep files for empty dirs
  const gitkeepDirs = ['cron', 'triggers', 'logs', 'tmp', 'data'];
  for (const dir of gitkeepDirs) {
    const gitkeep = path.join(cwd, dir, '.gitkeep');
    if (!fs.existsSync(gitkeep)) {
      fs.mkdirSync(path.join(cwd, dir), { recursive: true });
      fs.writeFileSync(gitkeep, '');
    }
  }

  // Report changed templates
  if (changed.length > 0) {
    console.log('\n  Updated templates available:');
    console.log('  These files differ from the current package templates.');
    console.log('  This may be from your edits, or from a thepopebot update.\n');
    for (const file of changed) {
      console.log(`    ${file}`);
    }
    console.log('\n  To view differences:  npx thepopebot diff <file>');
    console.log('  To reset to default:  npx thepopebot reset <file>');
  }

  // Handle gitignore rename (npm strips .gitignore from packages)
  const gitignoreSrc = path.join(templatesDir, 'gitignore');
  const gitignoreDest = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignoreSrc) && !fs.existsSync(gitignoreDest)) {
    fs.copyFileSync(gitignoreSrc, gitignoreDest);
    console.log('  Created .gitignore');
  }

  // Update THEPOPEBOT_VERSION in .env if it exists
  const envPath = path.join(cwd, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const thepopebotPkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
      const version = thepopebotPkg.version;
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.match(/^THEPOPEBOT_VERSION=.*/m)) {
        envContent = envContent.replace(/^THEPOPEBOT_VERSION=.*/m, `THEPOPEBOT_VERSION=${version}`);
      } else {
        envContent = envContent.trimEnd() + `\nTHEPOPEBOT_VERSION=${version}\n`;
      }
      fs.writeFileSync(envPath, envContent);
      console.log(`  Updated THEPOPEBOT_VERSION to ${version}`);
    } catch {}
  }

  console.log('\nDone! Run: npm run setup\n');
}

/**
 * List all available template files, or restore a specific one.
 */
function reset(filePath) {
  const packageDir = path.join(__dirname, '..');
  const templatesDir = path.join(packageDir, 'templates');
  const cwd = process.cwd();

  if (!filePath) {
    console.log('\nAvailable template files:\n');
    const files = getTemplateFiles(templatesDir);
    for (const file of files) {
      console.log(`  ${file}`);
    }
    console.log('\nUsage: thepopebot reset <file>');
    console.log('Example: thepopebot reset config/SOUL.md\n');
    return;
  }

  const src = path.join(templatesDir, filePath);
  const dest = path.join(cwd, filePath);

  if (!fs.existsSync(src)) {
    console.error(`\nTemplate not found: ${filePath}`);
    console.log('Run "thepopebot reset" to see available templates.\n');
    process.exit(1);
  }

  if (fs.statSync(src).isDirectory()) {
    console.log(`\nRestoring ${filePath}/...\n`);
    copyDirSyncForce(src, dest);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`\nRestored ${filePath}\n`);
  }
}

/**
 * Show the diff between a user's file and the package template.
 */
function diff(filePath) {
  const packageDir = path.join(__dirname, '..');
  const templatesDir = path.join(packageDir, 'templates');
  const cwd = process.cwd();

  if (!filePath) {
    // Show all files that differ
    console.log('\nFiles that differ from package templates:\n');
    const files = getTemplateFiles(templatesDir);
    let anyDiff = false;
    for (const file of files) {
      const src = path.join(templatesDir, file);
      const dest = path.join(cwd, file);
      if (fs.existsSync(dest)) {
        const srcContent = fs.readFileSync(src);
        const destContent = fs.readFileSync(dest);
        if (!srcContent.equals(destContent)) {
          console.log(`  ${file}`);
          anyDiff = true;
        }
      } else {
        console.log(`  ${file} (missing)`);
        anyDiff = true;
      }
    }
    if (!anyDiff) {
      console.log('  All files match package templates.');
    }
    console.log('\nUsage: thepopebot diff <file>');
    console.log('Example: thepopebot diff config/SOUL.md\n');
    return;
  }

  const src = path.join(templatesDir, filePath);
  const dest = path.join(cwd, filePath);

  if (!fs.existsSync(src)) {
    console.error(`\nTemplate not found: ${filePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(dest)) {
    console.log(`\n${filePath} does not exist in your project.`);
    console.log(`Run "thepopebot reset ${filePath}" to create it.\n`);
    return;
  }

  try {
    // Use git diff for nice colored output, fall back to plain diff
    execSync(`git diff --no-index -- "${dest}" "${src}"`, { stdio: 'inherit' });
    console.log('\nFiles are identical.\n');
  } catch (e) {
    // git diff exits with 1 when files differ (output already printed)
    console.log(`\n  To reset: thepopebot reset ${filePath}\n`);
  }
}

function copyDirSyncForce(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSyncForce(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  Restored ${path.relative(process.cwd(), destPath)}`);
    }
  }
}

function setup() {
  const setupScript = path.join(__dirname, '..', 'setup', 'setup.mjs');
  try {
    execSync(`node ${setupScript}`, { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    process.exit(1);
  }
}

function setupTelegram() {
  const setupScript = path.join(__dirname, '..', 'setup', 'setup-telegram.mjs');
  try {
    execSync(`node ${setupScript}`, { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    process.exit(1);
  }
}

async function resetAuth() {
  const { randomBytes } = await import('crypto');
  const { updateEnvVariable } = await import(path.join(__dirname, '..', 'setup', 'lib', 'auth.mjs'));

  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('\n  No .env file found. Run "npm run setup" first.\n');
    process.exit(1);
  }

  const newSecret = randomBytes(32).toString('base64');
  updateEnvVariable('AUTH_SECRET', newSecret);
  console.log('\n  AUTH_SECRET regenerated.');
  console.log('  All existing sessions have been invalidated.');
  console.log('  Restart your server for the change to take effect.\n');
}

switch (command) {
  case 'init':
    init();
    break;
  case 'setup':
    setup();
    break;
  case 'setup-telegram':
    setupTelegram();
    break;
  case 'reset-auth':
    await resetAuth();
    break;
  case 'reset':
    reset(args[0]);
    break;
  case 'diff':
    diff(args[0]);
    break;
  default:
    printUsage();
    process.exit(command ? 1 : 0);
}
