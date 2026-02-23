import React from 'react';
import { FolderOpen, PlayCircle, AlertTriangle } from 'lucide-react';
import type { SourceStatus } from '../models/orchestrator';

interface WelcomeEmptyStateProps {
  basePath: string;
  sourceStatus: SourceStatus | null;
  onBrowseWorkspace: () => void;
  onSpawnAgent: () => void;
}

const WelcomeEmptyState: React.FC<WelcomeEmptyStateProps> = ({
  basePath,
  sourceStatus,
  onBrowseWorkspace,
  onSpawnAgent
}) => {
  const workspaceReady = !!basePath.trim() && !!sourceStatus?.valid;

  return (
    <div className="h-full app-panel rounded-xl overflow-auto">
      <div className="h-full w-full p-8 flex flex-col">
        <div className="max-w-2xl w-full mx-auto">
          <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] font-mono">Ready State</div>
          <h2 className="text-2xl text-white font-semibold mt-2">Start in two steps</h2>
          <p className="text-sm text-[#a1a1aa] mt-2">
            Pick a workspace, then spawn an agent. Everything else stays out of your way.
          </p>

          <div className="mt-6 app-panel rounded-lg p-5 border border-[#1f1f1f]">
            <div className="text-[10px] uppercase tracking-wider text-[#6b7280] font-mono mb-2">Current Workspace</div>
            <div className="text-xs text-[#d4d4d8] break-all">
              {basePath || 'No workspace selected yet.'}
            </div>
            <div className={`text-[11px] mt-2 ${workspaceReady ? 'text-emerald-300' : 'text-amber-300'}`}>
              {workspaceReady ? 'Workspace ready' : (sourceStatus?.error || 'Select a valid directory')}
            </div>
            <div className="mt-4 flex gap-2 flex-wrap">
              <button onClick={onBrowseWorkspace} className="btn-primary px-3 py-1.5 rounded text-[11px] uppercase tracking-wider flex items-center">
                <FolderOpen size={12} className="mr-1.5" />
                1) Choose Workspace
              </button>
              <button
                onClick={onSpawnAgent}
                disabled={!workspaceReady}
                className="btn-primary px-3 py-1.5 rounded text-[11px] uppercase tracking-wider flex items-center disabled:opacity-50"
              >
                <PlayCircle size={12} className="mr-1.5" />
                2) Spawn Agent
              </button>
            </div>
          </div>

          {!workspaceReady && (
            <div className="mt-5 rounded-lg border border-amber-900/70 bg-[#1d1607] px-4 py-3 text-amber-300 text-xs flex items-start">
              <AlertTriangle size={13} className="mr-2 mt-0.5 flex-shrink-0" />
              <span>Start by choosing a valid local project folder. Spawn and merge controls remain disabled until workspace validation passes.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WelcomeEmptyState;
