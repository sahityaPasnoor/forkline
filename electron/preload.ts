import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  getDefaultPath: () => ipcRenderer.invoke('app:getDefaultPath'),
  validateSource: (sourcePath: string) => ipcRenderer.invoke('git:validateSource', { sourcePath }),
  detectAgents: () => ipcRenderer.invoke('app:detectAgents'),
  saveImage: (worktreePath: string, imageBase64: string, filename: string) => ipcRenderer.invoke('app:saveImage', { worktreePath, imageBase64, filename }),
  createWorktree: (basePath: string, taskName: string) => ipcRenderer.invoke('git:createWorktree', { basePath, taskName }),
  getDiff: (worktreePath: string) => ipcRenderer.invoke('git:getDiff', { worktreePath }),
  getModifiedFiles: (worktreePath: string) => ipcRenderer.invoke('git:getModifiedFiles', { worktreePath }),
  removeWorktree: (basePath: string, taskName: string, worktreePath: string, force: boolean) => ipcRenderer.invoke('git:removeWorktree', { basePath, taskName, worktreePath, force }),
  mergeWorktree: (basePath: string, taskName: string, worktreePath: string) => ipcRenderer.invoke('git:mergeWorktree', { basePath, taskName, worktreePath }),
  saveStore: (data: any) => ipcRenderer.invoke('store:save', { data }),
  loadStore: () => ipcRenderer.invoke('store:load'),
  createPty: (taskId: string, cwd?: string, customEnv?: Record<string, string>) => ipcRenderer.send('pty:create', { taskId, cwd, customEnv }),
  writePty: (taskId: string, data: string) => ipcRenderer.send('pty:write', { taskId, data }),
  resizePty: (taskId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { taskId, cols, rows }),
  destroyPty: (taskId: string) => ipcRenderer.send('pty:destroy', { taskId }),
  onPtyData: (taskId: string, callback: (data: string) => void) => {
    ipcRenderer.on(`pty:data:${taskId}`, (_, data) => callback(data));
  },
  removePtyDataListener: (taskId: string) => {
    ipcRenderer.removeAllListeners(`pty:data:${taskId}`);
  },
  onAgentRequest: (callback: (req: {requestId: string, taskId: string, action: string, payload: any}) => void) => {
    ipcRenderer.on('agent:request', (_, req) => callback(req));
  },
  respondToAgent: (requestId: string, statusCode: number, data: any) => {
    ipcRenderer.send('agent:respond', { requestId, statusCode, data });
  },
  onAgentTodos: (callback: (req: {taskId: string, payload: any}) => void) => {
    ipcRenderer.on('agent:todos', (_, req) => callback(req));
  },
  onAgentMessage: (callback: (req: {taskId: string, payload: any}) => void) => {
    ipcRenderer.on('agent:message', (_, req) => callback(req));
  },
  onAgentBlocked: (callback: (data: {taskId: string, isBlocked: boolean}) => void) => {
    ipcRenderer.on('agent:blocked', (_, data) => callback(data));
  }
});