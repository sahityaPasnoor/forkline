const os = require('node:os');
const EventEmitter = require('node:events');
const pty = require('node-pty');

const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
const MAX_OUTPUT_BUFFER = 2_000_000;

class PtyService extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  stripAnsi(value) {
    return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
  }

  extractBlockReason(data, blockRegex) {
    const cleaned = this.stripAnsi(data);
    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return undefined;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (blockRegex.test(lines[i])) return lines[i].slice(0, 240);
    }

    if (blockRegex.test(cleaned)) {
      const singleLine = cleaned.replace(/\s+/g, ' ').trim();
      return singleLine.slice(0, 240);
    }
    return undefined;
  }

  trimBuffer(data) {
    if (data.length <= MAX_OUTPUT_BUFFER) return data;
    return data.slice(-MAX_OUTPUT_BUFFER);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      taskId: session.taskId,
      cwd: session.cwd,
      running: !!session.ptyProcess,
      isBlocked: session.isBlocked,
      blockedReason: session.blockedReason,
      subscribers: session.subscribers.size,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      exitCode: session.exitCode,
      signal: session.exitSignal,
      bufferSize: session.outputBuffer.length
    }));
  }

  createSession(taskId, cwd, customEnv = {}, subscriberId = 'default') {
    const existing = this.sessions.get(taskId);
    if (existing) {
      existing.subscribers.add(subscriberId);
      this.emit('state', { taskId, created: false, running: !!existing.ptyProcess, subscriberId });
      return { created: false, running: !!existing.ptyProcess };
    }

    const mergedEnv = { ...process.env, ...customEnv };
    // Force color-capable terminal behavior for shells/tools that gate color output.
    delete mergedEnv.NO_COLOR;
    mergedEnv.TERM = 'xterm-256color';
    mergedEnv.COLORTERM = 'truecolor';
    mergedEnv.TERM_PROGRAM = mergedEnv.TERM_PROGRAM || 'Forkline';
    mergedEnv.FORCE_COLOR = '1';
    mergedEnv.CLICOLOR = '1';
    mergedEnv.CLICOLOR_FORCE = '1';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: cwd || process.env.HOME || process.cwd(),
      env: mergedEnv
    });

    const session = {
      taskId,
      cwd: cwd || process.env.HOME || process.cwd(),
      ptyProcess,
      subscribers: new Set([subscriberId]),
      outputBuffer: '',
      isBlocked: false,
      blockedReason: undefined,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      exitCode: null,
      exitSignal: undefined
    };

    this.sessions.set(taskId, session);

    const blockRegex = /((?:do you want|are you sure|confirm(?:ation)?|approve|proceed|continue)[^\r\n]{0,140}\?\s*$)|((?:\(|\[)\s*[yY](?:es)?\s*\/\s*[nN](?:o)?\s*(?:\)|\])\s*$)|(\b(?:yes\/no|y\/n)\b\s*$)|(\b(?:press|hit)\s+(?:enter|return)\b(?:\s+to\s+(?:continue|confirm))?\s*$)|(\bselect\s+(?:an?\s+)?option\b\s*[:?]?\s*$)/i;

    ptyProcess.onData((data) => {
      const current = this.sessions.get(taskId);
      if (!current) return;
      current.lastActivityAt = Date.now();
      current.outputBuffer = this.trimBuffer(current.outputBuffer + data);
      this.emit('data', { taskId, data });
      this.emit('activity', { taskId, at: current.lastActivityAt });

      const reason = this.extractBlockReason(data, blockRegex);
      if (reason && !current.isBlocked) {
        current.isBlocked = true;
        current.blockedReason = reason;
        this.emit('blocked', { taskId, isBlocked: true, reason });
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      const current = this.sessions.get(taskId);
      if (!current) return;
      current.lastActivityAt = Date.now();
      current.exitCode = exitCode;
      current.exitSignal = signal;
      current.ptyProcess = null;
      current.isBlocked = false;
      current.blockedReason = undefined;
      this.emit('blocked', { taskId, isBlocked: false });
      this.emit('exit', { taskId, exitCode, signal });
    });

    this.emit('started', { taskId, cwd: session.cwd, createdAt: session.createdAt });
    this.emit('state', { taskId, created: true, running: true, subscriberId });
    return { created: true, running: true };
  }

  attach(taskId, subscriberId = 'default') {
    const session = this.sessions.get(taskId);
    if (!session) return null;
    session.subscribers.add(subscriberId);
    return {
      taskId,
      outputBuffer: session.outputBuffer,
      isBlocked: session.isBlocked,
      blockedReason: session.blockedReason,
      running: !!session.ptyProcess,
      exitCode: session.exitCode,
      signal: session.exitSignal
    };
  }

  detach(taskId, subscriberId = 'default') {
    const session = this.sessions.get(taskId);
    if (!session) return;
    session.subscribers.delete(subscriberId);
    session.lastActivityAt = Date.now();
  }

  write(taskId, data) {
    const session = this.sessions.get(taskId);
    if (!session || !session.ptyProcess) {
      return { success: false, error: 'PTY is not running for this task.' };
    }
    session.lastActivityAt = Date.now();
    session.ptyProcess.write(data);
    if (session.isBlocked) {
      session.isBlocked = false;
      session.blockedReason = undefined;
      this.emit('blocked', { taskId, isBlocked: false });
    }
    this.emit('activity', { taskId, at: session.lastActivityAt });
    return { success: true };
  }

  resize(taskId, cols, rows) {
    const session = this.sessions.get(taskId);
    if (!session || !session.ptyProcess) return { success: false };
    session.ptyProcess.resize(cols, rows);
    return { success: true };
  }

  destroy(taskId) {
    const session = this.sessions.get(taskId);
    if (!session) return { success: true };
    if (session.ptyProcess) {
      session.ptyProcess.kill();
    }
    this.sessions.delete(taskId);
    this.emit('destroyed', { taskId });
    return { success: true };
  }
}

module.exports = { PtyService };
