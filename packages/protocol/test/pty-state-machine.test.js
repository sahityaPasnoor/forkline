const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PTY_MODES,
  PtySessionStateMachine,
  parseForklineMarkers
} = require('../src/pty-state-machine');

test('parseForklineMarkers extracts marker payloads', () => {
  const sample = '\u001b]1337;ForklineEvent=type=agent_started;provider=claude\u0007';
  const markers = parseForklineMarkers(sample);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].type, 'agent_started');
  assert.equal(markers[0].provider, 'claude');
});

test('PtySessionStateMachine tracks blocked -> agent -> shell transitions', () => {
  const machine = new PtySessionStateMachine({ providerHint: 'claude' });

  machine.start();
  assert.equal(machine.snapshot().mode, PTY_MODES.BOOTING);

  machine.consumeOutput('\u001b]1337;ForklineEvent=type=awaiting_confirmation;provider=claude;reason=Proceed?\u0007');
  assert.equal(machine.snapshot().mode, PTY_MODES.BLOCKED);
  assert.equal(machine.snapshot().isBlocked, true);

  machine.consumeOutput('\u001b]1337;ForklineEvent=type=confirmation_resolved;provider=claude\u0007');
  assert.equal(machine.snapshot().isBlocked, false);
  assert.equal(machine.snapshot().mode, PTY_MODES.AGENT);

  machine.consumeOutput('\u001b]1337;ForklineEvent=type=agent_exited;provider=claude;code=0\u0007');
  assert.equal(machine.snapshot().mode, PTY_MODES.SHELL);
  assert.equal(machine.snapshot().isBlocked, false);
});
