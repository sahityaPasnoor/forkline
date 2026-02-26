"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentControlServer = void 0;
const http_1 = __importDefault(require("http"));
const node_fs_1 = __importDefault(require("node:fs"));
const crypto_1 = __importDefault(require("crypto"));
class AgentControlServer {
    server;
    port = 34567;
    authToken = crypto_1.default.randomBytes(24).toString('base64url');
    allowedActions = new Set(['merge', 'todos', 'message', 'usage', 'metrics']);
    approvalCallbackTimeoutMs = 10 * 60 * 1000;
    resolvedRetentionMs = 7 * 24 * 60 * 60 * 1000;
    maxResolvedRecords = 2_000;
    persistencePath;
    mainWindow;
    approvalsById = new Map();
    responseCallbacks = new Map();
    callbackTimeouts = new Map();
    constructor(options) {
        this.mainWindow = options.mainWindow;
        this.persistencePath = options.persistencePath;
        this.loadApprovalsFromDisk();
        this.server = http_1.default.createServer((req, res) => {
            void this.handleRequest(req, res);
        });
        this.listenWithRetry(this.port);
    }
    secureTokenEquals(a, b) {
        const left = Buffer.from(a, 'utf8');
        const right = Buffer.from(b, 'utf8');
        if (left.length !== right.length)
            return false;
        try {
            return crypto_1.default.timingSafeEqual(left, right);
        }
        catch {
            return false;
        }
    }
    sendJson(res, statusCode, data) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    isLoopbackRequest(req) {
        const remoteAddress = req.socket.remoteAddress || '';
        return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
    }
    isAuthorized(req) {
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
    readRequestBody(req, maxBytes = 1_000_000) {
        return new Promise((resolve) => {
            let body = '';
            let receivedBytes = 0;
            let tooLarge = false;
            let settled = false;
            const finish = (result) => {
                if (settled)
                    return;
                settled = true;
                resolve(result);
            };
            req.on('data', (chunk) => {
                if (tooLarge)
                    return;
                receivedBytes += chunk.length;
                if (receivedBytes > maxBytes) {
                    tooLarge = true;
                    finish({ ok: false });
                    return;
                }
                body += chunk.toString('utf8');
            });
            req.on('end', () => {
                if (tooLarge)
                    return;
                if (!body.trim()) {
                    finish({ ok: true, payload: {} });
                    return;
                }
                try {
                    finish({ ok: true, payload: JSON.parse(body) });
                }
                catch {
                    finish({ ok: true, payload: {} });
                }
            });
            req.on('error', () => {
                finish({ ok: false });
            });
        });
    }
    generateRequestId() {
        return `${Date.now()}-${crypto_1.default.randomBytes(6).toString('hex')}`;
    }
    normalizeApprovalRecord(input) {
        if (!input || typeof input !== 'object')
            return null;
        const source = input;
        const requestId = typeof source.requestId === 'string' ? source.requestId.trim() : '';
        const taskId = typeof source.taskId === 'string' ? source.taskId.trim() : '';
        const action = typeof source.action === 'string' ? source.action.trim() : '';
        if (!requestId || !taskId || !action)
            return null;
        const createdAt = typeof source.createdAt === 'number' ? source.createdAt : Date.now();
        const updatedAt = typeof source.updatedAt === 'number' ? source.updatedAt : createdAt;
        const statusRaw = typeof source.status === 'string' ? source.status : 'pending';
        const status = statusRaw === 'approved' || statusRaw === 'rejected' || statusRaw === 'timed_out'
            ? statusRaw
            : 'pending';
        const payload = source.payload ?? {};
        let decision;
        if (source.decision && typeof source.decision === 'object') {
            const decisionSource = source.decision;
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
    pruneApprovals() {
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
    saveApprovalsToDisk() {
        try {
            this.pruneApprovals();
            const payload = {
                version: 1,
                approvals: Array.from(this.approvalsById.values()).sort((a, b) => a.createdAt - b.createdAt)
            };
            node_fs_1.default.writeFileSync(this.persistencePath, JSON.stringify(payload, null, 2), 'utf8');
        }
        catch {
            // Persistence is best-effort; in-memory queue still functions.
        }
    }
    loadApprovalsFromDisk() {
        try {
            if (!node_fs_1.default.existsSync(this.persistencePath))
                return;
            const stats = node_fs_1.default.statSync(this.persistencePath);
            if (!stats.isFile() || stats.size > 4_000_000)
                return;
            const raw = node_fs_1.default.readFileSync(this.persistencePath, 'utf8');
            const parsed = JSON.parse(raw);
            const approvals = Array.isArray(parsed.approvals) ? parsed.approvals : [];
            approvals.forEach((record) => {
                const normalized = this.normalizeApprovalRecord(record);
                if (!normalized)
                    return;
                this.approvalsById.set(normalized.requestId, normalized);
            });
            this.pruneApprovals();
        }
        catch {
            // If state cannot be read, start cleanly with an empty queue.
            this.approvalsById.clear();
        }
    }
    sendToRenderer(channel, payload) {
        if (!this.mainWindow || this.mainWindow.isDestroyed())
            return;
        this.mainWindow.webContents.send(channel, payload);
    }
    handleApprovalRequested(taskId, action, payload, reqUrl, res) {
        const requestId = this.generateRequestId();
        const now = Date.now();
        const record = {
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
        const outboundPayload = { requestId, taskId, action, payload };
        this.sendToRenderer('agent:request', outboundPayload);
        const waitRequested = reqUrl.searchParams.get('wait');
        const shouldWaitForDecision = waitRequested === '1' || waitRequested === 'true';
        if (shouldWaitForDecision) {
            this.responseCallbacks.set(requestId, res);
            const timeout = setTimeout(() => {
                const callback = this.responseCallbacks.get(requestId);
                if (!callback)
                    return;
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
    handleApprovalStatusLookup(requestId, res) {
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
    async handleRequest(req, res) {
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
            if (!this.allowedActions.has(action)) {
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
    listenWithRetry(startPort) {
        const maxAttempts = 25;
        const attemptListen = (port, attempt) => {
            const onError = (err) => {
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
    respondToAgent(requestId, statusCode, data) {
        const normalizedRequestId = String(requestId || '').trim();
        if (!normalizedRequestId)
            return;
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
    listPendingRequests() {
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
    getPort() {
        return this.port;
    }
    getBaseUrl() {
        return `http://127.0.0.1:${this.port}`;
    }
    getAuthToken() {
        return this.authToken;
    }
    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }
}
exports.AgentControlServer = AgentControlServer;
