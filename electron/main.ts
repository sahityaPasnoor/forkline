import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';
import { PtyManager } from './ptyManager';
import { GitManager } from './gitManager';
import { AgentControlServer } from './agentServer';
import { FleetStore, type FleetListTasksOptions, type FleetTaskPayload } from './fleetStore';
const {
  collectAgenticSpecCandidates,
  sanitizeLivingSpecPreference,
  resolveLivingSpecDocument
} = require('../../packages/core/src/services/living-spec-service');

const execFileAsync = util.promisify(execFile);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = !!devServerUrl;
let mainWindow: BrowserWindow | null = null;
let agentServer: AgentControlServer | null = null;
let fleetStore: FleetStore | null = null;
let runtimeSessionState: any | null = null;
let runtimeSessionFile: string | null = null;
let detectedAgentsCache: { data: Array<{name: string; command: string; version: string}>; ts: number } | null = null;

const MAX_TEXT_FILE_BYTES = 256_000;
const MAX_IMAGE_FILE_BYTES = 10_000_000;
const MAX_WORKSPACE_JSON_BYTES = 512_000;
const MAX_RUNTIME_SESSION_BYTES = 8_000_000;
const WORKTREE_BASENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
type WorkspaceLivingSpecPreference = { mode: 'single' | 'consolidated'; selectedPath?: string };

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

const sanitizePathString = (value: unknown) => {
  const candidate = clampString(value, 4096);
  if (!candidate) return '';
  return path.resolve(candidate);
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
    mcpEnabled: !!source.mcpEnabled,
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

app.setName('Forkline');

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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
    agentServer = new AgentControlServer(mainWindow);
  } else {
    agentServer.setMainWindow(mainWindow);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(devServerUrl!);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(async () => {
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

  ipcMain.handle('app:getControlBaseUrl', () => {
    if (agentServer) {
      return agentServer.getBaseUrl();
    }
    return 'http://127.0.0.1:34567';
  });

  ipcMain.handle('app:getControlAuthToken', () => {
    return agentServer?.getAuthToken() || '';
  });

  ipcMain.handle('app:detectAgents', async () => {
    const now = Date.now();
    const cacheTtlMs = 5 * 60 * 1000;
    if (detectedAgentsCache && now - detectedAgentsCache.ts < cacheTtlMs) {
      return detectedAgentsCache.data;
    }

    const knownAgents = ['claude', 'gemini', 'codex', 'aider', 'amp', 'cline', 'sweep', 'cursor'];
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

  ipcMain.handle('app:prepareAgentWorkspace', async (event, {
    worktreePath,
    projectPath,
    context,
    mcpServers,
    apiDoc,
    livingSpecPreference
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

      const resolvedLivingSpec = resolveLivingSpecDocument(
        safeProjectPath,
        sanitizeLivingSpecPreference(livingSpecPreference)
      );
      const forklineSpecPath = path.join(cacheDir, 'FORKLINE_SPEC.md');
      if (resolvedLivingSpec?.content) {
        fs.writeFileSync(forklineSpecPath, resolvedLivingSpec.content, 'utf8');
      } else if (fs.existsSync(forklineSpecPath)) {
        fs.rmSync(forklineSpecPath, { force: true });
      }

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
            `- canonical path: .agent_cache/FORKLINE_SPEC.md`,
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

      const mcpPath = path.join(cacheDir, 'mcp.json');
      const safeMcp = clampUtf8(mcpServers, MAX_TEXT_FILE_BYTES);
      if (safeMcp) {
        try {
          const parsed = JSON.parse(safeMcp);
          fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2), 'utf8');
        } catch {
          return { success: false, error: 'Invalid MCP JSON' };
        }
      } else if (fs.existsSync(mcpPath)) {
        fs.rmSync(mcpPath, { force: true });
      }

      return { success: true };
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
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  fleetStore?.close();
});
