const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { resolveQuickActionPlan } = require('../../protocol/src/quick-actions');

const getCoreBaseUrl = () => process.env.FORKLINE_CORE_URL || 'http://127.0.0.1:34600';
const getTuiAgentCommand = () => process.env.FORKLINE_TUI_AGENT || 'shell';
const getCoreTokenFile = () => process.env.FORKLINE_CORE_TOKEN_FILE || path.join(os.homedir(), '.forkline', 'core.token');

const resolveCoreToken = () => {
  const envToken = String(process.env.FORKLINE_CORE_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    const tokenFile = getCoreTokenFile();
    if (!fs.existsSync(tokenFile)) return '';
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
};

const buildAuthHeaders = (authToken) => {
  if (!authToken) return {};
  return {
    authorization: `Bearer ${authToken}`,
    'x-forkline-token': authToken
  };
};

const httpRequestJson = (method, url, body, authToken = '') =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const baseHeaders = buildAuthHeaders(authToken);
    const headers = payload
      ? {
          ...baseHeaders,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        }
      : baseHeaders;
    const req = http.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk.toString();
        });
        res.on('end', () => {
          const statusCode = res.statusCode || 500;
          let parsedJson = {};
          try {
            parsedJson = raw ? JSON.parse(raw) : {};
          } catch {
            parsedJson = { raw };
          }
          if (statusCode >= 400) {
            reject(new Error(`HTTP ${statusCode}: ${JSON.stringify(parsedJson)}`));
            return;
          }
          resolve(parsedJson);
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const printHelp = () => {
  process.stdout.write('\n');
  process.stdout.write('Forkline TUI (experimental)\n');
  process.stdout.write('Note: GUI is the primary interface; TUI commands and UX may change.\n');
  process.stdout.write('Commands:\n');
  process.stdout.write('  health\n');
  process.stdout.write('  version\n');
  process.stdout.write('  sessions\n');
  process.stdout.write('  spawn <taskId> [cwd]\n');
  process.stdout.write('  follow <taskId>\n');
  process.stdout.write('  send <taskId> <text>\n');
  process.stdout.write('  input <text>           (to followed task)\n');
  process.stdout.write('  resume [taskId]        (or current followed task)\n');
  process.stdout.write('  pause [taskId]         (Ctrl+C, or current followed task)\n');
  process.stdout.write('  status [taskId]        (git status + branch)\n');
  process.stdout.write('  plan [taskId]          (ask for concise execution plan)\n');
  process.stdout.write('  testfix [taskId]       (run test & fix quick action)\n');
  process.stdout.write('  context [taskId]       (ask agent for context usage)\n');
  process.stdout.write('  cost [taskId]          (ask agent for token/cost summary)\n');
  process.stdout.write('  resize <taskId> <cols> <rows>\n');
  process.stdout.write('  destroy <taskId>\n');
  process.stdout.write('  clear\n');
  process.stdout.write('  q\n');
  process.stdout.write('\n');
};

const parseCommand = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return { cmd: '', args: [] };
  const [cmd, ...args] = trimmed.split(' ');
  return { cmd: cmd.toLowerCase(), args };
};

const startEventStream = (baseUrl, authToken, onEvent) => {
  const eventsUrl = new URL('/v1/events', baseUrl);
  const headers = buildAuthHeaders(authToken);
  const req = http.request(
    {
      method: 'GET',
      hostname: eventsUrl.hostname,
      port: eventsUrl.port,
      path: eventsUrl.pathname,
      headers
    },
    (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const packet = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          const dataLine = packet
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice('data: '.length));
            onEvent(event);
          } catch {
            // Ignore malformed event packet.
          }
        }
      });
    }
  );
  req.on('error', (error) => {
    process.stdout.write(`\n[event-stream] disconnected: ${error.message}\n`);
  });
  req.end();
  return req;
};

const executeQuickAction = async ({
  coreBaseUrl,
  coreAuthToken,
  taskId,
  action,
  isBlocked,
  agentCommand = 'shell'
}) => {
  const plan = resolveQuickActionPlan({
    action,
    agentCommand,
    isBlocked
  });

  for (const step of plan.steps) {
    if (step.kind === 'hint') {
      process.stdout.write(`[hint] ${step.message}\n`);
      continue;
    }
    if (step.kind === 'send') {
      await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
        taskId,
        data: step.data
      }, coreAuthToken);
      continue;
    }
    if (step.kind === 'send_line') {
      const prefix = step.clearLine === false ? '' : '\u0015';
      await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
        taskId,
        data: `${prefix}${step.line}\r`
      }, coreAuthToken);
      continue;
    }
    if (step.kind === 'launch_agent') {
      await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
        taskId,
        data: `\u0015${agentCommand}\r`
      }, coreAuthToken);
      if (step.postInstruction && step.postInstruction.trim()) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
          taskId,
          data: `\u0015${step.postInstruction.trim()}\r`
        }, coreAuthToken);
      }
    }
  }
};

const runTui = async () => {
  const coreBaseUrl = getCoreBaseUrl();
  const coreAuthToken = resolveCoreToken();
  if (!coreAuthToken) {
    process.stderr.write('Missing core auth token. Set FORKLINE_CORE_TOKEN or create ~/.forkline/core.token.\n');
    process.exit(1);
    return;
  }
  const tuiAgentCommand = getTuiAgentCommand();
  let followedTaskId = null;
  const blockedByTask = new Map();
  const modeByTask = new Map();

  process.stdout.write(`Connected target: ${coreBaseUrl}\n`);
  printHelp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'forkline> '
  });

  const eventReq = startEventStream(coreBaseUrl, coreAuthToken, (event) => {
    if (event.type === 'pty.data') {
      const taskId = event.payload?.taskId;
      if (taskId && taskId === followedTaskId) {
        process.stdout.write(event.payload.data || '');
      }
      return;
    }

    if (event.type === 'pty.blocked') {
      const taskId = event.payload?.taskId;
      const isBlocked = !!event.payload?.isBlocked;
      const reason = event.payload?.reason || '';
      blockedByTask.set(taskId, isBlocked);
      if (isBlocked) {
        process.stdout.write(`\n[blocked:${taskId}] ${reason}\n`);
      } else {
        process.stdout.write(`\n[blocked:${taskId}] cleared\n`);
      }
      rl.prompt();
      return;
    }

    if (event.type === 'pty.mode') {
      const taskId = event.payload?.taskId;
      if (!taskId) return;
      const mode = String(event.payload?.mode || 'booting');
      const isBlocked = !!event.payload?.isBlocked;
      const reason = event.payload?.blockedReason || '';
      modeByTask.set(taskId, mode);
      blockedByTask.set(taskId, isBlocked);
      if (taskId === followedTaskId) {
        process.stdout.write(`\n[mode:${taskId}] ${mode}`);
        if (isBlocked) process.stdout.write(` (${reason || 'awaiting confirmation'})`);
        process.stdout.write('\n');
        rl.prompt();
      }
      return;
    }

    if (event.type === 'pty.exit') {
      const taskId = event.payload?.taskId;
      const code = event.payload?.exitCode;
      process.stdout.write(`\n[exit:${taskId}] code=${code}\n`);
      rl.prompt();
    }
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const { cmd, args } = parseCommand(line);
    const resolveTaskId = (candidate) => candidate || followedTaskId;

    try {
      if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
        rl.close();
        return;
      }

      if (cmd === 'clear') {
        process.stdout.write('\x1Bc');
        printHelp();
        rl.prompt();
        return;
      }

      if (cmd === 'health') {
        const data = await httpRequestJson('GET', `${coreBaseUrl}/v1/health`, undefined, coreAuthToken);
        process.stdout.write(`${JSON.stringify(data)}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'version') {
        const data = await httpRequestJson('GET', `${coreBaseUrl}/v1/version`, undefined, coreAuthToken);
        process.stdout.write(`${JSON.stringify(data)}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'sessions') {
        const data = await httpRequestJson('GET', `${coreBaseUrl}/v1/pty/sessions`, undefined, coreAuthToken);
        for (const session of Array.isArray(data.sessions) ? data.sessions : []) {
          if (!session?.taskId) continue;
          modeByTask.set(session.taskId, session.mode || 'booting');
          blockedByTask.set(session.taskId, !!session.isBlocked);
        }
        process.stdout.write(`${JSON.stringify(data.sessions || [], null, 2)}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'spawn') {
        const taskId = args[0];
        const cwd = args[1] || process.cwd();
        if (!taskId) {
          process.stdout.write('Usage: spawn <taskId> [cwd]\n');
          rl.prompt();
          return;
        }
        const data = await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/create`, {
          taskId,
          cwd,
          subscriberId: 'tui'
        }, coreAuthToken);
        process.stdout.write(`${JSON.stringify(data)}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'follow') {
        const taskId = args[0];
        if (!taskId) {
          process.stdout.write('Usage: follow <taskId>\n');
          rl.prompt();
          return;
        }
        const data = await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/attach`, {
          taskId,
          subscriberId: 'tui'
        }, coreAuthToken);
        followedTaskId = taskId;
        process.stdout.write(`[follow] ${taskId}\n`);
        if (data.state?.outputBuffer) {
          process.stdout.write(data.state.outputBuffer);
        }
        rl.prompt();
        return;
      }

      if (cmd === 'send') {
        const taskId = args[0];
        const text = args.slice(1).join(' ');
        if (!taskId || !text) {
          process.stdout.write('Usage: send <taskId> <text>\n');
          rl.prompt();
          return;
        }
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, { taskId, data: `${text}\r` }, coreAuthToken);
        rl.prompt();
        return;
      }

      if (cmd === 'input') {
        const text = args.join(' ');
        if (!followedTaskId || !text) {
          process.stdout.write('Usage: input <text> (after follow <taskId>)\n');
          rl.prompt();
          return;
        }
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
          taskId: followedTaskId,
          data: `${text}\r`
        }, coreAuthToken);
        rl.prompt();
        return;
      }

      if (cmd === 'resume') {
        const taskId = resolveTaskId(args[0]);
        if (!taskId) {
          process.stdout.write('Usage: resume [taskId] (or follow <taskId> first)\n');
          rl.prompt();
          return;
        }
        await executeQuickAction({
          coreBaseUrl,
          coreAuthToken,
          taskId,
          action: 'resume',
          isBlocked: !!blockedByTask.get(taskId),
          agentCommand: tuiAgentCommand
        });
        rl.prompt();
        return;
      }

      if (cmd === 'pause') {
        const taskId = resolveTaskId(args[0]);
        if (!taskId) {
          process.stdout.write('Usage: pause [taskId] (or follow <taskId> first)\n');
          rl.prompt();
          return;
        }
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, { taskId, data: '\u0003' }, coreAuthToken);
        rl.prompt();
        return;
      }

      if (cmd === 'status') {
        const taskId = resolveTaskId(args[0]);
        if (!taskId) {
          process.stdout.write('Usage: status [taskId] (or follow <taskId> first)\n');
          rl.prompt();
          return;
        }
        await executeQuickAction({
          coreBaseUrl,
          coreAuthToken,
          taskId,
          action: 'status',
          isBlocked: !!blockedByTask.get(taskId),
          agentCommand: tuiAgentCommand
        });
        rl.prompt();
        return;
      }

      if (cmd === 'plan') {
        const taskId = resolveTaskId(args[0]);
        if (!taskId) {
          process.stdout.write('Usage: plan [taskId] (or follow <taskId> first)\n');
          rl.prompt();
          return;
        }
        await executeQuickAction({
          coreBaseUrl,
          coreAuthToken,
          taskId,
          action: 'plan',
          isBlocked: !!blockedByTask.get(taskId),
          agentCommand: tuiAgentCommand
        });
        rl.prompt();
        return;
      }

      if (cmd === 'testfix') {
        const taskId = resolveTaskId(args[0]);
        if (!taskId) {
          process.stdout.write('Usage: testfix [taskId] (or follow <taskId> first)\n');
          rl.prompt();
          return;
        }
        await executeQuickAction({
          coreBaseUrl,
          coreAuthToken,
          taskId,
          action: 'test_and_fix',
          isBlocked: !!blockedByTask.get(taskId),
          agentCommand: tuiAgentCommand
        });
        rl.prompt();
        return;
      }

      if (cmd === 'context') {
        const taskId = resolveTaskId(args[0]);
        if (!taskId) {
          process.stdout.write('Usage: context [taskId] (or follow <taskId> first)\n');
          rl.prompt();
          return;
        }
        await executeQuickAction({
          coreBaseUrl,
          coreAuthToken,
          taskId,
          action: 'context',
          isBlocked: !!blockedByTask.get(taskId),
          agentCommand: tuiAgentCommand
        });
        rl.prompt();
        return;
      }

      if (cmd === 'cost') {
        const taskId = resolveTaskId(args[0]);
        if (!taskId) {
          process.stdout.write('Usage: cost [taskId] (or follow <taskId> first)\n');
          rl.prompt();
          return;
        }
        await executeQuickAction({
          coreBaseUrl,
          coreAuthToken,
          taskId,
          action: 'cost',
          isBlocked: !!blockedByTask.get(taskId),
          agentCommand: tuiAgentCommand
        });
        rl.prompt();
        return;
      }

      if (cmd === 'resize') {
        const taskId = args[0];
        const cols = Number.parseInt(args[1], 10);
        const rows = Number.parseInt(args[2], 10);
        if (!taskId || !Number.isFinite(cols) || !Number.isFinite(rows)) {
          process.stdout.write('Usage: resize <taskId> <cols> <rows>\n');
          rl.prompt();
          return;
        }
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/resize`, { taskId, cols, rows }, coreAuthToken);
        rl.prompt();
        return;
      }

      if (cmd === 'destroy') {
        const taskId = args[0];
        if (!taskId) {
          process.stdout.write('Usage: destroy <taskId>\n');
          rl.prompt();
          return;
        }
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/destroy`, { taskId }, coreAuthToken);
        if (followedTaskId === taskId) followedTaskId = null;
        rl.prompt();
        return;
      }

      if (cmd) {
        process.stdout.write(`Unknown command: ${cmd}\n`);
      }
      rl.prompt();
    } catch (error) {
      process.stdout.write(`Error: ${error?.message || error}\n`);
      rl.prompt();
    }
  });

  rl.on('close', () => {
    eventReq.destroy();
    process.stdout.write('Bye.\n');
    process.exit(0);
  });
};

module.exports = { runTui };
