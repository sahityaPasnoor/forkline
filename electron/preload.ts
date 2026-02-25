import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  getDefaultPath: () => ipcRenderer.invoke('app:getDefaultPath'),
  readClipboardText: () => ipcRenderer.invoke('clipboard:readText'),
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:writeText', { text }),
  openExternalUrl: (url: string) => ipcRenderer.invoke('app:openExternalUrl', { url }),
  getControlBaseUrl: () => ipcRenderer.invoke('app:getControlBaseUrl'),
  getControlAuthToken: () => ipcRenderer.invoke('app:getControlAuthToken'),
  listPendingAgentRequests: () => ipcRenderer.invoke('app:listPendingAgentRequests'),
  listAgentSessions: (agentCommand: string, projectPath: string) =>
    ipcRenderer.invoke('app:listAgentSessions', { agentCommand, projectPath }),
  validateSource: (sourcePath: string) => ipcRenderer.invoke('git:validateSource', { sourcePath }),
  detectAgents: () => ipcRenderer.invoke('app:detectAgents'),
  prepareAgentWorkspace: (
    worktreePath: string,
    projectPath: string,
    context: string,
    apiDoc: string,
    livingSpecPreference?: { mode: 'single' | 'consolidated'; selectedPath?: string },
    livingSpecOverridePath?: string,
    launchCommand?: string
  ) =>
    ipcRenderer.invoke('app:prepareAgentWorkspace', {
      worktreePath,
      projectPath,
      context,
      apiDoc,
      livingSpecPreference,
      livingSpecOverridePath,
      launchCommand
    }),
  detectLivingSpecCandidates: (basePath: string) =>
    ipcRenderer.invoke('app:detectLivingSpecCandidates', { basePath }),
  getLivingSpecSummary: (
    basePath: string,
    livingSpecPreference?: { mode: 'single' | 'consolidated'; selectedPath?: string }
  ) =>
    ipcRenderer.invoke('app:getLivingSpecSummary', { basePath, livingSpecPreference }),
  writeHandoverArtifact: (worktreePath: string, packet: any, command: string) =>
    ipcRenderer.invoke('app:writeHandoverArtifact', { worktreePath, packet, command }),
  saveImage: (worktreePath: string, imageBase64: string, filename: string) => ipcRenderer.invoke('app:saveImage', { worktreePath, imageBase64, filename }),
  createWorktree: (
    basePath: string,
    taskName: string,
    baseBranch?: string,
    options?: {
      createBaseBranchIfMissing?: boolean;
      dependencyCloneMode?: 'copy_on_write' | 'full_copy';
      packageStoreStrategy?: 'off' | 'pnpm_global' | 'polyglot_global';
      pnpmStorePath?: string;
      sharedCacheRoot?: string;
      pnpmAutoInstall?: boolean;
    }
  ) => ipcRenderer.invoke('git:createWorktree', { basePath, taskName, baseBranch, options }),
  listWorktrees: (basePath: string) => ipcRenderer.invoke('git:listWorktrees', { basePath }),
  getWorkspaceInfo: (basePath: string) => ipcRenderer.invoke('git:getWorkspaceInfo', { basePath }),
  listBranches: (basePath: string) => ipcRenderer.invoke('git:listBranches', { basePath }),
  getRepositoryWebUrl: (basePath: string) => ipcRenderer.invoke('git:getRepositoryWebUrl', { basePath }),
  getDiff: (worktreePath: string, options?: { syntaxAware?: boolean }) => ipcRenderer.invoke('git:getDiff', { worktreePath, options }),
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
  fleetRemoveProject: (projectPath: string) => ipcRenderer.invoke('fleet:removeProject', { projectPath }),
  fleetListTasks: (options?: any) => ipcRenderer.invoke('fleet:listTasks', { options }),
  fleetGetTaskTimeline: (taskId: string) => ipcRenderer.invoke('fleet:getTaskTimeline', { taskId }),
  createPty: (taskId: string, cwd?: string, customEnv?: Record<string, string>) => ipcRenderer.send('pty:create', { taskId, cwd, customEnv }),
  writePty: (taskId: string, data: string) => ipcRenderer.send('pty:write', { taskId, data }),
  launchPty: (taskId: string, command: string, options?: { suppressEcho?: boolean }) =>
    ipcRenderer.invoke('pty:launch', { taskId, command, options }),
  resizePty: (taskId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { taskId, cols, rows }),
  restartPty: (taskId: string) => ipcRenderer.invoke('pty:restart', { taskId }),
  detachPty: (taskId: string) => ipcRenderer.send('pty:detach', { taskId }),
  destroyPty: (taskId: string) => ipcRenderer.send('pty:destroy', { taskId }),
  listPtySessions: () => ipcRenderer.invoke('pty:listSessions'),
  onPtyData: (taskId: string, callback: (data: string) => void) => {
    const channel = `pty:data:${taskId}`;
    const listener = (_: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyState: (
    taskId: string,
    callback: (data: {
      taskId: string;
      created: boolean;
      running: boolean;
      restarted?: boolean;
      sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
    }) => void
  ) => {
    const channel = `pty:state:${taskId}`;
    const listener = (
      _: Electron.IpcRendererEvent,
      data: {
        taskId: string;
        created: boolean;
        running: boolean;
        restarted?: boolean;
        sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
      }
    ) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyExit: (taskId: string, callback: (data: {taskId: string, exitCode: number | null, signal?: number}) => void) => {
    const channel = `pty:exit:${taskId}`;
    const listener = (_: Electron.IpcRendererEvent, data: {taskId: string, exitCode: number | null, signal?: number}) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyMode: (
    taskId: string,
    callback: (data: {
      taskId: string;
      mode: string;
      modeSeq: number;
      modeConfidence?: string;
      modeSource?: string;
      provider?: string;
      isBlocked: boolean;
      blockedReason?: string;
    }) => void
  ) => {
    const channel = `pty:mode:${taskId}`;
    const listener = (
      _: Electron.IpcRendererEvent,
      data: {
        taskId: string;
        mode: string;
        modeSeq: number;
        modeConfidence?: string;
        modeSource?: string;
        provider?: string;
        isBlocked: boolean;
        blockedReason?: string;
      }
    ) => callback(data);
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
