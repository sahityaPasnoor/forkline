const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GitService } = require('../src/services/git-service');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forkline-git-service-'));

const removeDirSafe = (targetPath) => {
  fs.rmSync(targetPath, { recursive: true, force: true });
};

test('GitService.validateSource rejects missing paths', async () => {
  const service = new GitService();
  const result = await service.validateSource('/path/that/does/not/exist');
  assert.equal(result.valid, false);
  assert.match(result.error, /does not exist/i);
});

test('GitService.createWorktree validates task names', async () => {
  const service = new GitService();
  const basePath = makeTempDir();

  try {
    const result = await service.createWorktree(basePath, 'invalid/task/name', 'main');
    assert.equal(result.success, false);
    assert.match(result.error, /invalid task name/i);
  } finally {
    removeDirSafe(basePath);
  }
});

test('GitService.createWorktree creates/lists/removes worktrees', async () => {
  const service = new GitService();
  const basePath = makeTempDir();
  fs.writeFileSync(path.join(basePath, 'README.md'), '# forkline test\n', 'utf8');

  try {
    const createResult = await service.createWorktree(basePath, 'task-alpha', 'main', {
      createBaseBranchIfMissing: true,
      packageStoreStrategy: 'off',
      dependencyCloneMode: 'copy_on_write'
    });

    assert.equal(createResult.success, true);
    assert.ok(createResult.worktreePath);
    assert.equal(fs.existsSync(createResult.worktreePath), true);

    const listResult = await service.listWorktrees(basePath);
    assert.equal(listResult.success, true);
    const taskEntry = listResult.worktrees.find((entry) => entry.branchName === 'task-alpha');
    assert.ok(taskEntry);
    assert.equal(path.basename(taskEntry.path), 'task-alpha');
    assert.equal(fs.existsSync(taskEntry.path), true);

    const infoResult = await service.getWorkspaceInfo(basePath);
    assert.equal(infoResult.success, true);
    assert.equal(infoResult.isRepo, true);

    const branchesResult = await service.listBranches(basePath);
    assert.equal(branchesResult.success, true);
    assert.ok(branchesResult.branches.includes('task-alpha'));

    const removeResult = await service.removeWorktree(basePath, 'task-alpha', taskEntry.path, true);
    assert.equal(removeResult.success, true);
  } finally {
    removeDirSafe(basePath);
    removeDirSafe(`${basePath}-worktrees`);
  }
});

test('GitService supports blocking/background dependency hydration modes', async () => {
  const service = new GitService();
  const basePath = makeTempDir();
  fs.writeFileSync(path.join(basePath, 'README.md'), '# hydration mode test\n', 'utf8');

  const previousMode = process.env.FORKLINE_DEPENDENCY_HYDRATION_MODE;

  try {
    process.env.FORKLINE_DEPENDENCY_HYDRATION_MODE = 'background';
    const backgroundResult = await service.createWorktree(basePath, 'task-bg', 'main', {
      createBaseBranchIfMissing: true,
      pnpmAutoInstall: true,
      packageStoreStrategy: 'off'
    });
    assert.equal(backgroundResult.success, true);
    assert.equal(backgroundResult.dependencyBootstrap?.hydration?.mode, 'background');

    process.env.FORKLINE_DEPENDENCY_HYDRATION_MODE = 'blocking';
    const blockingResult = await service.createWorktree(basePath, 'task-block', 'main', {
      createBaseBranchIfMissing: true,
      pnpmAutoInstall: true,
      packageStoreStrategy: 'off'
    });
    assert.equal(blockingResult.success, true);
    assert.equal(blockingResult.dependencyBootstrap?.hydration?.enabled, true);
    assert.notEqual(blockingResult.dependencyBootstrap?.hydration?.status, 'queued');
  } finally {
    if (previousMode === undefined) {
      delete process.env.FORKLINE_DEPENDENCY_HYDRATION_MODE;
    } else {
      process.env.FORKLINE_DEPENDENCY_HYDRATION_MODE = previousMode;
    }

    removeDirSafe(basePath);
    removeDirSafe(`${basePath}-worktrees`);
  }
});

test('GitService.removeWorktree succeeds when base repository path is missing', async () => {
  const service = new GitService();
  const basePath = path.join(makeTempDir(), 'missing-base');
  const worktreePath = `${basePath}-worktrees/task-missing`;

  const result = await service.removeWorktree(basePath, 'task-missing', worktreePath, true);
  assert.equal(result.success, true);
  assert.equal(result.stale, true);
  assert.ok(Array.isArray(result.warnings));
  assert.ok(result.warnings.length > 0);
});

test('GitService.removeWorktree treats missing worktree directory as stale cleanup and deletes branch', async () => {
  const service = new GitService();
  const basePath = makeTempDir();
  fs.writeFileSync(path.join(basePath, 'README.md'), '# stale cleanup test\n', 'utf8');

  try {
    const createResult = await service.createWorktree(basePath, 'task-stale', 'main', {
      createBaseBranchIfMissing: true,
      packageStoreStrategy: 'off',
      dependencyCloneMode: 'copy_on_write'
    });
    assert.equal(createResult.success, true);
    assert.ok(createResult.worktreePath);

    removeDirSafe(createResult.worktreePath);
    assert.equal(fs.existsSync(createResult.worktreePath), false);

    const removeResult = await service.removeWorktree(basePath, 'task-stale', createResult.worktreePath, true);
    assert.equal(removeResult.success, true);
    if (removeResult.stale) {
      assert.ok(Array.isArray(removeResult.warnings));
      assert.ok(removeResult.warnings.length > 0);
    }

    const branches = await service.listBranches(basePath);
    assert.equal(branches.success, true);
    assert.equal(branches.branches.includes('task-stale'), false);
  } finally {
    removeDirSafe(basePath);
    removeDirSafe(`${basePath}-worktrees`);
  }
});
