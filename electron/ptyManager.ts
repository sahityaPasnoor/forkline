import * as pty from 'node-pty';
import { ipcMain } from 'electron';
import os from 'os';

const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';

interface PTYSession {
  ptyProcess: pty.IPty;
  taskId: string;
  isBlocked: boolean;
}

export class PtyManager {
  private sessions: Map<string, PTYSession> = new Map();

  constructor() {
    ipcMain.on('pty:create', (event, { taskId, cwd, customEnv }) => {
      if (this.sessions.has(taskId)) {
        return; // Already exists
      }

      const mergedEnv = { ...process.env, ...(customEnv || {}) };

      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: cwd || process.env.HOME,
        env: mergedEnv as any
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

    ipcMain.on('pty:write', (event, { taskId, data }) => {
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

    ipcMain.on('pty:resize', (event, { taskId, cols, rows }) => {
      const session = this.sessions.get(taskId);
      if (session) {
        session.ptyProcess.resize(cols, rows);
      }
    });

    ipcMain.on('pty:destroy', (event, { taskId }) => {
      const session = this.sessions.get(taskId);
      if (session) {
        session.ptyProcess.kill();
        this.sessions.delete(taskId);
      }
    });
  }
}