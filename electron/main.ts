import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';
import { PtyManager } from './ptyManager';
import { GitManager } from './gitManager';
import { AgentControlServer } from './agentServer';

const execAsync = util.promisify(exec);
const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let agentServer: AgentControlServer | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  agentServer = new AgentControlServer(mainWindow);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5177');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  new PtyManager();
  new GitManager();
  
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

  ipcMain.handle('app:detectAgents', async () => {
    const knownAgents = ['claude', 'gemini', 'codex', 'aider', 'amp', 'cline', 'sweep', 'cursor'];
    const installed = [];
    
    for (const agent of knownAgents) {
      try {
        await execAsync(`which ${agent}`);
        
        let version = 'unknown';
        try {
          // Attempt to get version
          const { stdout } = await execAsync(`${agent} --version`);
          version = stdout.split('\n')[0].trim(); // Take first line
        } catch (e) {
          try {
            const { stdout } = await execAsync(`${agent} -v`);
            version = stdout.split('\n')[0].trim();
          } catch (e2) {}
        }

        installed.push({ 
          name: agent.charAt(0).toUpperCase() + agent.slice(1), 
          command: agent, 
          version: version.length > 20 ? version.substring(0, 20) + '...' : version 
        });
      } catch (e) {
        // Agent not found in PATH
      }
    }
    
    if (installed.length === 0) {
      // Fallback if which fails globally
      return [{ name: 'Claude', command: 'claude', version: 'unknown' }];
    }
    
    return installed;
  });

  ipcMain.handle('app:saveImage', async (event, { worktreePath, imageBase64, filename }) => {
    try {
      const cacheDir = path.join(worktreePath, '.agent_cache');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        // Make sure git ignores the cache
        fs.writeFileSync(path.join(cacheDir, '.gitignore'), '*\n');
      }
      
      const filePath = path.join(cacheDir, filename);
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      fs.writeFileSync(filePath, buffer);
      
      // Return relative path for the agent to use
      return { success: true, path: `.agent_cache/${filename}` };
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
