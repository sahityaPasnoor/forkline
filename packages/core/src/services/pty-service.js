const os = require('node:os');
const EventEmitter = require('node:events');
const { spawnSync } = require('node:child_process');
const pty = require('node-pty');
const { ResourceAllocator } = require('./resource-allocator');
const { resolveSandboxLaunch } = require('./sandbox-service');
const { PtySessionStateMachine, detectProviderFromCommand } = require('../../../protocol/src/pty-state-machine');
const {
  buildSharedCacheEnv,
  ensureCacheDirectories,
  normalizePackageStoreStrategy
} = require('./dependency-policy-service');

const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
const MAX_OUTPUT_BUFFER = 2_000_000;
const MAX_TRIM_BOUNDARY_SCAN = 4096;
const DEFAULT_MAX_SESSIONS = 256;
const TASK_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const MAX_ENV_KEYS = 128;
const MAX_ENV_VALUE_BYTES = 4096;
const DEFAULT_SESSION_PERSISTENCE_MODE = 'auto';

const commandExists = (command) => {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
};

const normalizePersistenceMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'disabled' || raw === 'none') return 'off';
  if (raw === 'tmux') return 'tmux';
  return 'auto';
};

const shellQuote = (value) => `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;

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
    this.sessionPersistenceMode = normalizePersistenceMode(
      options.sessionPersistenceMode || process.env.FORKLINE_PTY_PERSISTENCE_MODE || DEFAULT_SESSION_PERSISTENCE_MODE
    );
    this.tmuxAvailable = process.platform !== 'win32' && commandExists('tmux');
  }

  resolveProviderHint(customEnv = {}) {
    if (!customEnv || typeof customEnv !== 'object') return '';
    const explicit = String(customEnv.FORKLINE_AGENT_PROVIDER || '').trim().toLowerCase();
    if (explicit) return explicit;
    return detectProviderFromCommand(customEnv.FORKLINE_AGENT_COMMAND || customEnv.FORKLINE_AGENT || '');
  }

  ensureModeMachine(session, customEnv = {}) {
    if (!session) return;
    if (!session.modeMachine) {
      session.modeMachine = new PtySessionStateMachine({
        providerHint: this.resolveProviderHint(customEnv),
        agentCommand: customEnv.FORKLINE_AGENT_COMMAND || customEnv.FORKLINE_AGENT || ''
      });
      session.modeSnapshot = session.modeMachine.snapshot();
      return;
    }

    const nextProvider = this.resolveProviderHint(customEnv);
    if (!nextProvider) return;
    const currentProvider = String(session.modeSnapshot?.provider || '').trim().toLowerCase();
    if (currentProvider === nextProvider) return;
    const transition = session.modeMachine.transition({ provider: nextProvider });
    this.emitModeChange(session.taskId, session, transition, { force: transition.changed });
  }

  emitModeChange(taskId, session, transition, options = {}) {
    if (!session || !session.modeMachine) return;
    const snapshot = transition?.snapshot || session.modeMachine.snapshot();
    const prevBlocked = !!session.isBlocked;
    const prevReason = session.blockedReason;

    session.modeSnapshot = snapshot;
    session.isBlocked = !!snapshot.isBlocked;
    session.blockedReason = snapshot.isBlocked ? snapshot.blockedReason : undefined;

    const blockedChanged = prevBlocked !== session.isBlocked || prevReason !== session.blockedReason;
    if (blockedChanged) {
      this.emit('blocked', {
        taskId,
        isBlocked: session.isBlocked,
        reason: session.isBlocked ? session.blockedReason : undefined
      });
    }

    if (transition?.changed || options.force) {
      this.emit('mode', { taskId, ...snapshot });
    }
  }

  stripAnsi(value) {
    return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
  }

  normalizeReasonText(value) {
    if (!value) return '';
    let text = String(value)
      .replace(/\x1b\][^\u0007]*(?:\u0007|\x1b\\)/g, ' ')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';

    text = text
      .replace(/([.?!])([A-Za-z])/g, '$1 $2')
      .replace(/\b(Claude|Codex|Gemini|Aider|Amp|Cursor|Cline|Sweep)(has|is|would|wants|can)\b/g, '$1 $2')
      .replace(/\bhaswrittenupaplanandisreadytoexecute\b/ig, 'has written up a plan and is ready to execute')
      .replace(/\bwrittenupaplanandisreadytoexecute\b/ig, 'written up a plan and is ready to execute')
      .replace(/\bwouldyouliketoproceed\??\b/ig, 'Would you like to proceed?')
      .replace(/\bdoyouwanttoproceed\??\b/ig, 'Do you want to proceed?')
      .replace(/\bareyousure\??\b/ig, 'Are you sure?')
      .replace(/\bpressentertocontinue\b/ig, 'press Enter to continue')
      .replace(/\?{2,}/g, '?');

    const compact = text.toLowerCase().replace(/[^a-z0-9?]/g, '');
    if (compact.includes('claudehaswrittenupaplanandisreadytoexecutewouldyouliketoproceed')) {
      return 'Claude has written up a plan and is ready to execute. Would you like to proceed?';
    }

    if (!/\s/.test(text) && text.length > 48) {
      return 'Agent is waiting for confirmation. Would you like to proceed?';
    }
    return text;
  }

  updateAltScreenState(previous, data) {
    let alt = !!previous;
    const chunk = String(data || '');
    // Common alternate-screen toggles used by TUIs.
    if (/\x1b\[\?(?:47|1047|1048|1049)h/.test(chunk)) alt = true;
    if (/\x1b\[\?(?:47|1047|1048|1049)l/.test(chunk)) alt = false;
    return alt;
  }

  looksLikeTuiChunk(data) {
    const cleaned = this.stripAnsi(String(data || '')).replace(/\r/g, '\n');
    if (!cleaned.trim()) return false;
    return (
      /Type your message or @path\/to\/file/i.test(cleaned)
      || /for shortcuts/i.test(cleaned)
      || /\bno sandbox\b/i.test(cleaned)
      || /Welcome back/i.test(cleaned)
      || /Authenticated with .*\/auth/i.test(cleaned)
      || /GEMINI\.md file/i.test(cleaned)
      || /^\s*[█░▐▛▜▌▘▝]{8,}/m.test(cleaned)
    );
  }

  reconcileBlockedState(taskId, session, options = {}) {
    if (!session) return;
    this.ensureModeMachine(session);
    const transition = session.modeMachine.reconcile('snapshot');
    this.emitModeChange(taskId, session, transition, { force: options.emit === true });
  }

  trimBuffer(data) {
    if (data.length <= MAX_OUTPUT_BUFFER) return data;
    const initialStart = data.length - MAX_OUTPUT_BUFFER;
    let start = initialStart;
    const boundaryWindow = data.slice(initialStart, Math.min(data.length, initialStart + MAX_TRIM_BOUNDARY_SCAN));
    const nextNewlineIndex = boundaryWindow.search(/[\r\n]/);
    if (nextNewlineIndex >= 0) {
      start = initialStart + nextNewlineIndex + 1;
    }
    let trimmed = data.slice(start);
    // If trimming happens mid-control sequence, drop obvious leading payload fragments.
    trimmed = trimmed
      .replace(/^\[[0-9;:?><]{1,24}[A-Za-z]/, '')
      .replace(/^[0-9]{1,3}(?:;[0-9]{1,3}){1,6}[cRn]/, '');
    if (trimmed.length <= MAX_OUTPUT_BUFFER) return trimmed;
    return trimmed.slice(-MAX_OUTPUT_BUFFER);
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
    const processRef = session.ptyProcess;

    processRef.onData((data) => {
      const current = this.sessions.get(taskId);
      if (!current || current.ptyProcess !== processRef) return;
      current.lastActivityAt = Date.now();
      current.outputBuffer = this.trimBuffer(current.outputBuffer + data);
      this.emit('data', { taskId, data });
      this.emit('activity', { taskId, at: current.lastActivityAt });

      current.altScreen = this.updateAltScreenState(current.altScreen, data);
      this.ensureModeMachine(current);
      const transition = current.modeMachine.consumeOutput(data, { altScreen: current.altScreen });
      this.emitModeChange(taskId, current, transition);
    });

    processRef.onExit(({ exitCode, signal }) => {
      const current = this.sessions.get(taskId);
      if (!current || current.ptyProcess !== processRef) return;
      current.lastActivityAt = Date.now();
      current.exitCode = exitCode;
      current.exitSignal = signal;
      current.ptyProcess = null;
      current.altScreen = false;
      this.ensureModeMachine(current);
      const transition = current.modeMachine.consumeExit(exitCode, signal);
      this.emitModeChange(taskId, current, transition, { force: true });
      this.emit('exit', { taskId, exitCode, signal });
    });
  }

  startPtyForSession(taskId) {
    const session = this.sessions.get(taskId);
    if (!session) return false;

    let launch;
    try {
      launch = resolveSandboxLaunch({
        shell,
        cwd: session.cwd || process.env.HOME || process.cwd(),
        env: session.env
      });
    } catch (error) {
      this.emit('data', {
        taskId,
        data: `\r\n[orchestrator] Failed to resolve PTY launch plan: ${error?.message || error}\r\n`
      });
      return false;
    }

    session.sandbox = launch.sandbox;
    try {
      session.ptyProcess = pty.spawn(launch.command, launch.args || [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: session.cwd || process.env.HOME || process.cwd(),
        env: launch.env || session.env
      });
    } catch (error) {
      session.ptyProcess = null;
      session.lastActivityAt = Date.now();
      this.emit('data', {
        taskId,
        data: `\r\n[orchestrator] Failed to start PTY: ${error?.message || error}\r\n`
      });
      return false;
    }
    session.lastActivityAt = Date.now();
    session.exitCode = null;
    session.exitSignal = undefined;
    this.ensureModeMachine(session, session.env);
    const transition = session.modeMachine.start();
    this.emitModeChange(taskId, session, transition, { force: true });

    this.attachProcessListeners(taskId);
    if (this.shouldUseTmuxPersistence(session)) {
      const tmuxSession = session.persistence?.tmuxSession || `forkline_${taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}`;
      session.persistence = { mode: 'tmux', tmuxSession };
      const attachCmd = `tmux new-session -A -s ${shellQuote(tmuxSession)} -c ${shellQuote(session.cwd || process.cwd())}`;
      session.ptyProcess.write(`${attachCmd}\r`);
    }
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
    return Array.from(this.sessions.values()).map((session) => {
      this.reconcileBlockedState(session.taskId, session, { emit: false });
      return {
        taskId: session.taskId,
        cwd: session.cwd,
        running: !!session.ptyProcess,
        isBlocked: session.isBlocked,
        blockedReason: session.blockedReason,
        mode: session.modeSnapshot?.mode || 'booting',
        modeSeq: session.modeSnapshot?.seq || 0,
        modeConfidence: session.modeSnapshot?.confidence || 'low',
        modeSource: session.modeSnapshot?.source || 'snapshot',
        provider: session.modeSnapshot?.provider,
        subscribers: session.subscribers.size,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        exitCode: session.exitCode,
        signal: session.exitSignal,
        bufferSize: session.outputBuffer.length,
        tailPreview: this.summarizeTailPreview(session.outputBuffer),
        resource: session.resource || null,
        sandbox: session.sandbox || null,
        dependencyPolicy: session.dependencyPolicy || null,
        persistence: session.persistence || null
      };
    });
  }

  shouldUseTmuxPersistence(session) {
    if (!session || !this.tmuxAvailable) return false;
    if (this.sessionPersistenceMode === 'off') return false;
    if (this.sessionPersistenceMode === 'tmux') return true;
    return true;
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
      this.ensureModeMachine(existing, sanitizedEnv);
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
      altScreen: false,
      isBlocked: false,
      blockedReason: undefined,
      modeMachine: new PtySessionStateMachine({
        providerHint: this.resolveProviderHint(sanitizedEnv),
        agentCommand: sanitizedEnv.FORKLINE_AGENT_COMMAND || sanitizedEnv.FORKLINE_AGENT || ''
      }),
      modeSnapshot: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      exitCode: null,
      exitSignal: undefined,
      resource: this.resourceAllocator.allocate(taskId),
      sandbox: null,
      persistence: this.shouldUseTmuxPersistence({}) ? { mode: 'tmux', tmuxSession: `forkline_${taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}` } : null,
      dependencyPolicy: {
        strategy: dependencyPolicy.strategy,
        ecosystems: dependencyPolicy.ecosystems,
        sharedCacheRoot: dependencyPolicy.sharedCacheRoot
      }
    };

    this.sessions.set(taskId, session);
    this.ensureModeMachine(session, sanitizedEnv);
    const started = this.startPtyForSession(taskId);
    this.emit('state', { taskId, created: true, running: started, restarted: false, subscriberId });
    return { created: true, running: started, restarted: false };
  }

  attach(taskId, subscriberId = 'default') {
    const session = this.sessions.get(taskId);
    if (!session) return null;
    this.reconcileBlockedState(taskId, session, { emit: true });
    session.subscribers.add(subscriberId);
    return {
      taskId,
      outputBuffer: session.outputBuffer,
      isBlocked: session.isBlocked,
      blockedReason: session.blockedReason,
      mode: session.modeSnapshot?.mode || 'booting',
      modeSeq: session.modeSnapshot?.seq || 0,
      modeConfidence: session.modeSnapshot?.confidence || 'low',
      modeSource: session.modeSnapshot?.source || 'snapshot',
      provider: session.modeSnapshot?.provider,
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
    this.ensureModeMachine(session);
    const transition = session.modeMachine.consumeInput(data);
    this.emitModeChange(taskId, session, transition);
    this.emit('activity', { taskId, at: session.lastActivityAt });
    return { success: true };
  }

  resize(taskId, cols, rows) {
    const session = this.sessions.get(taskId);
    if (!session || !session.ptyProcess) return { success: false };
    session.ptyProcess.resize(cols, rows);
    return { success: true };
  }

  restart(taskId, subscriberId = 'default') {
    const session = this.sessions.get(taskId);
    if (!session) {
      return { success: false, running: false, restarted: false, error: 'Session not found.' };
    }

    session.subscribers.add(subscriberId);
    if (session.ptyProcess) {
      try {
        session.ptyProcess.kill();
      } catch {
        // Best effort; session restart will proceed with a fresh process.
      }
      session.ptyProcess = null;
    }
    if (session.persistence?.mode === 'tmux' && session.persistence.tmuxSession && this.tmuxAvailable) {
      spawnSync('tmux', ['kill-session', '-t', session.persistence.tmuxSession], { stdio: 'ignore' });
    }

    session.outputBuffer = '';
    session.altScreen = false;
    session.lastActivityAt = Date.now();
    session.exitCode = null;
    session.exitSignal = undefined;
    session.modeMachine = new PtySessionStateMachine({
      providerHint: this.resolveProviderHint(session.env),
      agentCommand: session.env.FORKLINE_AGENT_COMMAND || session.env.FORKLINE_AGENT || ''
    });
    session.modeSnapshot = session.modeMachine.snapshot();
    session.isBlocked = false;
    session.blockedReason = undefined;

    const restarted = this.startPtyForSession(taskId);
    this.emit('state', { taskId, created: false, running: restarted, restarted: true, subscriberId });
    return { success: true, running: restarted, restarted: true };
  }

  destroy(taskId) {
    const session = this.sessions.get(taskId);
    if (!session) return { success: true };
    if (session.ptyProcess) {
      session.ptyProcess.kill();
    }
    if (session.persistence?.mode === 'tmux' && session.persistence.tmuxSession && this.tmuxAvailable) {
      spawnSync('tmux', ['kill-session', '-t', session.persistence.tmuxSession], { stdio: 'ignore' });
    }
    this.resourceAllocator.release(taskId);
    this.sessions.delete(taskId);
    this.emit('destroyed', { taskId });
    return { success: true };
  }
}

module.exports = { PtyService };
