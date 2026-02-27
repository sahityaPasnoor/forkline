"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitManager = void 0;
const electron_1 = require("electron");
// Shared core engine implementation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GitService } = require('../../packages/core/src/services/git-service');
class GitManager {
    gitService;
    constructor() {
        this.gitService = new GitService();
        electron_1.ipcMain.handle('git:validateSource', async (event, { sourcePath }) => {
            try {
                return await this.gitService.validateSource(sourcePath);
            }
            catch (error) {
                return { valid: false, error: error?.message || String(error) };
            }
        });
        electron_1.ipcMain.handle('git:createWorktree', async (event, { basePath, taskName, baseBranch, options }) => {
            try {
                return await this.gitService.createWorktree(basePath, taskName, baseBranch, options);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
        electron_1.ipcMain.handle('git:listWorktrees', async (event, { basePath }) => {
            try {
                return await this.gitService.listWorktrees(basePath);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
        electron_1.ipcMain.handle('git:getWorkspaceInfo', async (event, { basePath }) => {
            try {
                return await this.gitService.getWorkspaceInfo(basePath);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
        electron_1.ipcMain.handle('git:listBranches', async (event, { basePath }) => {
            try {
                return await this.gitService.listBranches(basePath);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error), branches: [] };
            }
        });
        electron_1.ipcMain.handle('git:getRepositoryWebUrl', async (_event, { basePath }) => {
            try {
                return await this.gitService.getRepositoryWebUrl(basePath);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
        electron_1.ipcMain.handle('git:getDiff', async (event, { worktreePath, options }) => {
            try {
                return await this.gitService.getDiff(worktreePath, options);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
        electron_1.ipcMain.handle('git:getModifiedFiles', async (event, { worktreePath }) => {
            try {
                return await this.gitService.getModifiedFiles(worktreePath);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error), files: [] };
            }
        });
        electron_1.ipcMain.handle('git:removeWorktree', async (event, { basePath, taskName, worktreePath, force }) => {
            try {
                return await this.gitService.removeWorktree(basePath, taskName, worktreePath, force);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
        electron_1.ipcMain.handle('git:mergeWorktree', async (event, { basePath, taskName, worktreePath }) => {
            try {
                return await this.gitService.mergeWorktree(basePath, taskName, worktreePath);
            }
            catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
    }
}
exports.GitManager = GitManager;
