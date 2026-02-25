const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const commandExists = (command) => {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
};

const shouldDisableNetwork = (env) => {
  const raw = String(env?.FORKLINE_NETWORK_GUARD || process.env.FORKLINE_NETWORK_GUARD || 'off').toLowerCase();
  return raw === 'none' || raw === 'disabled' || raw === 'block';
};

const resolveSandboxMode = (env) => {
  const rawMode = String(env?.FORKLINE_SANDBOX_MODE || process.env.FORKLINE_SANDBOX_MODE || 'off').toLowerCase();
  if (rawMode === 'off' || rawMode === '0' || rawMode === 'false') return 'off';
  if (rawMode === 'auto') {
    if (process.platform === 'darwin') return 'seatbelt';
    if (process.platform === 'linux') return 'firejail';
    return 'off';
  }
  if (rawMode === 'seatbelt' || rawMode === 'firejail') return rawMode;
  return 'off';
};

const escapeForSeatbelt = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const withSandboxShellEnv = (env) => {
  const merged = { ...(env || {}) };
  merged.ZDOTDIR = '/tmp';
  merged.HISTFILE = '/tmp/.zsh_history';
  return merged;
};

const buildSeatbeltProfile = (cwd, denyNetwork) => {
  const escapedCwd = escapeForSeatbelt(path.resolve(cwd));
  const escapedTmp = escapeForSeatbelt('/tmp');
  const escapedPrivateTmp = escapeForSeatbelt('/private/tmp');
  const home = os.homedir();
  const escapedHome = escapeForSeatbelt(home);
  const escapedSsh = escapeForSeatbelt(path.join(home, '.ssh'));
  const escapedShellRc = escapeForSeatbelt(path.join(home, '.zshrc'));
  const networkBlock = denyNetwork ? '(deny network*)\n' : '';

  return [
    '(version 1)',
    '(allow default)',
    `(allow file-write* (subpath "${escapedCwd}") (subpath "${escapedTmp}") (subpath "${escapedPrivateTmp}"))`,
    `(deny file-read* (subpath "${escapedSsh}"))`,
    `(deny file-read* (subpath "${escapedShellRc}"))`,
    `(deny file-write* (subpath "${escapedHome}"))`,
    `(allow file-write* (subpath "${escapedCwd}") (subpath "${escapedTmp}") (subpath "${escapedPrivateTmp}"))`,
    networkBlock.trim()
  ].filter(Boolean).join('\n');
};

const resolveSandboxLaunch = ({ shell, cwd, env }) => {
  const sandboxMode = resolveSandboxMode(env);
  const denyNetwork = shouldDisableNetwork(env);

  if (sandboxMode === 'off') {
    return { command: shell, args: [], env, sandbox: { mode: 'off', active: false } };
  }

  if (sandboxMode === 'seatbelt') {
    if (!commandExists('sandbox-exec')) {
      return {
        command: shell,
        args: [],
        env,
        sandbox: { mode: 'seatbelt', active: false, warning: 'sandbox-exec unavailable' }
      };
    }
    const profile = buildSeatbeltProfile(cwd, denyNetwork);
    return {
      command: 'sandbox-exec',
      args: ['-p', profile, shell],
      env: withSandboxShellEnv(env),
      sandbox: { mode: 'seatbelt', active: true, denyNetwork }
    };
  }

  if (sandboxMode === 'firejail') {
    if (!commandExists('firejail')) {
      return {
        command: shell,
        args: [],
        env,
        sandbox: { mode: 'firejail', active: false, warning: 'firejail unavailable' }
      };
    }
    const args = [
      '--quiet',
      `--private=${path.resolve(cwd)}`,
      `--whitelist=${path.resolve(cwd)}`
    ];
    if (denyNetwork) {
      args.push('--net=none');
    }
    args.push('--', shell);
    return {
      command: 'firejail',
      args,
      env: withSandboxShellEnv(env),
      sandbox: { mode: 'firejail', active: true, denyNetwork }
    };
  }

  return { command: shell, args: [], env, sandbox: { mode: 'off', active: false } };
};

module.exports = { resolveSandboxLaunch };
