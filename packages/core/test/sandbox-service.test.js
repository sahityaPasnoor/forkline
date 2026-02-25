const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSandboxLaunch } = require('../src/services/sandbox-service');

test('resolveSandboxLaunch keeps auto sandbox mode for interactive agent providers', () => {
  const result = resolveSandboxLaunch({
    shell: '/bin/zsh',
    cwd: process.cwd(),
    env: {
      FORKLINE_SANDBOX_MODE: 'auto',
      FORKLINE_AGENT_PROVIDER: 'claude'
    }
  });

  assert.ok(['seatbelt', 'firejail', 'off'].includes(result.sandbox.mode));
  assert.doesNotMatch(String(result.sandbox.warning || ''), /raw tty/i);
});

test('resolveSandboxLaunch applies network deny flag when sandbox is active', () => {
  const result = resolveSandboxLaunch({
    shell: '/bin/zsh',
    cwd: process.cwd(),
    env: {
      FORKLINE_SANDBOX_MODE: 'auto',
      FORKLINE_NETWORK_GUARD: 'none'
    }
  });

  if (result.sandbox.active) {
    assert.equal(result.sandbox.denyNetwork, true);
  }
});

test('resolveSandboxLaunch keeps sandbox mode off behavior unchanged', () => {
  const result = resolveSandboxLaunch({
    shell: '/bin/zsh',
    cwd: process.cwd(),
    env: {
      FORKLINE_SANDBOX_MODE: 'off',
      FORKLINE_AGENT_PROVIDER: 'claude'
    }
  });

  assert.equal(result.command, '/bin/zsh');
  assert.deepEqual(result.args, []);
  assert.equal(result.sandbox.mode, 'off');
  assert.equal(result.sandbox.active, false);
});
