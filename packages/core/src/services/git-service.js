const simpleGit = require('simple-git');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const {
  normalizePackageStoreStrategy,
  detectProjectEcosystems,
  getDependencyCloneTargets,
  buildSharedCacheEnv
} = require('./dependency-policy-service');

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
const SAFE_BRANCH_PATTERN = /^[a-zA-Z0-9._/-]{1,120}$/;
const MAX_SEMANTIC_DIFF_BYTES = 1_500_000;

const commandExists = (command) => {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
};

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

const toPathString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const isTruthy = (value) => value === true || value === 'true' || value === '1' || value === 1;

const resolveDependencyCloneMode = (value) => (value === 'full_copy' ? 'full_copy' : 'copy_on_write');

const tryDependencyLinkClone = (sourcePath, targetPath, rawCloneMode = 'copy_on_write') => {
  const cloneMode = resolveDependencyCloneMode(rawCloneMode);
  if (!fs.existsSync(sourcePath)) return { mode: 'missing_source' };
  if (fs.existsSync(targetPath)) return { mode: 'existing' };
  if (cloneMode === 'full_copy') {
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true
      });
      return { mode: 'full_copy' };
    } catch {
      return { mode: 'full_copy_failed' };
    }
  }
  if (process.platform === 'win32') return { mode: 'copy_on_write_unavailable_windows' };
  const targetParent = path.dirname(targetPath);
  fs.mkdirSync(targetParent, { recursive: true });

  const attempts = [];
  if (process.platform === 'darwin') {
    attempts.push({
      mode: 'reflink-macos',
      cmd: 'cp',
      args: ['-R', '-c', sourcePath, targetPath]
    });
  } else {
    attempts.push({
      mode: 'reflink',
      cmd: 'cp',
      args: ['-R', '--reflink=always', sourcePath, targetPath]
    });
  }
  attempts.push({
    mode: 'hardlink',
    cmd: 'cp',
    args: ['-a', '-l', sourcePath, targetPath]
  });

  for (const attempt of attempts) {
    const result = spawnSync(attempt.cmd, attempt.args, { cwd: targetParent, stdio: 'ignore' });
    if (result.status === 0) {
      return { mode: attempt.mode };
    }
  }

  return { mode: 'copy_on_write_unavailable' };
};

const cloneDependencyDirectories = (basePath, targetPath, relativePaths, cloneMode) => {
  const result = {};
  for (const relativePath of relativePaths) {
    const normalizedRelative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedRelative || normalizedRelative.includes('..')) continue;
    const source = path.join(basePath, normalizedRelative);
    const target = path.join(targetPath, normalizedRelative);
    result[normalizedRelative] = tryDependencyLinkClone(source, target, cloneMode).mode;
  }
  return result;
};

const maybeBootstrapPnpmInstall = (basePath, targetPath, options = {}, cachePolicy = null) => {
  const packageStoreStrategy = normalizePackageStoreStrategy(options.packageStoreStrategy);
  const shouldUsePnpm = packageStoreStrategy === 'pnpm_global' || packageStoreStrategy === 'polyglot_global';
  if (!shouldUsePnpm) return { skipped: true, reason: 'strategy_off' };
  const pnpmLockPath = path.join(basePath, 'pnpm-lock.yaml');
  if (!fs.existsSync(pnpmLockPath)) return { skipped: true, reason: 'no_pnpm_lock' };
  if (!commandExists('pnpm')) return { skipped: true, reason: 'pnpm_missing' };

  const explicitStorePath = toPathString(options.pnpmStorePath, '');
  const storePath = explicitStorePath || cachePolicy?.pnpmStorePath || '';
  const env = {
    ...process.env,
    ...(cachePolicy?.env || {})
  };
  if (storePath) {
    env.PNPM_STORE_PATH = storePath;
  }

  const autoInstall = isTruthy(options.pnpmAutoInstall) || isTruthy(process.env.FORKLINE_PNPM_AUTOINSTALL);
  if (!autoInstall) {
    return { skipped: true, reason: 'pnpm_auto_install_disabled', storePath };
  }

  const installResult = spawnSync(
    'pnpm',
    ['install', '--frozen-lockfile', '--prefer-offline'],
    {
      cwd: targetPath,
      env,
      stdio: 'ignore'
    }
  );
  if (installResult.status === 0) {
    return { installed: true, storePath };
  }
  return { installed: false, storePath, reason: 'pnpm_install_failed' };
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

  async createWorktree(basePath, taskName, baseBranch, options = {}) {
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

    const requestedBaseBranch = String(baseBranch || '').trim();
    const safeRequestedBaseBranch = SAFE_BRANCH_PATTERN.test(requestedBaseBranch)
      && !requestedBaseBranch.includes('..')
      ? requestedBaseBranch
      : '';
    const createBaseBranchIfMissing = isTruthy(options.createBaseBranchIfMissing);
    if (createBaseBranchIfMissing && !safeRequestedBaseBranch) {
      return {
        success: false,
        error: 'Invalid parent branch name. Use letters, numbers, ".", "_", "-", or "/" only.'
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

    let branches = await git.branchLocal();
    let startPoint = '';
    if (safeRequestedBaseBranch) {
      if (branches.all.includes(safeRequestedBaseBranch)) {
        startPoint = safeRequestedBaseBranch;
      } else {
        try {
          const remoteRef = `origin/${safeRequestedBaseBranch}`;
          await git.raw(['rev-parse', '--verify', remoteRef]);
          startPoint = remoteRef;
        } catch {
          if (createBaseBranchIfMissing) {
            await git.branch([safeRequestedBaseBranch]);
            startPoint = safeRequestedBaseBranch;
            branches = await git.branchLocal();
          } else {
            startPoint = '';
          }
        }
      }
    }

    if (branches.all.includes(normalizedTaskName)) {
      await git.raw(['worktree', 'add', normalizedTargetPath, normalizedTaskName]);
    } else {
      const createArgs = ['worktree', 'add', '-b', normalizedTaskName, normalizedTargetPath];
      if (startPoint) {
        createArgs.push(startPoint);
      }
      await git.raw(createArgs);
    }

    const strategy = normalizePackageStoreStrategy(options.packageStoreStrategy);
    const dependencyCloneMode = resolveDependencyCloneMode(options.dependencyCloneMode);
    const ecosystems = detectProjectEcosystems(basePath);
    const cachePolicy = buildSharedCacheEnv(basePath, {
      packageStoreStrategy: strategy,
      pnpmStorePath: options.pnpmStorePath,
      sharedCacheRoot: options.sharedCacheRoot
    });
    const cloneTargets = getDependencyCloneTargets(basePath, {
      packageStoreStrategy: strategy,
      ecosystems
    });
    const cloneResults = cloneDependencyDirectories(basePath, normalizedTargetPath, cloneTargets, dependencyCloneMode);

    const dependencyBootstrap = {
      strategy,
      dependencyCloneMode,
      ecosystems,
      cloneTargets,
      cloneResults
    };
    if (cachePolicy.sharedCacheRoot) {
      dependencyBootstrap.sharedCacheRoot = cachePolicy.sharedCacheRoot;
    }
    if (cachePolicy.pnpmStorePath) {
      dependencyBootstrap.pnpmStorePath = cachePolicy.pnpmStorePath;
    }
    dependencyBootstrap.cacheEnvKeys = Object.keys(cachePolicy.env || {});

    const pnpmResult = maybeBootstrapPnpmInstall(basePath, normalizedTargetPath, options, cachePolicy);
    if (!pnpmResult.skipped) {
      dependencyBootstrap.pnpm = pnpmResult.installed ? 'installed' : 'failed';
    } else {
      dependencyBootstrap.pnpm = pnpmResult.reason;
    }
    if (pnpmResult.storePath) dependencyBootstrap.pnpmStorePath = pnpmResult.storePath;

    return { success: true, worktreePath: normalizedTargetPath, dependencyBootstrap };
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

  async getWorkspaceInfo(basePath) {
    if (!basePath || !fs.existsSync(basePath)) {
      return { success: false, error: 'Base path does not exist' };
    }
    const git = simpleGit(basePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        success: true,
        isRepo: false,
        currentBranch: null,
        defaultBranch: null
      };
    }

    let currentBranch = null;
    let defaultBranch = null;
    try {
      const branchInfo = await git.branchLocal();
      currentBranch = branchInfo.current || null;
    } catch {
      currentBranch = null;
    }

    try {
      const remoteHeadRef = (await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim();
      if (remoteHeadRef.startsWith('refs/remotes/origin/')) {
        defaultBranch = remoteHeadRef.slice('refs/remotes/origin/'.length);
      }
    } catch {
      defaultBranch = null;
    }

    if (!defaultBranch) {
      const candidates = ['main', 'master', 'develop', 'dev'];
      try {
        const branches = await git.branchLocal();
        defaultBranch = candidates.find((candidate) => branches.all.includes(candidate)) || currentBranch || null;
      } catch {
        defaultBranch = currentBranch || null;
      }
    }

    return {
      success: true,
      isRepo: true,
      currentBranch,
      defaultBranch
    };
  }

  async listBranches(basePath) {
    if (!basePath || !fs.existsSync(basePath)) {
      return { success: true, branches: [] };
    }
    const git = simpleGit(basePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { success: true, branches: [] };

    const local = await git.branchLocal();
    const branchSet = new Set(local.all || []);
    const remote = await git.branch(['-r']);
    (remote.all || [])
      .map((entry) => entry.replace(/^origin\//, '').trim())
      .filter(Boolean)
      .forEach((entry) => branchSet.add(entry));

    const branches = Array.from(branchSet).sort((a, b) => a.localeCompare(b));
    return { success: true, branches };
  }

  async getDiff(worktreePath, options = {}) {
    const git = simpleGit(worktreePath);
    const wantsSemantic = options && options.syntaxAware === true;

    if (wantsSemantic && commandExists('difft')) {
      const semantic = spawnSync('difft', ['--color=always', '--display=inline', '--git'], {
        cwd: worktreePath,
        encoding: 'utf8',
        maxBuffer: MAX_SEMANTIC_DIFF_BYTES
      });
      if (semantic.status === 0 && typeof semantic.stdout === 'string' && semantic.stdout.trim()) {
        return { success: true, diff: semantic.stdout, diffMode: 'syntax' };
      }
    }

    const trackedDiff = await git.raw(['diff', '--no-ext-diff', 'HEAD']);
    const status = await git.status();
    const untracked = status.not_added || [];
    const untrackedSection = untracked.length > 0
      ? `\n\n# Untracked files\n${untracked.map((f) => `?? ${f}`).join('\n')}\n`
      : '';
    return { success: true, diff: `${trackedDiff}${untrackedSection}`, diffMode: 'text' };
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
