"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PtyManager = void 0;
const electron_1 = require("electron");
// Shared core engine implementation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PtyService } = require('../../packages/core/src/services/pty-service');
class PtyManager {
    hooks;
    service;
    rendererSubscribers = new Map();
    static TASK_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
    static ATTACH_CHUNK_SIZE = 64_000;
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.service = new PtyService();
        this.bindCoreEvents();
        this.bindIpc();
    }
    bindCoreEvents() {
        this.service.on('started', ({ taskId, cwd, createdAt }) => {
            this.hooks.onSessionStarted?.({ taskId, cwd, createdAt });
        });
        this.service.on('activity', ({ taskId, at }) => {
            this.hooks.onSessionActivity?.({ taskId, at });
        });
        this.service.on('blocked', ({ taskId, isBlocked, reason }) => {
            this.hooks.onSessionBlocked?.({ taskId, isBlocked, reason });
            this.broadcast(taskId, 'agent:blocked', {
                taskId,
                isBlocked,
                reason: isBlocked ? reason : undefined
            });
        });
        this.service.on('mode', ({ taskId, mode, seq, confidence, source, provider, isBlocked, blockedReason }) => {
            this.hooks.onSessionMode?.({
                taskId,
                mode,
                modeSeq: seq,
                modeConfidence: confidence,
                modeSource: source,
                provider,
                isBlocked: !!isBlocked,
                blockedReason
            });
            this.broadcast(taskId, `pty:mode:${taskId}`, {
                taskId,
                mode,
                modeSeq: seq,
                modeConfidence: confidence,
                modeSource: source,
                provider,
                isBlocked: !!isBlocked,
                blockedReason
            });
        });
        this.service.on('data', ({ taskId, data }) => {
            this.hooks.onSessionData?.({ taskId, data });
            this.broadcast(taskId, `pty:data:${taskId}`, data);
        });
        this.service.on('exit', ({ taskId, exitCode, signal }) => {
            this.hooks.onSessionExited?.({ taskId, exitCode, signal });
            this.broadcast(taskId, `pty:exit:${taskId}`, {
                taskId,
                exitCode,
                signal
            });
        });
        this.service.on('destroyed', ({ taskId }) => {
            this.hooks.onSessionDestroyed?.({ taskId });
            this.rendererSubscribers.delete(taskId);
        });
    }
    bindIpc() {
        electron_1.ipcMain.on('pty:create', (event, { taskId, cwd, customEnv }) => {
            if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
                event.sender.send(`pty:data:${taskId}`, '\r\n[orchestrator] Invalid task id.\r\n');
                return;
            }
            const senderId = event.sender.id;
            const state = this.service.createSession(taskId, cwd || process.env.HOME || '', customEnv || {}, String(senderId));
            if (state && state.error) {
                event.sender.send(`pty:data:${taskId}`, `\r\n[orchestrator] ${state.error}\r\n`);
                return;
            }
            this.trackSubscriber(taskId, senderId);
            const existing = this.service.attach(taskId, String(senderId));
            if (existing?.outputBuffer) {
                this.sendBufferedOutput(event.sender, taskId, existing.outputBuffer);
            }
            if (existing) {
                event.sender.send('agent:blocked', {
                    taskId,
                    isBlocked: !!existing.isBlocked,
                    reason: existing.isBlocked ? existing.blockedReason : undefined
                });
                event.sender.send(`pty:mode:${taskId}`, {
                    taskId,
                    mode: existing.mode || 'booting',
                    modeSeq: existing.modeSeq || 0,
                    modeConfidence: existing.modeConfidence || 'low',
                    modeSource: existing.modeSource || 'snapshot',
                    provider: existing.provider,
                    isBlocked: !!existing.isBlocked,
                    blockedReason: existing.isBlocked ? existing.blockedReason : undefined
                });
            }
            if (existing && !existing.running) {
                event.sender.send(`pty:exit:${taskId}`, {
                    taskId,
                    exitCode: existing.exitCode,
                    signal: existing.signal
                });
            }
            event.sender.send(`pty:state:${taskId}`, {
                taskId,
                created: !!state.created,
                running: state.running,
                restarted: !!state.restarted,
                startError: typeof state.startError === 'string' ? state.startError : undefined,
                sandbox: existing?.sandbox ?? state.sandbox ?? null
            });
        });
        electron_1.ipcMain.on('pty:write', (event, { taskId, data }) => {
            if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
                return;
            }
            if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 64_000) {
                event.sender.send(`pty:data:${taskId}`, '\r\n[orchestrator] PTY write dropped: payload too large.\r\n');
                return;
            }
            const result = this.service.write(taskId, data);
            if (!result.success) {
                event.sender.send(`pty:data:${taskId}`, '\r\n[orchestrator] PTY is not running for this tab.\r\n');
                return;
            }
            this.hooks.onSessionInput?.({ taskId, data });
        });
        electron_1.ipcMain.handle('pty:launch', (event, { taskId, command, options }) => {
            if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
                return { success: false, error: 'Invalid task id.' };
            }
            if (typeof command !== 'string') {
                return { success: false, error: 'Launch command is required.' };
            }
            this.trackSubscriber(taskId, event.sender.id);
            const result = this.service.launch(taskId, command, options || {});
            if (!result.success) {
                return result;
            }
            this.hooks.onSessionInput?.({ taskId, data: `${command}\r` });
            return { success: true };
        });
        electron_1.ipcMain.on('pty:resize', (event, { taskId, cols, rows }) => {
            if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
                return;
            }
            const safeCols = Number.isFinite(cols) ? Math.max(20, Math.min(1000, cols)) : 80;
            const safeRows = Number.isFinite(rows) ? Math.max(10, Math.min(1000, rows)) : 24;
            this.service.resize(taskId, safeCols, safeRows);
        });
        electron_1.ipcMain.on('pty:detach', (event, { taskId }) => {
            if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
                return;
            }
            this.untrackSubscriber(taskId, event.sender.id);
            this.service.detach(taskId, String(event.sender.id));
        });
        electron_1.ipcMain.on('pty:destroy', (event, { taskId }) => {
            if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
                return;
            }
            this.service.destroy(taskId);
        });
        electron_1.ipcMain.handle('pty:listSessions', () => {
            return { success: true, sessions: this.service.listSessions() };
        });
        electron_1.ipcMain.handle('pty:restart', (event, { taskId }) => {
            if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
                return { success: false, running: false, restarted: false, error: 'Invalid task id.' };
            }
            const senderId = event.sender.id;
            this.trackSubscriber(taskId, senderId);
            const restarted = this.service.restart(taskId, String(senderId));
            if (!restarted.success) {
                return restarted;
            }
            const existing = this.service.attach(taskId, String(senderId));
            if (existing?.outputBuffer) {
                this.sendBufferedOutput(event.sender, taskId, existing.outputBuffer);
            }
            if (existing) {
                event.sender.send('agent:blocked', {
                    taskId,
                    isBlocked: !!existing.isBlocked,
                    reason: existing.isBlocked ? existing.blockedReason : undefined
                });
                event.sender.send(`pty:mode:${taskId}`, {
                    taskId,
                    mode: existing.mode || 'booting',
                    modeSeq: existing.modeSeq || 0,
                    modeConfidence: existing.modeConfidence || 'low',
                    modeSource: existing.modeSource || 'snapshot',
                    provider: existing.provider,
                    isBlocked: !!existing.isBlocked,
                    blockedReason: existing.isBlocked ? existing.blockedReason : undefined
                });
                if (!existing.running) {
                    event.sender.send(`pty:exit:${taskId}`, {
                        taskId,
                        exitCode: existing.exitCode,
                        signal: existing.signal
                    });
                }
            }
            event.sender.send(`pty:state:${taskId}`, {
                taskId,
                created: false,
                running: !!existing?.running,
                restarted: true,
                startError: existing?.startError ?? restarted.startError,
                sandbox: existing?.sandbox ?? restarted.sandbox ?? null
            });
            return {
                success: true,
                running: !!existing?.running,
                restarted: true,
                startError: existing?.startError ?? restarted.startError
            };
        });
        electron_1.ipcMain.on('pty:destroyAllForSender', (event) => {
            const senderId = event.sender.id;
            for (const [taskId, ids] of this.rendererSubscribers.entries()) {
                if (ids.has(senderId)) {
                    ids.delete(senderId);
                    this.service.detach(taskId, String(senderId));
                }
            }
        });
    }
    trackSubscriber(taskId, senderId) {
        const existing = this.rendererSubscribers.get(taskId) || new Set();
        existing.add(senderId);
        this.rendererSubscribers.set(taskId, existing);
    }
    untrackSubscriber(taskId, senderId) {
        const existing = this.rendererSubscribers.get(taskId);
        if (!existing)
            return;
        existing.delete(senderId);
        if (existing.size === 0) {
            this.rendererSubscribers.delete(taskId);
        }
    }
    broadcast(taskId, channel, payload) {
        const subscribers = this.rendererSubscribers.get(taskId);
        if (!subscribers || subscribers.size === 0)
            return;
        for (const senderId of Array.from(subscribers)) {
            const subscriber = electron_1.webContents.fromId(senderId);
            if (!subscriber || subscriber.isDestroyed()) {
                subscribers.delete(senderId);
                continue;
            }
            subscriber.send(channel, payload);
        }
    }
    sendBufferedOutput(sender, taskId, outputBuffer) {
        if (!outputBuffer)
            return;
        if (outputBuffer.length <= PtyManager.ATTACH_CHUNK_SIZE) {
            sender.send(`pty:data:${taskId}`, outputBuffer);
            return;
        }
        for (let index = 0; index < outputBuffer.length; index += PtyManager.ATTACH_CHUNK_SIZE) {
            sender.send(`pty:data:${taskId}`, outputBuffer.slice(index, index + PtyManager.ATTACH_CHUNK_SIZE));
        }
    }
}
exports.PtyManager = PtyManager;
