#!/usr/bin/env node

const { spawn } = require('node:child_process');

const rawIdentity = String(process.env.FORKLINE_MAC_IDENTITY || process.env.CSC_NAME || '').trim();

if (/block/i.test(rawIdentity)) {
  process.stderr.write('[signing] Refusing to use certificate matching "block". Set FORKLINE_MAC_IDENTITY to your personal signing identity.\n');
  process.exit(1);
}

const env = { ...process.env };
if (process.platform === 'darwin') {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  if (rawIdentity) {
    env.CSC_NAME = rawIdentity;
    process.stdout.write(`[signing] Using explicit mac signing identity: ${rawIdentity}\n`);
  } else {
    process.stdout.write('[signing] No mac signing identity provided; auto-discovery disabled. Set FORKLINE_MAC_IDENTITY to sign with your personal cert.\n');
  }
}

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['-y', 'electron-builder@24.13.3', ...process.argv.slice(2)];

const child = spawn(npxCommand, args, {
  stdio: 'inherit',
  env,
  cwd: process.cwd()
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
