"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    openDirectoryDialog: () => electron_1.ipcRenderer.invoke('dialog:openDirectory'),
    getDefaultPath: () => electron_1.ipcRenderer.invoke('app:getDefaultPath'),
    readClipboardText: () => electron_1.ipcRenderer.invoke('clipboard:readText'),
    writeClipboardText: (text) => electron_1.ipcRenderer.invoke('clipboard:writeText', { text }),
    openExternalUrl: (url) => electron_1.ipcRenderer.invoke('app:openExternalUrl', { url }),
    getControlBaseUrl: () => electron_1.ipcRenderer.invoke('app:getControlBaseUrl'),
    getControlAuthToken: () => electron_1.ipcRenderer.invoke('app:getControlAuthToken'),
    listPendingAgentRequests: () => electron_1.ipcRenderer.invoke('app:listPendingAgentRequests'),
    listAgentSessions: (agentCommand, projectPath) => electron_1.ipcRenderer.invoke('app:listAgentSessions', { agentCommand, projectPath }),
    validateSource: (sourcePath) => electron_1.ipcRenderer.invoke('git:validateSource', { sourcePath }),
    detectAgents: () => electron_1.ipcRenderer.invoke('app:detectAgents'),
    prepareAgentWorkspace: (worktreePath, projectPath, context, apiDoc, livingSpecPreference, livingSpecOverridePath, launchCommand) => electron_1.ipcRenderer.invoke('app:prepareAgentWorkspace', {
        worktreePath,
        projectPath,
        context,
        apiDoc,
        livingSpecPreference,
        livingSpecOverridePath,
        launchCommand
    }),
    detectLivingSpecCandidates: (basePath) => electron_1.ipcRenderer.invoke('app:detectLivingSpecCandidates', { basePath }),
    getLivingSpecSummary: (basePath, livingSpecPreference) => electron_1.ipcRenderer.invoke('app:getLivingSpecSummary', { basePath, livingSpecPreference }),
    writeHandoverArtifact: (worktreePath, packet, command) => electron_1.ipcRenderer.invoke('app:writeHandoverArtifact', { worktreePath, packet, command }),
    saveImage: (worktreePath, imageBase64, filename) => electron_1.ipcRenderer.invoke('app:saveImage', { worktreePath, imageBase64, filename }),
    createWorktree: (basePath, taskName, baseBranch, options) => electron_1.ipcRenderer.invoke('git:createWorktree', { basePath, taskName, baseBranch, options }),
    listWorktrees: (basePath) => electron_1.ipcRenderer.invoke('git:listWorktrees', { basePath }),
    getWorkspaceInfo: (basePath) => electron_1.ipcRenderer.invoke('git:getWorkspaceInfo', { basePath }),
    listBranches: (basePath) => electron_1.ipcRenderer.invoke('git:listBranches', { basePath }),
    getRepositoryWebUrl: (basePath) => electron_1.ipcRenderer.invoke('git:getRepositoryWebUrl', { basePath }),
    getDiff: (worktreePath, options) => electron_1.ipcRenderer.invoke('git:getDiff', { worktreePath, options }),
    getModifiedFiles: (worktreePath) => electron_1.ipcRenderer.invoke('git:getModifiedFiles', { worktreePath }),
    removeWorktree: (basePath, taskName, worktreePath, force) => electron_1.ipcRenderer.invoke('git:removeWorktree', { basePath, taskName, worktreePath, force }),
    mergeWorktree: (basePath, taskName, worktreePath) => electron_1.ipcRenderer.invoke('git:mergeWorktree', { basePath, taskName, worktreePath }),
    saveStore: (data) => electron_1.ipcRenderer.invoke('store:save', { data }),
    loadStore: () => electron_1.ipcRenderer.invoke('store:load'),
    saveRuntimeSession: (data) => electron_1.ipcRenderer.invoke('session:saveRuntime', { data }),
    loadRuntimeSession: () => electron_1.ipcRenderer.invoke('session:loadRuntime'),
    fleetTrackTask: (payload) => electron_1.ipcRenderer.invoke('fleet:trackTask', { payload }),
    fleetRecordEvent: (taskId, eventType, payload) => electron_1.ipcRenderer.invoke('fleet:recordEvent', { taskId, eventType, payload }),
    fleetMarkClosed: (taskId, closeAction) => electron_1.ipcRenderer.invoke('fleet:markClosed', { taskId, closeAction }),
    fleetSetArchived: (taskId, archived) => electron_1.ipcRenderer.invoke('fleet:setArchived', { taskId, archived }),
    fleetListOverview: () => electron_1.ipcRenderer.invoke('fleet:listOverview'),
    fleetListProjects: () => electron_1.ipcRenderer.invoke('fleet:listProjects'),
    fleetRemoveProject: (projectPath) => electron_1.ipcRenderer.invoke('fleet:removeProject', { projectPath }),
    fleetListTasks: (options) => electron_1.ipcRenderer.invoke('fleet:listTasks', { options }),
    fleetGetTaskTimeline: (taskId) => electron_1.ipcRenderer.invoke('fleet:getTaskTimeline', { taskId }),
    createPty: (taskId, cwd, customEnv) => electron_1.ipcRenderer.send('pty:create', { taskId, cwd, customEnv }),
    writePty: (taskId, data) => electron_1.ipcRenderer.send('pty:write', { taskId, data }),
    launchPty: (taskId, command, options) => electron_1.ipcRenderer.invoke('pty:launch', { taskId, command, options }),
    resizePty: (taskId, cols, rows) => electron_1.ipcRenderer.send('pty:resize', { taskId, cols, rows }),
    restartPty: (taskId) => electron_1.ipcRenderer.invoke('pty:restart', { taskId }),
    detachPty: (taskId) => electron_1.ipcRenderer.send('pty:detach', { taskId }),
    destroyPty: (taskId) => electron_1.ipcRenderer.send('pty:destroy', { taskId }),
    listPtySessions: () => electron_1.ipcRenderer.invoke('pty:listSessions'),
    onPtyData: (taskId, callback) => {
        const channel = `pty:data:${taskId}`;
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on(channel, listener);
        return () => electron_1.ipcRenderer.removeListener(channel, listener);
    },
    onPtyState: (taskId, callback) => {
        const channel = `pty:state:${taskId}`;
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on(channel, listener);
        return () => electron_1.ipcRenderer.removeListener(channel, listener);
    },
    onPtyExit: (taskId, callback) => {
        const channel = `pty:exit:${taskId}`;
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on(channel, listener);
        return () => electron_1.ipcRenderer.removeListener(channel, listener);
    },
    onPtyMode: (taskId, callback) => {
        const channel = `pty:mode:${taskId}`;
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on(channel, listener);
        return () => electron_1.ipcRenderer.removeListener(channel, listener);
    },
    removePtyDataListener: (taskId) => {
        electron_1.ipcRenderer.removeAllListeners(`pty:data:${taskId}`);
    },
    onAgentRequest: (callback) => {
        const listener = (_, req) => callback(req);
        electron_1.ipcRenderer.on('agent:request', listener);
        return () => electron_1.ipcRenderer.removeListener('agent:request', listener);
    },
    respondToAgent: (requestId, statusCode, data) => {
        electron_1.ipcRenderer.send('agent:respond', { requestId, statusCode, data });
    },
    onAgentTodos: (callback) => {
        const listener = (_, req) => callback(req);
        electron_1.ipcRenderer.on('agent:todos', listener);
        return () => electron_1.ipcRenderer.removeListener('agent:todos', listener);
    },
    onAgentMessage: (callback) => {
        const listener = (_, req) => callback(req);
        electron_1.ipcRenderer.on('agent:message', listener);
        return () => electron_1.ipcRenderer.removeListener('agent:message', listener);
    },
    onAgentUsage: (callback) => {
        const listener = (_, req) => callback(req);
        electron_1.ipcRenderer.on('agent:usage', listener);
        return () => electron_1.ipcRenderer.removeListener('agent:usage', listener);
    },
    onAgentBlocked: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('agent:blocked', listener);
        return () => electron_1.ipcRenderer.removeListener('agent:blocked', listener);
    },
    onGlobalShortcutNewTask: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on('app:new-task', listener);
        return () => electron_1.ipcRenderer.removeListener('app:new-task', listener);
    }
});
