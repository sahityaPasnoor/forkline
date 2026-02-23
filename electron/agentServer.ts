import http from 'http';
import { BrowserWindow } from 'electron';
import crypto from 'crypto';

export class AgentControlServer {
  private server: http.Server;
  private port = 34567;
  private readonly authToken = crypto.randomBytes(24).toString('base64url');
  private responseCallbacks: Map<string, http.ServerResponse> = new Map();
  private readonly allowedActions = new Set(['merge', 'todos', 'message', 'usage', 'metrics']);

  constructor(private mainWindow: BrowserWindow) {
    this.server = http.createServer((req, res) => {
      const remoteAddress = req.socket.remoteAddress || '';
      const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
      if (!isLoopback) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }

      const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
      if (typeof origin === 'string' && origin.trim()) {
        // Browser-originated cross-origin requests to localhost are not allowed.
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cross-origin requests are not allowed.' }));
        return;
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const reqUrl = req.url ? new URL(req.url, 'http://127.0.0.1') : null;
      if (!reqUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request URL.' }));
        return;
      }
      const tokenFromQuery = reqUrl.searchParams.get('token');
      const tokenFromHeader = Array.isArray(req.headers['x-forkline-token'])
        ? req.headers['x-forkline-token'][0]
        : req.headers['x-forkline-token'];
      const providedToken = (typeof tokenFromHeader === 'string' && tokenFromHeader.trim())
        ? tokenFromHeader.trim()
        : (tokenFromQuery || '').trim();
      if (!providedToken || providedToken !== this.authToken) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized control request.' }));
        return;
      }

      const reqPath = reqUrl.pathname;
      if (req.method === 'POST' && reqPath.startsWith('/api/task/')) {
        const parts = reqPath.split('/');
        // /api/task/:taskId/:action
        const taskId = parts[3];
        const action = parts[4];
        if (!taskId || !action || !/^[a-zA-Z0-9._-]+$/.test(taskId) || !/^[a-zA-Z0-9_-]+$/.test(action)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid task route.' }));
          return;
        }
        if (!this.allowedActions.has(action)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unsupported action: ${action}` }));
          return;
        }

        let body = '';
        let receivedBytes = 0;
        let abortedForSize = false;
        req.on('data', (chunk: Buffer) => {
          if (abortedForSize) return;
          receivedBytes += chunk.length;
          if (receivedBytes > 1_000_000) {
            abortedForSize = true;
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Payload too large.' }));
            req.destroy();
            return;
          }
          body += chunk.toString('utf8');
        });
        req.on('end', () => {
          if (abortedForSize) return;
          let payload = {};
          try { if (body) payload = JSON.parse(body); } catch { payload = {}; }

          // Synchronous updates that don't need approval
          const normalizedAction = action === 'metrics' ? 'usage' : action;
          if (normalizedAction === 'todos' || normalizedAction === 'message' || normalizedAction === 'usage') {
            this.mainWindow.webContents.send(`agent:${normalizedAction}`, { taskId, payload });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
          
          // Store response object to reply later if it's an async approval
          this.responseCallbacks.set(requestId, res);

          // Forward to frontend for permission check
          this.mainWindow.webContents.send('agent:request', {
            requestId,
            taskId,
            action,
            payload
          });

          // Timeout after 60 seconds if frontend doesn't respond
          setTimeout(() => {
            if (this.responseCallbacks.has(requestId)) {
              const resObj = this.responseCallbacks.get(requestId);
              resObj?.writeHead(408, { 'Content-Type': 'application/json' });
              resObj?.end(JSON.stringify({ error: 'Request timed out or user ignored.' }));
              this.responseCallbacks.delete(requestId);
            }
          }, 60000);
        });
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    this.listenWithRetry(this.port);
  }

  private listenWithRetry(startPort: number) {
    const maxAttempts = 25;
    const attemptListen = (port: number, attempt: number) => {
      const onError = (err: any) => {
        this.server.removeListener('error', onError);
        if (err?.code === 'EADDRINUSE' && attempt < maxAttempts) {
          const nextPort = port + 1;
          this.port = nextPort;
          setTimeout(() => attemptListen(nextPort, attempt + 1), 25);
          return;
        }
        console.error('[agent-server] Failed to bind control server:', err);
      };

      this.server.once('error', onError);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.removeListener('error', onError);
        this.port = port;
        console.log(`Agent Control Server listening on port ${this.port}`);
      });
    };

    attemptListen(startPort, 1);
  }

  public respondToAgent(requestId: string, statusCode: number, data: any) {
    const res = this.responseCallbacks.get(requestId);
    if (res) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      this.responseCallbacks.delete(requestId);
    }
  }

  public getPort() {
    return this.port;
  }

  public getBaseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  public getAuthToken() {
    return this.authToken;
  }
}
