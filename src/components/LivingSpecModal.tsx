import React, { useEffect, useState } from 'react';
import type { LivingSpecPreference, LivingSpecSelectionPrompt } from '../models/orchestrator';

interface LivingSpecModalProps {
  isOpen: boolean;
  prompt: LivingSpecSelectionPrompt | null;
  preference?: LivingSpecPreference;
  onApply: (preference: LivingSpecPreference) => void;
  onClose: () => void;
}

const LivingSpecModal: React.FC<LivingSpecModalProps> = ({
  isOpen,
  prompt,
  preference,
  onApply,
  onClose
}) => {
  const [selectedPath, setSelectedPath] = useState('');

  useEffect(() => {
    if (!isOpen || !prompt) return;
    const firstCandidate = prompt.candidates[0]?.path || '';
    if (preference?.mode === 'single' && preference.selectedPath) {
      setSelectedPath(preference.selectedPath);
      return;
    }
    setSelectedPath(firstCandidate);
  }, [isOpen, prompt, preference]);

  if (!isOpen || !prompt) return null;

  const canApply = !!selectedPath && prompt.candidates.some((candidate) => candidate.path === selectedPath);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[95] p-4">
      <div className="app-panel border border-[#1a1a1a] rounded-xl shadow-2xl w-full max-w-2xl flex flex-col">
        <div className="p-5 border-b border-[#1a1a1a] bg-[#050505]">
          <h2 className="text-sm font-bold text-[#e5e5e5] uppercase tracking-widest">Select Living Spec Source</h2>
          <p className="text-xs text-[#9ca3af] mt-2 leading-relaxed">
            Multiple instruction files were found for this project. Choose the file Forkline should read directly (prefer
            <span className="font-mono text-[#d4d4d8]"> AGENTS.md</span> when available).
          </p>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="rounded border border-[#1a1a1a] bg-[#050505]">
            {prompt.candidates.map((candidate) => (
              <label key={candidate.path} className="flex items-start gap-3 px-3 py-2 border-b border-[#111111] last:border-b-0 cursor-pointer">
                <input
                  type="radio"
                  className="mt-1"
                  name="living-spec-single"
                  checked={selectedPath === candidate.path}
                  onChange={() => setSelectedPath(candidate.path)}
                />
                <div className="min-w-0">
                  <div className="text-xs font-mono text-[#d4d4d8] break-all">{candidate.path}</div>
                  <div className="text-[11px] text-[#737373] uppercase tracking-wider mt-1">{candidate.kind}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-[#1a1a1a] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost px-3 py-1.5 rounded text-[11px] font-mono"
          >
            later
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canApply) return;
              onApply({ mode: 'single', selectedPath });
            }}
            disabled={!canApply}
            className="btn-primary px-3 py-1.5 rounded text-[11px] font-mono disabled:opacity-40 disabled:cursor-not-allowed"
          >
            apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default LivingSpecModal;
