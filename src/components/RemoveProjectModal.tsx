import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface RemoveProjectModalProps {
  isOpen: boolean;
  projectPath: string;
  sessionNames: string[];
  onClose: () => void;
  onConfirm: () => Promise<{ success: boolean; error?: string }>;
}

const normalizePath = (value: string) => String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');

const compactPath = (value: string, keepSegments = 4) => {
  const normalized = normalizePath(value);
  if (!normalized) return '-';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= keepSegments) return normalized;
  return `.../${parts.slice(-keepSegments).join('/')}`;
};

const projectNameFromPath = (value: string) => {
  const normalized = normalizePath(value);
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

const RemoveProjectModal: React.FC<RemoveProjectModalProps> = ({
  isOpen,
  projectPath,
  sessionNames,
  onClose,
  onConfirm
}) => {
  const [typedProjectName, setTypedProjectName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTypedProjectName('');
    setAcknowledged(false);
    setIsRemoving(false);
    setError('');
  }, [isOpen, projectPath]);

  const expectedProjectName = useMemo(() => projectNameFromPath(projectPath), [projectPath]);
  const typedMatches = typedProjectName.trim() === expectedProjectName;
  const canConfirm = !!expectedProjectName && typedMatches && acknowledged && !isRemoving;
  const visibleSessionNames = sessionNames.slice(0, 5);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsRemoving(true);
    setError('');
    const result = await onConfirm().catch((err: any) => ({
      success: false,
      error: err?.message || 'Project removal failed.'
    }));
    if (!result.success) {
      setError(result.error || 'Project removal failed.');
      setIsRemoving(false);
      return;
    }
    setIsRemoving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[96] flex items-center justify-center p-4" onClick={onClose}>
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-xl border border-[#1a1a1a] overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1a1a1a] bg-[#090909]">
          <div className="flex items-center gap-2 text-red-300">
            <AlertTriangle size={16} className="shrink-0" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em]">Remove Project and Sessions</h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-red-900/70 bg-[#1a0707] p-3 space-y-1">
            <div className="text-[11px] font-mono text-red-200">This action permanently removes:</div>
            <div className="text-[11px] font-mono text-red-100">- Project entry from side rail and local history</div>
            <div className="text-[11px] font-mono text-red-100">- All sessions for this project ({sessionNames.length})</div>
            <div className="text-[11px] font-mono text-red-100">- Branch/worktree for each active project session</div>
            <div className="text-[11px] font-mono text-red-100">- Fleet timeline/transcript metadata for this project</div>
          </div>

          <div className="rounded-lg border border-amber-900/70 bg-[#1d1408] p-3">
            <div className="text-[11px] font-mono text-amber-200">
              Merge and verify your session changes before deleting this project and its worktrees.
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] font-mono">Project Path</div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono truncate" title={projectPath}>{compactPath(projectPath, 5)}</div>
          </div>

          {visibleSessionNames.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] font-mono">Sessions</div>
              <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel-subtle)] p-2.5 space-y-1">
                {visibleSessionNames.map((name, index) => (
                  <div key={`${name}-${index}`} className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                    {name}
                  </div>
                ))}
                {sessionNames.length > visibleSessionNames.length && (
                  <div className="text-[10px] font-mono text-[var(--text-muted)]">
                    +{sessionNames.length - visibleSessionNames.length} more
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] font-mono">
              Type project name to confirm
            </label>
            <input
              type="text"
              value={typedProjectName}
              onChange={(event) => setTypedProjectName(event.target.value)}
              placeholder={expectedProjectName || 'project-name'}
              className="w-full input-stealth rounded py-2 px-3 text-xs font-mono"
              autoFocus
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[11px] text-[var(--text-secondary)] font-mono">
              I understand this removes project sessions and related local metadata. I have merged or intentionally discarded pending changes.
            </span>
          </label>

          <div className="text-[10px] text-[var(--text-muted)] font-mono">
            The source project directory itself is not deleted.
          </div>

          {error && (
            <div className="text-[11px] text-red-300 font-mono">{error}</div>
          )}

          <div className="pt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isRemoving}
              className="btn-ghost px-3 py-1.5 rounded text-[11px] uppercase tracking-wider"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleConfirm();
              }}
              disabled={!canConfirm}
              className="btn-danger px-3 py-1.5 rounded text-[11px] uppercase tracking-wider disabled:opacity-60"
            >
              {isRemoving ? 'removing...' : 'remove project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemoveProjectModal;
