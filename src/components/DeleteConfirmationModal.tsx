import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  kind: 'session' | 'worktree';
  sessionName?: string;
  branchName: string;
  projectPath: string;
  worktreePath: string;
  onClose: () => void;
  onConfirm: () => Promise<{ success: boolean; error?: string }>;
}

const compactPath = (value: string, keepSegments = 4) => {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return '-';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= keepSegments) return normalized;
  return `.../${parts.slice(-keepSegments).join('/')}`;
};

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  kind,
  sessionName,
  branchName,
  projectPath,
  worktreePath,
  onClose,
  onConfirm
}) => {
  const [typedBranch, setTypedBranch] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTypedBranch('');
    setAcknowledged(false);
    setIsDeleting(false);
    setError('');
  }, [isOpen, branchName, sessionName, projectPath, worktreePath]);

  const expectedBranch = useMemo(() => String(branchName || '').trim(), [branchName]);
  const typedMatches = typedBranch.trim() === expectedBranch;
  const canDelete = !!expectedBranch && typedMatches && acknowledged && !isDeleting;

  if (!isOpen) return null;

  const title = kind === 'session' ? 'Delete Session, Branch, and Worktree' : 'Delete Branch and Worktree';

  const handleDelete = async () => {
    if (!canDelete) return;
    setIsDeleting(true);
    setError('');
    const result = await onConfirm().catch((err: any) => ({
      success: false,
      error: err?.message || 'Delete failed.'
    }));
    if (!result.success) {
      setError(result.error || 'Delete failed.');
      setIsDeleting(false);
      return;
    }
    setIsDeleting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[95] flex items-center justify-center p-4" onClick={onClose}>
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-xl border border-[#1a1a1a] overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1a1a1a] bg-[#090909]">
          <div className="flex items-center gap-2 text-red-300">
            <AlertTriangle size={16} className="shrink-0" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em]">{title}</h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {kind === 'session' && sessionName && (
            <div className="text-[12px] text-[var(--text-primary)] font-mono">
              Session: <span className="text-white">{sessionName}</span>
            </div>
          )}

          <div className="rounded-lg border border-red-900/70 bg-[#1a0707] p-3 space-y-1">
            <div className="text-[11px] font-mono text-red-200">This action permanently removes:</div>
            {kind === 'session' && (
              <div className="text-[11px] font-mono text-red-100">- The running session tab</div>
            )}
            <div className="text-[11px] font-mono text-red-100">- Branch: {expectedBranch || '-'}</div>
            <div className="text-[11px] font-mono text-red-100">- Worktree: {compactPath(worktreePath, 5)}</div>
          </div>

          <div className="rounded-lg border border-amber-900/70 bg-[#1d1408] p-3">
            <div className="text-[11px] font-mono text-amber-200">
              Merge and verify your changes before deleting this branch/worktree.
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] font-mono">Project</div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono truncate" title={projectPath}>{compactPath(projectPath, 5)}</div>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] font-mono">
              Type branch name to confirm
            </label>
            <input
              type="text"
              value={typedBranch}
              onChange={(event) => setTypedBranch(event.target.value)}
              placeholder={expectedBranch || 'branch-name'}
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
              I understand this permanently deletes local branch/worktree data and cannot be undone. I have merged or intentionally discarded my changes.
            </span>
          </label>

          {error && (
            <div className="text-[11px] text-red-300 font-mono">{error}</div>
          )}

          <div className="pt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="btn-ghost px-3 py-1.5 rounded text-[11px] uppercase tracking-wider"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDelete();
              }}
              disabled={!canDelete}
              className="btn-danger px-3 py-1.5 rounded text-[11px] uppercase tracking-wider disabled:opacity-60"
            >
              {isDeleting ? 'deleting...' : 'delete permanently'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmationModal;
