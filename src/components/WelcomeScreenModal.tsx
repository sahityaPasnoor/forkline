import React from 'react';
import { Palette, Sparkles } from 'lucide-react';
import { APP_THEMES } from '../lib/themes';
import { APP_BRANDING } from '../config/appBranding';

interface WelcomeScreenModalProps {
  isOpen: boolean;
  theme: string;
  setTheme: (theme: string) => void;
  onContinue: () => void;
}

const WelcomeScreenModal: React.FC<WelcomeScreenModalProps> = ({
  isOpen,
  theme,
  setTheme,
  onContinue
}) => {
  if (!isOpen) return null;

  const selectedTheme = APP_THEMES.find((candidate) => candidate.id === theme) || APP_THEMES[0];
  const logoSrc = APP_BRANDING.logoSrc;

  return (
    <div
      className="fixed inset-0 z-[120] backdrop-blur-sm flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(3, 7, 12, 0.88)' }}
    >
      <div className="w-full max-w-2xl app-panel rounded-2xl border border-[var(--panel-border)] shadow-2xl overflow-hidden">
        <div className="px-6 py-6 bg-[var(--panel-subtle)] border-b border-[var(--panel-border)]">
          <div className="flex items-center gap-4">
            <img src={logoSrc} alt={`${APP_BRANDING.name} logo`} className="w-14 h-14 rounded-lg border border-[var(--panel-border)] p-2 bg-[var(--panel)]" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)] font-mono">Welcome</div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)] mt-1">{APP_BRANDING.name}</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                {APP_BRANDING.tagline}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-6 space-y-5">
          <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel-subtle)] p-4">
            <div className="flex items-center gap-2 text-[var(--text-primary)] text-xs font-semibold uppercase tracking-wider">
              <Palette size={14} />
              Default Theme
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              App default matches the documentation theme. You can change it here or later in Settings.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] items-center">
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                className="w-full input-stealth rounded px-3 py-2 text-sm"
              >
                {APP_THEMES.map((appTheme) => (
                  <option key={appTheme.id} value={appTheme.id}>{appTheme.name}</option>
                ))}
              </select>

              <div
                className="rounded-lg border px-3 py-2"
                style={{
                  backgroundColor: selectedTheme.preview.panel,
                  borderColor: selectedTheme.preview.border,
                  color: selectedTheme.preview.text
                }}
              >
                <div className="text-[11px] font-semibold">{selectedTheme.name}</div>
                <div className="mt-1 h-1.5 rounded" style={{ backgroundColor: selectedTheme.preview.accent }} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4">
            <div className="flex items-center gap-2 text-xs text-[var(--text-primary)] font-semibold uppercase tracking-wider">
              <Sparkles size={14} />
              Start Flow
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              1) Choose workspace, 2) spawn first task, 3) iterate and merge.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--panel-border)] bg-[var(--panel-subtle)] flex items-center justify-end">
          <button onClick={onContinue} className="btn-primary px-4 py-2 rounded text-xs uppercase tracking-wider">
            Enter {APP_BRANDING.name}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreenModal;
