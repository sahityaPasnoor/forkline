"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PtyManager = void 0;
const pty = __importStar(require("node-pty"));
const electron_1 = require("electron");
const os_1 = __importDefault(require("os"));
const shell = os_1.default.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
class PtyManager {
    sessions = new Map();
    constructor() {
        electron_1.ipcMain.on('pty:create', (event, { taskId, cwd, customEnv }) => {
            if (this.sessions.has(taskId)) {
                return; // Already exists
            }
            const mergedEnv = { ...process.env, ...(customEnv || {}) };
            const ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: cwd || process.env.HOME,
                env: mergedEnv
            });
            // Regex to detect common CLI prompts waiting for input
            const blockRegex = /([\[\(][yY]\/[nN][\]\)])|(\?\s*$)|(Press Enter)|(Select an option)/i;
            ptyProcess.onData((data) => {
                event.sender.send(`pty:data:${taskId}`, data);
                // Check if agent is blocked waiting for input
                if (blockRegex.test(data)) {
                    const session = this.sessions.get(taskId);
                    if (session && !session.isBlocked) {
                        session.isBlocked = true;
                        event.sender.send('agent:blocked', { taskId, isBlocked: true });
                    }
                }
            });
            this.sessions.set(taskId, { ptyProcess, taskId, isBlocked: false });
        });
        electron_1.ipcMain.on('pty:write', (event, { taskId, data }) => {
            const session = this.sessions.get(taskId);
            if (session) {
                session.ptyProcess.write(data);
                // Clear blocked state when user interacts
                if (session.isBlocked) {
                    session.isBlocked = false;
                    event.sender.send('agent:blocked', { taskId, isBlocked: false });
                }
            }
        });
        electron_1.ipcMain.on('pty:resize', (event, { taskId, cols, rows }) => {
            const session = this.sessions.get(taskId);
            if (session) {
                session.ptyProcess.resize(cols, rows);
            }
        });
        electron_1.ipcMain.on('pty:destroy', (event, { taskId }) => {
            const session = this.sessions.get(taskId);
            if (session) {
                session.ptyProcess.kill();
                this.sessions.delete(taskId);
            }
        });
    }
}
exports.PtyManager = PtyManager;
