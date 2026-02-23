const http = require('node:http');
const readline = require('node:readline');

const getCoreBaseUrl = () => process.env.FORKLINE_CORE_URL || 'http://127.0.0.1:34600';

const httpRequestJson = (method, url, body) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload)
            }
          : undefined
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
  process.stdout.write('Forkline TUI\n');
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

const startEventStream = (baseUrl, onEvent) => {
  const eventsUrl = new URL('/v1/events', baseUrl);
  const req = http.request(
    {
      method: 'GET',
      hostname: eventsUrl.hostname,
      port: eventsUrl.port,
      path: eventsUrl.pathname
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

const runTui = async () => {
  const coreBaseUrl = getCoreBaseUrl();
  let followedTaskId = null;

  process.stdout.write(`Connected target: ${coreBaseUrl}\n`);
  printHelp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'forkline> '
  });

  const eventReq = startEventStream(coreBaseUrl, (event) => {
    if (event.type === 'pty.data') {
      const taskId = event.payload?.taskId;
      if (taskId && taskId === followedTaskId) {
        process.stdout.write(event.payload.data || '');
      }
      return;
    }

    if (event.type === 'pty.blocked') {
      const taskId = event.payload?.taskId;
      const reason = event.payload?.reason || '';
      process.stdout.write(`\n[blocked:${taskId}] ${reason}\n`);
      rl.prompt();
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
        const data = await httpRequestJson('GET', `${coreBaseUrl}/v1/health`);
        process.stdout.write(`${JSON.stringify(data)}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'version') {
        const data = await httpRequestJson('GET', `${coreBaseUrl}/v1/version`);
        process.stdout.write(`${JSON.stringify(data)}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'sessions') {
        const data = await httpRequestJson('GET', `${coreBaseUrl}/v1/pty/sessions`);
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
        });
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
        });
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, { taskId, data: `${text}\r` });
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
        });
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, { taskId, data: '\r' });
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, { taskId, data: '\u0003' });
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
          taskId,
          data: 'git status --short && echo "---" && git branch --show-current\r'
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
          taskId,
          data: 'Report current context usage and remaining context window in one concise line.\r'
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/write`, {
          taskId,
          data: 'Report the latest token usage and estimated cost in USD for this session in a compact format.\r'
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/resize`, { taskId, cols, rows });
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
        await httpRequestJson('POST', `${coreBaseUrl}/v1/pty/destroy`, { taskId });
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
