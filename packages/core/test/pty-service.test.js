const test = require('node:test');
const assert = require('node:assert/strict');

const { PtyService } = require('../src/services/pty-service');

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

  try {
    const created = service.createSession('task-lifecycle', process.cwd(), {}, 'test');
    assert.equal(created.created, true);

    const attached = service.attach('task-lifecycle', 'test');
    assert.ok(attached);
    assert.equal(attached.taskId, 'task-lifecycle');

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
