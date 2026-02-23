#!/usr/bin/env node

const { CoreDaemon, DEFAULT_PORT } = require('../src/index');

const portRaw = process.env.FORKLINE_CORE_PORT || String(DEFAULT_PORT);
const port = Number.parseInt(portRaw, 10);
const safePort = Number.isFinite(port) ? port : DEFAULT_PORT;

const daemon = new CoreDaemon();

daemon.start(safePort)
  .then(({ host, port: boundPort }) => {
    process.stdout.write(`[forkline-core] listening at http://${host}:${boundPort}\n`);
  })
  .catch((error) => {
    process.stderr.write(`[forkline-core] failed to start: ${error?.message || error}\n`);
    process.exit(1);
  });
