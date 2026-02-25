import { ipcMain, webContents, type WebContents } from 'electron';

// Shared core engine implementation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PtyService } = require('../../packages/core/src/services/pty-service');

interface PtyLifecycleHooks {
  onSessionStarted?: (data: { taskId: string; cwd: string; createdAt: number }) => void;
  onSessionActivity?: (data: { taskId: string; at: number }) => void;
  onSessionMode?: (data: {
    taskId: string;
    mode: string;
    modeSeq: number;
    modeConfidence?: string;
    modeSource?: string;
    provider?: string;
    isBlocked: boolean;
    blockedReason?: string;
  }) => void;
  onSessionBlocked?: (data: { taskId: string; isBlocked: boolean; reason?: string }) => void;
  onSessionData?: (data: { taskId: string; data: string }) => void;
  onSessionInput?: (data: { taskId: string; data: string }) => void;
  onSessionExited?: (data: { taskId: string; exitCode: number | null; signal?: number }) => void;
  onSessionDestroyed?: (data: { taskId: string }) => void;
}

type PtyServiceInstance = {
  createSession: (
    taskId: string,
    cwd: string,
    customEnv?: Record<string, string>,
    subscriberId?: string
  ) => {
    created: boolean;
    running: boolean;
    restarted?: boolean;
    sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
  };
  attach: (taskId: string, subscriberId?: string) => {
    taskId: string;
    outputBuffer: string;
    isBlocked: boolean;
    blockedReason?: string;
    mode?: string;
    modeSeq?: number;
    modeConfidence?: string;
    modeSource?: string;
    provider?: string;
    running: boolean;
    exitCode: number | null;
    signal?: number;
    sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
  } | null;
  detach: (taskId: string, subscriberId?: string) => void;
  write: (taskId: string, data: string) => { success: boolean; error?: string };
  launch: (taskId: string, command: string, options?: { suppressEcho?: boolean }) => { success: boolean; error?: string };
  resize: (taskId: string, cols: number, rows: number) => { success: boolean };
  restart: (taskId: string, subscriberId?: string) => {
    success: boolean;
    running: boolean;
    restarted: boolean;
    error?: string;
    sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
  };
  destroy: (taskId: string) => { success: boolean };
  listSessions: () => Array<{
    taskId: string;
    cwd: string;
    running: boolean;
    isBlocked: boolean;
    mode?: string;
    modeSeq?: number;
    modeConfidence?: string;
    modeSource?: string;
    provider?: string;
    subscribers: number;
    createdAt: number;
    lastActivityAt: number;
    exitCode: number | null;
    signal?: number;
    bufferSize: number;
  }>;
  on: (event: string, listener: (...args: any[]) => void) => void;
};

export class PtyManager {
  private hooks: PtyLifecycleHooks;
  private service: PtyServiceInstance;
  private rendererSubscribers = new Map<string, Set<number>>();
  private static TASK_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
  private static ATTACH_CHUNK_SIZE = 64_000;

  constructor(hooks: PtyLifecycleHooks = {}) {
    this.hooks = hooks;
    this.service = new PtyService();
    this.bindCoreEvents();
    this.bindIpc();
  }

  private bindCoreEvents() {
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

  private bindIpc() {
    ipcMain.on('pty:create', (event, { taskId, cwd, customEnv }) => {
      if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
        event.sender.send(`pty:data:${taskId}`, '\r\n[orchestrator] Invalid task id.\r\n');
        return;
      }
      const senderId = event.sender.id;
      const state = this.service.createSession(taskId, cwd || process.env.HOME || '', customEnv || {}, String(senderId));
      if (state && (state as any).error) {
        event.sender.send(`pty:data:${taskId}`, `\r\n[orchestrator] ${(state as any).error}\r\n`);
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
        sandbox: existing?.sandbox ?? state.sandbox ?? null
      });
    });

    ipcMain.on('pty:write', (event, { taskId, data }) => {
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

    ipcMain.handle('pty:launch', (event, { taskId, command, options }) => {
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

    ipcMain.on('pty:resize', (event, { taskId, cols, rows }) => {
      if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
        return;
      }
      const safeCols = Number.isFinite(cols) ? Math.max(20, Math.min(1000, cols)) : 80;
      const safeRows = Number.isFinite(rows) ? Math.max(10, Math.min(1000, rows)) : 24;
      this.service.resize(taskId, safeCols, safeRows);
    });

    ipcMain.on('pty:detach', (event, { taskId }) => {
      if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
        return;
      }
      this.untrackSubscriber(taskId, event.sender.id);
      this.service.detach(taskId, String(event.sender.id));
    });

    ipcMain.on('pty:destroy', (event, { taskId }) => {
      if (!PtyManager.TASK_ID_PATTERN.test(String(taskId || ''))) {
        return;
      }
      this.service.destroy(taskId);
    });

    ipcMain.handle('pty:listSessions', () => {
      return { success: true, sessions: this.service.listSessions() };
    });

    ipcMain.handle('pty:restart', (event, { taskId }) => {
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
        sandbox: existing?.sandbox ?? restarted.sandbox ?? null
      });

      return { success: true, running: !!existing?.running, restarted: true };
    });

    ipcMain.on('pty:destroyAllForSender', (event) => {
      const senderId = event.sender.id;
      for (const [taskId, ids] of this.rendererSubscribers.entries()) {
        if (ids.has(senderId)) {
          ids.delete(senderId);
          this.service.detach(taskId, String(senderId));
        }
      }
    });
  }

  private trackSubscriber(taskId: string, senderId: number) {
    const existing = this.rendererSubscribers.get(taskId) || new Set<number>();
    existing.add(senderId);
    this.rendererSubscribers.set(taskId, existing);
  }

  private untrackSubscriber(taskId: string, senderId: number) {
    const existing = this.rendererSubscribers.get(taskId);
    if (!existing) return;
    existing.delete(senderId);
    if (existing.size === 0) {
      this.rendererSubscribers.delete(taskId);
    }
  }

  private broadcast(taskId: string, channel: string, payload: unknown) {
    const subscribers = this.rendererSubscribers.get(taskId);
    if (!subscribers || subscribers.size === 0) return;
    for (const senderId of Array.from(subscribers)) {
      const subscriber = webContents.fromId(senderId);
      if (!subscriber || subscriber.isDestroyed()) {
        subscribers.delete(senderId);
        continue;
      }
      subscriber.send(channel, payload);
    }
  }

  private sendBufferedOutput(sender: WebContents, taskId: string, outputBuffer: string) {
    if (!outputBuffer) return;
    if (outputBuffer.length <= PtyManager.ATTACH_CHUNK_SIZE) {
      sender.send(`pty:data:${taskId}`, outputBuffer);
      return;
    }
    for (let index = 0; index < outputBuffer.length; index += PtyManager.ATTACH_CHUNK_SIZE) {
      sender.send(`pty:data:${taskId}`, outputBuffer.slice(index, index + PtyManager.ATTACH_CHUNK_SIZE));
    }
  }
}
