#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const fail = (message) => {
  process.stderr.write(`[preflight] FAIL: ${message}\n`);
  process.exit(1);
};

const ok = (message) => {
  process.stdout.write(`[preflight] OK: ${message}\n`);
};

const assertArrayIncludes = (arr, value, label) => {
  if (!Array.isArray(arr) || !arr.includes(value)) {
    fail(`${label} must include "${value}"`);
  }
  ok(`${label} includes "${value}"`);
};

const assertExists = (relativePath, label) => {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`${label} missing at ${relativePath}`);
  }
  ok(`${label} exists (${relativePath})`);
};

const run = () => {
  assertExists('dist/electron/main.js', 'Electron main build output');
  assertExists('dist/electron/preload.js', 'Electron preload build output');
  assertExists('packages/core/bin/forkline-core.js', 'Core CLI entry');
  assertExists('bin/forkline.js', 'GUI CLI entry');

  const rootFiles = packageJson.files || [];
  const electronFiles = packageJson.build?.files || [];
  assertArrayIncludes(rootFiles, 'packages/**/*', 'package.json files');
  assertArrayIncludes(rootFiles, 'bin/**/*', 'package.json files');
  assertArrayIncludes(electronFiles, 'packages/**/*', 'electron-builder build.files');
  assertArrayIncludes(electronFiles, 'bin/**/*', 'electron-builder build.files');

  if (!packageJson.bin?.forkline || !packageJson.bin?.['forkline-core']) {
    fail('bin entries must include forkline and forkline-core');
  }
  ok('bin entries include forkline and forkline-core');

  process.stdout.write('[preflight] Checking npm tarball includes runtime modules...\n');
  const npmPack = spawnSync('npm', ['pack', '--dry-run'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (npmPack.status !== 0) {
    fail(`npm pack --dry-run failed:\n${npmPack.stderr || npmPack.stdout || '(no output)'}`);
  }
  const npmPackOutput = `${npmPack.stdout || ''}\n${npmPack.stderr || ''}`;
  const requiredTarballPaths = [
    'packages/core/src/services/pty-service.js',
    'packages/protocol/src/quick-actions.js',
    'bin/forkline.js'
  ];
  for (const requiredPath of requiredTarballPaths) {
    if (!npmPackOutput.includes(requiredPath)) {
      fail(`npm tarball missing ${requiredPath}`);
    }
    ok(`npm tarball includes ${requiredPath}`);
  }

  process.stdout.write('[preflight] PASS: release packaging prerequisites are satisfied.\n');
};

run();
