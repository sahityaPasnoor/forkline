const http = require('node:http');
const { URL } = require('node:url');
const { GitService } = require('./services/git-service');
const { PtyService } = require('./services/pty-service');

const DEFAULT_PORT = 34600;

const json = (res, code, payload) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
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

class CoreDaemon {
  constructor() {
    this.gitService = new GitService();
    this.ptyService = new PtyService();
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

  async handleRequest(req, res) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const method = req.method || 'GET';
    const parsed = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = parsed.pathname;

    try {
      if (method === 'GET' && pathname === '/v1/health') {
        json(res, 200, { ok: true, service: 'forkline-core', port: this.port });
        return;
      }

      if (method === 'GET' && pathname === '/v1/version') {
        json(res, 200, { version: '0.2.0', api: 'v1' });
        return;
      }

      if (method === 'GET' && pathname === '/v1/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
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
        const body = await parseBody(req);
        const result = await this.gitService.validateSource(body.sourcePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/create') {
        const body = await parseBody(req);
        const result = await this.gitService.createWorktree(body.basePath, body.taskName);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/list') {
        const body = await parseBody(req);
        const result = await this.gitService.listWorktrees(body.basePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/remove') {
        const body = await parseBody(req);
        const result = await this.gitService.removeWorktree(body.basePath, body.taskName, body.worktreePath, !!body.force);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/worktree/merge') {
        const body = await parseBody(req);
        const result = await this.gitService.mergeWorktree(body.basePath, body.taskName, body.worktreePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/diff') {
        const body = await parseBody(req);
        const result = await this.gitService.getDiff(body.worktreePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/git/modified-files') {
        const body = await parseBody(req);
        const result = await this.gitService.getModifiedFiles(body.worktreePath);
        json(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/create') {
        const body = await parseBody(req);
        const result = this.ptyService.createSession(body.taskId, body.cwd, body.customEnv, body.subscriberId || 'http');
        json(res, 200, { success: true, ...result });
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/attach') {
        const body = await parseBody(req);
        const state = this.ptyService.attach(body.taskId, body.subscriberId || 'http');
        if (!state) {
          json(res, 404, { success: false, error: 'Task session not found' });
          return;
        }
        json(res, 200, { success: true, state });
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/detach') {
        const body = await parseBody(req);
        this.ptyService.detach(body.taskId, body.subscriberId || 'http');
        json(res, 200, { success: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/write') {
        const body = await parseBody(req);
        const result = this.ptyService.write(body.taskId, body.data || '');
        json(res, result.success ? 200 : 409, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/resize') {
        const body = await parseBody(req);
        const result = this.ptyService.resize(body.taskId, body.cols || 80, body.rows || 24);
        json(res, result.success ? 200 : 404, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/pty/destroy') {
        const body = await parseBody(req);
        const result = this.ptyService.destroy(body.taskId);
        json(res, 200, result);
        return;
      }

      json(res, 404, { error: 'Not found' });
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
        resolve({ port, host });
      });
    });
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
