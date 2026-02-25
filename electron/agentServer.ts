import http from 'http';
import fs from 'node:fs';
import crypto from 'crypto';
import { BrowserWindow } from 'electron';

type AgentAction = 'merge' | 'todos' | 'message' | 'usage' | 'metrics';
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timed_out';

interface ApprovalDecision {
  statusCode: number;
  data: unknown;
  resolvedAt: number;
}

interface ApprovalRecord {
  requestId: string;
  taskId: string;
  action: string;
  payload: unknown;
  status: ApprovalStatus;
  createdAt: number;
  updatedAt: number;
  decision?: ApprovalDecision;
}

interface PersistedApprovalStore {
  version: 1;
  approvals: ApprovalRecord[];
}

interface AgentControlServerOptions {
  mainWindow: BrowserWindow | null;
  persistencePath: string;
}

interface AgentRequestPayload {
  requestId: string;
  taskId: string;
  action: string;
  payload: unknown;
}

export class AgentControlServer {
  private server: http.Server;
  private port = 34567;
  private readonly authToken = crypto.randomBytes(24).toString('base64url');
  private readonly allowedActions = new Set<AgentAction>(['merge', 'todos', 'message', 'usage', 'metrics']);
  private readonly approvalCallbackTimeoutMs = 10 * 60 * 1000;
  private readonly resolvedRetentionMs = 7 * 24 * 60 * 60 * 1000;
  private readonly maxResolvedRecords = 2_000;
  private readonly persistencePath: string;
  private mainWindow: BrowserWindow | null;
  private readonly approvalsById = new Map<string, ApprovalRecord>();
  private readonly responseCallbacks = new Map<string, http.ServerResponse>();
  private readonly callbackTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(options: AgentControlServerOptions) {
    this.mainWindow = options.mainWindow;
    this.persistencePath = options.persistencePath;
    this.loadApprovalsFromDisk();
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    this.listenWithRetry(this.port);
  }

  private secureTokenEquals(a: string, b: string) {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    try {
      return crypto.timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private isLoopbackRequest(req: http.IncomingMessage) {
    const remoteAddress = req.socket.remoteAddress || '';
    return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  }

  private isAuthorized(req: http.IncomingMessage) {
    const authHeader = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
    const tokenFromHeader = Array.isArray(req.headers['x-forkline-token'])
      ? req.headers['x-forkline-token'][0]
      : req.headers['x-forkline-token'];
    const bearerToken = (typeof authHeader === 'string' && authHeader.startsWith('Bearer '))
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    const providedToken = bearerToken || (typeof tokenFromHeader === 'string' ? tokenFromHeader.trim() : '');
    return !!providedToken && this.secureTokenEquals(providedToken, this.authToken);
  }

  private readRequestBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<{ ok: true; payload: unknown } | { ok: false }> {
    return new Promise((resolve) => {
      let body = '';
      let receivedBytes = 0;
      let tooLarge = false;
      let settled = false;
      const finish = (result: { ok: true; payload: unknown } | { ok: false }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      req.on('data', (chunk: Buffer) => {
        if (tooLarge) return;
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          tooLarge = true;
          finish({ ok: false });
          return;
        }
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        if (tooLarge) return;
        if (!body.trim()) {
          finish({ ok: true, payload: {} });
          return;
        }
        try {
          finish({ ok: true, payload: JSON.parse(body) });
        } catch {
          finish({ ok: true, payload: {} });
        }
      });
      req.on('error', () => {
        finish({ ok: false });
      });
    });
  }

  private generateRequestId() {
    return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  }

  private normalizeApprovalRecord(input: unknown): ApprovalRecord | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as Record<string, unknown>;
    const requestId = typeof source.requestId === 'string' ? source.requestId.trim() : '';
    const taskId = typeof source.taskId === 'string' ? source.taskId.trim() : '';
    const action = typeof source.action === 'string' ? source.action.trim() : '';
    if (!requestId || !taskId || !action) return null;
    const createdAt = typeof source.createdAt === 'number' ? source.createdAt : Date.now();
    const updatedAt = typeof source.updatedAt === 'number' ? source.updatedAt : createdAt;
    const statusRaw = typeof source.status === 'string' ? source.status : 'pending';
    const status: ApprovalStatus = statusRaw === 'approved' || statusRaw === 'rejected' || statusRaw === 'timed_out'
      ? statusRaw
      : 'pending';
    const payload = source.payload ?? {};
    let decision: ApprovalDecision | undefined;
    if (source.decision && typeof source.decision === 'object') {
      const decisionSource = source.decision as Record<string, unknown>;
      const statusCode = typeof decisionSource.statusCode === 'number' ? decisionSource.statusCode : undefined;
      const resolvedAt = typeof decisionSource.resolvedAt === 'number' ? decisionSource.resolvedAt : undefined;
      if (typeof statusCode === 'number' && typeof resolvedAt === 'number') {
        decision = {
          statusCode,
          resolvedAt,
          data: decisionSource.data
        };
      }
    }
    return {
      requestId,
      taskId,
      action,
      payload,
      status,
      createdAt,
      updatedAt,
      decision
    };
  }

  private pruneApprovals() {
    const now = Date.now();
    const allRecords = Array.from(this.approvalsById.values());
    const pending = allRecords.filter((record) => record.status === 'pending');
    const resolved = allRecords
      .filter((record) => record.status !== 'pending' && now - record.updatedAt <= this.resolvedRetentionMs)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, this.maxResolvedRecords);
    this.approvalsById.clear();
    for (const record of [...pending, ...resolved]) {
      this.approvalsById.set(record.requestId, record);
    }
  }

  private saveApprovalsToDisk() {
    try {
      this.pruneApprovals();
      const payload: PersistedApprovalStore = {
        version: 1,
        approvals: Array.from(this.approvalsById.values()).sort((a, b) => a.createdAt - b.createdAt)
      };
      fs.writeFileSync(this.persistencePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Persistence is best-effort; in-memory queue still functions.
    }
  }

  private loadApprovalsFromDisk() {
    try {
      if (!fs.existsSync(this.persistencePath)) return;
      const stats = fs.statSync(this.persistencePath);
      if (!stats.isFile() || stats.size > 4_000_000) return;
      const raw = fs.readFileSync(this.persistencePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedApprovalStore>;
      const approvals = Array.isArray(parsed.approvals) ? parsed.approvals : [];
      approvals.forEach((record) => {
        const normalized = this.normalizeApprovalRecord(record);
        if (!normalized) return;
        this.approvalsById.set(normalized.requestId, normalized);
      });
      this.pruneApprovals();
    } catch {
      // If state cannot be read, start cleanly with an empty queue.
      this.approvalsById.clear();
    }
  }

  private sendToRenderer(channel: string, payload: unknown) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(channel, payload);
  }

  private handleApprovalRequested(taskId: string, action: string, payload: unknown, reqUrl: URL, res: http.ServerResponse) {
    const requestId = this.generateRequestId();
    const now = Date.now();
    const record: ApprovalRecord = {
      requestId,
      taskId,
      action,
      payload,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };
    this.approvalsById.set(requestId, record);
    this.saveApprovalsToDisk();

    const outboundPayload: AgentRequestPayload = { requestId, taskId, action, payload };
    this.sendToRenderer('agent:request', outboundPayload);

    const waitRequested = reqUrl.searchParams.get('wait');
    const shouldWaitForDecision = waitRequested === '1' || waitRequested === 'true';
    if (shouldWaitForDecision) {
      this.responseCallbacks.set(requestId, res);
      const timeout = setTimeout(() => {
        const callback = this.responseCallbacks.get(requestId);
        if (!callback) return;
        this.responseCallbacks.delete(requestId);
        this.callbackTimeouts.delete(requestId);
        const timedOut = this.approvalsById.get(requestId);
        if (timedOut && timedOut.status === 'pending') {
          timedOut.status = 'timed_out';
          timedOut.updatedAt = Date.now();
          timedOut.decision = {
            statusCode: 408,
            data: { error: 'Request timed out or user ignored.' },
            resolvedAt: Date.now()
          };
          this.saveApprovalsToDisk();
        }
        this.sendJson(callback, 408, { error: 'Request timed out or user ignored.', requestId });
      }, this.approvalCallbackTimeoutMs);
      this.callbackTimeouts.set(requestId, timeout);
      return;
    }

    this.sendJson(res, 202, {
      success: true,
      status: 'pending',
      requestId,
      pollUrl: `${this.getBaseUrl()}/api/approval/${requestId}`
    });
  }

  private handleApprovalStatusLookup(requestId: string, res: http.ServerResponse) {
    const normalizedRequestId = requestId.trim();
    if (!normalizedRequestId || !/^[a-zA-Z0-9._-]+$/.test(normalizedRequestId)) {
      this.sendJson(res, 400, { error: 'Invalid request id.' });
      return;
    }
    const record = this.approvalsById.get(normalizedRequestId);
    if (!record) {
      this.sendJson(res, 404, { error: 'Approval request not found.' });
      return;
    }
    this.sendJson(res, 200, {
      success: true,
      requestId: record.requestId,
      taskId: record.taskId,
      action: record.action,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      decision: record.decision || null
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.isLoopbackRequest(req)) {
      this.sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (typeof origin === 'string' && origin.trim()) {
      this.sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }

    if (req.method === 'OPTIONS') {
      this.sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const reqUrl = req.url ? new URL(req.url, 'http://127.0.0.1') : null;
    if (!reqUrl) {
      this.sendJson(res, 400, { error: 'Invalid request URL.' });
      return;
    }

    if (!this.isAuthorized(req)) {
      this.sendJson(res, 403, { error: 'Unauthorized control request.' });
      return;
    }

    const reqPath = reqUrl.pathname;
    if (req.method === 'GET' && reqPath.startsWith('/api/approval/')) {
      const parts = reqPath.split('/');
      const requestId = parts[3];
      if (!requestId) {
        this.sendJson(res, 400, { error: 'Invalid approval route.' });
        return;
      }
      this.handleApprovalStatusLookup(requestId, res);
      return;
    }

    if (req.method === 'POST' && reqPath.startsWith('/api/task/')) {
      const parts = reqPath.split('/');
      const taskId = parts[3];
      const action = parts[4];
      if (!taskId || !action || !/^[a-zA-Z0-9._-]+$/.test(taskId) || !/^[a-zA-Z0-9_-]+$/.test(action)) {
        this.sendJson(res, 400, { error: 'Invalid task route.' });
        return;
      }
      if (!this.allowedActions.has(action as AgentAction)) {
        this.sendJson(res, 400, { error: `Unsupported action: ${action}` });
        return;
      }

      const body = await this.readRequestBody(req);
      if (!body.ok) {
        this.sendJson(res, 413, { error: 'Payload too large.' });
        return;
      }

      const payload = body.payload;
      const normalizedAction = action === 'metrics' ? 'usage' : action;
      if (normalizedAction === 'todos' || normalizedAction === 'message' || normalizedAction === 'usage') {
        this.sendToRenderer(`agent:${normalizedAction}`, { taskId, payload });
        this.sendJson(res, 200, { success: true });
        return;
      }

      this.handleApprovalRequested(taskId, action, payload, reqUrl, res);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  private listenWithRetry(startPort: number) {
    const maxAttempts = 25;
    const attemptListen = (port: number, attempt: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        this.server.removeListener('error', onError);
        if (err?.code === 'EADDRINUSE' && attempt < maxAttempts) {
          const nextPort = port + 1;
          this.port = nextPort;
          setTimeout(() => attemptListen(nextPort, attempt + 1), 25);
          return;
        }
        // eslint-disable-next-line no-console
        console.error('[agent-server] Failed to bind control server:', err);
      };

      this.server.once('error', onError);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.removeListener('error', onError);
        this.port = port;
        // eslint-disable-next-line no-console
        console.log(`Agent Control Server listening on port ${this.port}`);
      });
    };

    attemptListen(startPort, 1);
  }

  public respondToAgent(requestId: string, statusCode: number, data: unknown) {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) return;
    const record = this.approvalsById.get(normalizedRequestId);
    if (record) {
      const now = Date.now();
      record.status = (statusCode >= 200 && statusCode < 300) ? 'approved' : 'rejected';
      record.updatedAt = now;
      record.decision = { statusCode, data, resolvedAt: now };
      this.saveApprovalsToDisk();
    }

    const callback = this.responseCallbacks.get(normalizedRequestId);
    if (callback) {
      callback.writeHead(statusCode, { 'Content-Type': 'application/json' });
      callback.end(JSON.stringify(data));
      this.responseCallbacks.delete(normalizedRequestId);
    }
    const timeout = this.callbackTimeouts.get(normalizedRequestId);
    if (timeout) {
      clearTimeout(timeout);
      this.callbackTimeouts.delete(normalizedRequestId);
    }
  }

  public listPendingRequests() {
    return Array.from(this.approvalsById.values())
      .filter((record) => record.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((record) => ({
        requestId: record.requestId,
        taskId: record.taskId,
        action: record.action,
        payload: record.payload,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }));
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

  public setMainWindow(mainWindow: BrowserWindow | null) {
    this.mainWindow = mainWindow;
  }
}
