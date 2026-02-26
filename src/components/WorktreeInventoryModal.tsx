import React, { useEffect, useMemo, useState } from 'react';
import { FolderTree, GitBranch, Activity, Trash2 } from 'lucide-react';
import type { TaskStatus, TaskTab } from '../models/orchestrator';

interface WorktreeInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPaths: string[];
  tabs: TaskTab[];
  statuses: Record<string, TaskStatus>;
  onOpenSession: (taskId: string) => void;
  onOpenWorktree: (projectPath: string, worktreePath: string, branchName?: string | null) => void;
  onDeleteWorktree: (projectPath: string, worktreePath: string, branchName?: string | null) => void;
}

interface WorktreeEntry {
  path: string;
  branchName?: string | null;
  branchRef?: string;
}

interface ProjectInventory {
  loading: boolean;
  error?: string;
  worktrees: WorktreeEntry[];
}

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

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

const statusLabel = (status?: TaskStatus) => {
  if (!status) return 'unknown';
  if (!status.isReady) return 'provisioning';
  if (status.isBlocked) return 'blocked';
  if (status.hasCollision) return 'collision';
  if (status.isDirty) return 'dirty';
  return 'clean';
};

const WorktreeInventoryModal: React.FC<WorktreeInventoryModalProps> = ({
  isOpen,
  onClose,
  projectPaths,
  tabs,
  statuses,
  onOpenSession,
  onOpenWorktree,
  onDeleteWorktree
}) => {
  const [inventory, setInventory] = useState<Record<string, ProjectInventory>>({});

  const uniqueProjects = useMemo(() => {
    return Array.from(new Set(projectPaths.map(p => p.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [projectPaths]);
  const uniqueProjectsKey = useMemo(() => uniqueProjects.join('\n'), [uniqueProjects]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const projectsToLoad = uniqueProjects;

    if (projectsToLoad.length === 0) {
      setInventory({});
      return;
    }

    const load = async () => {
      const seed: Record<string, ProjectInventory> = {};
      projectsToLoad.forEach((projectPath) => {
        seed[projectPath] = { loading: true, worktrees: [] };
      });
      setInventory(seed);

      const results = await Promise.all(
        projectsToLoad.map(async (projectPath) => {
          const res = await window.electronAPI.listWorktrees(projectPath);
          if (!res.success) {
            return {
              projectPath,
              data: { loading: false, worktrees: [], error: res.error || 'Failed to list worktrees' } as ProjectInventory
            };
          }
          return {
            projectPath,
            data: { loading: false, worktrees: res.worktrees || [] } as ProjectInventory
          };
        })
      );

      if (cancelled) return;
      setInventory(prev => {
        const next = { ...prev };
        results.forEach(({ projectPath, data }) => {
          next[projectPath] = data;
        });
        return next;
      });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, uniqueProjectsKey]);

  if (!isOpen) return null;

  const tabsByWorktreePath = new Map<string, TaskTab>();
  tabs.forEach((tab) => {
    if (!tab.worktreePath) return;
    tabsByWorktreePath.set(normalizePath(tab.worktreePath), tab);
  });

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-7xl border border-[#1a1a1a] h-[86vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] font-mono">Workspace</div>
            <h2 className="text-lg text-white font-semibold mt-1 truncate flex items-center">
              <FolderTree size={18} className="mr-2 text-white" />
              Worktrees
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 rounded text-[11px] uppercase tracking-wider">
            close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {uniqueProjects.length === 0 && (
            <div className="h-full flex items-center justify-center text-[#737373] font-mono text-xs">
              No projects discovered yet.
            </div>
          )}

          {uniqueProjects.map((projectPath) => {
            const projectData = inventory[projectPath];
            const loading = projectData?.loading;
            const worktrees = projectData?.worktrees || [];
            const error = projectData?.error;

            return (
              <section key={projectPath} className="border border-[#1f1f1f] rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-[#090909] border-b border-[#1a1a1a] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium truncate">{basename(projectPath)}</div>
                    <div className="text-[10px] text-[#6b7280] font-mono truncate" title={projectPath}>{compactPath(projectPath)}</div>
                  </div>
                  <div className="text-[10px] text-[#9ca3af] font-mono uppercase tracking-wider">
                    {loading ? 'loading...' : `${worktrees.length} worktrees`}
                  </div>
                </div>

                {error && (
                  <div className="px-4 py-3 text-[11px] text-red-300 bg-[#140808] border-b border-[#1a1a1a]">{error}</div>
                )}

                {!loading && worktrees.length === 0 && !error && (
                  <div className="px-4 py-4 text-[11px] text-[#737373] font-mono">No active worktrees for this project.</div>
                )}

                {!loading && worktrees.length > 0 && (
                  <div className="divide-y divide-[#141414]">
                    {worktrees.map((worktree) => {
                      const tab = tabsByWorktreePath.get(normalizePath(worktree.path));
                      const tabStatus = tab ? statuses[tab.id] : undefined;
                      return (
                        <div key={worktree.path} className="px-4 py-3 flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center min-w-0 gap-2">
                              <GitBranch size={12} className="text-[#9ca3af] flex-shrink-0" />
                              <span className="text-[12px] text-white font-mono truncate">
                                {worktree.branchName || '(detached)'}
                              </span>
                              <span className="text-[10px] text-[#6b7280] font-mono truncate">{basename(worktree.path)}</span>
                            </div>
                            <div className="text-[10px] text-[#6b7280] font-mono truncate mt-1" title={worktree.path}>{compactPath(worktree.path, 5)}</div>
                          </div>

                          <div className="flex items-center gap-2">
                            {tab ? (
                              <>
                                <div className="text-[10px] font-mono uppercase tracking-wider text-[#9ca3af] flex items-center">
                                  <Activity size={11} className="mr-1 text-[#9ca3af]" />
                                  {statusLabel(tabStatus)}
                                </div>
                                <button
                                  onClick={() => {
                                    onOpenSession(tab.id);
                                    onClose();
                                  }}
                                  className="btn-primary px-3 py-1 rounded text-[10px] uppercase tracking-wider"
                                >
                                  open session
                                </button>
                                <button
                                  onClick={() => onDeleteWorktree(projectPath, worktree.path, worktree.branchName)}
                                  className="btn-danger px-3 py-1 rounded text-[10px] uppercase tracking-wider flex items-center"
                                  title="Delete this worktree and branch"
                                >
                                  <Trash2 size={10} className="mr-1" />
                                  delete
                                </button>
                              </>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    onOpenWorktree(projectPath, worktree.path, worktree.branchName);
                                    onClose();
                                  }}
                                  className="btn-ghost px-3 py-1 rounded text-[10px] uppercase tracking-wider"
                                  title="Attach this existing worktree to a tab session"
                                >
                                  open terminal
                                </button>
                                <button
                                  onClick={() => onDeleteWorktree(projectPath, worktree.path, worktree.branchName)}
                                  className="btn-danger px-3 py-1 rounded text-[10px] uppercase tracking-wider flex items-center"
                                  title="Delete this worktree and branch"
                                >
                                  <Trash2 size={10} className="mr-1" />
                                  delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WorktreeInventoryModal;
