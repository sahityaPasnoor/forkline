#!/usr/bin/env node

const { runTui } = require('../src/index');

process.stdout.write('[forkline-tui] experimental runtime. For full workflow use GUI (`forkline` / `npm run gui:start`).\n');

runTui().catch((error) => {
  process.stderr.write(`[forkline-tui] failed: ${error?.message || error}\n`);
  process.exit(1);
});
