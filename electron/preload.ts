import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  getDefaultPath: () => ipcRenderer.invoke('app:getDefaultPath'),
  getControlBaseUrl: () => ipcRenderer.invoke('app:getControlBaseUrl'),
  getControlAuthToken: () => ipcRenderer.invoke('app:getControlAuthToken'),
  validateSource: (sourcePath: string) => ipcRenderer.invoke('git:validateSource', { sourcePath }),
  detectAgents: () => ipcRenderer.invoke('app:detectAgents'),
  prepareAgentWorkspace: (worktreePath: string, context: string, mcpServers: string, apiDoc: string) =>
    ipcRenderer.invoke('app:prepareAgentWorkspace', { worktreePath, context, mcpServers, apiDoc }),
  saveImage: (worktreePath: string, imageBase64: string, filename: string) => ipcRenderer.invoke('app:saveImage', { worktreePath, imageBase64, filename }),
  createWorktree: (basePath: string, taskName: string) => ipcRenderer.invoke('git:createWorktree', { basePath, taskName }),
  listWorktrees: (basePath: string) => ipcRenderer.invoke('git:listWorktrees', { basePath }),
  getDiff: (worktreePath: string) => ipcRenderer.invoke('git:getDiff', { worktreePath }),
  getModifiedFiles: (worktreePath: string) => ipcRenderer.invoke('git:getModifiedFiles', { worktreePath }),
  removeWorktree: (basePath: string, taskName: string, worktreePath: string, force: boolean) => ipcRenderer.invoke('git:removeWorktree', { basePath, taskName, worktreePath, force }),
  mergeWorktree: (basePath: string, taskName: string, worktreePath: string) => ipcRenderer.invoke('git:mergeWorktree', { basePath, taskName, worktreePath }),
  saveStore: (data: any) => ipcRenderer.invoke('store:save', { data }),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveRuntimeSession: (data: any) => ipcRenderer.invoke('session:saveRuntime', { data }),
  loadRuntimeSession: () => ipcRenderer.invoke('session:loadRuntime'),
  fleetTrackTask: (payload: any) => ipcRenderer.invoke('fleet:trackTask', { payload }),
  fleetRecordEvent: (taskId: string, eventType: string, payload?: Record<string, unknown>) =>
    ipcRenderer.invoke('fleet:recordEvent', { taskId, eventType, payload }),
  fleetMarkClosed: (taskId: string, closeAction: string) => ipcRenderer.invoke('fleet:markClosed', { taskId, closeAction }),
  fleetSetArchived: (taskId: string, archived: boolean) => ipcRenderer.invoke('fleet:setArchived', { taskId, archived }),
  fleetListOverview: () => ipcRenderer.invoke('fleet:listOverview'),
  fleetListProjects: () => ipcRenderer.invoke('fleet:listProjects'),
  fleetListTasks: (options?: any) => ipcRenderer.invoke('fleet:listTasks', { options }),
  fleetGetTaskTimeline: (taskId: string) => ipcRenderer.invoke('fleet:getTaskTimeline', { taskId }),
  createPty: (taskId: string, cwd?: string, customEnv?: Record<string, string>) => ipcRenderer.send('pty:create', { taskId, cwd, customEnv }),
  writePty: (taskId: string, data: string) => ipcRenderer.send('pty:write', { taskId, data }),
  resizePty: (taskId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { taskId, cols, rows }),
  detachPty: (taskId: string) => ipcRenderer.send('pty:detach', { taskId }),
  destroyPty: (taskId: string) => ipcRenderer.send('pty:destroy', { taskId }),
  listPtySessions: () => ipcRenderer.invoke('pty:listSessions'),
  onPtyData: (taskId: string, callback: (data: string) => void) => {
    const channel = `pty:data:${taskId}`;
    const listener = (_: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyState: (taskId: string, callback: (data: {taskId: string, created: boolean, running: boolean}) => void) => {
    const channel = `pty:state:${taskId}`;
    const listener = (_: Electron.IpcRendererEvent, data: {taskId: string, created: boolean, running: boolean}) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyExit: (taskId: string, callback: (data: {taskId: string, exitCode: number | null, signal?: number}) => void) => {
    const channel = `pty:exit:${taskId}`;
    const listener = (_: Electron.IpcRendererEvent, data: {taskId: string, exitCode: number | null, signal?: number}) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  removePtyDataListener: (taskId: string) => {
    ipcRenderer.removeAllListeners(`pty:data:${taskId}`);
  },
  onAgentRequest: (callback: (req: {requestId: string, taskId: string, action: string, payload: any}) => void) => {
    const listener = (_: Electron.IpcRendererEvent, req: {requestId: string, taskId: string, action: string, payload: any}) => callback(req);
    ipcRenderer.on('agent:request', listener);
    return () => ipcRenderer.removeListener('agent:request', listener);
  },
  respondToAgent: (requestId: string, statusCode: number, data: any) => {
    ipcRenderer.send('agent:respond', { requestId, statusCode, data });
  },
  onAgentTodos: (callback: (req: {taskId: string, payload: any}) => void) => {
    const listener = (_: Electron.IpcRendererEvent, req: {taskId: string, payload: any}) => callback(req);
    ipcRenderer.on('agent:todos', listener);
    return () => ipcRenderer.removeListener('agent:todos', listener);
  },
  onAgentMessage: (callback: (req: {taskId: string, payload: any}) => void) => {
    const listener = (_: Electron.IpcRendererEvent, req: {taskId: string, payload: any}) => callback(req);
    ipcRenderer.on('agent:message', listener);
    return () => ipcRenderer.removeListener('agent:message', listener);
  },
  onAgentUsage: (callback: (req: {taskId: string, payload: any}) => void) => {
    const listener = (_: Electron.IpcRendererEvent, req: {taskId: string, payload: any}) => callback(req);
    ipcRenderer.on('agent:usage', listener);
    return () => ipcRenderer.removeListener('agent:usage', listener);
  },
  onAgentBlocked: (callback: (data: {taskId: string, isBlocked: boolean, reason?: string}) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: {taskId: string, isBlocked: boolean, reason?: string}) => callback(data);
    ipcRenderer.on('agent:blocked', listener);
    return () => ipcRenderer.removeListener('agent:blocked', listener);
  },
  onGlobalShortcutNewTask: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:new-task', listener);
    return () => ipcRenderer.removeListener('app:new-task', listener);
  }
});
