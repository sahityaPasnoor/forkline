const simpleGit = require('simple-git');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
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
  'mcp.json',
  '.claude/settings.local.json'
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

const toRepositoryWebUrl = (remoteUrl) => {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.search = '';
      parsed.pathname = parsed.pathname.replace(/\.git$/i, '');
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  const sshMatch = raw.match(/^git@([^:]+):(.+)$/i);
  if (sshMatch) {
    const host = sshMatch[1].trim();
    const repoPath = sshMatch[2].trim().replace(/^\/+/, '').replace(/\.git$/i, '');
    if (!host || !repoPath) return null;
    return `https://${host}/${repoPath}`;
  }

  const sshProtocolMatch = raw.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/i);
  if (sshProtocolMatch) {
    const host = sshProtocolMatch[1].trim();
    const repoPath = sshProtocolMatch[2].trim().replace(/^\/+/, '').replace(/\.git$/i, '');
    if (!host || !repoPath) return null;
    return `https://${host}/${repoPath}`;
  }

  return null;
};

const commandExists = (command) => {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
};

const commandExistsAsync = (command) => new Promise((resolve) => {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const child = spawn(checker, [command], { stdio: 'ignore' });
  child.on('error', () => resolve(false));
  child.on('exit', (code) => resolve(code === 0));
});

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
const isDependencyAutoInstallEnabled = (options = {}) => (
  isTruthy(options.pnpmAutoInstall)
  || isTruthy(process.env.FORKLINE_PNPM_AUTOINSTALL)
  || isTruthy(process.env.FORKLINE_DEPENDENCY_AUTOINSTALL)
);
const resolveDependencyHydrationMode = (options = {}) => {
  const raw = String(
    options.dependencyHydrationMode
    || process.env.FORKLINE_DEPENDENCY_HYDRATION_MODE
    || ''
  ).trim().toLowerCase();
  if (raw === 'blocking' || raw === 'sync' || raw === 'foreground') return 'blocking';
  return 'background';
};

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

const runCloneCommand = (cmd, args, cwd) => new Promise((resolve) => {
  const child = spawn(cmd, args, { cwd, stdio: 'ignore' });
  child.on('error', () => resolve(false));
  child.on('exit', (code) => resolve(code === 0));
});

const tryDependencyLinkCloneAsync = async (sourcePath, targetPath, rawCloneMode = 'copy_on_write') => {
  const cloneMode = resolveDependencyCloneMode(rawCloneMode);
  if (!fs.existsSync(sourcePath)) return { mode: 'missing_source' };
  if (fs.existsSync(targetPath)) return { mode: 'existing' };
  if (cloneMode === 'full_copy') {
    try {
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.cp(sourcePath, targetPath, {
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
  await fs.promises.mkdir(targetParent, { recursive: true });

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
    // eslint-disable-next-line no-await-in-loop
    const ok = await runCloneCommand(attempt.cmd, attempt.args, targetParent);
    if (ok) return { mode: attempt.mode };
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

const cloneDependencyDirectoriesAsync = async (basePath, targetPath, relativePaths, cloneMode) => {
  const result = {};
  for (const relativePath of relativePaths) {
    const normalizedRelative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedRelative || normalizedRelative.includes('..')) continue;
    const source = path.join(basePath, normalizedRelative);
    const target = path.join(targetPath, normalizedRelative);
    // eslint-disable-next-line no-await-in-loop
    result[normalizedRelative] = (await tryDependencyLinkCloneAsync(source, target, cloneMode)).mode;
  }
  return result;
};

const runBootstrapCommand = (cmd, args, cwd, env) => new Promise((resolve) => {
  const child = spawn(cmd, args, {
    cwd,
    env,
    stdio: 'ignore'
  });
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    resolve(result);
  };
  const timeout = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1_000);
    finish(false);
  }, 15 * 60 * 1000);

  child.on('error', () => {
    clearTimeout(timeout);
    finish(false);
  });
  child.on('exit', (code) => {
    clearTimeout(timeout);
    finish(code === 0);
  });
});

const maybeBootstrapDependencies = async (basePath, targetPath, options = {}, cachePolicy = null) => {
  const autoInstall = isDependencyAutoInstallEnabled(options);
  if (!autoInstall) {
    return { enabled: false, reason: 'dependency_auto_install_disabled', steps: [] };
  }

  const explicitStorePath = toPathString(options.pnpmStorePath, '');
  const storePath = explicitStorePath || cachePolicy?.pnpmStorePath || '';
  const env = {
    ...process.env,
    ...(cachePolicy?.env || {})
  };
  if (storePath) env.PNPM_STORE_PATH = storePath;

  const steps = [];
  const addStep = (tool, status, reason) => {
    steps.push({ tool, status, reason: reason || null });
  };

  // Node ecosystem
  if (fs.existsSync(path.join(basePath, 'pnpm-lock.yaml'))) {
    if (!await commandExistsAsync('pnpm')) {
      addStep('pnpm', 'skipped', 'pnpm_missing');
    } else if (await runBootstrapCommand('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], targetPath, env)) {
      addStep('pnpm', 'installed');
    } else {
      addStep('pnpm', 'failed', 'pnpm_install_failed');
    }
  } else if (fs.existsSync(path.join(basePath, 'package-lock.json'))) {
    if (!await commandExistsAsync('npm')) {
      addStep('npm', 'skipped', 'npm_missing');
    } else if (await runBootstrapCommand('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], targetPath, env)) {
      addStep('npm', 'installed');
    } else {
      addStep('npm', 'failed', 'npm_ci_failed');
    }
  } else if (fs.existsSync(path.join(basePath, 'yarn.lock'))) {
    if (!await commandExistsAsync('yarn')) {
      addStep('yarn', 'skipped', 'yarn_missing');
    } else if (await runBootstrapCommand('yarn', ['install', '--frozen-lockfile'], targetPath, env)) {
      addStep('yarn', 'installed');
    } else {
      addStep('yarn', 'failed', 'yarn_install_failed');
    }
  } else if (fs.existsSync(path.join(basePath, 'bun.lockb')) || fs.existsSync(path.join(basePath, 'bun.lock'))) {
    if (!await commandExistsAsync('bun')) {
      addStep('bun', 'skipped', 'bun_missing');
    } else if (await runBootstrapCommand('bun', ['install', '--frozen-lockfile'], targetPath, env)) {
      addStep('bun', 'installed');
    } else {
      addStep('bun', 'failed', 'bun_install_failed');
    }
  }

  // Python ecosystem
  if (fs.existsSync(path.join(basePath, 'uv.lock')) || fs.existsSync(path.join(basePath, 'pyproject.toml'))) {
    if (!await commandExistsAsync('uv')) {
      addStep('uv', 'skipped', 'uv_missing');
    } else if (await runBootstrapCommand('uv', ['sync', '--frozen'], targetPath, env)) {
      addStep('uv', 'installed');
    } else {
      addStep('uv', 'failed', 'uv_sync_failed');
    }
  } else if (fs.existsSync(path.join(basePath, 'requirements.txt'))) {
    if (!await commandExistsAsync('pip')) {
      addStep('pip', 'skipped', 'pip_missing');
    } else if (await runBootstrapCommand('pip', ['install', '-r', 'requirements.txt'], targetPath, env)) {
      addStep('pip', 'installed');
    } else {
      addStep('pip', 'failed', 'pip_install_failed');
    }
  } else if (fs.existsSync(path.join(basePath, 'poetry.lock'))) {
    if (!await commandExistsAsync('poetry')) {
      addStep('poetry', 'skipped', 'poetry_missing');
    } else if (await runBootstrapCommand('poetry', ['install', '--no-interaction'], targetPath, env)) {
      addStep('poetry', 'installed');
    } else {
      addStep('poetry', 'failed', 'poetry_install_failed');
    }
  }

  // Go ecosystem
  if (fs.existsSync(path.join(basePath, 'go.mod')) || fs.existsSync(path.join(basePath, 'go.work'))) {
    if (!await commandExistsAsync('go')) {
      addStep('go', 'skipped', 'go_missing');
    } else if (await runBootstrapCommand('go', ['mod', 'download'], targetPath, env)) {
      addStep('go', 'installed');
    } else {
      addStep('go', 'failed', 'go_mod_download_failed');
    }
  }

  // Rust ecosystem
  if (fs.existsSync(path.join(basePath, 'Cargo.toml'))) {
    if (!await commandExistsAsync('cargo')) {
      addStep('cargo', 'skipped', 'cargo_missing');
    } else if (await runBootstrapCommand('cargo', ['fetch'], targetPath, env)) {
      addStep('cargo', 'installed');
    } else {
      addStep('cargo', 'failed', 'cargo_fetch_failed');
    }
  }

  return { enabled: true, steps, storePath };
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
    const hydrationMode = resolveDependencyHydrationMode(options);
    let cloneResults = {};
    if (hydrationMode === 'blocking') {
      cloneResults = cloneDependencyDirectories(basePath, normalizedTargetPath, cloneTargets, dependencyCloneMode);
    }

    const dependencyBootstrap = {
      strategy,
      dependencyCloneMode,
      ecosystems,
      cloneTargets,
      cloneResults
    };
    if (hydrationMode !== 'blocking' && cloneTargets.length > 0) {
      dependencyBootstrap.cloneStatus = 'queued';
      void cloneDependencyDirectoriesAsync(basePath, normalizedTargetPath, cloneTargets, dependencyCloneMode)
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.warn('[git-service] dependency clone failed:', error?.message || error);
        });
    }
    if (cachePolicy.sharedCacheRoot) {
      dependencyBootstrap.sharedCacheRoot = cachePolicy.sharedCacheRoot;
    }
    if (cachePolicy.pnpmStorePath) {
      dependencyBootstrap.pnpmStorePath = cachePolicy.pnpmStorePath;
    }
    dependencyBootstrap.cacheEnvKeys = Object.keys(cachePolicy.env || {});

    if (hydrationMode === 'blocking') {
      const hydrationResult = await maybeBootstrapDependencies(basePath, normalizedTargetPath, options, cachePolicy);
      dependencyBootstrap.hydration = hydrationResult;
      if (!hydrationResult.enabled) {
        dependencyBootstrap.pnpm = hydrationResult.reason;
      } else {
        const pnpmStep = hydrationResult.steps.find((step) => step.tool === 'pnpm');
        dependencyBootstrap.pnpm = pnpmStep ? pnpmStep.status : 'not_applicable';
      }
      if (hydrationResult.storePath) dependencyBootstrap.pnpmStorePath = hydrationResult.storePath;
    } else if (!isDependencyAutoInstallEnabled(options)) {
      dependencyBootstrap.hydration = {
        enabled: false,
        mode: 'background',
        status: 'skipped',
        reason: 'dependency_auto_install_disabled',
        steps: []
      };
      dependencyBootstrap.pnpm = 'dependency_auto_install_disabled';
    } else {
      const storePath = toPathString(options.pnpmStorePath, '') || cachePolicy?.pnpmStorePath || '';
      dependencyBootstrap.hydration = {
        enabled: true,
        mode: 'background',
        status: 'queued',
        steps: [],
        storePath: storePath || undefined
      };
      dependencyBootstrap.pnpm = 'queued';
      if (storePath) dependencyBootstrap.pnpmStorePath = storePath;

      void maybeBootstrapDependencies(basePath, normalizedTargetPath, options, cachePolicy).catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('[git-service] dependency hydration failed:', error?.message || error);
      });
    }

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

  async getRepositoryWebUrl(basePath) {
    if (!basePath || !fs.existsSync(basePath)) {
      return { success: false, error: 'Base path does not exist' };
    }
    const git = simpleGit(basePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { success: false, error: 'Selected path is not a git repository' };
    }

    let remoteUrl = '';
    try {
      remoteUrl = (await git.raw(['remote', 'get-url', 'origin'])).trim();
    } catch {
      remoteUrl = '';
    }

    if (!remoteUrl) {
      try {
        const remotes = await git.getRemotes(true);
        const preferredRemote = remotes.find((remote) => remote.name === 'origin') || remotes[0];
        if (preferredRemote) {
          remoteUrl = String(
            preferredRemote.refs?.fetch
            || preferredRemote.refs?.push
            || ''
          ).trim();
        }
      } catch {
        remoteUrl = '';
      }
    }

    if (!remoteUrl) {
      return { success: false, error: 'No git remote configured for this repository.' };
    }

    const webUrl = toRepositoryWebUrl(remoteUrl);
    if (!webUrl) {
      return { success: false, error: 'Unable to derive a browser URL from the repository remote.' };
    }

    return { success: true, remoteUrl, webUrl };
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
  normalizePath,
  toRepositoryWebUrl
};
