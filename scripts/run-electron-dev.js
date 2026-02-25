#!/usr/bin/env node

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const waitOn = require('wait-on');

const port = Number.parseInt(process.env.VITE_PORT || '5555', 10);
const resolvedPort = Number.isFinite(port) ? port : 5555;
const devServerUrl = `http://localhost:${resolvedPort}`;

const resolveBrandingIconSource = () => {
  const brandingPath = path.resolve(__dirname, '../config/app-branding.json');
  let appIconFile = 'logo.icns';
  let logoFile = 'logo.svg';
  try {
    if (fs.existsSync(brandingPath)) {
      const parsed = JSON.parse(fs.readFileSync(brandingPath, 'utf8')) || {};
      if (typeof parsed.appIconFile === 'string' && parsed.appIconFile.trim()) {
        appIconFile = parsed.appIconFile.trim();
      }
      if (typeof parsed.logoFile === 'string' && parsed.logoFile.trim()) {
        logoFile = parsed.logoFile.trim();
      }
    }
  } catch {
    // Ignore malformed branding config and use defaults.
  }

  const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const iconCandidate = normalize(appIconFile);
  const logoCandidate = normalize(logoFile);
  const iconBase = iconCandidate.replace(/\.(svg|png|icns|ico)$/i, '');
  const logoBase = logoCandidate.replace(/\.(svg|png|icns|ico)$/i, '');
  const candidateFiles = Array.from(new Set([
    `${iconBase}.icns`,
    `${logoBase}.icns`,
    iconCandidate,
    'logo.icns'
  ])).filter(Boolean);

  for (const relativeFile of candidateFiles) {
    const absolutePath = path.resolve(__dirname, `../public/${relativeFile}`);
    try {
      if (!fs.existsSync(absolutePath)) continue;
      if (path.extname(absolutePath).toLowerCase() !== '.icns') continue;
      return absolutePath;
    } catch {
      // Ignore read failures and continue.
    }
  }
  return null;
};

const applyDevBundleIcon = (electronBinary) => {
  if (process.platform !== 'darwin') return;
  const sourceIconPath = resolveBrandingIconSource();
  if (!sourceIconPath) return;
  const resourcesDir = path.resolve(path.dirname(electronBinary), '../Resources');
  const targetIconPath = path.join(resourcesDir, 'electron.icns');
  try {
    if (!fs.existsSync(targetIconPath)) return;
    const sourceBuffer = fs.readFileSync(sourceIconPath);
    let targetBuffer = null;
    try {
      targetBuffer = fs.readFileSync(targetIconPath);
    } catch {
      targetBuffer = null;
    }
    if (targetBuffer && sourceBuffer.equals(targetBuffer)) return;
    fs.copyFileSync(sourceIconPath, targetIconPath);
  } catch (error) {
    console.warn(`[dev] Could not apply dev app icon: ${error?.message || error}`);
  }
};

const run = async () => {
  await waitOn({
    resources: [
      `tcp:${resolvedPort}`,
      'dist/electron/main.js',
      'dist/electron/preload.js'
    ],
    timeout: 120000,
    interval: 100
  });

  const electronBinary = require('electron');
  applyDevBundleIcon(electronBinary);
  const child = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
};

run().catch((error) => {
  console.error('[dev] Failed to launch Electron:', error?.message || error);
  process.exit(1);
});
