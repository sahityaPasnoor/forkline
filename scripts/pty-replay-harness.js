#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { PtySessionStateMachine } = require('../packages/protocol/src/pty-state-machine');

const FIXTURE_DIR = path.join(process.cwd(), 'documents', 'pty-replay-fixtures');

const readFixtures = () => {
  if (!fs.existsSync(FIXTURE_DIR)) {
    throw new Error(`Fixture directory not found: ${FIXTURE_DIR}`);
  }
  const files = fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new Error(`No replay fixtures found in ${FIXTURE_DIR}`);
  }
  return files.map((file) => ({
    file,
    fullPath: path.join(FIXTURE_DIR, file),
    payload: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'))
  }));
};

const assertMatches = (actual, expected, context) => {
  for (const [key, value] of Object.entries(expected || {})) {
    if (actual[key] !== value) {
      throw new Error(`${context}: expected ${key}=${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`);
    }
  }
};

const runFixture = (fixture) => {
  const { payload, file } = fixture;
  const machine = new PtySessionStateMachine({
    providerHint: payload.providerHint || '',
    agentCommand: payload.agentCommand || ''
  });

  const events = Array.isArray(payload.events) ? payload.events : [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i] || {};
    const type = String(event.type || '').trim().toLowerCase();
    if (type === 'start') {
      machine.start();
    } else if (type === 'output') {
      machine.consumeOutput(String(event.data || ''), { altScreen: !!event.altScreen });
    } else if (type === 'input') {
      machine.consumeInput(String(event.data || ''));
    } else if (type === 'exit') {
      machine.consumeExit(
        typeof event.exitCode === 'number' ? event.exitCode : null,
        typeof event.signal === 'number' ? event.signal : undefined
      );
    } else if (type === 'altscreen') {
      machine.updateAltScreen(!!event.value);
    } else if (type === 'reconcile') {
      machine.reconcile('test');
    } else {
      throw new Error(`${file}: unsupported event type "${type}" at index ${i}`);
    }

    if (event.expect) {
      assertMatches(machine.snapshot(), event.expect, `${file} event#${i}`);
    }
  }

  assertMatches(machine.snapshot(), payload.expectFinal || {}, `${file} final`);
};

const main = () => {
  const fixtures = readFixtures();
  for (const fixture of fixtures) {
    runFixture(fixture);
    process.stdout.write(`[replay] pass ${fixture.file}\n`);
  }
  process.stdout.write(`[replay] ${fixtures.length} fixture(s) passed\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`[replay] FAIL: ${error?.message || error}\n`);
  process.exit(1);
}
