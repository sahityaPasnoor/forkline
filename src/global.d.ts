export {};

declare global {
  interface Window {
    electronAPI: {
      openDirectoryDialog: () => Promise<string | null>;
      getDefaultPath: () => Promise<string>;
      readClipboardText: () => Promise<string>;
      writeClipboardText: (text: string) => Promise<{ success: boolean; error?: string }>;
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
      getControlBaseUrl: () => Promise<string>;
      getControlAuthToken: () => Promise<string>;
      listPendingAgentRequests: () => Promise<Array<{
        requestId: string;
        taskId: string;
        action: string;
        payload: any;
        createdAt: number;
        updatedAt: number;
      }>>;
      listAgentSessions: (agentCommand: string, projectPath: string) => Promise<{
        success: boolean;
        provider: 'claude' | 'gemini' | 'amp' | 'codex' | 'other';
        supportsInAppList: boolean;
        sessions?: Array<{ id: string; label: string; resumeArg?: string }>;
        error?: string;
      }>;
      detectAgents: () => Promise<{name: string, command: string, version: string}[]>;
      prepareAgentWorkspace: (
        worktreePath: string,
        projectPath: string,
        context: string,
        apiDoc: string,
        livingSpecPreference?: { mode: 'single' | 'consolidated'; selectedPath?: string },
        livingSpecOverridePath?: string,
        launchCommand?: string
      ) => Promise<{success: boolean, launchScriptPath?: string, error?: string}>;
      detectLivingSpecCandidates: (basePath: string) => Promise<{
        success: boolean;
        candidates?: Array<{ path: string; kind: string }>;
        error?: string;
      }>;
      getLivingSpecSummary: (basePath: string, livingSpecPreference?: { mode: 'single' | 'consolidated'; selectedPath?: string }) => Promise<{
        success: boolean;
        summary?: { preferredLanguage?: string; requiredExts?: string[]; forbiddenExts?: string[] };
        error?: string;
      }>;
      writeHandoverArtifact: (
        worktreePath: string,
        packet: any,
        command: string
      ) => Promise<{ success: boolean; path?: string; latestPath?: string; error?: string }>;
      saveImage: (worktreePath: string, imageBase64: string, filename: string) => Promise<{success: boolean, path?: string, error?: string}>;
      validateSource: (sourcePath: string) => Promise<{valid: boolean, isRepo?: boolean, type?: string, error?: string}>;
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
      ) => Promise<{success: boolean, worktreePath?: string, error?: string, dependencyBootstrap?: Record<string, unknown>}>;
      listWorktrees: (basePath: string) => Promise<{
        success: boolean;
        worktrees?: Array<{ path: string; branchRef?: string; branchName?: string | null }>;
        error?: string;
      }>;
      getWorkspaceInfo: (basePath: string) => Promise<{
        success: boolean;
        isRepo?: boolean;
        currentBranch?: string | null;
        defaultBranch?: string | null;
        error?: string;
      }>;
      listBranches: (basePath: string) => Promise<{
        success: boolean;
        branches?: string[];
        error?: string;
      }>;
      getRepositoryWebUrl: (basePath: string) => Promise<{
        success: boolean;
        webUrl?: string;
        remoteUrl?: string;
        error?: string;
      }>;
      getDiff: (worktreePath: string, options?: { syntaxAware?: boolean }) => Promise<{success: boolean, diff?: string, diffMode?: string, error?: string}>;
      getModifiedFiles: (worktreePath: string) => Promise<{success: boolean, files?: string[], error?: string}>;
      removeWorktree: (basePath: string, taskName: string, worktreePath: string, force: boolean) => Promise<{success: boolean, error?: string}>;
      mergeWorktree: (basePath: string, taskName: string, worktreePath: string) => Promise<{success: boolean, error?: string}>;
      saveStore: (data: any) => Promise<{success: boolean, error?: string}>;
      loadStore: () => Promise<{success: boolean, data: any, error?: string}>;
      saveRuntimeSession: (data: any) => Promise<{success: boolean, error?: string}>;
      loadRuntimeSession: () => Promise<{success: boolean, data: any, error?: string}>;
      fleetTrackTask: (payload: any) => Promise<{success: boolean, error?: string}>;
      fleetRecordEvent: (taskId: string, eventType: string, payload?: Record<string, unknown>) => Promise<{success: boolean, error?: string}>;
      fleetMarkClosed: (taskId: string, closeAction: string) => Promise<{success: boolean, error?: string}>;
      fleetSetArchived: (taskId: string, archived: boolean) => Promise<{success: boolean, error?: string}>;
      fleetListOverview: () => Promise<{success: boolean, overview?: any, error?: string}>;
      fleetListProjects: () => Promise<{success: boolean, projects?: any[], error?: string}>;
      fleetRemoveProject: (projectPath: string) => Promise<{success: boolean, removedProject?: boolean, removedTasks?: number, error?: string}>;
      fleetListTasks: (options?: any) => Promise<{success: boolean, tasks?: any[], error?: string}>;
      fleetGetTaskTimeline: (taskId: string) => Promise<{success: boolean, timeline?: any, error?: string}>;
      createPty: (taskId: string, cwd?: string, customEnv?: Record<string, string>) => void;
      writePty: (taskId: string, data: string) => void;
      launchPty: (taskId: string, command: string, options?: { suppressEcho?: boolean }) => Promise<{ success: boolean; error?: string }>;
      resizePty: (taskId: string, cols: number, rows: number) => void;
      restartPty: (taskId: string) => Promise<{ success: boolean; running?: boolean; restarted?: boolean; error?: string }>;
      detachPty: (taskId: string) => void;
      destroyPty: (taskId: string) => void;
      listPtySessions: () => Promise<{
        success: boolean;
        sessions?: Array<{
          taskId: string;
          cwd: string;
          running: boolean;
          isBlocked: boolean;
          mode?: string;
          modeSeq?: number;
          modeConfidence?: string;
          modeSource?: string;
          provider?: string;
          subscribers: number;
          createdAt: number;
          lastActivityAt: number;
          exitCode: number | null;
          signal?: number;
          bufferSize: number;
          tailPreview?: string[];
          resource?: { taskId: string; sessionId: string; port: number; host: string } | null;
          sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
          dependencyPolicy?: { strategy: string; ecosystems?: string[]; sharedCacheRoot?: string } | null;
        }>;
      }>;
      onPtyData: (taskId: string, callback: (data: string) => void) => () => void;
      onPtyState: (
        taskId: string,
        callback: (data: {
          taskId: string;
          created: boolean;
          running: boolean;
          restarted?: boolean;
          sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
        }) => void
      ) => () => void;
      onPtyExit: (taskId: string, callback: (data: {taskId: string, exitCode: number | null, signal?: number}) => void) => () => void;
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
      ) => () => void;
      removePtyDataListener: (taskId: string) => void;
      onAgentRequest: (callback: (req: {requestId: string, taskId: string, action: string, payload: any}) => void) => () => void;
      respondToAgent: (requestId: string, statusCode: number, data: any) => void;
      onAgentTodos: (callback: (req: {taskId: string, payload: any}) => void) => () => void;
      onAgentMessage: (callback: (req: {taskId: string, payload: any}) => void) => () => void;
      onAgentUsage: (callback: (req: {taskId: string, payload: any}) => void) => () => void;
      onAgentBlocked: (callback: (data: {taskId: string, isBlocked: boolean, reason?: string}) => void) => () => void;
      onGlobalShortcutNewTask: (callback: () => void) => () => void;
    };
  }
}
