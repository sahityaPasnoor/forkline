const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { CoreDaemon } = require('../src/daemon');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forkline-daemon-'));
const removeDirSafe = (targetPath) => fs.rmSync(targetPath, { recursive: true, force: true });

const requestJson = ({ port, method, route, token, origin, body }) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      ...(payload
        ? {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload)
          }
        : {})
    };

    const req = http.request(
      {
        method,
        hostname: '127.0.0.1',
        port,
        path: route,
        headers
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

test('CoreDaemon enforces auth/origin/rate limits and supports core lifecycle endpoints', async (t) => {
  const token = crypto.randomBytes(16).toString('hex');
  const port = 36000 + Math.floor(Math.random() * 2000);
  const daemon = new CoreDaemon({
    authToken: token,
    requireAuth: true,
    maxPtySessions: 2,
    maxRequestsPerMinute: 500
  });

  const tempProject = makeTempDir();
  fs.writeFileSync(path.join(tempProject, 'README.md'), '# daemon integration\n', 'utf8');

  await daemon.start(port, '127.0.0.1');
  t.after(async () => {
    await daemon.stop();
    removeDirSafe(tempProject);
    removeDirSafe(`${tempProject}-worktrees`);
  });

  const health = await requestJson({ port, method: 'GET', route: '/v1/health' });
  assert.equal(health.status, 200);

  const unauthorized = await requestJson({ port, method: 'GET', route: '/v1/pty/sessions' });
  assert.equal(unauthorized.status, 403);

  const authorized = await requestJson({ port, method: 'GET', route: '/v1/pty/sessions', token });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.success, true);

  const originBlocked = await requestJson({
    port,
    method: 'GET',
    route: '/v1/pty/sessions',
    token,
    origin: 'https://evil.example'
  });
  assert.equal(originBlocked.status, 403);

  const invalidTask = await requestJson({
    port,
    method: 'POST',
    route: '/v1/pty/create',
    token,
    body: { taskId: 'bad id', cwd: tempProject }
  });
  assert.equal(invalidTask.status, 400);

  const createPty = await requestJson({
    port,
    method: 'POST',
    route: '/v1/pty/create',
    token,
    body: { taskId: 'task-1', cwd: tempProject }
  });
  assert.equal(createPty.status, 200);
  assert.equal(createPty.body.success, true);

  const oversizedWrite = await requestJson({
    port,
    method: 'POST',
    route: '/v1/pty/write',
    token,
    body: { taskId: 'task-1', data: 'x'.repeat(70000) }
  });
  assert.equal(oversizedWrite.status, 413);

  const attach = await requestJson({
    port,
    method: 'POST',
    route: '/v1/pty/attach',
    token,
    body: { taskId: 'task-1', subscriberId: 'integration' }
  });
  assert.equal(attach.status, 200);
  assert.equal(attach.body.success, true);

  const validateSource = await requestJson({
    port,
    method: 'POST',
    route: '/v1/git/validate',
    token,
    body: { sourcePath: tempProject }
  });
  assert.equal(validateSource.status, 200);
  assert.equal(validateSource.body.valid, true);

  const createWorktree = await requestJson({
    port,
    method: 'POST',
    route: '/v1/git/worktree/create',
    token,
    body: {
      basePath: tempProject,
      taskName: 'daemon-worktree',
      baseBranch: 'main',
      options: {
        createBaseBranchIfMissing: true,
        packageStoreStrategy: 'off'
      }
    }
  });
  assert.equal(createWorktree.status, 200);
  assert.equal(createWorktree.body.success, true);

  const listWorktrees = await requestJson({
    port,
    method: 'POST',
    route: '/v1/git/worktree/list',
    token,
    body: { basePath: tempProject }
  });
  assert.equal(listWorktrees.status, 200);
  assert.equal(listWorktrees.body.success, true);
  assert.ok(Array.isArray(listWorktrees.body.worktrees));

  const destroy = await requestJson({
    port,
    method: 'POST',
    route: '/v1/pty/destroy',
    token,
    body: { taskId: 'task-1' }
  });
  assert.equal(destroy.status, 200);
  assert.equal(destroy.body.success, true);
});
