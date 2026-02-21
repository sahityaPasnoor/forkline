"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentControlServer = void 0;
const http_1 = __importDefault(require("http"));
class AgentControlServer {
    mainWindow;
    server;
    port = 34567;
    responseCallbacks = new Map();
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.server = http_1.default.createServer((req, res) => {
            // CORS headers for local access
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            if (req.method === 'POST' && req.url?.startsWith('/api/task/')) {
                const parts = req.url.split('/');
                // /api/task/:taskId/:action
                const taskId = parts[3];
                const action = parts[4];
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    let payload = {};
                    try {
                        if (body)
                            payload = JSON.parse(body);
                    }
                    catch (e) { }
                    // Synchronous updates that don't need approval
                    if (action === 'todos' || action === 'message') {
                        this.mainWindow.webContents.send(`agent:${action}`, { taskId, payload });
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
        this.server.listen(this.port, '127.0.0.1', () => {
            console.log(`Agent Control Server listening on port ${this.port}`);
        });
    }
    respondToAgent(requestId, statusCode, data) {
        const res = this.responseCallbacks.get(requestId);
        if (res) {
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
            this.responseCallbacks.delete(requestId);
        }
    }
    getPort() {
        return this.port;
    }
}
exports.AgentControlServer = AgentControlServer;
