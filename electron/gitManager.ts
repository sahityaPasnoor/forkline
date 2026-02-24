import { ipcMain } from 'electron';

// Shared core engine implementation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GitService } = require('../../packages/core/src/services/git-service');

type GitServiceInstance = {
  validateSource: (sourcePath: string) => Promise<Record<string, unknown>>;
  createWorktree: (
    basePath: string,
    taskName: string,
    baseBranch?: string,
    options?: {
      createBaseBranchIfMissing?: boolean;
      dependencyCloneMode?: 'copy_on_write' | 'full_copy';
      packageStoreStrategy?: string;
      pnpmStorePath?: string;
      sharedCacheRoot?: string;
      pnpmAutoInstall?: boolean;
    }
  ) => Promise<Record<string, unknown>>;
  listWorktrees: (basePath: string) => Promise<Record<string, unknown>>;
  getWorkspaceInfo: (basePath: string) => Promise<Record<string, unknown>>;
  listBranches: (basePath: string) => Promise<Record<string, unknown>>;
  getDiff: (worktreePath: string, options?: { syntaxAware?: boolean }) => Promise<Record<string, unknown>>;
  getModifiedFiles: (worktreePath: string) => Promise<Record<string, unknown>>;
  removeWorktree: (basePath: string, taskName: string, worktreePath: string, force: boolean) => Promise<Record<string, unknown>>;
  mergeWorktree: (basePath: string, taskName: string, worktreePath: string) => Promise<Record<string, unknown>>;
};

export class GitManager {
  private gitService: GitServiceInstance;

  constructor() {
    this.gitService = new GitService();

    ipcMain.handle('git:validateSource', async (event, { sourcePath }) => {
      try {
        return await this.gitService.validateSource(sourcePath);
      } catch (error: any) {
        return { valid: false, error: error?.message || String(error) };
      }
    });

    ipcMain.handle('git:createWorktree', async (event, { basePath, taskName, baseBranch, options }) => {
      try {
        return await this.gitService.createWorktree(basePath, taskName, baseBranch, options);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    });

    ipcMain.handle('git:listWorktrees', async (event, { basePath }) => {
      try {
        return await this.gitService.listWorktrees(basePath);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    });

    ipcMain.handle('git:getWorkspaceInfo', async (event, { basePath }) => {
      try {
        return await this.gitService.getWorkspaceInfo(basePath);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    });

    ipcMain.handle('git:listBranches', async (event, { basePath }) => {
      try {
        return await this.gitService.listBranches(basePath);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error), branches: [] };
      }
    });

    ipcMain.handle('git:getDiff', async (event, { worktreePath, options }) => {
      try {
        return await this.gitService.getDiff(worktreePath, options);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    });

    ipcMain.handle('git:getModifiedFiles', async (event, { worktreePath }) => {
      try {
        return await this.gitService.getModifiedFiles(worktreePath);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error), files: [] };
      }
    });

    ipcMain.handle('git:removeWorktree', async (event, { basePath, taskName, worktreePath, force }) => {
      try {
        return await this.gitService.removeWorktree(basePath, taskName, worktreePath, force);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    });

    ipcMain.handle('git:mergeWorktree', async (event, { basePath, taskName, worktreePath }) => {
      try {
        return await this.gitService.mergeWorktree(basePath, taskName, worktreePath);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    });
  }
}
