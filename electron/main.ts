import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';
import { PtyManager } from './ptyManager';
import { GitManager } from './gitManager';
import { AgentControlServer } from './agentServer';
import { FleetStore, type FleetListTasksOptions, type FleetTaskPayload } from './fleetStore';

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
const WORKTREE_BASENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

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

app.setName('Forkline');

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
    const raw = fs.readFileSync(runtimeSessionFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const saveRuntimeSessionToDisk = (data: any) => {
  if (!runtimeSessionFile) return;
  try {
    fs.writeFileSync(runtimeSessionFile, JSON.stringify(data ?? null, null, 2));
  } catch {
    // Best-effort persistence. Runtime state still remains in memory.
  }
};

function createWindow() {
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

  agentServer = new AgentControlServer(mainWindow);

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

  ipcMain.handle('app:prepareAgentWorkspace', async (event, { worktreePath, context, mcpServers, apiDoc }) => {
    try {
      const safeWorktreePath = resolveSafeWorktreePath(worktreePath);
      if (!safeWorktreePath) {
        return { success: false, error: 'Invalid worktree path' };
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

      const memoryPath = path.join(cacheDir, 'agent_memory.md');
      const safeContext = clampUtf8(context, MAX_TEXT_FILE_BYTES);
      if (safeContext) {
        fs.writeFileSync(memoryPath, `Project Memory Context: ${safeContext}\n`, 'utf8');
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
      fs.writeFileSync(workspaceFile, JSON.stringify(data, null, 2));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('store:load', async () => {
    try {
      if (fs.existsSync(workspaceFile)) {
        const raw = fs.readFileSync(workspaceFile, 'utf8');
        return { success: true, data: JSON.parse(raw) };
      }
      return { success: true, data: null };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('session:saveRuntime', async (event, { data }) => {
    runtimeSessionState = data;
    saveRuntimeSessionToDisk(runtimeSessionState);
    return { success: true };
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  fleetStore?.close();
});
