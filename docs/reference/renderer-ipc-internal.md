# Renderer IPC (Internal Appendix)

Status: internal implementation detail for GUI runtime. Not a stable public API.

Implementation source:
- `electron/preload.ts`
- `electron/main.ts`
- `electron/ptyManager.ts`
- `src/global.d.ts`

## Scope

`window.electronAPI` is exposed via preload and includes:
- invoke-style request/response calls (`ipcRenderer.invoke`)
- fire-and-forget commands (`ipcRenderer.send`)
- listener registration helpers for renderer subscriptions

## Invoke channels (request/response)

| Renderer API | Channel |
|---|---|
| `openDirectoryDialog` | `dialog:openDirectory` |
| `getDefaultPath` | `app:getDefaultPath` |
| `readClipboardText` | `clipboard:readText` |
| `writeClipboardText` | `clipboard:writeText` |
| `openExternalUrl` | `app:openExternalUrl` |
| `getControlBaseUrl` | `app:getControlBaseUrl` |
| `getControlAuthToken` | `app:getControlAuthToken` |
| `listPendingAgentRequests` | `app:listPendingAgentRequests` |
| `detectAgents` | `app:detectAgents` |
| `detectLivingSpecCandidates` | `app:detectLivingSpecCandidates` |
| `getLivingSpecSummary` | `app:getLivingSpecSummary` |
| `prepareAgentWorkspace` | `app:prepareAgentWorkspace` |
| `writeHandoverArtifact` | `app:writeHandoverArtifact` |
| `saveImage` | `app:saveImage` |
| `validateSource` | `git:validateSource` |
| `createWorktree` | `git:createWorktree` |
| `listWorktrees` | `git:listWorktrees` |
| `getWorkspaceInfo` | `git:getWorkspaceInfo` |
| `listBranches` | `git:listBranches` |
| `getRepositoryWebUrl` | `git:getRepositoryWebUrl` |
| `getDiff` | `git:getDiff` |
| `getModifiedFiles` | `git:getModifiedFiles` |
| `removeWorktree` | `git:removeWorktree` |
| `mergeWorktree` | `git:mergeWorktree` |
| `saveStore` | `store:save` |
| `loadStore` | `store:load` |
| `saveRuntimeSession` | `session:saveRuntime` |
| `loadRuntimeSession` | `session:loadRuntime` |
| `fleetTrackTask` | `fleet:trackTask` |
| `fleetRecordEvent` | `fleet:recordEvent` |
| `fleetMarkClosed` | `fleet:markClosed` |
| `fleetSetArchived` | `fleet:setArchived` |
| `fleetListOverview` | `fleet:listOverview` |
| `fleetListProjects` | `fleet:listProjects` |
| `fleetListTasks` | `fleet:listTasks` |
| `fleetGetTaskTimeline` | `fleet:getTaskTimeline` |
| `listPtySessions` | `pty:listSessions` |
| `restartPty` | `pty:restart` |

## Send channels (command style)

| Renderer API | Channel |
|---|---|
| `createPty` | `pty:create` |
| `writePty` | `pty:write` |
| `resizePty` | `pty:resize` |
| `detachPty` | `pty:detach` |
| `destroyPty` | `pty:destroy` |
| `respondToAgent` | `agent:respond` |

## Event listeners exposed to renderer

| Renderer helper | IPC channel |
|---|---|
| `onPtyData(taskId)` | `pty:data:<taskId>` |
| `onPtyState(taskId)` | `pty:state:<taskId>` |
| `onPtyExit(taskId)` | `pty:exit:<taskId>` |
| `onPtyMode(taskId)` | `pty:mode:<taskId>` |
| `onAgentRequest` | `agent:request` |
| `onAgentTodos` | `agent:todos` |
| `onAgentMessage` | `agent:message` |
| `onAgentUsage` | `agent:usage` |
| `onAgentBlocked` | `agent:blocked` |
| `onGlobalShortcutNewTask` | `app:new-task` |

## Error contract notes

- Most invoke handlers return `{ success: boolean, error?: string }` style payloads.
- Some utility channels return route-specific payloads (`getControlBaseUrl`, clipboard getters, etc.).
- PTY send channels report many failures asynchronously by writing orchestrator hints into `pty:data:<taskId>`.

## Change policy

Any change to these channels requires synchronized updates to:
- `electron/preload.ts`
- `src/global.d.ts`
- call sites in `src/`
