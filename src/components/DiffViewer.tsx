import React, { useEffect, useState } from 'react';
import { X, GitMerge } from 'lucide-react';

interface DiffViewerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  worktreePath: string;
  branchName?: string;
  targetBranch?: string;
}

const DiffViewer: React.FC<DiffViewerProps> = ({ isOpen, onClose, onConfirm, worktreePath, branchName, targetBranch }) => {
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [syntaxAware, setSyntaxAware] = useState(true);
  const [diffMode, setDiffMode] = useState<'syntax' | 'text'>('text');

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      window.electronAPI.getDiff(worktreePath, { syntaxAware }).then((res) => {
        if (res.success && res.diff) {
          setDiff(res.diff);
          setDiffMode(res.diffMode === 'syntax' ? 'syntax' : 'text');
        } else {
          setDiff('No changes detected, or an error occurred.');
          setDiffMode('text');
        }
        setLoading(false);
      });
    }
  }, [isOpen, worktreePath, syntaxAware]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8">
      <div className="app-panel border border-[var(--panel-border)] rounded-lg shadow-2xl w-full max-w-5xl flex flex-col h-full">
        <div className="flex justify-between items-center p-4 border-b border-[var(--panel-border)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">Review Before Merge</h2>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">
              {branchName || 'task-branch'} {'->'} {targetBranch || 'base-branch'} • session closes after merge
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] font-mono mt-1">
              Diff mode: {diffMode === 'syntax' ? 'syntax-aware (difftastic)' : 'plain git diff'}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><X size={20} /></button>
        </div>

        <div className="px-4 py-2 border-b border-[var(--panel-border)] flex items-center gap-3 text-[11px] text-[var(--text-secondary)] font-mono">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={syntaxAware}
              onChange={(event) => setSyntaxAware(event.target.checked)}
            />
            syntax-aware diff
          </label>
          <span className="text-[var(--text-tertiary)]">falls back to plain diff if difftastic is unavailable</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 bg-[var(--panel-subtle)]">
          {loading ? (
            <div className="text-[var(--text-tertiary)] text-center mt-10 animate-pulse">Generating Diff...</div>
          ) : (
            <pre className="text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap">
              {diff || "No changes to merge."}
            </pre>
          )}
        </div>

        <div className="p-4 border-t border-[var(--panel-border)] flex justify-end space-x-3 bg-[var(--panel)]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded flex items-center">
            <GitMerge size={16} className="mr-2" /> Merge & Close Session
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
