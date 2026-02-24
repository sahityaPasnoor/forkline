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
  const [mode, setMode] = useState<'single' | 'consolidated'>('single');
  const [selectedPath, setSelectedPath] = useState('');

  useEffect(() => {
    if (!isOpen || !prompt) return;
    const firstCandidate = prompt.candidates[0]?.path || '';
    if (preference?.mode === 'single' && preference.selectedPath) {
      setMode('single');
      setSelectedPath(preference.selectedPath);
      return;
    }
    if (preference?.mode === 'consolidated') {
      setMode('consolidated');
      setSelectedPath(firstCandidate);
      return;
    }
    setMode('single');
    setSelectedPath(firstCandidate);
  }, [isOpen, prompt, preference]);

  if (!isOpen || !prompt) return null;

  const canApply = mode === 'consolidated'
    || (mode === 'single' && !!selectedPath && prompt.candidates.some((candidate) => candidate.path === selectedPath));

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[95] p-4">
      <div className="app-panel border border-[#1a1a1a] rounded-xl shadow-2xl w-full max-w-2xl flex flex-col">
        <div className="p-5 border-b border-[#1a1a1a] bg-[#050505]">
          <h2 className="text-sm font-bold text-[#e5e5e5] uppercase tracking-widest">Select Living Spec Source</h2>
          <p className="text-xs text-[#9ca3af] mt-2 leading-relaxed">
            Multiple agent instruction files were found for this project. Choose one file, or consolidate all files into a single
            canonical <span className="font-mono text-[#d4d4d8]">.agent_cache/FORKLINE_SPEC.md</span> per task.
          </p>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <label className="flex items-start gap-3 rounded border border-[#242424] p-3 cursor-pointer">
            <input
              type="radio"
              className="mt-1"
              name="living-spec-mode"
              checked={mode === 'single'}
              onChange={() => setMode('single')}
            />
            <span className="text-xs text-[#d4d4d8]">
              Use one existing file as the source of truth.
            </span>
          </label>

          {mode === 'single' && (
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
          )}

          <label className="flex items-start gap-3 rounded border border-[#242424] p-3 cursor-pointer">
            <input
              type="radio"
              className="mt-1"
              name="living-spec-mode"
              checked={mode === 'consolidated'}
              onChange={() => setMode('consolidated')}
            />
            <span className="text-xs text-[#d4d4d8]">
              Consolidate all detected files into one canonical task-local spec file.
            </span>
          </label>
        </div>

        <div className="p-4 border-t border-[#1a1a1a] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost border border-[#262626] px-3 py-1.5 rounded text-[11px] font-mono"
          >
            later
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canApply) return;
              if (mode === 'consolidated') {
                onApply({ mode: 'consolidated' });
                return;
              }
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
