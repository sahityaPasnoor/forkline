const pty = require('node-pty');
const ptyProcess = pty.spawn(process.env.SHELL || 'bash', [], { name: 'xterm-color', cols: 80, rows: 30, cwd: process.cwd(), env: process.env });
ptyProcess.onData((data) => process.stdout.write(data));
ptyProcess.write('echo "PTY is working"\r');
setTimeout(() => { ptyProcess.kill(); process.exit(0); }, 1000);
