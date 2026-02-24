import { ipcMain, webContents } from 'electron';

// Shared core engine implementation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PtyService } = require('../../packages/core/src/services/pty-service');

interface PtyLifecycleHooks {
  onSessionStarted?: (data: { taskId: string; cwd: string; createdAt: number }) => void;
  onSessionActivity?: (data: { taskId: string; at: number }) => void;
  onSessionBlocked?: (data: { taskId: string; isBlocked: boolean; reason?: string }) => void;
  onSessionExited?: (data: { taskId: string; exitCode: number | null; signal?: number }) => void;
  onSessionDestroyed?: (data: { taskId: string }) => void;
}

type PtyServiceInstance = {
  createSession: (
    taskId: string,
    cwd: string,
    customEnv?: Record<string, string>,
    subscriberId?: string
  ) => { created: boolean; running: boolean; restarted?: boolean };
  attach: (taskId: string, subscriberId?: string) => {
    taskId: string;
    outputBuffer: string;
    isBlocked: boolean;
    blockedReason?: string;
    running: boolean;
    exitCode: number | null;
    signal?: number;
  } | null;
  detach: (taskId: string, subscriberId?: string) => void;
  write: (taskId: string, data: string) => { success: boolean; error?: string };
  resize: (taskId: string, cols: number, rows: number) => { success: boolean };
  destroy: (taskId: string) => { success: boolean };
  listSessions: () => Array<{
    taskId: string;
    cwd: string;
    running: boolean;
    isBlocked: boolean;
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

    this.service.on('data', ({ taskId, data }) => {
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
      const existing = this.service.attach(taskId, String(senderId));
      this.trackSubscriber(taskId, senderId);
      if (existing?.outputBuffer) {
        event.sender.send(`pty:data:${taskId}`, existing.outputBuffer);
      }
      if (existing?.isBlocked) {
        event.sender.send('agent:blocked', {
          taskId,
          isBlocked: true,
          reason: existing.blockedReason
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
        created: state.created,
        running: state.running,
        restarted: !!state.restarted
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
      }
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
}
