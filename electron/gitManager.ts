import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { ipcMain } from 'electron';

export class GitManager {
  constructor() {
    ipcMain.handle('git:validateSource', async (event, { sourcePath }) => {
      try {
        if (!fs.existsSync(sourcePath)) {
          return { valid: false, error: 'Path does not exist' };
        }
        const stat = fs.statSync(sourcePath);
        if (!stat.isDirectory()) {
          return { valid: false, error: 'Path is not a directory' };
        }
        const git = simpleGit(sourcePath);
        const isRepo = await git.checkIsRepo();
        return { valid: true, isRepo, type: isRepo ? 'Git Repository' : 'Local Directory' };
      } catch (error: any) {
        return { valid: false, error: error.message };
      }
    });

    ipcMain.handle('git:createWorktree', async (event, { basePath, taskName }) => {
      try {
        const git = simpleGit(basePath);
        
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
          await git.init();
          await git.add('.');
          try {
            await git.commit('Initial framework commit by Multi-Agent App');
          } catch (e) {
            // Ignore if nothing to commit
          }
        }

        const worktreesPath = path.join(path.dirname(basePath), `${path.basename(basePath)}-worktrees`);
        if (!fs.existsSync(worktreesPath)) {
          fs.mkdirSync(worktreesPath, { recursive: true });
        }

        const targetPath = path.join(worktreesPath, taskName);
        
        const branches = await git.branchLocal();
        if (branches.all.includes(taskName)) {
           await git.raw(['worktree', 'add', targetPath, taskName]);
        } else {
           await git.raw(['worktree', 'add', '-b', taskName, targetPath]);
        }
        
        return { success: true, worktreePath: targetPath };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('git:getDiff', async (event, { worktreePath }) => {
      try {
        const git = simpleGit(worktreePath);
        // Stage everything to get a comprehensive diff including new files
        await git.add('.');
        const diff = await git.diff(['--cached']);
        // Unstage to avoid forcing commits if user doesn't want to
        await git.reset(['HEAD']); 
        return { success: true, diff };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('git:getModifiedFiles', async (event, { worktreePath }) => {
      try {
        if (!fs.existsSync(worktreePath)) return { success: true, files: [] };
        const git = simpleGit(worktreePath);
        const status = await git.status();
        return { success: true, files: status.files.map(f => f.path) };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('git:removeWorktree', async (event, { basePath, taskName, worktreePath, force }) => {
      try {
        const git = simpleGit(basePath);
        
        // Remove worktree
        if (force) {
          await git.raw(['worktree', 'remove', '-f', worktreePath]);
        } else {
          await git.raw(['worktree', 'remove', worktreePath]);
        }

        // Delete the branch
        await git.branch(['-D', taskName]);

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('git:mergeWorktree', async (event, { basePath, taskName, worktreePath }) => {
      try {
        const gitBase = simpleGit(basePath);
        const gitWorktree = simpleGit(worktreePath);

        // Commit any pending changes in the worktree
        const status = await gitWorktree.status();
        if (!status.isClean()) {
           await gitWorktree.add('.');
           await gitWorktree.commit(`Automated commit from agent task: ${taskName}`);
        }

        // Merge into base branch (assuming base is currently checked out in basePath)
        await gitBase.merge([taskName]);

        // Clean up
        await gitBase.raw(['worktree', 'remove', '-f', worktreePath]);
        await gitBase.branch(['-d', taskName]);

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });
  }
}