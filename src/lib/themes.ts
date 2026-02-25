export interface AppTheme {
  id: string;
  name: string;
  description: string;
  preview: {
    bg: string;
    panel: string;
    border: string;
    text: string;
    accent: string;
  };
}

export const APP_THEMES: AppTheme[] = [
  {
    id: 'docs-circuit',
    name: 'Docs Circuit',
    description: 'Matches the documentation default dark palette',
    preview: { bg: '#090d14', panel: '#0f1723', border: '#283548', text: '#e2e8f0', accent: '#2dd4bf' }
  },
  {
    id: 'stealth',
    name: 'Stealth Mono',
    description: 'High-contrast dark operator theme',
    preview: { bg: '#000000', panel: '#050505', border: '#1a1a1a', text: '#e5e5e5', accent: '#ffffff' }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Neutral gray studio look',
    preview: { bg: '#0b0d10', panel: '#101419', border: '#2a3038', text: '#dde1e7', accent: '#dbe3f0' }
  },
  {
    id: 'midnight-teal',
    name: 'Midnight Teal',
    description: 'Cool dark cyan accents',
    preview: { bg: '#041217', panel: '#092027', border: '#1f4a52', text: '#d9f3f0', accent: '#4bd3cf' }
  },
  {
    id: 'amber-night',
    name: 'Amber Night',
    description: 'Warm amber focus palette',
    preview: { bg: '#140d05', panel: '#1b1208', border: '#4b3116', text: '#f8e8c8', accent: '#f0b34a' }
  },
  {
    id: 'forest-terminal',
    name: 'Forest Terminal',
    description: 'Deep green command center',
    preview: { bg: '#071107', panel: '#0b1a0c', border: '#24512a', text: '#d8f3dc', accent: '#65d46e' }
  },
  {
    id: 'ocean-deep',
    name: 'Ocean Deep',
    description: 'Blue-forward contrast theme',
    preview: { bg: '#06111f', panel: '#0a1a33', border: '#244779', text: '#d6e7ff', accent: '#74aaff' }
  },
  {
    id: 'sunset-dark',
    name: 'Sunset Dark',
    description: 'Dark shell with warm highlights',
    preview: { bg: '#1a0e14', panel: '#23111a', border: '#5b2e3b', text: '#f8dce3', accent: '#ff9a76' }
  },
  {
    id: 'paper-light',
    name: 'Paper Light',
    description: 'Light reading-focused workspace',
    preview: { bg: '#f6f7f9', panel: '#ffffff', border: '#d5dbe4', text: '#111827', accent: '#111827' }
  },
  {
    id: 'sandstorm-light',
    name: 'Sandstorm Light',
    description: 'Warm light with muted contrast',
    preview: { bg: '#f7f3ea', panel: '#fffaf0', border: '#d9c9ae', text: '#2b2217', accent: '#7f4f24' }
  },
  {
    id: 'ice-light',
    name: 'Ice Light',
    description: 'Cool light technical theme',
    preview: { bg: '#eef4f9', panel: '#f9fcff', border: '#bfd2e6', text: '#10263d', accent: '#1f5f8b' }
  }
];

export const DEFAULT_THEME_ID = 'docs-circuit';
