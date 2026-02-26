#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { CoreDaemon, DEFAULT_PORT } = require('../src/index');

const TOKEN_FILE_ENV = 'FORKLINE_CORE_TOKEN_FILE';
const TOKEN_ENV = 'FORKLINE_CORE_TOKEN';

const defaultTokenFilePath = path.join(os.homedir(), '.forkline', 'core.token');

const ensureTokenDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
};

const readTokenFromFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
};

const writeTokenFile = (filePath, token) => {
  ensureTokenDir(filePath);
  fs.writeFileSync(filePath, `${token}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort permission tightening.
  }
};

const resolveAuthToken = () => {
  const envToken = String(process.env[TOKEN_ENV] || '').trim();
  if (envToken) {
    return { token: envToken, source: 'env' };
  }

  const tokenFilePath = String(process.env[TOKEN_FILE_ENV] || '').trim() || defaultTokenFilePath;
  const fileToken = readTokenFromFile(tokenFilePath);
  if (fileToken) {
    return { token: fileToken, source: 'file', tokenFilePath };
  }

  const generatedToken = crypto.randomBytes(32).toString('base64url');
  writeTokenFile(tokenFilePath, generatedToken);
  return { token: generatedToken, source: 'generated', tokenFilePath };
};

const portRaw = process.env.FORKLINE_CORE_PORT || String(DEFAULT_PORT);
const port = Number.parseInt(portRaw, 10);
const safePort = Number.isFinite(port) ? port : DEFAULT_PORT;

const authConfig = resolveAuthToken();
const daemon = new CoreDaemon({ authToken: authConfig.token, requireAuth: true });

daemon.start(safePort)
  .then(({ host, port: boundPort }) => {
    process.stdout.write(`[forkline-core] listening at http://${host}:${boundPort}\n`);
    if (authConfig.source === 'generated') {
      process.stdout.write(`[forkline-core] generated auth token and stored it at ${authConfig.tokenFilePath}\n`);
    } else if (authConfig.source === 'file') {
      process.stdout.write(`[forkline-core] loaded auth token from ${authConfig.tokenFilePath}\n`);
    } else {
      process.stdout.write(`[forkline-core] loaded auth token from ${TOKEN_ENV}\n`);
    }
  })
  .catch((error) => {
    process.stderr.write(`[forkline-core] failed to start: ${error?.message || error}\n`);
    process.exit(1);
  });
