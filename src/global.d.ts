export {};

declare global {
  interface Window {
    electronAPI: {
      openDirectoryDialog: () => Promise<string | null>;
      getDefaultPath: () => Promise<string>;
      detectAgents: () => Promise<{name: string, command: string, version: string}[]>;
      saveImage: (worktreePath: string, imageBase64: string, filename: string) => Promise<{success: boolean, path?: string, error?: string}>;
      validateSource: (sourcePath: string) => Promise<{valid: boolean, isRepo?: boolean, type?: string, error?: string}>;
      createWorktree: (basePath: string, taskName: string) => Promise<{success: boolean, worktreePath?: string, error?: string}>;
      getDiff: (worktreePath: string) => Promise<{success: boolean, diff?: string, error?: string}>;
      getModifiedFiles: (worktreePath: string) => Promise<{success: boolean, files?: string[], error?: string}>;
      removeWorktree: (basePath: string, taskName: string, worktreePath: string, force: boolean) => Promise<{success: boolean, error?: string}>;
      mergeWorktree: (basePath: string, taskName: string, worktreePath: string) => Promise<{success: boolean, error?: string}>;
      saveStore: (data: any) => Promise<{success: boolean, error?: string}>;
      loadStore: () => Promise<{success: boolean, data: any, error?: string}>;
      createPty: (taskId: string, cwd?: string, customEnv?: Record<string, string>) => void;
      writePty: (taskId: string, data: string) => void;
      resizePty: (taskId: string, cols: number, rows: number) => void;
      destroyPty: (taskId: string) => void;
      onPtyData: (taskId: string, callback: (data: string) => void) => void;
      removePtyDataListener: (taskId: string) => void;
      onAgentRequest: (callback: (req: {requestId: string, taskId: string, action: string, payload: any}) => void) => void;
      respondToAgent: (requestId: string, statusCode: number, data: any) => void;
      onAgentTodos: (callback: (req: {taskId: string, payload: any}) => void) => void;
      onAgentMessage: (callback: (req: {taskId: string, payload: any}) => void) => void;
      onAgentBlocked: (callback: (data: {taskId: string, isBlocked: boolean}) => void) => void;
      onGlobalShortcutNewTask?: (callback: () => void) => void;
    };
  }
}
