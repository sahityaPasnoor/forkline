#!/usr/bin/env node

const { runTui } = require('../src/index');

runTui().catch((error) => {
  process.stderr.write(`[forkline-tui] failed: ${error?.message || error}\n`);
  process.exit(1);
});
