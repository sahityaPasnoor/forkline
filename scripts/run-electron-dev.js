#!/usr/bin/env node

const { spawn } = require('node:child_process');
const waitOn = require('wait-on');

const port = Number.parseInt(process.env.VITE_PORT || '5555', 10);
const resolvedPort = Number.isFinite(port) ? port : 5555;
const devServerUrl = `http://localhost:${resolvedPort}`;

const run = async () => {
  await waitOn({
    resources: [
      `tcp:${resolvedPort}`,
      'dist/electron/main.js',
      'dist/electron/preload.js'
    ],
    timeout: 120000,
    interval: 100
  });

  const electronBinary = require('electron');
  const child = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
};

run().catch((error) => {
  console.error('[dev] Failed to launch Electron:', error?.message || error);
  process.exit(1);
});
