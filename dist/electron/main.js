"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const ptyManager_1 = require("./ptyManager");
const gitManager_1 = require("./gitManager");
const agentServer_1 = require("./agentServer");
const execAsync = util_1.default.promisify(child_process_1.exec);
const isDev = !electron_1.app.isPackaged;
let mainWindow = null;
let agentServer = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, 'preload.js')
        }
    });
    agentServer = new agentServer_1.AgentControlServer(mainWindow);
    if (isDev) {
        mainWindow.loadURL('http://localhost:5177');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../../dist/index.html'));
    }
}
electron_1.app.whenReady().then(() => {
    new ptyManager_1.PtyManager();
    new gitManager_1.GitManager();
    electron_1.ipcMain.handle('dialog:openDirectory', async () => {
        if (!mainWindow)
            return null;
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        return canceled ? null : filePaths[0];
    });
    electron_1.ipcMain.handle('app:getDefaultPath', () => {
        return process.env.PWD || process.cwd();
    });
    electron_1.ipcMain.handle('app:detectAgents', async () => {
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
                }
                catch (e) {
                    try {
                        const { stdout } = await execAsync(`${agent} -v`);
                        version = stdout.split('\n')[0].trim();
                    }
                    catch (e2) { }
                }
                installed.push({
                    name: agent.charAt(0).toUpperCase() + agent.slice(1),
                    command: agent,
                    version: version.length > 20 ? version.substring(0, 20) + '...' : version
                });
            }
            catch (e) {
                // Agent not found in PATH
            }
        }
        if (installed.length === 0) {
            // Fallback if which fails globally
            return [{ name: 'Claude', command: 'claude', version: 'unknown' }];
        }
        return installed;
    });
    electron_1.ipcMain.handle('app:saveImage', async (event, { worktreePath, imageBase64, filename }) => {
        try {
            const cacheDir = path_1.default.join(worktreePath, '.agent_cache');
            if (!fs_1.default.existsSync(cacheDir)) {
                fs_1.default.mkdirSync(cacheDir, { recursive: true });
                // Make sure git ignores the cache
                fs_1.default.writeFileSync(path_1.default.join(cacheDir, '.gitignore'), '*\n');
            }
            const filePath = path_1.default.join(cacheDir, filename);
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            fs_1.default.writeFileSync(filePath, buffer);
            // Return relative path for the agent to use
            return { success: true, path: `.agent_cache/${filename}` };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    const workspaceFile = path_1.default.join(electron_1.app.getPath('userData'), 'workspace.json');
    electron_1.ipcMain.handle('store:save', async (event, { data }) => {
        try {
            fs_1.default.writeFileSync(workspaceFile, JSON.stringify(data, null, 2));
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('store:load', async () => {
        try {
            if (fs_1.default.existsSync(workspaceFile)) {
                const raw = fs_1.default.readFileSync(workspaceFile, 'utf8');
                return { success: true, data: JSON.parse(raw) };
            }
            return { success: true, data: null };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.on('agent:respond', (event, { requestId, statusCode, data }) => {
        if (agentServer) {
            agentServer.respondToAgent(requestId, statusCode, data);
        }
    });
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
