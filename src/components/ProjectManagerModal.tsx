import React, { useMemo, useState } from 'react';
import { FolderOpen, FolderTree, Plus, PlayCircle, X } from 'lucide-react';
import type { TaskTab } from '../models/orchestrator';

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProjectPath: string;
  projectPaths: string[];
  tabs: TaskTab[];
  onSwitchProject: (projectPath: string) => void;
  onCreateProjectPath: (projectPath: string, activate: boolean) => void;
  onBrowseProject: (activate: boolean) => Promise<void>;
}

const normalizePath = (value: string) => value.trim().replace(/\\/g, '/').replace(/\/+$/, '');

const basename = (value: string) => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
};

const compactPath = (value: string, keepSegments = 4) => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= keepSegments) return normalized;
  return `.../${parts.slice(-keepSegments).join('/')}`;
};

const ProjectManagerModal: React.FC<ProjectManagerModalProps> = ({
  isOpen,
  onClose,
  currentProjectPath,
  projectPaths,
  tabs,
  onSwitchProject,
  onCreateProjectPath,
  onBrowseProject
}) => {
  const [newProjectPath, setNewProjectPath] = useState('');

  const sortedProjects = useMemo(() => {
    const knownWorktreePaths = new Set(
      tabs
        .map(tab => normalizePath(tab.worktreePath || ''))
        .filter(Boolean)
    );
    return Array.from(
      new Set(projectPaths.map(path => normalizePath(path)).filter(path => !!path && (!knownWorktreePaths.has(path) || path === normalizePath(currentProjectPath))))
    ).sort((a, b) => a.localeCompare(b));
  }, [projectPaths, tabs, currentProjectPath]);

  if (!isOpen) return null;

  const renderProjectRow = (projectPath: string) => {
    const liveSessions = tabs.filter(tab => normalizePath(tab.basePath) === projectPath).length;
    const isCurrent = normalizePath(currentProjectPath) === projectPath;

    return (
      <div key={projectPath} className="rounded-lg border border-[#1f1f1f] bg-[#090909] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <FolderTree size={13} className="text-[#9ca3af] shrink-0" />
              <div className="text-sm text-white truncate">{basename(projectPath)}</div>
              {isCurrent && <span className="text-[10px] uppercase tracking-wider font-mono text-emerald-300">current</span>}
            </div>
            <div className="text-[10px] text-[#6b7280] font-mono truncate mt-1" title={projectPath}>
              {compactPath(projectPath)}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                onSwitchProject(projectPath);
                onClose();
              }}
              className="btn-primary px-2 py-1 rounded text-[10px] uppercase tracking-wider flex items-center"
            >
              <PlayCircle size={11} className="mr-1" />
              switch
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-[10px] font-mono">
          <div className="app-panel rounded p-2">
            <div className="text-[#6b7280]">live sessions</div>
            <div className="text-white">{liveSessions}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-6xl border border-[#1a1a1a] h-[86vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] font-mono">Workspace</div>
            <h2 className="text-lg text-white font-semibold mt-1">Projects</h2>
          </div>
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 rounded text-[11px] uppercase tracking-wider flex items-center">
            <X size={12} className="mr-1.5" />
            close
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[#1a1a1a]">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newProjectPath}
              onChange={(event) => setNewProjectPath(event.target.value)}
              placeholder="/absolute/path/to/project"
              className="input-stealth px-3 py-2 rounded text-xs font-mono min-w-[20rem] flex-1"
            />
            <button
              onClick={() => {
                const normalized = normalizePath(newProjectPath);
                if (!normalized) return;
                onCreateProjectPath(normalized, false);
                setNewProjectPath('');
              }}
              className="btn-ghost px-3 py-2 rounded text-[11px] uppercase tracking-wider flex items-center"
            >
              <Plus size={12} className="mr-1.5" />
              add
            </button>
            <button
              onClick={() => {
                void onBrowseProject(true).then(() => onClose());
              }}
              className="btn-primary px-3 py-2 rounded text-[11px] uppercase tracking-wider flex items-center"
            >
              <FolderOpen size={12} className="mr-1.5" />
              browse & switch
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[#9ca3af] font-mono mb-2">Available Projects</div>
          <div className="space-y-2">
            {sortedProjects.length === 0 && (
              <div className="text-xs font-mono text-[#6b7280] px-2 py-3 border border-[#1a1a1a] rounded">
                No projects yet. Add one above to start.
              </div>
            )}
            {sortedProjects.map(projectPath => renderProjectRow(projectPath))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectManagerModal;
