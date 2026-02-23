import { useEffect, useState } from 'react';
import { Settings, AlertTriangle, Plus } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import SettingsModal from './components/SettingsModal';
import DiffViewer from './components/DiffViewer';
import NewTaskModal from './components/NewTaskModal';
import ApprovalModal from './components/ApprovalModal';
import HandoverModal from './components/HandoverModal';
import TodoPanel from './components/TodoPanel';
import WelcomeEmptyState from './components/WelcomeEmptyState';
import { useOrchestrator } from './hooks/useOrchestrator';

const SIDEBAR_WIDTH_KEY = 'orchestrator.sidebar.width';
const PROJECT_HISTORY_KEY = 'orchestrator.project.paths';
const PROJECT_SELECT_ADD = '__add_project__';
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX_FALLBACK = 520;
const normalizeProjectPath = (value: string) => value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
const basename = (value: string) => {
  const normalized = normalizeProjectPath(value);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
};
const compactPath = (value: string, keepSegments = 3) => {
  const normalized = normalizeProjectPath(value);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= keepSegments) return normalized;
  return `.../${parts.slice(-keepSegments).join('/')}`;
};
const getDisplayDirectory = (projectRoot: string, currentPath: string) => {
  const root = normalizeProjectPath(projectRoot);
  const current = normalizeProjectPath(currentPath);
  if (!current) return '-';
  if (!root) return compactPath(current, 4);
  if (current === root) return './';
  if (current.startsWith(`${root}/`)) {
    const rel = current.slice(root.length + 1);
    const relParts = rel.split('/').filter(Boolean);
    if (relParts.length <= 4) return `./${rel}`;
    return `./.../${relParts.slice(-3).join('/')}`;
  }
  return compactPath(current, 4);
};
const formatProjectLabel = (path: string) => {
  const name = basename(path);
  const shortPath = compactPath(path, 3);
  if (!shortPath || shortPath === path) return name;
  return `${name} (${shortPath})`;
};

function App() {
  const {
    state: {
      activeTab,
      tabs,
      basePath,
      sourceStatus,
      context,
      envVars,
      defaultCommand,
      mcpServers,
      availableAgents,
      taskStatuses,
      taskTodos,
      taskUsage,
      collisions,
      pendingApproval,
      pendingApprovalCount
    },
    actions: {
      setActiveTab,
      switchProject,
      browseForBasePath,
      setContext,
      setEnvVars,
      setDefaultCommand,
      setMcpServers,
      createTask,
      markTaskBootstrapped,
      closeTaskById,
      handoverTask,
      approvePendingRequest,
      rejectPendingRequest
    }
  } = useOrchestrator();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [isHandoverOpen, setIsHandoverOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffTask, setDiffTask] = useState<string | null>(null);
  const [projectPaths, setProjectPaths] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(PROJECT_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return Array.from(new Set(parsed.map(value => (typeof value === 'string' ? normalizeProjectPath(value) : '')).filter(Boolean)));
    } catch {
      return [];
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 280;
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return 280;
    return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX_FALLBACK, parsed));
  });
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onGlobalShortcutNewTask(() => {
      setIsNewTaskOpen(true);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    setProjectPaths((prev) => {
      const next = new Set(prev);
      const normalizedBase = normalizeProjectPath(basePath);
      if (normalizedBase) next.add(normalizedBase);
      tabs.forEach((tab) => {
        const normalized = normalizeProjectPath(tab.basePath);
        if (normalized) next.add(normalized);
      });
      return Array.from(next);
    });
  }, [basePath, tabs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PROJECT_HISTORY_KEY, JSON.stringify(projectPaths));
  }, [projectPaths]);

  useEffect(() => {
    let cancelled = false;
    const loadFleetProjects = async () => {
      const res = await window.electronAPI.fleetListProjects();
      if (cancelled || !res.success || !Array.isArray(res.projects)) return;
      const paths = res.projects
        .map(project => (project && typeof project.basePath === 'string' ? normalizeProjectPath(project.basePath) : ''))
        .filter(Boolean);
      if (paths.length === 0) return;
      setProjectPaths(prev => Array.from(new Set([...prev, ...paths])));
    };
    void loadFleetProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSidebarResizing) return;

    const onMove = (event: MouseEvent) => {
      const maxByViewport = Math.max(SIDEBAR_MIN + 40, Math.min(SIDEBAR_MAX_FALLBACK, Math.floor(window.innerWidth * 0.45)));
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(maxByViewport, event.clientX)));
    };
    const onUp = () => {
      setIsSidebarResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isSidebarResizing]);

  const normalizedBasePath = normalizeProjectPath(basePath);
  const visibleTabs = normalizedBasePath
    ? tabs.filter(tab => normalizeProjectPath(tab.basePath) === normalizedBasePath)
    : tabs;
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (activeTab && visibleTabs.some(tab => tab.id === activeTab)) return;
    setActiveTab(visibleTabs[0].id);
  }, [visibleTabs, activeTab, setActiveTab]);

  const selectedTask = activeTab ? tabs.find(t => t.id === activeTab) : null;
  const activeTask = selectedTask && (!normalizedBasePath || normalizeProjectPath(selectedTask.basePath) === normalizedBasePath)
    ? selectedTask
    : null;
  const currentWorkingPath = activeTask?.worktreePath || basePath;
  const currentDirectoryLabel = getDisplayDirectory(basePath, currentWorkingPath);
  const projectNameLabel = basename(basePath || '');
  const activeTaskTodos = activeTask ? (taskTodos[activeTask.id] || []) : [];
  const activeTaskStatus = activeTask ? taskStatuses[activeTask.id] : undefined;
  const sortedProjectPaths = Array.from(new Set([basePath, ...projectPaths, ...tabs.map(tab => tab.basePath)]))
    .map(path => normalizeProjectPath(path))
    .filter(path => !!path)
    .sort((a, b) => a.localeCompare(b));
  const selectableProjectPaths = sortedProjectPaths;
  const workspaceReady = !!basePath.trim() && !!sourceStatus?.valid;
  const activeStateLabel = !activeTask
    ? 'idle'
    : !activeTaskStatus?.isReady
      ? 'provisioning'
      : activeTaskStatus?.isBlocked
        ? 'blocked'
        : activeTaskStatus?.hasCollision
          ? 'collision'
          : activeTaskStatus?.isDirty
            ? 'dirty'
            : 'clean';
  const activeStateClass = activeStateLabel === 'blocked'
    ? 'text-red-300 border-red-900/80 bg-[#240a0a]'
    : activeStateLabel === 'collision'
      ? 'text-amber-300 border-amber-900/80 bg-[#1f1607]'
      : activeStateLabel === 'dirty'
        ? 'text-blue-300 border-blue-900/80 bg-[#091424]'
        : activeStateLabel === 'provisioning'
          ? 'text-cyan-300 border-cyan-900/80 bg-[#07161b]'
          : 'text-emerald-300 border-emerald-900/80 bg-[#0b1a13]';

  const handleProjectSwitch = (path: string) => {
    const normalized = normalizeProjectPath(path);
    if (!normalized) return;
    switchProject(normalized);
  };

  const addProjectPath = (path: string, activate: boolean) => {
    const normalized = normalizeProjectPath(path);
    if (!normalized) return;
    setProjectPaths(prev => Array.from(new Set([...prev, normalized])));
    if (activate) {
      handleProjectSwitch(normalized);
    }
  };

  const handleBrowseProject = async (activate: boolean) => {
    const selectedPath = await window.electronAPI.openDirectoryDialog();
    if (!selectedPath) return;
    addProjectPath(selectedPath, activate);
  };

  const handleBrowseWorkspace = async () => {
    const selectedPath = await browseForBasePath();
    if (!selectedPath) return;
    const normalized = normalizeProjectPath(selectedPath);
    if (!normalized) return;
    setProjectPaths(prev => Array.from(new Set([...prev, normalized])));
  };

  const handleProjectSelect = (selection: string) => {
    if (selection === PROJECT_SELECT_ADD) {
      void handleBrowseProject(true);
      return;
    }
    handleProjectSwitch(selection);
  };

  const handleNewTaskSubmit = async (
    rawTaskName: string,
    agentCommand: string,
    prompt: string,
    capabilities: { autoMerge: boolean }
  ) => {
    if (!basePath || !sourceStatus?.valid) {
      alert('Please select a valid base project path first.');
      return;
    }

    const result = await createTask({
      rawTaskName,
      agentCommand,
      prompt,
      capabilities,
      activate: true
    });

    if (!result.success) {
      alert(`Git Worktree Setup Failed: ${result.error}`);
    }
  };

  const handleMergeClick = (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab?.worktreePath) return;
    setDiffTask(id);
    setDiffOpen(true);
  };

  const handleConfirmMerge = async () => {
    if (!diffTask) return;
    const res = await closeTaskById(diffTask, 'merge');
    if (!res.success) {
      alert(`Failed to merge worktree: ${res.error}`);
    }
  };

  const handleDeleteClick = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    const confirmed = window.confirm(`Delete agent branch "${tab.name}" and remove its worktree?`);
    if (!confirmed) return;

    const res = await closeTaskById(id, 'delete');
    if (!res.success) {
      alert(`Failed to delete worktree: ${res.error}`);
    }
  };

  const handleHandoverSubmit = (command: string, prompt: string) => {
    if (!activeTab) return;
    handoverTask(activeTab, command, prompt);
  };

  return (
    <div className="flex h-screen w-full relative overflow-hidden bg-[#000000]">
      <Sidebar
        tabs={visibleTabs.map(t => ({ id: t.id, name: t.name, agent: t.agent }))}
        activeTab={activeTab}
        statuses={taskStatuses}
        usageByTask={taskUsage}
        width={sidebarWidth}
        onSelectTab={setActiveTab}
        onDeleteTask={(taskId) => {
          void handleDeleteClick(taskId);
        }}
        onNewTask={() => {
          if (!workspaceReady) {
            void handleBrowseWorkspace();
            return;
          }
          setIsNewTaskOpen(true);
        }}
      />
      <div
        className="w-1.5 shrink-0 mx-1 my-2 rounded bg-transparent hover:bg-[#1f1f1f] active:bg-[#2d2d2d] cursor-col-resize"
        onMouseDown={(event) => {
          event.preventDefault();
          setIsSidebarResizing(true);
        }}
        aria-label="Resize sidebar"
        role="separator"
      />

      <main className="flex-1 min-w-0 flex flex-col h-full relative z-10 pt-2 pr-2 pb-2">
        {collisions.length > 0 && (
          <div className="absolute top-2 left-0 right-2 h-10 bg-[#1a0505] border border-red-900 rounded-lg flex items-center justify-center z-40 text-xs font-semibold text-red-400 shadow-sm">
            <AlertTriangle size={14} className="mr-2 text-red-500" />
            Collision Detected: Multiple agents modifying ({collisions.join(', ')}).
          </div>
        )}

        <div className={`app-panel rounded-xl px-3 py-2 z-30 ${collisions.length > 0 ? 'mt-12' : ''}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-[#6b7280] uppercase tracking-[0.14em] font-mono">Workspace</span>
              <select
                value={normalizeProjectPath(basePath) || selectableProjectPaths[0] || ''}
                onChange={(e) => handleProjectSelect(e.target.value)}
                className="input-stealth rounded px-2 py-1.5 text-xs font-mono max-w-[16rem]"
              >
                {selectableProjectPaths.length === 0 && <option value={basePath || ''}>{basePath || 'No project'}</option>}
                {selectableProjectPaths.map(path => (
                  <option key={path} value={path}>
                    {formatProjectLabel(path)}
                  </option>
                ))}
                <option value={PROJECT_SELECT_ADD}>+ Add workspace...</option>
              </select>
              <button
                onClick={() => {
                  void handleBrowseProject(true);
                }}
                className="w-7 h-7 rounded-md btn-ghost flex items-center justify-center"
                title="Add workspace"
              >
                <Plus size={13} />
              </button>
            </div>

            <div className="h-5 w-px bg-[#1f1f1f] shrink-0" />

            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-[#6b7280] uppercase tracking-[0.14em] font-mono">Current Directory</div>
              <div className="text-[13px] text-[#d4d4d8] font-mono truncate" title={currentWorkingPath}>
                {projectNameLabel ? `${projectNameLabel}: ` : ''}{currentDirectoryLabel}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] uppercase tracking-wider border rounded px-2 py-0.5 font-mono ${activeStateClass}`}>
                {activeStateLabel}
              </span>
              {pendingApprovalCount > 0 && (
                <span className="text-[10px] text-amber-300 border border-amber-900/80 bg-[#1f1607] rounded px-2 py-0.5 font-mono">
                  approvals {pendingApprovalCount}
                </span>
              )}
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-8 h-8 rounded-md btn-ghost flex items-center justify-center"
                title="Workspace Settings"
              >
                <Settings size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 mt-2 relative z-20 overflow-hidden">
          {activeTask ? (
            <div className="h-full flex gap-2">
              <div className="flex-1 min-w-0 app-panel rounded-xl overflow-hidden">
                <div className="h-full flex flex-col p-1 relative z-10 bg-[#000000]">
                  {activeTask.worktreePath ? (
                      <Terminal
                        taskId={activeTask.id}
                        cwd={activeTask.worktreePath}
                        agentCommand={activeTask.agent}
                        context={context}
                        envVars={envVars}
                        prompt={activeTask.prompt}
                        shouldBootstrap={activeTask.hasBootstrapped === false}
                        onBootstrapped={() => {
                          markTaskBootstrapped(activeTask.id);
                        }}
                        capabilities={activeTask.capabilities}
                        taskUsage={taskUsage[activeTask.id]}
                        mcpServers={mcpServers}
                        isBlocked={taskStatuses[activeTask.id]?.isBlocked}
                        blockedReason={taskStatuses[activeTask.id]?.blockedReason}
                        onHandover={() => {
                          setActiveTab(activeTask.id);
                          setIsHandoverOpen(true);
                        }}
                        onMerge={() => {
                          handleMergeClick(activeTask.id);
                        }}
                        onDelete={() => {
                          void handleDeleteClick(activeTask.id);
                        }}
                      />
                    ) : activeTask ? (
                      <div className="h-full w-full flex flex-col items-center justify-center font-mono">
                        <div className="mb-3 text-white text-[11px] uppercase tracking-widest">Initializing Environment</div>
                        <div className="text-[#525252] text-[10px]">{activeTask.name}</div>
                      </div>
                    ) : null}
                </div>
              </div>

              {activeTaskTodos.length > 0 && (
                <div className="hidden xl:block w-72 max-w-[32%] app-panel rounded-xl overflow-hidden">
                  <TodoPanel todos={activeTaskTodos} />
                </div>
              )}
            </div>
          ) : (
            <WelcomeEmptyState
              basePath={basePath}
              sourceStatus={sourceStatus}
              onBrowseWorkspace={() => {
                void handleBrowseWorkspace();
              }}
              onSpawnAgent={() => {
                if (!workspaceReady) {
                  void handleBrowseWorkspace();
                  return;
                }
                setIsNewTaskOpen(true);
              }}
            />
          )}
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        context={context}
        setContext={setContext}
        envVars={envVars}
        setEnvVars={setEnvVars}
        defaultCommand={defaultCommand}
        setDefaultCommand={setDefaultCommand}
        mcpServers={mcpServers}
        setMcpServers={setMcpServers}
        availableAgents={availableAgents}
      />

      {diffOpen && diffTask && (
        <DiffViewer
          isOpen={diffOpen}
          onClose={() => setDiffOpen(false)}
          onConfirm={() => {
            setDiffOpen(false);
            void handleConfirmMerge();
          }}
          worktreePath={tabs.find(t => t.id === diffTask)?.worktreePath || ''}
        />
      )}

      <NewTaskModal
        isOpen={isNewTaskOpen}
        onClose={() => setIsNewTaskOpen(false)}
        projectName={basePath.split('/').pop() || 'proj'}
        onSubmit={(rawTaskName, agentCommand, prompt, capabilities) => {
          void handleNewTaskSubmit(rawTaskName, agentCommand, prompt, capabilities);
        }}
        defaultCommand={defaultCommand}
        availableAgents={availableAgents}
      />

      <ApprovalModal
        isOpen={!!pendingApproval}
        request={pendingApproval}
        taskName={tabs.find(t => t.id === pendingApproval?.taskId)?.name || 'unknown'}
        projectPath={tabs.find(t => t.id === pendingApproval?.taskId)?.basePath || pendingApproval?.projectPath || ''}
        queueCount={pendingApprovalCount}
        onApprove={() => {
          void approvePendingRequest();
        }}
        onReject={rejectPendingRequest}
      />

      <HandoverModal
        isOpen={isHandoverOpen}
        onClose={() => setIsHandoverOpen(false)}
        onSubmit={handleHandoverSubmit}
        defaultCommand={defaultCommand}
        availableAgents={availableAgents}
      />
    </div>
  );
}

export default App;
