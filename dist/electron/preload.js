"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    openDirectoryDialog: () => electron_1.ipcRenderer.invoke('dialog:openDirectory'),
    getDefaultPath: () => electron_1.ipcRenderer.invoke('app:getDefaultPath'),
    validateSource: (sourcePath) => electron_1.ipcRenderer.invoke('git:validateSource', { sourcePath }),
    detectAgents: () => electron_1.ipcRenderer.invoke('app:detectAgents'),
    saveImage: (worktreePath, imageBase64, filename) => electron_1.ipcRenderer.invoke('app:saveImage', { worktreePath, imageBase64, filename }),
    createWorktree: (basePath, taskName) => electron_1.ipcRenderer.invoke('git:createWorktree', { basePath, taskName }),
    getDiff: (worktreePath) => electron_1.ipcRenderer.invoke('git:getDiff', { worktreePath }),
    getModifiedFiles: (worktreePath) => electron_1.ipcRenderer.invoke('git:getModifiedFiles', { worktreePath }),
    removeWorktree: (basePath, taskName, worktreePath, force) => electron_1.ipcRenderer.invoke('git:removeWorktree', { basePath, taskName, worktreePath, force }),
    mergeWorktree: (basePath, taskName, worktreePath) => electron_1.ipcRenderer.invoke('git:mergeWorktree', { basePath, taskName, worktreePath }),
    saveStore: (data) => electron_1.ipcRenderer.invoke('store:save', { data }),
    loadStore: () => electron_1.ipcRenderer.invoke('store:load'),
    createPty: (taskId, cwd, customEnv) => electron_1.ipcRenderer.send('pty:create', { taskId, cwd, customEnv }),
    writePty: (taskId, data) => electron_1.ipcRenderer.send('pty:write', { taskId, data }),
    resizePty: (taskId, cols, rows) => electron_1.ipcRenderer.send('pty:resize', { taskId, cols, rows }),
    destroyPty: (taskId) => electron_1.ipcRenderer.send('pty:destroy', { taskId }),
    onPtyData: (taskId, callback) => {
        electron_1.ipcRenderer.on(`pty:data:${taskId}`, (_, data) => callback(data));
    },
    removePtyDataListener: (taskId) => {
        electron_1.ipcRenderer.removeAllListeners(`pty:data:${taskId}`);
    },
    onAgentRequest: (callback) => {
        electron_1.ipcRenderer.on('agent:request', (_, req) => callback(req));
    },
    respondToAgent: (requestId, statusCode, data) => {
        electron_1.ipcRenderer.send('agent:respond', { requestId, statusCode, data });
    },
    onAgentTodos: (callback) => {
        electron_1.ipcRenderer.on('agent:todos', (_, req) => callback(req));
    },
    onAgentMessage: (callback) => {
        electron_1.ipcRenderer.on('agent:message', (_, req) => callback(req));
    },
    onAgentBlocked: (callback) => {
        electron_1.ipcRenderer.on('agent:blocked', (_, data) => callback(data));
    }
});
