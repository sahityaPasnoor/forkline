import { app, BrowserWindow, ipcMain, dialog, session, clipboard, shell, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';
import { PtyManager } from './ptyManager';
import { GitManager } from './gitManager';
import { AgentControlServer } from './agentServer';
import { FleetStore, type FleetListTasksOptions, type FleetTaskPayload } from './fleetStore';
import { loadAppBranding } from './branding';
const {
  collectAgenticSpecCandidates,
  sanitizeLivingSpecPreference,
  resolveLivingSpecDocument,
  resolveLivingSpecSummary
} = require('../../packages/core/src/services/living-spec-service');

const execFileAsync = util.promisify(execFile);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = !!devServerUrl;
const keepBackgroundServicesAlive = String(process.env.FORKLINE_KEEP_BACKGROUND_SERVICES || '1').toLowerCase() !== '0';
let mainWindow: BrowserWindow | null = null;
let agentServer: AgentControlServer | null = null;
let fleetStore: FleetStore | null = null;
let runtimeSessionState: any | null = null;
let runtimeSessionFile: string | null = null;
let detectedAgentsCache: { data: Array<{name: string; command: string; version: string}>; ts: number } | null = null;
const appBranding = loadAppBranding();

const MAX_TEXT_FILE_BYTES = 256_000;
const MAX_IMAGE_FILE_BYTES = 10_000_000;
const MAX_WORKSPACE_JSON_BYTES = 512_000;
const MAX_RUNTIME_SESSION_BYTES = 8_000_000;
const MAX_CLIPBOARD_TEXT_BYTES = 1_000_000;
const MAX_HANDOVER_PACKET_BYTES = 256_000;
const MAX_EXTERNAL_URL_BYTES = 2048;
const WORKTREE_BASENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
type WorkspaceLivingSpecPreference = { mode: 'single' | 'consolidated'; selectedPath?: string };
type AgentSessionProvider = 'claude' | 'gemini' | 'amp' | 'codex' | 'other';

const resolveAppIconPath = () => {
  const brandingIconFile = appBranding.appIconFile.replace(/\\/g, '/').replace(/^\/+/, '');
  const brandingLogoFile = appBranding.logoFile.replace(/\\/g, '/').replace(/^\/+/, '');
  const iconBasePath = brandingIconFile.replace(/\.(svg|png|icns|ico)$/i, '');
  const logoBasePath = brandingLogoFile.replace(/\.(svg|png|icns|ico)$/i, '');
  const preferredExtOrder = process.platform === 'darwin'
    ? ['.icns', '.png', '.ico']
    : ['.png', '.ico', '.icns'];
  const brandingIconCandidates = Array.from(new Set([
    ...preferredExtOrder.map((ext) => `${iconBasePath}${ext}`),
    ...preferredExtOrder.map((ext) => `${logoBasePath}${ext}`),
    brandingIconFile,
    brandingLogoFile
  ])).filter(Boolean);
  const candidates = [
    ...brandingIconCandidates.flatMap((file) => ([
      path.join(__dirname, `../${file}`),
      path.join(__dirname, `../../public/${file}`),
      path.join(process.cwd(), `public/${file}`)
    ])),
    path.join(__dirname, '../logo.png'),
    path.join(__dirname, '../../public/logo.png'),
    path.join(process.cwd(), 'public/logo.png')
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const ext = path.extname(candidate).toLowerCase();
      if (ext === '.png' || ext === '.ico' || ext === '.icns') {
        return candidate;
      }
    } catch {
      // Ignore unreadable paths and continue searching.
    }
  }
  return undefined;
};

const applyAppIcon = (iconPath: string | undefined) => {
  if (process.platform !== 'darwin' || !app.dock || !iconPath) return;
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return;
    app.dock.setIcon(icon);
  } catch {
    // Ignore icon load failures and continue startup.
  }
};

const resolveSafeWorktreePath = (rawPath: unknown): string | null => {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) return null;
  try {
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) return null;
    const base = path.basename(resolved);
    if (!WORKTREE_BASENAME_PATTERN.test(base)) return null;
    return resolved;
  } catch {
    return null;
  }
};

const resolveSafeProjectPath = (rawPath: unknown): string | null => {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) return null;
  try {
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
};

const clampUtf8 = (value: unknown, maxBytes: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const bytes = Buffer.byteLength(trimmed, 'utf8');
  if (bytes <= maxBytes) return trimmed;
  // Preserve UTF-8 validity while capping payload size.
  return Buffer.from(trimmed, 'utf8').subarray(0, maxBytes).toString('utf8');
};

const normalizeCacheFilename = (value: unknown, fallback = 'file.bin'): string => {
  if (typeof value !== 'string') return fallback;
  const base = path.basename(value.trim());
  if (!base || !FILENAME_PATTERN.test(base)) return fallback;
  return base;
};

const clampString = (value: unknown, maxChars: number) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxChars);
};

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\u0007]*(?:\u0007|\x1b\\)/g, '');

const resolveSessionProvider = (command: unknown): AgentSessionProvider => {
  const normalized = clampString(command, 256).toLowerCase();
  if (!normalized) return 'other';
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('amp')) return 'amp';
  if (normalized.includes('codex')) return 'codex';
  return 'other';
};

const parseGeminiSessionList = (stdout: string) => {
  const sessions: Array<{ id: string; label: string; resumeArg?: string }> = [];
  const lines = stripAnsi(stdout || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\.\s+(.+?)\s+\[([0-9a-fA-F-]{8,})\]$/);
    if (!match) continue;
    const index = match[1];
    const title = match[2].trim();
    const sessionId = match[3].trim();
    sessions.push({
      id: sessionId,
      resumeArg: index,
      label: `${title} [${sessionId}]`
    });
  }
  return sessions;
};

const parseAmpSessionList = (stdout: string) => {
  const sessions: Array<{ id: string; label: string; resumeArg?: string }> = [];
  const lines = stripAnsi(stdout || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Title ') || line.startsWith('─')) continue;
    const idMatch = line.match(/\b(T-[A-Za-z0-9-]+)\b/);
    if (!idMatch) continue;
    const sessionId = idMatch[1];
    const columns = line.split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
    const title = columns[0] || sessionId;
    const updated = columns.length >= 2 ? columns[1] : '';
    sessions.push({
      id: sessionId,
      resumeArg: sessionId,
      label: updated ? `${title} (${updated})` : title
    });
  }
  return sessions;
};

const sanitizePathString = (value: unknown) => {
  const candidate = clampString(value, 4096);
  if (!candidate) return '';
  return path.resolve(candidate);
};

const normalizeHandoverProvider = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return 'agent';
  const firstToken = raw.split(/\s+/)[0] || 'agent';
  const normalized = firstToken.replace(/[^a-z0-9._-]/g, '');
  return normalized.slice(0, 48) || 'agent';
};

const sanitizeHandoverPacket = (value: unknown) => {
  const safePacket = (value && typeof value === 'object') ? value : {};
  const serialized = JSON.stringify(safePacket);
  if (!serialized) return {};
  if (Buffer.byteLength(serialized, 'utf8') > MAX_HANDOVER_PACKET_BYTES) {
    throw new Error('Handover packet too large.');
  }
  return JSON.parse(serialized);
};

const sanitizeWorkspaceStoreData = (input: unknown) => {
  const source = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const rawPermissions = (source.projectPermissions && typeof source.projectPermissions === 'object')
    ? source.projectPermissions as Record<string, unknown>
    : {};
  const rawLivingSpecPreferences = (source.livingSpecPreferences && typeof source.livingSpecPreferences === 'object')
    ? source.livingSpecPreferences as Record<string, unknown>
    : {};
  const sanitizedPermissions: Record<string, { autonomousMode: boolean; autoApproveMerge: boolean; autoRespondPrompts: boolean; promptResponse: 'y' | 'n' }> = {};
  const sanitizedLivingSpecPreferences: Record<string, WorkspaceLivingSpecPreference> = {};
  for (const [rawPath, rawPolicy] of Object.entries(rawPermissions)) {
    const normalizedPath = sanitizePathString(rawPath);
    if (!normalizedPath || !rawPolicy || typeof rawPolicy !== 'object') continue;
    const policy = rawPolicy as Record<string, unknown>;
    sanitizedPermissions[normalizedPath] = {
      autonomousMode: !!policy.autonomousMode,
      autoApproveMerge: !!policy.autoApproveMerge,
      autoRespondPrompts: !!policy.autoRespondPrompts,
      promptResponse: policy.promptResponse === 'n' ? 'n' : 'y'
    };
  }
  for (const [rawPath, rawPreference] of Object.entries(rawLivingSpecPreferences)) {
    const normalizedPath = sanitizePathString(rawPath);
    if (!normalizedPath) continue;
    const preference = sanitizeLivingSpecPreference(rawPreference);
    if (!preference) continue;
    sanitizedLivingSpecPreferences[normalizedPath] = preference;
  }

  return {
    basePath: sanitizePathString(source.basePath),
    context: clampUtf8(source.context, MAX_TEXT_FILE_BYTES),
    defaultCommand: clampString(source.defaultCommand, 128),
    packageStoreStrategy: source.packageStoreStrategy === 'pnpm_global' || source.packageStoreStrategy === 'polyglot_global'
      ? source.packageStoreStrategy
      : 'off',
    dependencyCloneMode: source.dependencyCloneMode === 'full_copy' ? 'full_copy' : 'copy_on_write',
    pnpmStorePath: sanitizePathString(source.pnpmStorePath),
    sharedCacheRoot: sanitizePathString(source.sharedCacheRoot),
    pnpmAutoInstall: !!source.pnpmAutoInstall,
    sandboxMode: source.sandboxMode === 'auto' || source.sandboxMode === 'seatbelt' || source.sandboxMode === 'firejail'
      ? source.sandboxMode
      : 'off',
    networkGuard: source.networkGuard === 'none' ? 'none' : 'off',
    projectPermissions: sanitizedPermissions,
    livingSpecPreferences: sanitizedLivingSpecPreferences
  };
};

const safeWriteJson = (targetPath: string, data: unknown, maxBytes: number) => {
  const raw = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new Error(`JSON payload too large for ${path.basename(targetPath)}.`);
  }
  fs.writeFileSync(targetPath, raw);
};

app.setName(appBranding.name);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const migrateLegacyUserData = () => {
  try {
    const appDataPath = app.getPath('appData');
    const currentUserDataPath = app.getPath('userData');
    const legacyUserDataPath = path.join(appDataPath, 'multiagentapp');

    if (legacyUserDataPath === currentUserDataPath) return;
    if (!fs.existsSync(legacyUserDataPath)) return;

    if (!fs.existsSync(currentUserDataPath)) {
      fs.mkdirSync(currentUserDataPath, { recursive: true });
    }

    const existingEntries = fs.readdirSync(currentUserDataPath);
    if (existingEntries.length > 0) return;

    const filesToMigrate = [
      'workspace.json',
      'runtime-session.json',
      'fleet.sqlite',
      'fleet.sqlite-shm',
      'fleet.sqlite-wal'
    ];

    for (const filename of filesToMigrate) {
      const sourcePath = path.join(legacyUserDataPath, filename);
      const destPath = path.join(currentUserDataPath, filename);
      if (!fs.existsSync(sourcePath)) continue;
      fs.copyFileSync(sourcePath, destPath);
    }
  } catch {
    // Non-fatal migration; app can still start cleanly.
  }
};

const loadRuntimeSessionFromDisk = () => {
  if (!runtimeSessionFile) return null;
  try {
    if (!fs.existsSync(runtimeSessionFile)) return null;
    const stats = fs.statSync(runtimeSessionFile);
    if (!stats.isFile() || stats.size > MAX_RUNTIME_SESSION_BYTES) return null;
    const raw = fs.readFileSync(runtimeSessionFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const saveRuntimeSessionToDisk = (data: any) => {
  if (!runtimeSessionFile) return;
  try {
    safeWriteJson(runtimeSessionFile, data ?? null, MAX_RUNTIME_SESSION_BYTES);
  } catch {
    // Best-effort persistence. Runtime state still remains in memory.
  }
};

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  const appIconPath = resolveAppIconPath();
  applyAppIcon(appIconPath);

  mainWindow = new BrowserWindow({
    title: appBranding.name,
    width: 1200,
    height: 800,
    icon: appIconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedDev = isDev && typeof devServerUrl === 'string' && url.startsWith(devServerUrl);
    const allowedProd = !isDev && url.startsWith('file://');
    if (!allowedDev && !allowedProd) {
      event.preventDefault();
    }
  });

  if (!agentServer) {
    agentServer = new AgentControlServer({
      mainWindow,
      persistencePath: path.join(app.getPath('userData'), 'agent-approvals.json')
    });
  } else {
    agentServer.setMainWindow(mainWindow);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    agentServer?.setMainWindow(null);
  });

  if (isDev) {
    mainWindow.loadURL(devServerUrl!);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  applyAppIcon(resolveAppIconPath());
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  migrateLegacyUserData();
  fleetStore = new FleetStore(path.join(app.getPath('userData'), 'fleet.sqlite'));
  await fleetStore.init();

  new PtyManager({
    onSessionStarted: ({ taskId, cwd }) => {
      fleetStore?.onPtySessionStarted(taskId, cwd);
    },
    onSessionActivity: ({ taskId }) => {
      fleetStore?.onPtySessionActivity(taskId);
    },
    onSessionBlocked: ({ taskId, isBlocked, reason }) => {
      fleetStore?.onPtySessionBlocked(taskId, isBlocked, reason);
    },
    onSessionMode: ({ taskId, mode, modeSeq, modeConfidence, modeSource, provider, isBlocked, blockedReason }) => {
      fleetStore?.onPtySessionMode(taskId, mode, modeSeq, modeConfidence, modeSource, provider, isBlocked, blockedReason);
    },
    onSessionData: ({ taskId, data }) => {
      fleetStore?.onPtySessionData(taskId, data);
    },
    onSessionInput: ({ taskId, data }) => {
      fleetStore?.onPtySessionInput(taskId, data);
    },
    onSessionExited: ({ taskId, exitCode, signal }) => {
      fleetStore?.onPtySessionExited(taskId, exitCode, signal);
    },
    onSessionDestroyed: ({ taskId }) => {
      fleetStore?.onPtySessionDestroyed(taskId);
    }
  });
  new GitManager();
  runtimeSessionFile = path.join(app.getPath('userData'), 'runtime-session.json');
  runtimeSessionState = loadRuntimeSessionFromDisk();
  
  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('app:getDefaultPath', () => {
    return process.env.PWD || process.cwd();
  });

  ipcMain.handle('clipboard:readText', () => {
    return clipboard.readText();
  });

  ipcMain.handle('clipboard:writeText', (_event, payload: { text?: unknown } = {}) => {
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_TEXT_BYTES) {
      return { success: false, error: 'Clipboard payload too large.' };
    }
    clipboard.writeText(text);
    return { success: true };
  });

  ipcMain.handle('app:openExternalUrl', async (_event, payload: { url?: unknown } = {}) => {
    const candidate = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!candidate) return { success: false, error: 'URL is required.' };
    if (Buffer.byteLength(candidate, 'utf8') > MAX_EXTERNAL_URL_BYTES) {
      return { success: false, error: 'URL is too long.' };
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return { success: false, error: 'Invalid URL.' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'Only http(s) URLs are allowed.' };
    }
    try {
      await shell.openExternal(parsed.toString());
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to open URL.' };
    }
  });

  ipcMain.handle('app:getControlBaseUrl', () => {
    if (agentServer) {
      return agentServer.getBaseUrl();
    }
    return 'http://127.0.0.1:34567';
  });

  ipcMain.handle('app:getControlAuthToken', () => {
    return agentServer?.getAuthToken() || '';
  });

  ipcMain.handle('app:listPendingAgentRequests', () => {
    if (!agentServer) return [];
    return agentServer.listPendingRequests();
  });

  ipcMain.handle('app:listAgentSessions', async (_event, {
    agentCommand,
    projectPath
  }: { agentCommand?: string; projectPath?: string }) => {
    const provider = resolveSessionProvider(agentCommand || '');
    const safeProjectPath = resolveSafeProjectPath(projectPath) || process.cwd();

    if (provider === 'claude' || provider === 'codex') {
      return {
        success: true,
        provider,
        supportsInAppList: false,
        sessions: []
      };
    }

    if (provider === 'gemini') {
      try {
        const { stdout, stderr } = await execFileAsync('gemini', ['--list-sessions'], {
          cwd: safeProjectPath,
          timeout: 8_000,
          maxBuffer: 1_000_000
        });
        const sessions = parseGeminiSessionList(`${stdout || ''}\n${stderr || ''}`);
        return {
          success: true,
          provider,
          supportsInAppList: true,
          sessions
        };
      } catch (error: any) {
        return {
          success: false,
          provider,
          supportsInAppList: true,
          sessions: [],
          error: error?.message || 'Unable to list Gemini sessions.'
        };
      }
    }

    if (provider === 'amp') {
      try {
        const { stdout, stderr } = await execFileAsync('amp', ['threads', 'list'], {
          cwd: safeProjectPath,
          timeout: 8_000,
          maxBuffer: 1_000_000
        });
        const sessions = parseAmpSessionList(`${stdout || ''}\n${stderr || ''}`);
        return {
          success: true,
          provider,
          supportsInAppList: true,
          sessions
        };
      } catch (error: any) {
        return {
          success: false,
          provider,
          supportsInAppList: true,
          sessions: [],
          error: error?.message || 'Unable to list Amp sessions.'
        };
      }
    }

    return {
      success: true,
      provider,
      supportsInAppList: false,
      sessions: []
    };
  });

  ipcMain.handle('app:detectAgents', async () => {
    const now = Date.now();
    const cacheTtlMs = 5 * 60 * 1000;
    if (detectedAgentsCache && now - detectedAgentsCache.ts < cacheTtlMs) {
      return detectedAgentsCache.data;
    }

    // Keep this list aligned with officially supported CLI integrations in docs.
    const knownAgents = ['claude', 'gemini', 'codex', 'aider', 'amp'];
    const installed = [];
    
    for (const agent of knownAgents) {
      try {
        await execFileAsync('which', [agent], { timeout: 3000 });
        
        let version = 'unknown';
        try {
          // Attempt to get version
          const { stdout } = await execFileAsync(agent, ['--version'], { timeout: 4000 });
          version = stdout.split('\n')[0].trim(); // Take first line
        } catch {
          try {
            const { stdout } = await execFileAsync(agent, ['-v'], { timeout: 4000 });
            version = stdout.split('\n')[0].trim();
          } catch {}
        }

        installed.push({ 
          name: agent.charAt(0).toUpperCase() + agent.slice(1), 
          command: agent, 
          version: version.length > 20 ? version.substring(0, 20) + '...' : version 
        });
      } catch {
        // Agent not found in PATH
      }
    }
    
    if (installed.length === 0) {
      // Fallback if which fails globally
      const fallback = [{ name: 'Claude', command: 'claude', version: 'unknown' }];
      detectedAgentsCache = { data: fallback, ts: now };
      return fallback;
    }

    detectedAgentsCache = { data: installed, ts: now };
    return installed;
  });

  ipcMain.handle('app:detectLivingSpecCandidates', async (event, { basePath }) => {
    try {
      const safeBasePath = resolveSafeProjectPath(basePath);
      if (!safeBasePath) {
        return { success: false, error: 'Invalid base path', candidates: [] };
      }
      const candidates = collectAgenticSpecCandidates(safeBasePath);
      return { success: true, candidates };
    } catch (e: any) {
      return { success: false, error: e.message, candidates: [] };
    }
  });

  ipcMain.handle('app:getLivingSpecSummary', async (event, { basePath, livingSpecPreference }) => {
    try {
      const safeBasePath = resolveSafeProjectPath(basePath);
      if (!safeBasePath) {
        return { success: false, error: 'Invalid base path' };
      }
      const summary = resolveLivingSpecSummary(
        safeBasePath,
        sanitizeLivingSpecPreference(livingSpecPreference)
      );
      return { success: true, summary: summary || undefined };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('app:saveImage', async (event, { worktreePath, imageBase64, filename }) => {
    try {
      const safeWorktreePath = resolveSafeWorktreePath(worktreePath);
      if (!safeWorktreePath) {
        return { success: false, error: 'Invalid worktree path' };
      }
      const safeFilename = normalizeCacheFilename(filename, `img_${Date.now()}.png`);
      const cacheDir = path.join(safeWorktreePath, '.agent_cache');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        // Make sure git ignores the cache
        fs.writeFileSync(path.join(cacheDir, '.gitignore'), '*\n');
      }
      
      const filePath = path.join(cacheDir, safeFilename);
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.byteLength > MAX_IMAGE_FILE_BYTES) {
        return { success: false, error: 'Image payload too large' };
      }
      
      fs.writeFileSync(filePath, buffer);
      
      // Return relative path for the agent to use
      return { success: true, path: `.agent_cache/${safeFilename}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('app:writeHandoverArtifact', async (_event, { worktreePath, packet, command }) => {
    try {
      const safeWorktreePath = resolveSafeWorktreePath(worktreePath);
      if (!safeWorktreePath) {
        return { success: false, error: 'Invalid worktree path' };
      }
      const safePacket = sanitizeHandoverPacket(packet);
      const provider = normalizeHandoverProvider(command);
      const cacheDir = path.join(safeWorktreePath, '.agent_cache');
      const handoverDir = path.join(cacheDir, 'handover');
      fs.mkdirSync(handoverDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, '.gitignore'), '*\n');

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${stamp}-${provider}.json`;
      const relativePath = path.join('.agent_cache', 'handover', fileName).replace(/\\/g, '/');
      const latestRelativePath = path.join('.agent_cache', 'handover', 'latest.json').replace(/\\/g, '/');
      safeWriteJson(path.join(safeWorktreePath, relativePath), safePacket, MAX_HANDOVER_PACKET_BYTES);
      safeWriteJson(path.join(safeWorktreePath, latestRelativePath), safePacket, MAX_HANDOVER_PACKET_BYTES);

      return { success: true, path: relativePath, latestPath: latestRelativePath };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to write handover artifact.' };
    }
  });

  ipcMain.handle('app:prepareAgentWorkspace', async (event, {
    worktreePath,
    projectPath,
    context,
    apiDoc,
    launchCommand,
    livingSpecPreference,
    livingSpecOverridePath
  }) => {
    try {
      const safeWorktreePath = resolveSafeWorktreePath(worktreePath);
      if (!safeWorktreePath) {
        return { success: false, error: 'Invalid worktree path' };
      }
      const safeProjectPath = resolveSafeProjectPath(projectPath);
      if (!safeProjectPath) {
        return { success: false, error: 'Invalid project path' };
      }
      const cacheDir = path.join(safeWorktreePath, '.agent_cache');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(path.join(cacheDir, '.gitignore'), '*\n');

      // Cleanup legacy root-level metadata files from older sessions.
      for (const legacyFile of ['.agent_api.md', '.agent_memory.md', 'mcp.json']) {
        const legacyPath = path.join(safeWorktreePath, legacyFile);
        if (fs.existsSync(legacyPath)) {
          fs.rmSync(legacyPath, { force: true });
        }
      }

      const safeApiDoc = clampUtf8(apiDoc, MAX_TEXT_FILE_BYTES);
      if (safeApiDoc) {
        fs.writeFileSync(path.join(cacheDir, 'agent_api.md'), safeApiDoc, 'utf8');
      }

      const launchScriptRelativePath = '.agent_cache/launch_agent.sh';
      const launchScriptAbsolutePath = path.join(safeWorktreePath, launchScriptRelativePath);
      const safeLaunchCommand = clampUtf8(typeof launchCommand === 'string' ? launchCommand : '', MAX_TEXT_FILE_BYTES).trim();
      if (safeLaunchCommand) {
        const launchScript = [
          '#!/usr/bin/env sh',
          'set -e',
          safeLaunchCommand
        ].join('\n');
        fs.writeFileSync(launchScriptAbsolutePath, `${launchScript}\n`, { mode: 0o700 });
        fs.chmodSync(launchScriptAbsolutePath, 0o700);
      } else if (fs.existsSync(launchScriptAbsolutePath)) {
        fs.rmSync(launchScriptAbsolutePath, { force: true });
      }

      const normalizedOverridePath = typeof livingSpecOverridePath === 'string'
        ? livingSpecOverridePath.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
        : '';
      const overridePreference = normalizedOverridePath
        ? { mode: 'single' as const, selectedPath: normalizedOverridePath }
        : sanitizeLivingSpecPreference(livingSpecPreference);
      const resolvedLivingSpec = resolveLivingSpecDocument(safeProjectPath, overridePreference);
      const forklineSpecPath = path.join(cacheDir, 'FORKLINE_SPEC.md');
      const directSpecSourcePath = typeof resolvedLivingSpec?.resolvedPath === 'string'
        ? resolvedLivingSpec.resolvedPath.trim()
        : '';
      const hasDirectSpecSource = !!directSpecSourcePath;
      if (hasDirectSpecSource) {
        if (fs.existsSync(forklineSpecPath)) {
          fs.rmSync(forklineSpecPath, { force: true });
        }
      } else if (resolvedLivingSpec?.content) {
        fs.writeFileSync(forklineSpecPath, resolvedLivingSpec.content, 'utf8');
      } else if (fs.existsSync(forklineSpecPath)) {
        fs.rmSync(forklineSpecPath, { force: true });
      }
      const exposedSpecPath = hasDirectSpecSource ? directSpecSourcePath : '.agent_cache/FORKLINE_SPEC.md';

      const memoryPath = path.join(cacheDir, 'agent_memory.md');
      const safeContext = clampUtf8(context, MAX_TEXT_FILE_BYTES);
      const memorySections: string[] = [];
      if (safeContext) {
        memorySections.push(`Project Memory Context:\n${safeContext}`);
      }
      if (resolvedLivingSpec?.content) {
        memorySections.push(
          [
            'Living Spec:',
            `- path: ${exposedSpecPath}`,
            `- mode: ${resolvedLivingSpec.mode}`,
            `- sources: ${resolvedLivingSpec.sources.join(', ')}`
          ].join('\n')
        );
      }
      if (memorySections.length > 0) {
        fs.writeFileSync(memoryPath, `${memorySections.join('\n\n')}\n`, 'utf8');
      } else if (fs.existsSync(memoryPath)) {
        fs.rmSync(memoryPath, { force: true });
      }

      return {
        success: true,
        launchScriptPath: safeLaunchCommand ? launchScriptRelativePath : undefined
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  const workspaceFile = path.join(app.getPath('userData'), 'workspace.json');
  
  ipcMain.handle('store:save', async (event, { data }) => {
    try {
      const sanitized = sanitizeWorkspaceStoreData(data);
      safeWriteJson(workspaceFile, sanitized, MAX_WORKSPACE_JSON_BYTES);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('store:load', async () => {
    try {
      if (fs.existsSync(workspaceFile)) {
        const raw = fs.readFileSync(workspaceFile, 'utf8');
        return { success: true, data: sanitizeWorkspaceStoreData(JSON.parse(raw)) };
      }
      return { success: true, data: null };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('session:saveRuntime', async (event, { data }) => {
    try {
      const serialized = JSON.stringify(data ?? null);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_RUNTIME_SESSION_BYTES) {
        return { success: false, error: 'Runtime session payload too large.' };
      }
      runtimeSessionState = JSON.parse(serialized);
      saveRuntimeSessionToDisk(runtimeSessionState);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Invalid runtime session payload.' };
    }
  });

  ipcMain.handle('session:loadRuntime', async () => {
    if (!runtimeSessionState) {
      runtimeSessionState = loadRuntimeSessionFromDisk();
    }
    return { success: true, data: runtimeSessionState };
  });

  ipcMain.handle('fleet:trackTask', async (event, { payload }: { payload: FleetTaskPayload }) => {
    try {
      fleetStore?.trackTask(payload);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:recordEvent', async (event, { taskId, eventType, payload }: { taskId: string; eventType: string; payload?: Record<string, unknown> }) => {
    try {
      fleetStore?.recordTaskEvent(taskId, eventType, payload || {});
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:markClosed', async (event, { taskId, closeAction }: { taskId: string; closeAction: string }) => {
    try {
      fleetStore?.markTaskClosed(taskId, closeAction);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:setArchived', async (event, { taskId, archived }: { taskId: string; archived: boolean }) => {
    try {
      fleetStore?.setTaskArchived(taskId, archived);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:listOverview', async () => {
    try {
      return { success: true, overview: fleetStore?.listOverview() || null };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:listProjects', async () => {
    try {
      return { success: true, projects: fleetStore?.listProjects() || [] };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:removeProject', async (event, { projectPath }: { projectPath: string }) => {
    try {
      if (!fleetStore) {
        return { success: false, error: 'Fleet store is unavailable.' };
      }
      const result = fleetStore.removeProject(projectPath);
      return { success: true, ...result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:listTasks', async (event, { options }: { options?: FleetListTasksOptions }) => {
    try {
      return { success: true, tasks: fleetStore?.listTasks(options) || [] };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fleet:getTaskTimeline', async (event, { taskId }: { taskId: string }) => {
    try {
      return { success: true, timeline: fleetStore?.getTaskTimeline(taskId) || { task: null, sessions: [], events: [] } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.on('agent:respond', (event, { requestId, statusCode, data }) => {
    if (agentServer) {
      agentServer.respondToAgent(requestId, statusCode, data);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !keepBackgroundServicesAlive) app.quit();
});

app.on('before-quit', () => {
  fleetStore?.close();
});
