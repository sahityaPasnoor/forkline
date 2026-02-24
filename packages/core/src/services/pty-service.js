const os = require('node:os');
const EventEmitter = require('node:events');
const pty = require('node-pty');
const { ResourceAllocator } = require('./resource-allocator');
const { resolveSandboxLaunch } = require('./sandbox-service');
const {
  buildSharedCacheEnv,
  ensureCacheDirectories,
  normalizePackageStoreStrategy
} = require('./dependency-policy-service');

const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
const MAX_OUTPUT_BUFFER = 2_000_000;
const DEFAULT_MAX_SESSIONS = 256;
const TASK_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const MAX_ENV_KEYS = 128;
const MAX_ENV_VALUE_BYTES = 4096;
const BLOCK_REGEX = /((?:do you want|are you sure|confirm(?:ation)?|approve|proceed|continue)[^\r\n]{0,140}\?\s*$)|((?:\(|\[)\s*[yY](?:es)?\s*\/\s*[nN](?:o)?\s*(?:\)|\])\s*$)|(\b(?:yes\/no|y\/n)\b\s*$)|(\b(?:press|hit)\s+(?:enter|return)\b(?:\s+to\s+(?:continue|confirm))?\s*$)|(\bselect\s+(?:an?\s+)?option\b\s*[:?]?\s*$)/i;

class PtyService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessions = new Map();
    this.resourceAllocator = new ResourceAllocator({
      portBase: options.portBase,
      portSpan: options.portSpan
    });
    const configuredMaxSessions = Number.parseInt(String(options.maxSessions ?? process.env.FORKLINE_CORE_MAX_PTY_SESSIONS ?? ''), 10);
    this.maxSessions = Number.isFinite(configuredMaxSessions) && configuredMaxSessions > 0
      ? Math.min(configuredMaxSessions, 4096)
      : DEFAULT_MAX_SESSIONS;
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

  createMergedEnv(customEnv = {}) {
    const mergedEnv = { ...process.env, ...customEnv };
    delete mergedEnv.NO_COLOR;
    mergedEnv.TERM = 'xterm-256color';
    mergedEnv.COLORTERM = 'truecolor';
    mergedEnv.TERM_PROGRAM = mergedEnv.TERM_PROGRAM || 'Forkline';
    mergedEnv.FORCE_COLOR = '1';
    mergedEnv.CLICOLOR = '1';
    mergedEnv.CLICOLOR_FORCE = '1';
    return mergedEnv;
  }

  buildResourceEnv(taskId) {
    const assignment = this.resourceAllocator.allocate(taskId);
    if (!assignment) return {};
    return {
      PORT: String(assignment.port),
      HOST: assignment.host,
      ASPNETCORE_URLS: assignment.aspNetCoreUrls,
      CONDUCTOR_SESSION_ID: assignment.sessionId,
      FORKLINE_SESSION_ID: assignment.sessionId,
      FORKLINE_ALLOCATED_PORT: String(assignment.port)
    };
  }

  buildDependencyPolicy(cwd, customEnv = {}) {
    const strategy = normalizePackageStoreStrategy(
      customEnv.FORKLINE_PACKAGE_STORE_STRATEGY ?? process.env.FORKLINE_PACKAGE_STORE_STRATEGY
    );
    const policy = buildSharedCacheEnv(cwd || process.cwd(), {
      packageStoreStrategy: strategy,
      pnpmStorePath: customEnv.FORKLINE_PNPM_STORE_PATH ?? process.env.FORKLINE_PNPM_STORE_PATH,
      sharedCacheRoot: customEnv.FORKLINE_SHARED_CACHE_ROOT ?? process.env.FORKLINE_SHARED_CACHE_ROOT
    });
    if (policy && policy.env) {
      ensureCacheDirectories(policy.env);
    }
    return policy;
  }

  sanitizeCustomEnv(customEnv = {}) {
    if (!customEnv || typeof customEnv !== 'object') return {};
    const entries = Object.entries(customEnv).slice(0, MAX_ENV_KEYS);
    const sanitized = {};
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey || '').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) continue;
      const value = String(rawValue ?? '');
      if (Buffer.byteLength(value, 'utf8') > MAX_ENV_VALUE_BYTES) continue;
      sanitized[key] = value;
    }
    return sanitized;
  }

  attachProcessListeners(taskId) {
    const session = this.sessions.get(taskId);
    if (!session || !session.ptyProcess) return;

    session.ptyProcess.onData((data) => {
      const current = this.sessions.get(taskId);
      if (!current) return;
      current.lastActivityAt = Date.now();
      current.outputBuffer = this.trimBuffer(current.outputBuffer + data);
      this.emit('data', { taskId, data });
      this.emit('activity', { taskId, at: current.lastActivityAt });

      const reason = this.extractBlockReason(data, BLOCK_REGEX);
      if (reason && !current.isBlocked) {
        current.isBlocked = true;
        current.blockedReason = reason;
        this.emit('blocked', { taskId, isBlocked: true, reason });
      }
    });

    session.ptyProcess.onExit(({ exitCode, signal }) => {
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
  }

  startPtyForSession(taskId) {
    const session = this.sessions.get(taskId);
    if (!session) return false;

    const launch = resolveSandboxLaunch({
      shell,
      cwd: session.cwd || process.env.HOME || process.cwd(),
      env: session.env
    });

    session.sandbox = launch.sandbox;
    session.ptyProcess = pty.spawn(launch.command, launch.args || [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: session.cwd || process.env.HOME || process.cwd(),
      env: launch.env || session.env
    });
    session.lastActivityAt = Date.now();
    session.exitCode = null;
    session.exitSignal = undefined;
    session.isBlocked = false;
    session.blockedReason = undefined;
    this.emit('blocked', { taskId, isBlocked: false });

    this.attachProcessListeners(taskId);
    if (launch.sandbox?.warning) {
      this.emit('data', { taskId, data: `\r\n[orchestrator] sandbox warning: ${launch.sandbox.warning}\r\n` });
    } else if (launch.sandbox?.active) {
      const networkStatus = launch.sandbox.denyNetwork ? 'network blocked' : 'network allowed';
      this.emit('data', { taskId, data: `\r\n[orchestrator] sandbox active (${launch.sandbox.mode}; ${networkStatus}).\r\n` });
    }
    this.emit('started', { taskId, cwd: session.cwd, createdAt: session.createdAt });
    return true;
  }

  summarizeTailPreview(outputBuffer, maxLines = 3) {
    const cleaned = this.stripAnsi(outputBuffer || '');
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    return lines.slice(-maxLines).map((line) => line.slice(0, 220));
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
      bufferSize: session.outputBuffer.length,
      tailPreview: this.summarizeTailPreview(session.outputBuffer),
      resource: session.resource || null,
      sandbox: session.sandbox || null,
      dependencyPolicy: session.dependencyPolicy || null
    }));
  }

  createSession(taskId, cwd, customEnv = {}, subscriberId = 'default') {
    if (!TASK_ID_PATTERN.test(String(taskId || ''))) {
      return { created: false, running: false, restarted: false, error: 'Invalid taskId.' };
    }

    const existing = this.sessions.get(taskId);
    if (existing) {
      const sanitizedEnv = this.sanitizeCustomEnv(customEnv);
      if (Object.keys(sanitizedEnv).length > 0) {
        const dependencyPolicy = this.buildDependencyPolicy(existing.cwd, sanitizedEnv);
        existing.dependencyPolicy = {
          strategy: dependencyPolicy.strategy,
          ecosystems: dependencyPolicy.ecosystems,
          sharedCacheRoot: dependencyPolicy.sharedCacheRoot
        };
        existing.env = this.createMergedEnv({ ...existing.env, ...(dependencyPolicy.env || {}), ...sanitizedEnv });
      }
      existing.subscribers.add(subscriberId);
      if (!existing.ptyProcess) {
        const restarted = this.startPtyForSession(taskId);
        this.emit('state', { taskId, created: false, running: restarted, restarted, subscriberId });
        return { created: false, running: restarted, restarted };
      }
      this.emit('state', { taskId, created: false, running: true, restarted: false, subscriberId });
      return { created: false, running: true, restarted: false };
    }

    if (this.sessions.size >= this.maxSessions) {
      return { created: false, running: false, restarted: false, error: `Session limit reached (${this.maxSessions}).` };
    }

    const sanitizedEnv = this.sanitizeCustomEnv(customEnv);
    const resourceEnv = this.buildResourceEnv(taskId);
    const sessionCwd = cwd || process.env.HOME || process.cwd();
    const dependencyPolicy = this.buildDependencyPolicy(sessionCwd, sanitizedEnv);

    const session = {
      taskId,
      cwd: sessionCwd,
      env: this.createMergedEnv({ ...(dependencyPolicy.env || {}), ...resourceEnv, ...sanitizedEnv }),
      ptyProcess: null,
      subscribers: new Set([subscriberId]),
      outputBuffer: '',
      isBlocked: false,
      blockedReason: undefined,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      exitCode: null,
      exitSignal: undefined,
      resource: this.resourceAllocator.allocate(taskId),
      sandbox: null,
      dependencyPolicy: {
        strategy: dependencyPolicy.strategy,
        ecosystems: dependencyPolicy.ecosystems,
        sharedCacheRoot: dependencyPolicy.sharedCacheRoot
      }
    };

    this.sessions.set(taskId, session);
    const started = this.startPtyForSession(taskId);
    this.emit('state', { taskId, created: true, running: started, restarted: false, subscriberId });
    return { created: true, running: started, restarted: false };
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
    this.resourceAllocator.release(taskId);
    this.sessions.delete(taskId);
    this.emit('destroyed', { taskId });
    return { success: true };
  }
}

module.exports = { PtyService };
