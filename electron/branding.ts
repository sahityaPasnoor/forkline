import fs from 'fs';
import path from 'path';

export interface AppBranding {
  name: string;
  tagline: string;
  logoFile: string;
  appIconFile: string;
}

const DEFAULT_BRANDING: AppBranding = {
  name: 'Forkline',
  tagline: 'Run and control coding agents in isolated Git worktrees.',
  logoFile: 'logo.svg',
  appIconFile: 'logo.icns'
};

const sanitizeText = (value: unknown, fallback: string) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
};

const sanitizeLogoFile = (value: unknown) => {
  const normalized = sanitizeText(value, DEFAULT_BRANDING.logoFile)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return DEFAULT_BRANDING.logoFile;
  return normalized;
};

const parseBranding = (input: unknown): AppBranding => {
  const source = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  return {
    name: sanitizeText(source.name, DEFAULT_BRANDING.name),
    tagline: sanitizeText(source.tagline, DEFAULT_BRANDING.tagline),
    logoFile: sanitizeLogoFile(source.logoFile),
    appIconFile: sanitizeLogoFile(source.appIconFile)
  };
};

const resolveBrandingConfigPath = () => {
  const candidates = [
    path.resolve(process.cwd(), 'config/app-branding.json'),
    path.resolve(__dirname, '../../config/app-branding.json')
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Ignore unreadable path and continue.
    }
  }
  return null;
};

export const loadAppBranding = (): AppBranding => {
  const configPath = resolveBrandingConfigPath();
  if (!configPath) return DEFAULT_BRANDING;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parseBranding(parsed);
  } catch {
    return DEFAULT_BRANDING;
  }
};
