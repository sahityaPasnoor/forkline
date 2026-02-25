const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STRATEGY_OFF = 'off';
const STRATEGY_PNPM_GLOBAL = 'pnpm_global';
const STRATEGY_POLYGLOT_GLOBAL = 'polyglot_global';

const normalizePackageStoreStrategy = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === STRATEGY_PNPM_GLOBAL || raw === 'pnpm') return STRATEGY_PNPM_GLOBAL;
  if (raw === STRATEGY_POLYGLOT_GLOBAL || raw === 'auto_global' || raw === 'polyglot') return STRATEGY_POLYGLOT_GLOBAL;
  return STRATEGY_OFF;
};

const toPathString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const hasAnyRootFile = (projectPath, fileNames) => {
  for (const fileName of fileNames) {
    if (fs.existsSync(path.join(projectPath, fileName))) return true;
  }
  return false;
};

const hasRootExtension = (projectPath, extensions) => {
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    return entries.some((entry) => {
      if (!entry.isFile()) return false;
      return extensions.some((ext) => entry.name.endsWith(ext));
    });
  } catch {
    return false;
  }
};

const detectProjectEcosystems = (projectPath) => {
  if (!projectPath || !fs.existsSync(projectPath)) return [];

  const ecosystems = [];
  const pushOnce = (name) => {
    if (!ecosystems.includes(name)) ecosystems.push(name);
  };

  if (hasAnyRootFile(projectPath, ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock'])) {
    pushOnce('node');
  }
  if (hasAnyRootFile(projectPath, ['requirements.txt', 'pyproject.toml', 'poetry.lock', 'Pipfile', 'Pipfile.lock', 'uv.lock'])) {
    pushOnce('python');
  }
  if (hasAnyRootFile(projectPath, ['Gemfile', 'Gemfile.lock'])) {
    pushOnce('ruby');
  }
  if (hasAnyRootFile(projectPath, ['go.mod', 'go.work'])) {
    pushOnce('go');
  }
  if (hasAnyRootFile(projectPath, ['Cargo.toml'])) {
    pushOnce('rust');
  }
  if (hasAnyRootFile(projectPath, ['composer.json', 'composer.lock'])) {
    pushOnce('php');
  }
  if (hasAnyRootFile(projectPath, ['pubspec.yaml'])) {
    pushOnce('dart');
  }
  if (hasAnyRootFile(projectPath, ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew'])) {
    pushOnce('gradle');
  }
  if (hasAnyRootFile(projectPath, ['pom.xml', 'mvnw'])) {
    pushOnce('maven');
  }
  if (hasAnyRootFile(projectPath, ['Podfile', 'Podfile.lock'])) {
    pushOnce('cocoapods');
  }
  if (hasAnyRootFile(projectPath, ['Package.swift'])) {
    pushOnce('swiftpm');
  }
  if (
    hasAnyRootFile(projectPath, ['global.json', '.config/dotnet-tools.json'])
    || hasRootExtension(projectPath, ['.sln', '.csproj', '.fsproj', '.vbproj'])
  ) {
    pushOnce('dotnet');
  }

  return ecosystems;
};

const getSharedCacheRoot = (options = {}) => {
  const explicit = toPathString(options.sharedCacheRoot, '');
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), '.forkline-cache');
};

const getDependencyCloneTargets = (projectPath, options = {}) => {
  const strategy = normalizePackageStoreStrategy(options.packageStoreStrategy);
  const ecosystems = Array.isArray(options.ecosystems) && options.ecosystems.length > 0
    ? options.ecosystems
    : detectProjectEcosystems(projectPath);

  const targets = [];
  const addTarget = (relativePath) => {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) return;
    if (!targets.includes(normalized)) targets.push(normalized);
  };

  // Keep node_modules fast-path for backward compatibility.
  addTarget('node_modules');

  if (strategy === STRATEGY_POLYGLOT_GLOBAL) {
    if (ecosystems.includes('python')) {
      addTarget('.venv');
      addTarget('venv');
    }
    if (ecosystems.includes('ruby')) addTarget('vendor/bundle');
    if (ecosystems.includes('php')) addTarget('vendor');
    if (ecosystems.includes('cocoapods')) addTarget('Pods');
    if (ecosystems.includes('gradle')) addTarget('.gradle');
    if (ecosystems.includes('swiftpm')) addTarget('.build');
    if (ecosystems.includes('dart')) addTarget('.dart_tool');
  }

  return targets.filter((relativePath) => fs.existsSync(path.join(projectPath, relativePath)));
};

const ensureCacheDirectories = (env = {}) => {
  for (const value of Object.values(env)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      fs.mkdirSync(path.resolve(value), { recursive: true });
    } catch {
      // Best-effort only.
    }
  }
};

const buildSharedCacheEnv = (projectPath, options = {}) => {
  const strategy = normalizePackageStoreStrategy(options.packageStoreStrategy);
  const ecosystems = detectProjectEcosystems(projectPath);
  if (strategy === STRATEGY_OFF) {
    return { strategy, ecosystems, sharedCacheRoot: '', pnpmStorePath: '', env: {} };
  }

  const sharedCacheRoot = getSharedCacheRoot(options);
  const explicitPnpmStore = toPathString(options.pnpmStorePath, '');
  const pnpmStorePath = explicitPnpmStore
    ? path.resolve(explicitPnpmStore)
    : (strategy === STRATEGY_PNPM_GLOBAL
      ? path.join(os.homedir(), '.pnpm-store')
      : path.join(sharedCacheRoot, 'pnpm-store'));

  const env = {
    PNPM_STORE_PATH: pnpmStorePath
  };

  if (strategy === STRATEGY_POLYGLOT_GLOBAL) {
    Object.assign(env, {
      npm_config_cache: path.join(sharedCacheRoot, 'npm'),
      YARN_CACHE_FOLDER: path.join(sharedCacheRoot, 'yarn'),
      BUN_INSTALL_CACHE_DIR: path.join(sharedCacheRoot, 'bun'),
      PIP_CACHE_DIR: path.join(sharedCacheRoot, 'pip'),
      UV_CACHE_DIR: path.join(sharedCacheRoot, 'uv'),
      POETRY_CACHE_DIR: path.join(sharedCacheRoot, 'poetry'),
      NUGET_PACKAGES: path.join(sharedCacheRoot, 'nuget', 'packages'),
      GRADLE_USER_HOME: path.join(sharedCacheRoot, 'gradle'),
      CARGO_HOME: path.join(sharedCacheRoot, 'cargo'),
      GOMODCACHE: path.join(sharedCacheRoot, 'go', 'pkg', 'mod'),
      GOCACHE: path.join(sharedCacheRoot, 'go', 'build'),
      COMPOSER_CACHE_DIR: path.join(sharedCacheRoot, 'composer'),
      PUB_CACHE: path.join(sharedCacheRoot, 'pub'),
      BUNDLE_USER_CACHE: path.join(sharedCacheRoot, 'bundle', 'cache'),
      CP_HOME_DIR: path.join(sharedCacheRoot, 'cocoapods')
    });
  }

  return {
    strategy,
    ecosystems,
    sharedCacheRoot,
    pnpmStorePath,
    env
  };
};

module.exports = {
  STRATEGY_OFF,
  STRATEGY_PNPM_GLOBAL,
  STRATEGY_POLYGLOT_GLOBAL,
  normalizePackageStoreStrategy,
  detectProjectEcosystems,
  getDependencyCloneTargets,
  buildSharedCacheEnv,
  ensureCacheDirectories
};
