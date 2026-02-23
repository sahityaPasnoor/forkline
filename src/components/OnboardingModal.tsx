import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Compass, FolderOpen, Rocket, X } from 'lucide-react';
import type { SourceStatus } from '../models/orchestrator';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  basePath: string;
  sourceStatus: SourceStatus | null;
  tabsCount: number;
  onBrowseWorkspace: () => void;
  onSpawnAgent: () => void;
}

const stepTitle = ['Connect Workspace', 'Spawn First Agent'];

const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  basePath,
  sourceStatus,
  tabsCount,
  onBrowseWorkspace,
  onSpawnAgent
}) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
  }, [isOpen]);

  const workspaceReady = !!basePath.trim() && !!sourceStatus?.valid;
  const hasSession = tabsCount > 0;

  const canContinue = useMemo(() => {
    if (step === 0) return workspaceReady;
    return true;
  }, [step, workspaceReady]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-3xl border border-[#1a1a1a] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] bg-[#050505] flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#6b7280] font-mono">Getting Started</div>
            <h2 className="text-white text-lg font-semibold mt-1 truncate flex items-center">
              <Compass size={16} className="mr-2" />
              {stepTitle[step]}
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost w-8 h-8 rounded flex items-center justify-center" title="Close onboarding">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-[#1a1a1a]">
          <div className="w-full h-1 bg-[#111111] rounded overflow-hidden">
            <div className="h-full bg-white transition-all" style={{ width: `${((step + 1) / 2) * 100}%` }} />
          </div>
          <div className="text-[10px] text-[#71717a] font-mono mt-2 uppercase tracking-wider">
            Step {step + 1} of 2
          </div>
        </div>

        <div className="p-5 bg-[#000000] min-h-[21rem]">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-[#d4d4d8]">
                Choose a project directory. This becomes your base repo for worktrees and agent sessions.
              </p>
              <div className="app-panel rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-mono mb-2">Current Workspace</div>
                <div className="text-sm text-white font-mono break-all">{basePath || 'Not selected'}</div>
                <div className="mt-2 text-xs text-[#9ca3af]">
                  {sourceStatus?.valid
                    ? `Ready${sourceStatus.type ? ` • ${sourceStatus.type}` : ''}`
                    : (sourceStatus?.error || 'Select a valid local directory')}
                </div>
              </div>
              <button onClick={onBrowseWorkspace} className="btn-primary px-4 py-2 rounded text-xs uppercase tracking-wider flex items-center">
                <FolderOpen size={13} className="mr-2" />
                Choose Workspace
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-[#d4d4d8]">
                Start your first task session. You can spawn one agent now and add more in parallel afterward.
              </p>
              <div className="app-panel rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-mono mb-2">Session Status</div>
                <div className="text-sm text-white font-mono">
                  {hasSession ? `${tabsCount} active session${tabsCount > 1 ? 's' : ''}` : 'No sessions yet'}
                </div>
              </div>
              <button
                onClick={onSpawnAgent}
                disabled={!workspaceReady}
                className="btn-primary px-4 py-2 rounded text-xs uppercase tracking-wider flex items-center disabled:opacity-50"
              >
                <Rocket size={13} className="mr-2" />
                Spawn Agent
              </button>
              {hasSession && (
                <div className="text-emerald-300 text-xs font-mono flex items-center">
                  <CheckCircle2 size={12} className="mr-1.5" />
                  First session started successfully.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#1a1a1a] bg-[#050505] flex items-center justify-between">
          <button
            onClick={() => setStep(prev => Math.max(0, prev - 1))}
            disabled={step === 0}
            className="btn-ghost px-3 py-2 rounded text-xs uppercase tracking-wider disabled:opacity-40 flex items-center"
          >
            <ChevronLeft size={12} className="mr-1.5" />
            Back
          </button>

          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-ghost px-3 py-2 rounded text-xs uppercase tracking-wider">
              Skip
            </button>
            {step < 1 ? (
              <button
                onClick={() => setStep(prev => Math.min(1, prev + 1))}
                disabled={!canContinue}
                className="btn-primary px-3 py-2 rounded text-xs uppercase tracking-wider disabled:opacity-50 flex items-center"
              >
                Continue
                <ChevronRight size={12} className="ml-1.5" />
              </button>
            ) : (
              <button
                onClick={onComplete}
                className="btn-primary px-3 py-2 rounded text-xs uppercase tracking-wider"
              >
                Finish Setup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
