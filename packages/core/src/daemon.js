const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { URL } = require('node:url');
const { GitService } = require('./services/git-service');
const { PtyService } = require('./services/pty-service');

const DEFAULT_PORT = 34600;
const DEFAULT_MAX_BODY_BYTES = 2_000_000;
const DEFAULT_MAX_PTY_WRITE_BYTES = 64_000;
const DEFAULT_MAX_SSE_CLIENTS = 64;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 1200;
const DEFAULT_MAX_PTY_SESSIONS = 256;
const TASK_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

const toInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const toSafeFsPath = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) return null;
  return resolved;
};

const toTaskId = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return TASK_ID_PATTERN.test(trimmed) ? trimmed : null;
};

const toShortString = (value, max = 240) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, max);
};

const isLoopbackRemote = (remoteAddress) => {
  const address = remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
};

const json = (res, code, payload) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
};

const secureTokenEquals = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
};

class CoreDaemon {
  constructor(options = {}) {
    this.requireAuth = options.requireAuth !== false;
    const suppliedToken = String(options.authToken || process.env.FORKLINE_CORE_TOKEN || '').trim();
    this.authToken = suppliedToken || crypto.randomBytes(24).toString('base64url');
    this.maxBodyBytes = toInteger(options.maxBodyBytes ?? process.env.FORKLINE_CORE_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES, 1024, 10_000_000);
    this.maxPtyWriteBytes = toInteger(options.maxPtyWriteBytes ?? process.env.FORKLINE_CORE_MAX_PTY_WRITE_BYTES, DEFAULT_MAX_PTY_WRITE_BYTES, 64, 500_000);
    this.maxSseClients = toInteger(options.maxSseClients ?? process.env.FORKLINE_CORE_MAX_SSE_CLIENTS, DEFAULT_MAX_SSE_CLIENTS, 1, 500);
    this.maxRequestsPerMinute = toInteger(options.maxRequestsPerMinute ?? process.env.FORKLINE_CORE_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT_PER_MINUTE, 30, 50_000);
    this.requestCounters = new Map();

    this.gitService = new GitService();
    this.ptyService = new PtyService({
      maxSessions: toInteger(options.maxPtySessions ?? process.env.FORKLINE_CORE_MAX_PTY_SESSIONS, DEFAULT_MAX_PTY_SESSIONS, 1, 4096)
    });
    this.sseClients = new Set();
    this.server = http.createServer(this.handleRequest.bind(this));
    this.port = DEFAULT_PORT;
    this.bindEvents();
  }

  bindEvents() {
    const emit = (type, payload) => this.broadcastEvent(type, payload);
    this.ptyService.on('started', (payload) => emit('pty.started', payload));
    this.ptyService.on('state', (payload) => emit('pty.state', payload));
    this.ptyService.on('activity', (payload) => emit('pty.activity', payload));
    this.ptyService.on('data', (payload) => emit('pty.data', payload));
    this.ptyService.on('mode', (payload) => emit('pty.mode', payload));
    this.ptyService.on('blocked', (payload) => emit('pty.blocked', payload));
    this.ptyService.on('exit', (payload) => emit('pty.exit', payload));
    this.ptyService.on('destroyed', (payload) => emit('pty.destroyed', payload));
  }

  broadcastEvent(type, payload) {
    const envelope = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      type,
      payload
    };
    const line = `data: ${JSON.stringify(envelope)}\n\n`;
    for (const client of Array.from(this.sseClients)) {
      try {
        client.write(line);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  isAuthorizedRequest(req) {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    const xToken = Array.isArray(req.headers['x-forkline-token'])
      ? req.headers['x-forkline-token'][0]
      : req.headers['x-forkline-token'];

    const bearerToken = (typeof authHeader === 'string' && authHeader.startsWith('Bearer '))
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    const providedToken = bearerToken || (typeof xToken === 'string' ? xToken.trim() : '');
    if (!providedToken) return false;
    return secureTokenEquals(providedToken, this.authToken);
  }

  consumeRateLimit(remoteAddress) {
    const key = remoteAddress || 'unknown';
    const now = Date.now();
    const existing = this.requestCounters.get(key);

    if (!existing || now - existing.windowStart >= 60_000) {
      this.requestCounters.set(key, { windowStart: now, count: 1 });
      return true;
    }

    if (existing.count >= this.maxRequestsPerMinute) {
      return false;
    }

    existing.count += 1;
    return true;
  }

  parseJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      let bodyBytes = 0;
      req.on('data', (chunk) => {
        bodyBytes += chunk.length;
        if (bodyBytes > this.maxBodyBytes) {
          reject(new Error('Payload too large'));
          req.destroy();
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => {
        if (!body) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  async handleRequest(req, res) {
    const remoteAddress = req.socket.remoteAddress || '';
    if (!isLoopbackRemote(remoteAddress)) {
      json(res, 403, { success: false, error: 'Forbidden' });
      return;
    }

    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (typeof origin === 'string' && origin.trim()) {
      json(res, 403, { success: false, error: 'Cross-origin browser requests are not allowed.' });
      return;
    }

    if (!this.consumeRateLimit(remoteAddress)) {
      json(res, 429, { success: false, error: 'Rate limit exceeded' });
      return;
    }

    if (req.method === 'OPTIONS') {
      json(res, 405, { success: false, error: 'Method not allowed' });
      return;
    }

    const method = req.method || 'GET';
    const parsed = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = parsed.pathname;

    const isPublic = pathname === '/v1/health' || pathname === '/v1/version';
    if (this.requireAuth && !isPublic && !this.isAuthorizedRequest(req)) {
      json(res, 403, { success: false, error: 'Unauthorized' });
      return;
    }

    try {
      if (method === 'GET' && pathname === '/v1/health') {
        json(res, 200, { ok: true, service: 'forkline-core', port: this.port, authRequired: this.requireAuth });
        return;
      }

      if (method === 'GET' && pathname === '/v1/version') {
        json(res, 200, { version: '0.3.0', api: 'v1' });
        return;
      }

      if (method === 'GET' && pathname === '/v1/events') {
        if (this.sseClients.size >= this.maxSseClients) {
          json(res, 429, { success: false, error: 'Too many SSE clients' });
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-store',
          connection: 'keep-alive',
          'x-content-type-options': 'nosniff'
        });
        res.write(': connected\n\n');
        this.sseClients.add(res);
        req.on('close', () => {
          this.sseClients.delete(res);
        });
        return;
      }

      if (method === 'GET' && pathname === '/v1/pty/sessions') {
        json(res, 200, { success: true, sessions: this.ptyService.listSessions() });
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/validate') {
        const body = await this.parseJsonBody(req);
        const sourcePath = toSafeFsPath(body.sourcePath);
        if (!sourcePath) {
          json(res, 400, { success: false, error: 'Invalid sourcePath' });
          return;
        }
        const result = await this.gitService.validateSource(sourcePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/create') {
        const body = await this.parseJsonBody(req);
        const basePath = toSafeFsPath(body.basePath);
        const taskName = toShortString(body.taskName, 128);
        const baseBranch = toShortString(body.baseBranch, 128);
        const options = body.options && typeof body.options === 'object' ? body.options : {};
        const createBaseBranchIfMissing = (options.createBaseBranchIfMissing ?? body.createBaseBranchIfMissing) === true;
        const dependencyCloneMode = options.dependencyCloneMode === 'full_copy' || body.dependencyCloneMode === 'full_copy'
          ? 'full_copy'
          : 'copy_on_write';
        const packageStoreStrategy = toShortString(options.packageStoreStrategy ?? body.packageStoreStrategy, 32).toLowerCase();
        const pnpmStorePath = toSafeFsPath(options.pnpmStorePath ?? body.pnpmStorePath) || '';
        const sharedCacheRoot = toSafeFsPath(options.sharedCacheRoot ?? body.sharedCacheRoot) || '';
        const pnpmAutoInstall = (options.pnpmAutoInstall ?? body.pnpmAutoInstall) === true;
        if (!basePath || !taskName) {
          json(res, 400, { success: false, error: 'Invalid worktree create request.' });
          return;
        }
        const result = await this.gitService.createWorktree(basePath, taskName, baseBranch, {
          createBaseBranchIfMissing,
          dependencyCloneMode,
          packageStoreStrategy: packageStoreStrategy || 'off',
          pnpmStorePath,
          sharedCacheRoot,
          pnpmAutoInstall
        });
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/list') {
        const body = await this.parseJsonBody(req);
        const basePath = toSafeFsPath(body.basePath);
        if (!basePath) {
          json(res, 400, { success: false, error: 'Invalid basePath' });
          return;
        }
        const result = await this.gitService.listWorktrees(basePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/branches/list') {
        const body = await this.parseJsonBody(req);
        const basePath = toSafeFsPath(body.basePath);
        if (!basePath) {
          json(res, 400, { success: false, error: 'Invalid basePath' });
          return;
        }
        const result = await this.gitService.listBranches(basePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/remove') {
        const body = await this.parseJsonBody(req);
        const basePath = toSafeFsPath(body.basePath);
        const worktreePath = toSafeFsPath(body.worktreePath);
        const taskName = toShortString(body.taskName, 128);
        if (!basePath || !worktreePath || !taskName) {
          json(res, 400, { success: false, error: 'Invalid worktree remove request.' });
          return;
        }
        const result = await this.gitService.removeWorktree(basePath, taskName, worktreePath, !!body.force);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/merge') {
        const body = await this.parseJsonBody(req);
        const basePath = toSafeFsPath(body.basePath);
        const worktreePath = toSafeFsPath(body.worktreePath);
        const taskName = toShortString(body.taskName, 128);
        if (!basePath || !worktreePath || !taskName) {
          json(res, 400, { success: false, error: 'Invalid worktree merge request.' });
          return;
        }
        const result = await this.gitService.mergeWorktree(basePath, taskName, worktreePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/diff') {
        const body = await this.parseJsonBody(req);
        const worktreePath = toSafeFsPath(body.worktreePath);
        if (!worktreePath) {
          json(res, 400, { success: false, error: 'Invalid worktreePath' });
          return;
        }
        const result = await this.gitService.getDiff(worktreePath, { syntaxAware: body.syntaxAware === true });
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/modified-files') {
        const body = await this.parseJsonBody(req);
        const worktreePath = toSafeFsPath(body.worktreePath);
        if (!worktreePath) {
          json(res, 400, { success: false, error: 'Invalid worktreePath' });
          return;
        }
        const result = await this.gitService.getModifiedFiles(worktreePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/create') {
        const body = await this.parseJsonBody(req);
        const taskId = toTaskId(body.taskId);
        const cwd = toSafeFsPath(body.cwd) || process.cwd();
        const subscriberId = toShortString(body.subscriberId, 128) || 'http';
        if (!taskId) {
          json(res, 400, { success: false, error: 'Invalid taskId' });
          return;
        }
        const result = this.ptyService.createSession(taskId, cwd, body.customEnv, subscriberId);
        if (result?.error) {
          json(res, 409, { success: false, error: result.error });
          return;
        }
        json(res, 200, { success: true, ...result });
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/attach') {
        const body = await this.parseJsonBody(req);
        const taskId = toTaskId(body.taskId);
        const subscriberId = toShortString(body.subscriberId, 128) || 'http';
        if (!taskId) {
          json(res, 400, { success: false, error: 'Invalid taskId' });
          return;
        }
        const state = this.ptyService.attach(taskId, subscriberId);
        if (!state) {
          json(res, 404, { success: false, error: 'Task session not found' });
          return;
        }
        json(res, 200, { success: true, state });
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/detach') {
        const body = await this.parseJsonBody(req);
        const taskId = toTaskId(body.taskId);
        const subscriberId = toShortString(body.subscriberId, 128) || 'http';
        if (!taskId) {
          json(res, 400, { success: false, error: 'Invalid taskId' });
          return;
        }
        this.ptyService.detach(taskId, subscriberId);
        json(res, 200, { success: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/write') {
        const body = await this.parseJsonBody(req);
        const taskId = toTaskId(body.taskId);
        const data = typeof body.data === 'string' ? body.data : '';
        if (!taskId) {
          json(res, 400, { success: false, error: 'Invalid taskId' });
          return;
        }
        if (Buffer.byteLength(data, 'utf8') > this.maxPtyWriteBytes) {
          json(res, 413, { success: false, error: 'Write payload too large' });
          return;
        }
        const result = this.ptyService.write(taskId, data);
        json(res, result.success ? 200 : 409, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/resize') {
        const body = await this.parseJsonBody(req);
        const taskId = toTaskId(body.taskId);
        const cols = toInteger(body.cols, 80, 20, 1000);
        const rows = toInteger(body.rows, 24, 10, 1000);
        if (!taskId) {
          json(res, 400, { success: false, error: 'Invalid taskId' });
          return;
        }
        const result = this.ptyService.resize(taskId, cols, rows);
        json(res, result.success ? 200 : 404, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/destroy') {
        const body = await this.parseJsonBody(req);
        const taskId = toTaskId(body.taskId);
        if (!taskId) {
          json(res, 400, { success: false, error: 'Invalid taskId' });
          return;
        }
        const result = this.ptyService.destroy(taskId);
        json(res, 200, result);
        return;
      }

      json(res, 404, { success: false, error: 'Not found' });
    } catch (error) {
      json(res, 500, { success: false, error: error?.message || String(error) });
    }
  }

  start(port = DEFAULT_PORT, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.removeListener('error', reject);
        this.port = port;
        resolve({ port, host, authRequired: this.requireAuth });
      });
    });
  }

  getAuthToken() {
    return this.authToken;
  }

  stop() {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

module.exports = { CoreDaemon, DEFAULT_PORT };
