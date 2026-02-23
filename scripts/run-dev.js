#!/usr/bin/env node

const net = require('node:net');
const { spawn } = require('node:child_process');

const requestedPort = Number.parseInt(process.env.VITE_PORT || '5555', 10);
const startPort = Number.isFinite(requestedPort) ? requestedPort : 5555;
const maxPort = startPort + 30;
const canBindHost = (port, host) => new Promise((resolve) => {
  const server = net.createServer();
  server.unref();

  server.on('error', (error) => {
    if (error && (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT')) {
      resolve(true);
      return;
    }
    resolve(false);
  });

  server.listen({ host, port }, () => {
    server.close(() => resolve(true));
  });
});

const isPortAvailable = async (port) => {
  const ipv4Free = await canBindHost(port, '127.0.0.1');
  if (!ipv4Free) return false;
  const ipv6Free = await canBindHost(port, '::1');
  return ipv6Free;
};

const findPort = async () => {
  for (let port = startPort; port <= maxPort; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No open port found in range ${startPort}-${maxPort}.`);
};

const run = async () => {
  const selectedPort = await findPort();
  const env = { ...process.env, VITE_PORT: String(selectedPort) };
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  console.log(`[dev] Using VITE_PORT=${selectedPort}`);

  const child = spawn(npmCommand, ['run', 'dev:internal'], {
    stdio: 'inherit',
    env
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
  console.error('[dev] Failed to start dev environment:', error?.message || error);
  process.exit(1);
});
