#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const mainEntry = path.join(projectRoot, 'dist', 'electron', 'main.js');

if (!fs.existsSync(mainEntry)) {
  console.error('[forkline] Build artifacts are missing.');
  console.error('[forkline] Run `npm run build` first (or install from a published package that includes dist/).');
  process.exit(1);
}

let electronBinaryPath;
try {
  electronBinaryPath = require('electron');
} catch {
  electronBinaryPath = null;
}

if (electronBinaryPath && typeof electronBinaryPath === 'string') {
  const child = spawn(electronBinaryPath, [mainEntry], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
} else {
  console.log('[forkline] Local electron runtime not found. Launching via npx electron@35.7.5...');
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npxCommand, ['-y', 'electron@35.7.5', mainEntry], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}
