const simpleGit = require('simple-git');
const path = require('node:path');
const fs = require('node:fs');

const ORCHESTRATOR_GENERATED_PREFIXES = ['.agent_cache/'];
const ORCHESTRATOR_GENERATED_FILES = new Set([
  '.agent_api.md',
  '.agent_memory.md',
  'mcp.json'
]);

const isOperationalRuntimeFile = (filePath) => {
  if (ORCHESTRATOR_GENERATED_FILES.has(filePath)) return true;
  return ORCHESTRATOR_GENERATED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
};

const branchRefToName = (branchRef) => {
  if (!branchRef) return null;
  if (branchRef.startsWith('refs/heads/')) return branchRef.slice('refs/heads/'.length);
  return branchRef;
};

const parseWorktreeList = (raw) => {
  const entries = [];
  const blocks = raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const entry = { path: '' };

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        entry.path = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ')) {
        entry.branch = line.slice('branch '.length).trim();
      }
    }

    if (entry.path) entries.push(entry);
  }

  return entries;
};

const normalizePath = (p) => path.resolve(p);

const isPathInside = (parentPath, targetPath) => {
  const parent = normalizePath(parentPath);
  const target = normalizePath(targetPath);
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const listWorktrees = async (git) => {
  const worktreeListRaw = await git.raw(['worktree', 'list', '--porcelain']);
  return parseWorktreeList(worktreeListRaw).map((entry) => ({
    path: normalizePath(entry.path),
    branchRef: entry.branch,
    branchName: branchRefToName(entry.branch)
  }));
};

const ensureInitialCommitExists = async (git) => {
  let hasHead = true;
  try {
    await git.raw(['rev-parse', '--verify', 'HEAD']);
  } catch {
    hasHead = false;
  }
  if (hasHead) return;

  try {
    await git.add('.');
  } catch {
    // Continue with allow-empty commit fallback.
  }

  await git.raw([
    '-c', 'user.name=Forkline',
    '-c', 'user.email=forkline@local',
    'commit',
    '--allow-empty',
    '-m',
    'Initial framework commit by Forkline'
  ]);
};

class GitService {
  async validateSource(sourcePath) {
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
  }

  async createWorktree(basePath, taskName) {
    const normalizedTaskName = String(taskName || '').trim();
    const isSafeTaskName = /^[a-z0-9][a-z0-9._-]{0,120}$/i.test(normalizedTaskName)
      && !normalizedTaskName.includes('..')
      && !normalizedTaskName.includes('/')
      && !normalizedTaskName.includes('\\');
    if (!isSafeTaskName) {
      return {
        success: false,
        error: 'Invalid task name. Use letters, numbers, ".", "_" or "-" only.'
      };
    }

    const git = simpleGit(basePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      await git.init();
    }
    await ensureInitialCommitExists(git);

    const worktreesPath = path.join(path.dirname(basePath), `${path.basename(basePath)}-worktrees`);
    const normalizedWorktreesPath = normalizePath(worktreesPath);
    if (!fs.existsSync(worktreesPath)) {
      fs.mkdirSync(worktreesPath, { recursive: true });
    }

    const targetPath = path.join(worktreesPath, normalizedTaskName);
    const normalizedTargetPath = normalizePath(targetPath);
    if (!isPathInside(normalizedWorktreesPath, normalizedTargetPath)) {
      return {
        success: false,
        error: 'Unsafe worktree path computed for task name.'
      };
    }

    const branchRef = `refs/heads/${normalizedTaskName}`;
    const worktrees = await listWorktrees(git);

    const existingByPath = worktrees.find((wt) => wt.path === normalizedTargetPath);
    if (existingByPath) return { success: true, worktreePath: existingByPath.path };

    const existingByBranch = worktrees.find((wt) => wt.branchRef === branchRef);
    if (existingByBranch) return { success: true, worktreePath: existingByBranch.path };

    if (fs.existsSync(normalizedTargetPath)) {
      return {
        success: false,
        error: `Path already exists and is not a worktree for this repository: ${normalizedTargetPath}`
      };
    }

    const branches = await git.branchLocal();
    if (branches.all.includes(normalizedTaskName)) {
      await git.raw(['worktree', 'add', normalizedTargetPath, normalizedTaskName]);
    } else {
      await git.raw(['worktree', 'add', '-b', normalizedTaskName, normalizedTargetPath]);
    }

    return { success: true, worktreePath: normalizedTargetPath };
  }

  async listWorktrees(basePath) {
    if (!basePath || !fs.existsSync(basePath)) {
      return { success: true, worktrees: [] };
    }
    const git = simpleGit(basePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { success: true, worktrees: [] };

    const baseResolved = normalizePath(basePath);
    const worktrees = (await listWorktrees(git)).filter((entry) => entry.path !== baseResolved);
    return { success: true, worktrees };
  }

  async getDiff(worktreePath) {
    const git = simpleGit(worktreePath);
    const trackedDiff = await git.raw(['diff', '--no-ext-diff', 'HEAD']);
    const status = await git.status();
    const untracked = status.not_added || [];
    const untrackedSection = untracked.length > 0
      ? `\n\n# Untracked files\n${untracked.map((f) => `?? ${f}`).join('\n')}\n`
      : '';
    return { success: true, diff: `${trackedDiff}${untrackedSection}` };
  }

  async getModifiedFiles(worktreePath) {
    if (!fs.existsSync(worktreePath)) {
      return { success: false, error: 'Worktree path does not exist', files: [] };
    }
    const git = simpleGit(worktreePath);
    const status = await git.status();
    const files = status.files
      .map((f) => f.path)
      .filter((file) => !isOperationalRuntimeFile(file));
    return { success: true, files };
  }

  async removeWorktree(basePath, taskName, worktreePath, force) {
    const git = simpleGit(basePath);
    if (force) {
      await git.raw(['worktree', 'remove', '-f', worktreePath]);
    } else {
      await git.raw(['worktree', 'remove', worktreePath]);
    }
    await git.branch(['-D', taskName]);
    return { success: true };
  }

  async mergeWorktree(basePath, taskName, worktreePath) {
    const gitBase = simpleGit(basePath);
    const gitWorktree = simpleGit(worktreePath);

    const status = await gitWorktree.status();
    if (!status.isClean()) {
      await gitWorktree.add('.');
      await gitWorktree.commit(`Automated commit from agent task: ${taskName}`);
    }

    await gitBase.merge([taskName]);
    await gitBase.raw(['worktree', 'remove', '-f', worktreePath]);
    await gitBase.branch(['-d', taskName]);
    return { success: true };
  }
}

module.exports = {
  GitService,
  normalizePath
};
