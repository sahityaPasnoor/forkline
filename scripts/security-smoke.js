#!/usr/bin/env node

const http = require('node:http');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const port = Number.parseInt(process.env.FORKLINE_SECURITY_TEST_PORT || '34609', 10);
const token = crypto.randomBytes(24).toString('base64url');

const request = ({ method, path, headers = {}, body }) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: '127.0.0.1',
        port,
        path,
        headers: payload
          ? {
              ...headers,
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload)
            }
          : headers
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk.toString();
        });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = { raw };
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const waitForHealth = async (attempts = 25) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await request({ method: 'GET', path: '/v1/health' });
      if (res.status === 200) return true;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

(async () => {
  const daemon = spawn(process.execPath, ['packages/core/bin/forkline-core.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FORKLINE_CORE_PORT: String(port),
      FORKLINE_CORE_TOKEN: token,
      FORKLINE_CORE_MAX_PTY_SESSIONS: '1',
      FORKLINE_CORE_RATE_LIMIT_PER_MINUTE: '40'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  daemon.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const stopDaemon = async () => {
    if (daemon.killed) return;
    daemon.kill('SIGTERM');
    await new Promise((resolve) => {
      daemon.once('exit', () => resolve());
      setTimeout(resolve, 1000);
    });
  };

  try {
    const ready = await waitForHealth();
    assert(ready, 'Core daemon did not become healthy in time.');

    const unauth = await request({ method: 'GET', path: '/v1/pty/sessions' });
    assert(unauth.status === 403, `Expected 403 for unauth sessions, got ${unauth.status}`);

    const authed = await request({
      method: 'GET',
      path: '/v1/pty/sessions',
      headers: { authorization: `Bearer ${token}` }
    });
    assert(authed.status === 200, `Expected 200 for auth sessions, got ${authed.status}`);

    const headerAuthed = await request({
      method: 'GET',
      path: '/v1/pty/sessions',
      headers: { 'x-forkline-token': token }
    });
    assert(headerAuthed.status === 200, `Expected 200 for x-forkline-token auth, got ${headerAuthed.status}`);

    const originBlocked = await request({
      method: 'GET',
      path: '/v1/pty/sessions',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'https://evil.example'
      }
    });
    assert(originBlocked.status === 403, `Expected 403 for origin-blocked request, got ${originBlocked.status}`);

    const invalidTaskId = await request({
      method: 'POST',
      path: '/v1/pty/create',
      headers: { authorization: `Bearer ${token}` },
      body: { taskId: 'invalid task id', cwd: '/tmp' }
    });
    assert(invalidTaskId.status === 400, `Expected 400 for invalid task id, got ${invalidTaskId.status}`);

    const invalidBasePath = await request({
      method: 'POST',
      path: '/v1/git/validate',
      headers: { authorization: `Bearer ${token}` },
      body: { sourcePath: '' }
    });
    assert(invalidBasePath.status === 400, `Expected 400 for invalid sourcePath, got ${invalidBasePath.status}`);

    const createOne = await request({
      method: 'POST',
      path: '/v1/pty/create',
      headers: { authorization: `Bearer ${token}` },
      body: { taskId: 'smoke-1', cwd: '/tmp' }
    });
    assert(createOne.status === 200 && createOne.body.success === true, 'First PTY create should succeed.');

    const oversizedWrite = await request({
      method: 'POST',
      path: '/v1/pty/write',
      headers: { authorization: `Bearer ${token}` },
      body: { taskId: 'smoke-1', data: 'x'.repeat(70000) }
    });
    assert(oversizedWrite.status === 413, `Expected 413 for oversized PTY write, got ${oversizedWrite.status}`);

    const createTwo = await request({
      method: 'POST',
      path: '/v1/pty/create',
      headers: { authorization: `Bearer ${token}` },
      body: { taskId: 'smoke-2', cwd: '/tmp' }
    });
    assert(createTwo.status === 409, `Expected 409 when session cap exceeded, got ${createTwo.status}`);

    let rateLimited = false;
    for (let i = 0; i < 50; i += 1) {
      // Hammer a lightweight endpoint to ensure limiter enforcement.
      const probe = await request({
        method: 'GET',
        path: '/v1/health'
      });
      if (probe.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Expected rate limiter to return 429 after repeated requests.');

    process.stdout.write('[security-smoke] PASS\n');
  } catch (error) {
    process.stderr.write(`[security-smoke] FAIL: ${error?.message || error}\n`);
    if (stderr.trim()) {
      process.stderr.write(`[security-smoke] daemon stderr:\n${stderr}\n`);
    }
    process.exitCode = 1;
  } finally {
    await stopDaemon();
  }
})();
