const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pty = require('node-pty');

const { PtyService } = require('../src/services/pty-service');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createFakePtyProcess = (options = {}) => {
  const emitScriptEcho = options.emitScriptEcho === true;
  let onData = null;
  let onExit = null;
  return {
    onData(handler) {
      onData = handler;
    },
    onExit(handler) {
      onExit = handler;
    },
    write(payload) {
      if (typeof onData === 'function' && typeof payload === 'string') {
        const normalized = payload.replace(/\r/g, '').trim();
        if (!normalized) return;
        if (normalized.includes('echo "forkline"')) {
          onData('forkline\r\n');
          return;
        }
        if (normalized.includes('printf "RESTART_LAUNCH_OK\\n"')) {
          onData('RESTART_LAUNCH_OK\r\n');
          return;
        }
        if (emitScriptEcho && normalized.includes('./.agent_cache/launch_agent.sh')) {
          onData(`${normalized}\r\nAGENT_SCRIPT_OK\r\n`);
        }
      }
    },
    resize() {},
    kill() {
      if (typeof onExit === 'function') {
        onExit({ exitCode: 0, signal: 0 });
      }
    }
  };
};

const withMockedSpawn = async (spawnImpl, callback) => {
  const originalSpawn = pty.spawn;
  pty.spawn = spawnImpl;
  try {
    return await callback();
  } finally {
    pty.spawn = originalSpawn;
  }
};

test('PtyService reports startup failure details and dedupes noisy repeat errors', () => {
  const originalSpawn = pty.spawn;
  const dataEvents = [];
  pty.spawn = () => {
    throw new Error('posix_spawnp failed.');
  };

  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });
  service.on('data', ({ data }) => dataEvents.push(data));

  try {
    const first = service.createSession('task-start-failure', process.cwd(), {}, 'test');
    assert.equal(first.created, true);
    assert.equal(first.running, false);
    assert.match(first.startError || '', /Failed to start PTY/i);

    const second = service.createSession('task-start-failure', process.cwd(), {}, 'test');
    assert.equal(second.created, false);
    assert.equal(second.running, false);
    assert.match(second.startError || '', /Failed to start PTY/i);

    const startupFailures = dataEvents.filter((entry) => /Failed to start PTY/i.test(entry));
    assert.equal(startupFailures.length, 1);

    const attached = service.attach('task-start-failure', 'test');
    assert.ok(attached);
    assert.match(attached.startError || '', /Failed to start PTY/i);
  } finally {
    pty.spawn = originalSpawn;
    service.destroy('task-start-failure');
  }
});

test('PtyService falls back across shell candidates before failing startup', () => {
  const originalSpawn = pty.spawn;
  const attemptedCommands = [];
  pty.spawn = (command, args, options) => {
    attemptedCommands.push(String(command));
    if (command !== '/bin/sh') {
      throw new Error('posix_spawnp failed.');
    }
    return createFakePtyProcess(args, options);
  };

  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });

  try {
    const created = service.createSession('task-shell-fallback', process.cwd(), {}, 'test');
    assert.equal(created.created, true);
    assert.equal(created.running, true);
    assert.equal(created.startError, undefined);
    assert.ok(attemptedCommands.length >= 2);
    assert.ok(attemptedCommands.includes('/bin/sh'));
  } finally {
    pty.spawn = originalSpawn;
    service.destroy('task-shell-fallback');
  }
});

test('PtyService validates task ids and enforces session cap', () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });

  const invalid = service.createSession('invalid task id', process.cwd());
  assert.equal(invalid.created, false);
  assert.match(invalid.error || '', /invalid taskid/i);

  const first = service.createSession('task-1', process.cwd(), {}, 'test');
  assert.equal(first.created, true);

  const second = service.createSession('task-2', process.cwd(), {}, 'test');
  assert.equal(second.created, false);
  assert.match(second.error || '', /session limit reached/i);

  service.destroy('task-1');
  service.destroy('task-2');
});

test('PtyService supports lifecycle operations', () => {
  const service = new PtyService({ maxSessions: 2, sessionPersistenceMode: 'off' });

  return withMockedSpawn(() => createFakePtyProcess(), async () => {
    try {
      const created = service.createSession('task-lifecycle', process.cwd(), {}, 'test');
      assert.equal(created.created, true);

      const attached = service.attach('task-lifecycle', 'test');
      assert.ok(attached);
      assert.equal(attached.taskId, 'task-lifecycle');
      assert.ok(attached.sandbox);
      assert.equal(attached.sandbox.mode, 'off');

      const writeRes = service.write('task-lifecycle', 'echo "forkline"\r');
      assert.equal(writeRes.success, true);

      const resizeRes = service.resize('task-lifecycle', 100, 30);
      assert.equal(resizeRes.success, true);

      const restartRes = service.restart('task-lifecycle', 'test');
      assert.equal(restartRes.success, true);
      assert.equal(restartRes.restarted, true);

      const list = service.listSessions();
      assert.equal(list.length, 1);
      assert.equal(list[0].taskId, 'task-lifecycle');

      const destroyRes = service.destroy('task-lifecycle');
      assert.equal(destroyRes.success, true);
    } finally {
      service.destroy('task-lifecycle');
    }
  });
});

test('PtyService drops immediate duplicate full-line writes', () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });
  const originalNow = Date.now;

  return withMockedSpawn(() => createFakePtyProcess(), async () => {
    try {
      const created = service.createSession('task-dedupe', process.cwd(), {}, 'test');
      assert.equal(created.created, true);

      const session = service.sessions.get('task-dedupe');
      assert.ok(session?.ptyProcess, 'expected PTY process for dedupe test');

      const writes = [];
      const originalWrite = session.ptyProcess.write.bind(session.ptyProcess);
      session.ptyProcess.write = (payload) => {
        writes.push(payload);
        return originalWrite(payload);
      };

      let now = 1_000;
      Date.now = () => now;

      const first = service.write('task-dedupe', 'pwd\r');
      assert.equal(first.success, true);
      assert.equal(first.deduped, undefined);

      now += 20;
      const duplicate = service.write('task-dedupe', 'pwd\r');
      assert.equal(duplicate.success, true);
      assert.equal(duplicate.deduped, true);

      now += 200;
      const later = service.write('task-dedupe', 'pwd\r');
      assert.equal(later.success, true);
      assert.equal(later.deduped, undefined);

      assert.equal(writes.filter((payload) => payload === 'pwd\r').length, 2);
    } finally {
      Date.now = originalNow;
      service.destroy('task-dedupe');
    }
  });
});

test('PtyService launch writes command and tracks hidden echo suppression', () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });

  return withMockedSpawn(() => createFakePtyProcess({ emitScriptEcho: false }), async () => {
    try {
      const created = service.createSession('task-launch', process.cwd(), {}, 'test');
      assert.equal(created.created, true);

      const session = service.sessions.get('task-launch');
      assert.ok(session?.ptyProcess, 'expected PTY process for launch test');

      const writes = [];
      const originalWrite = session.ptyProcess.write.bind(session.ptyProcess);
      session.ptyProcess.write = (payload) => {
        writes.push(payload);
        return originalWrite(payload);
      };

      const launchResult = service.launch('task-launch', './.agent_cache/launch_agent.sh', { suppressEcho: true });
      assert.equal(launchResult.success, true);
      assert.equal(writes[writes.length - 1], './.agent_cache/launch_agent.sh\r');
      assert.ok(session.hiddenCommandEcho, 'expected hidden command echo tracker');
    } finally {
      service.destroy('task-launch');
    }
  });
});

test('PtyService launch restarts PTY when session exists but process is not running', async () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });

  return withMockedSpawn(() => createFakePtyProcess(), async () => {
    try {
      const created = service.createSession('task-launch-restart', process.cwd(), {}, 'test');
      assert.equal(created.created, true);
      const session = service.sessions.get('task-launch-restart');
      assert.ok(session?.ptyProcess, 'expected PTY process for restart launch test');

      let output = '';
      service.on('data', ({ taskId, data }) => {
        if (taskId !== 'task-launch-restart') return;
        output += data;
      });

      session.ptyProcess.kill();
      const waitUntil = async (predicate, timeoutMs = 2400, intervalMs = 40) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (predicate()) return true;
          await wait(intervalMs);
        }
        return predicate();
      };
      const stopped = await waitUntil(() => !session.ptyProcess);
      assert.equal(stopped, true);

      const launchResult = service.launch('task-launch-restart', 'printf "RESTART_LAUNCH_OK\\n"', { suppressEcho: true });
      assert.equal(launchResult.success, true);

      await wait(120);
      assert.equal(output.includes('RESTART_LAUNCH_OK'), true);
      assert.equal(output.includes('printf "RESTART_LAUNCH_OK'), false);
    } finally {
      service.destroy('task-launch-restart');
    }
  });
});

test('PtyService hidden echo filter removes wrapped launch command from long startup chunk', () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });

  try {
    const created = service.createSession('task-hidden-echo', process.cwd(), {}, 'test');
    assert.equal(created.created, true);
    const session = service.sessions.get('task-hidden-echo');
    assert.ok(session, 'expected live session');

    service.trackHiddenCommandEcho(session, './.agent_cache/launch_agent.sh');

    const longPrefix = `${'x'.repeat(6200)} `;
    const wrappedCommand = './.agent_cache/launch_agent.s\r\nh';
    const filtered = service.filterHiddenCommandEcho(
      session,
      `${longPrefix}${wrappedCommand}\r\nForkline ready\r\n`
    );

    assert.equal(filtered.includes('./.agent_cache/launch_agent.sh'), false);
    assert.equal(filtered.includes('./.agent_cache/launch_agent.s'), false);
    assert.equal(filtered.includes('Forkline ready'), true);
    assert.equal(session.hiddenCommandEcho, null);
  } finally {
    service.destroy('task-hidden-echo');
  }
});

test('PtyService hidden echo filter removes command echoed with control-sequence noise', () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });

  try {
    const created = service.createSession('task-hidden-echo-noisy', process.cwd(), {}, 'test');
    assert.equal(created.created, true);
    const session = service.sessions.get('task-hidden-echo-noisy');
    assert.ok(session, 'expected live session');

    service.trackHiddenCommandEcho(session, 'printf "FORKLINE_LAUNCH_OK\\n"');

    const noisyEcho = [
      '\u001b[38;5;251m~/Development/Claude-Code/multiAgentApp\u001b[39m',
      ' \u001b[K\u001b[?2004hp\bprintf "FORKLINE_LAUNCH_OK\\ \r\u001b[Kn\rn"\u001b[?2004l\r\r\n',
      'FORKLINE_LAUNCH_OK\r\n'
    ].join('');
    const filtered = service.filterHiddenCommandEcho(session, noisyEcho);

    assert.equal(filtered.includes('printf "FORKLINE_LAUNCH_OK'), false);
    assert.equal(filtered.includes('FORKLINE_LAUNCH_OK'), true);
    assert.equal(session.hiddenCommandEcho, null);
  } finally {
    service.destroy('task-hidden-echo-noisy');
  }
});

test('PtyService hidden echo filter suppresses repeated command echoes before output', () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });

  try {
    const created = service.createSession('task-hidden-echo-repeat', process.cwd(), {}, 'test');
    assert.equal(created.created, true);
    const session = service.sessions.get('task-hidden-echo-repeat');
    assert.ok(session, 'expected live session');

    service.trackHiddenCommandEcho(session, 'printf "FORKLINE_LAUNCH_OK\\n"');

    const first = service.filterHiddenCommandEcho(session, 'printf "FORKLINE_LAUNCH_OK\\n"\r\n');
    assert.equal(first.includes('printf "FORKLINE_LAUNCH_OK'), false);

    const second = service.filterHiddenCommandEcho(
      session,
      'p\bprintf "FORKLINE_LAUNCH_OK\\ \r\u001b[Kn\rn"\u001b[?2004l\r\r\n'
    );
    assert.equal(second.includes('printf "FORKLINE_LAUNCH_OK'), false);

    const third = service.filterHiddenCommandEcho(session, 'FORKLINE_LAUNCH_OK\r\n');
    assert.equal(third.includes('FORKLINE_LAUNCH_OK'), true);
  } finally {
    service.destroy('task-hidden-echo-repeat');
  }
});

test('PtyService launch suppresses relaunch script echo in live PTY flow', async () => {
  const service = new PtyService({ maxSessions: 1, sessionPersistenceMode: 'off' });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forkline-pty-echo-'));

  return withMockedSpawn(() => createFakePtyProcess({ emitScriptEcho: true }), async () => {
    try {
      const cacheDir = path.join(tempRoot, '.agent_cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const scriptPath = path.join(cacheDir, 'launch_agent.sh');
      fs.writeFileSync(scriptPath, '#!/usr/bin/env sh\nprintf "AGENT_SCRIPT_OK\\n"\n', { mode: 0o700 });
      fs.chmodSync(scriptPath, 0o700);

      const created = service.createSession('task-live-launch', tempRoot, {}, 'test');
      assert.equal(created.created, true);

      let output = '';
      service.on('data', ({ taskId, data }) => {
        if (taskId !== 'task-live-launch') return;
        output += data;
      });

      await wait(50);
      const launchResult = service.launch('task-live-launch', './.agent_cache/launch_agent.sh', { suppressEcho: true });
      assert.equal(launchResult.success, true);

      await wait(120);
      assert.equal(output.includes('./.agent_cache/launch_agent.sh'), false);
      assert.equal(output.includes('AGENT_SCRIPT_OK'), true);
    } finally {
      service.destroy('task-live-launch');
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
