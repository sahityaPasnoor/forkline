import brandingJson from '../../config/app-branding.json';

interface BrandingConfig {
  name?: string;
  tagline?: string;
  logoFile?: string;
  appIconFile?: string;
}

const rawConfig = (brandingJson || {}) as BrandingConfig;

const sanitizeName = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const sanitizeTagline = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const sanitizeLogoFile = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim().replace(/\\/g, '/').replace(/^\/+/, '') : '';
  return text || fallback;
};

export const APP_BRANDING = {
  name: sanitizeName(rawConfig.name, 'Forkline'),
  tagline: sanitizeTagline(rawConfig.tagline, 'Run and control coding agents in isolated Git worktrees.'),
  logoFile: sanitizeLogoFile(rawConfig.logoFile, 'logo.svg'),
  appIconFile: sanitizeLogoFile(rawConfig.appIconFile, 'logo.icns'),
  logoSrc: `./${sanitizeLogoFile(rawConfig.logoFile, 'logo.svg')}`
};
