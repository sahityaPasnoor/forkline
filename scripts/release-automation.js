#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const usage = `Forkline release automation

Usage:
  node scripts/release-automation.js [options]

Options:
  --sync-dev               Merge main into codex/dev and push codex/dev.
  --sign-mac               Require FORKLINE_MAC_IDENTITY and build signed mac artifacts.
  --version <value>        Run npm version (patch|minor|major|X.Y.Z).
  --push-main              Push main to origin.
  --push-tags              Push tags to origin.
  --publish-npm            Publish to npm with provenance.
  --with-pty-replay        Run npm run test:pty-replay.
  --with-playwright        Run Playwright smoke test.
  --skip-npm-ci            Skip npm ci.
  --dry-run                Print planned commands without executing.
  -h, --help               Show this help.

Examples:
  npm run release:automate
  npm run release:automate -- --sync-dev --sign-mac --version patch --push-main --push-tags
  npm run release:automate -- --version 1.0.1 --push-main --push-tags --publish-npm
`;

const fail = (message) => {
  process.stderr.write(`[release-automate] FAIL: ${message}\n`);
  process.exit(1);
};

const info = (message) => {
  process.stdout.write(`[release-automate] ${message}\n`);
};

const options = {
  syncDev: false,
  signMac: false,
  version: '',
  pushMain: false,
  pushTags: false,
  publishNpm: false,
  withPtyReplay: false,
  withPlaywright: false,
  skipNpmCi: false,
  dryRun: false
};

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--sync-dev') {
    options.syncDev = true;
    continue;
  }
  if (arg === '--sign-mac') {
    options.signMac = true;
    continue;
  }
  if (arg === '--version') {
    const value = args[i + 1];
    if (!value || value.startsWith('-')) {
      fail('Missing value for --version.');
    }
    options.version = value;
    i += 1;
    continue;
  }
  if (arg === '--push-main') {
    options.pushMain = true;
    continue;
  }
  if (arg === '--push-tags') {
    options.pushTags = true;
    continue;
  }
  if (arg === '--publish-npm') {
    options.publishNpm = true;
    continue;
  }
  if (arg === '--with-pty-replay') {
    options.withPtyReplay = true;
    continue;
  }
  if (arg === '--with-playwright') {
    options.withPlaywright = true;
    continue;
  }
  if (arg === '--skip-npm-ci') {
    options.skipNpmCi = true;
    continue;
  }
  if (arg === '--dry-run') {
    options.dryRun = true;
    continue;
  }
  if (arg === '-h' || arg === '--help') {
    process.stdout.write(usage);
    process.exit(0);
  }
  fail(`Unknown option: ${arg}`);
}

const run = (command, commandArgs, runOptions = {}) => {
  const rendered = [command, ...commandArgs].join(' ');
  if (options.dryRun) {
    info(`(dry-run) ${rendered}`);
    return;
  }
  info(rendered);
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: runOptions.env || process.env,
    cwd: runOptions.cwd || process.cwd()
  });
  if (result.status !== 0) {
    fail(`Command failed: ${rendered}`);
  }
};

const runCapture = (command, commandArgs) => {
  const rendered = [command, ...commandArgs].join(' ');
  if (options.dryRun) {
    info(`(dry-run validate) ${rendered}`);
  }
  const result = spawnSync(command, commandArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    cwd: process.cwd()
  });
  if (result.status !== 0) {
    fail(`Command failed: ${rendered}\n${result.stderr || result.stdout || ''}`);
  }
  return String(result.stdout || '').trim();
};

const ensureCleanTree = () => {
  const status = runCapture('git', ['status', '--porcelain']);
  if (status) {
    fail('Working tree is not clean. Commit or stash changes first.');
  }
};

const ensureBranchExists = (branch) => {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    stdio: 'ignore'
  });
  return result.status === 0;
};

const ensureSigningIdentity = () => {
  const identity = String(process.env.FORKLINE_MAC_IDENTITY || '').trim();
  if (!identity) {
    fail('FORKLINE_MAC_IDENTITY is required with --sign-mac.');
  }
  if (/block/i.test(identity)) {
    fail('FORKLINE_MAC_IDENTITY cannot include "block". Use your personal identity.');
  }
};

const main = () => {
  ensureCleanTree();

  if (options.signMac) {
    ensureSigningIdentity();
  }

  run('git', ['checkout', 'main']);
  run('git', ['pull', '--ff-only', 'origin', 'main']);

  if (options.syncDev) {
    if (!ensureBranchExists('codex/dev')) {
      fail('Local branch codex/dev does not exist.');
    }
    run('git', ['checkout', 'codex/dev']);
    run('git', ['merge', '--no-edit', 'main']);
    run('git', ['push', 'origin', 'codex/dev']);
    run('git', ['checkout', 'main']);
  }

  if (!options.skipNpmCi) {
    run('npm', ['ci']);
  }

  run('npm', ['run', 'preflight:release']);
  run('npm', ['run', 'docs:build']);

  if (options.withPtyReplay) {
    run('npm', ['run', 'test:pty-replay']);
  }

  if (options.withPlaywright) {
    run('npx', ['playwright', 'test', 'e2e/electron.smoke.spec.js']);
  }

  if (options.version) {
    if (!options.pushTags) {
      info('WARN: --version creates a local git tag. Use --push-tags to publish it.');
    }
    run('npm', ['version', options.version]);
  }

  run('npm', ['run', 'dist:local']);

  if (options.pushMain) {
    run('git', ['push', 'origin', 'main']);
  }

  if (options.pushTags) {
    run('git', ['push', 'origin', '--tags']);
  }

  if (options.publishNpm) {
    run('npm', ['publish', '--provenance', '--access', 'public']);
    run('npm', ['view', 'forkline', 'version']);
  }

  info('Done.');
};

main();
