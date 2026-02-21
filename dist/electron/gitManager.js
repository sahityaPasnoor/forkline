"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitManager = void 0;
const simple_git_1 = __importDefault(require("simple-git"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
class GitManager {
    constructor() {
        electron_1.ipcMain.handle('git:validateSource', async (event, { sourcePath }) => {
            try {
                if (!fs_1.default.existsSync(sourcePath)) {
                    return { valid: false, error: 'Path does not exist' };
                }
                const stat = fs_1.default.statSync(sourcePath);
                if (!stat.isDirectory()) {
                    return { valid: false, error: 'Path is not a directory' };
                }
                const git = (0, simple_git_1.default)(sourcePath);
                const isRepo = await git.checkIsRepo();
                return { valid: true, isRepo, type: isRepo ? 'Git Repository' : 'Local Directory' };
            }
            catch (error) {
                return { valid: false, error: error.message };
            }
        });
        electron_1.ipcMain.handle('git:createWorktree', async (event, { basePath, taskName }) => {
            try {
                const git = (0, simple_git_1.default)(basePath);
                const isRepo = await git.checkIsRepo();
                if (!isRepo) {
                    await git.init();
                    await git.add('.');
                    try {
                        await git.commit('Initial framework commit by Multi-Agent App');
                    }
                    catch (e) {
                        // Ignore if nothing to commit
                    }
                }
                const worktreesPath = path_1.default.join(path_1.default.dirname(basePath), `${path_1.default.basename(basePath)}-worktrees`);
                if (!fs_1.default.existsSync(worktreesPath)) {
                    fs_1.default.mkdirSync(worktreesPath, { recursive: true });
                }
                const targetPath = path_1.default.join(worktreesPath, taskName);
                const branches = await git.branchLocal();
                if (branches.all.includes(taskName)) {
                    await git.raw(['worktree', 'add', targetPath, taskName]);
                }
                else {
                    await git.raw(['worktree', 'add', '-b', taskName, targetPath]);
                }
                return { success: true, worktreePath: targetPath };
            }
            catch (error) {
                return { success: false, error: error.message };
            }
        });
        electron_1.ipcMain.handle('git:getDiff', async (event, { worktreePath }) => {
            try {
                const git = (0, simple_git_1.default)(worktreePath);
                // Stage everything to get a comprehensive diff including new files
                await git.add('.');
                const diff = await git.diff(['--cached']);
                // Unstage to avoid forcing commits if user doesn't want to
                await git.reset(['HEAD']);
                return { success: true, diff };
            }
            catch (error) {
                return { success: false, error: error.message };
            }
        });
        electron_1.ipcMain.handle('git:getModifiedFiles', async (event, { worktreePath }) => {
            try {
                if (!fs_1.default.existsSync(worktreePath))
                    return { success: true, files: [] };
                const git = (0, simple_git_1.default)(worktreePath);
                const status = await git.status();
                return { success: true, files: status.files.map(f => f.path) };
            }
            catch (error) {
                return { success: false, error: error.message };
            }
        });
        electron_1.ipcMain.handle('git:removeWorktree', async (event, { basePath, taskName, worktreePath, force }) => {
            try {
                const git = (0, simple_git_1.default)(basePath);
                // Remove worktree
                if (force) {
                    await git.raw(['worktree', 'remove', '-f', worktreePath]);
                }
                else {
                    await git.raw(['worktree', 'remove', worktreePath]);
                }
                // Delete the branch
                await git.branch(['-D', taskName]);
                return { success: true };
            }
            catch (error) {
                return { success: false, error: error.message };
            }
        });
        electron_1.ipcMain.handle('git:mergeWorktree', async (event, { basePath, taskName, worktreePath }) => {
            try {
                const gitBase = (0, simple_git_1.default)(basePath);
                const gitWorktree = (0, simple_git_1.default)(worktreePath);
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
            }
            catch (error) {
                return { success: false, error: error.message };
            }
        });
    }
}
exports.GitManager = GitManager;
