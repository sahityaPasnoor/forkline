import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, AlertTriangle, FolderTree, GitBranch, Plus } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import SettingsModal from './components/SettingsModal';
import DiffViewer from './components/DiffViewer';
import NewTaskModal from './components/NewTaskModal';
import ApprovalModal from './components/ApprovalModal';
import HandoverModal from './components/HandoverModal';
import TodoPanel from './components/TodoPanel';
import WelcomeEmptyState from './components/WelcomeEmptyState';
import ProjectManagerModal from './components/ProjectManagerModal';
import WorktreeInventoryModal from './components/WorktreeInventoryModal';
import LivingSpecModal from './components/LivingSpecModal';
import FlightDeckModal from './components/FlightDeckModal';
import { useOrchestrator } from './hooks/useOrchestrator';
import { APP_THEMES, DEFAULT_THEME_ID } from './lib/themes';

const SIDEBAR_WIDTH_KEY = 'orchestrator.sidebar.width';
const PROJECT_HISTORY_KEY = 'orchestrator.project.paths';
const THEME_KEY = 'orchestrator.theme';
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
const buildProjectLabels = (paths: string[]) => {
  const counts = new Map<string, number>();
  paths.forEach((path) => {
    const key = basename(path) || path;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const labels: Record<string, string> = {};
  paths.forEach((path) => {
    const key = basename(path) || path;
    const hasDuplicateName = (counts.get(key) || 0) > 1;
    labels[path] = hasDuplicateName ? `${key} · ${compactPath(path, 2)}` : key;
  });
  return labels;
};
const isLikelyWorktreePath = (value: string) => /-worktrees\/[^/]+$/i.test(normalizeProjectPath(value));
const VALID_THEME_IDS = new Set(APP_THEMES.map(theme => theme.id));

interface WorkspaceInfo {
  isRepo: boolean;
  currentBranch: string | null;
  defaultBranch: string | null;
}

interface FlightDeckSession {
  taskId: string;
  running: boolean;
  isBlocked: boolean;
  exitCode: number | null;
  signal?: number;
  tailPreview?: string[];
  resource?: { taskId: string; sessionId: string; port: number; host: string } | null;
  sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
}

interface CommandPaletteItem {
  id: string;
  label: string;
  type: 'project' | 'task';
  projectPath: string;
  taskId?: string;
}

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
      mcpEnabled,
      packageStoreStrategy,
      dependencyCloneMode,
      pnpmStorePath,
      sharedCacheRoot,
      pnpmAutoInstall,
      sandboxMode,
      networkGuard,
      availableAgents,
      taskStatuses,
      taskTodos,
      taskUsage,
      collisions,
      pendingApproval,
      pendingApprovalCount,
      livingSpecPreferences,
      livingSpecSelectionPrompt
    },
    actions: {
      setActiveTab,
      switchProject,
      browseForBasePath,
      setContext,
      setEnvVars,
      setDefaultCommand,
      setMcpServers,
      setMcpEnabled,
      setPackageStoreStrategy,
      setDependencyCloneMode,
      setPnpmStorePath,
      setSharedCacheRoot,
      setPnpmAutoInstall,
      setSandboxMode,
      setNetworkGuard,
      createTask,
      markTaskBootstrapped,
      closeTaskById,
      handoverTask,
      restoreExistingWorktree,
      approvePendingRequest,
      rejectPendingRequest,
      resolveLivingSpecSelectionPrompt,
      dismissLivingSpecSelectionPrompt
    }
  } = useOrchestrator();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [isHandoverOpen, setIsHandoverOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [isWorktreeInventoryOpen, setIsWorktreeInventoryOpen] = useState(false);
  const [isFlightDeckOpen, setIsFlightDeckOpen] = useState(false);
  const [flightDeckSessions, setFlightDeckSessions] = useState<FlightDeckSession[]>([]);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0);
  const commandPaletteItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffTask, setDiffTask] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME_ID;
    const stored = window.localStorage.getItem(THEME_KEY) || '';
    return VALID_THEME_IDS.has(stored) ? stored : DEFAULT_THEME_ID;
  });
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo>({
    isRepo: false,
    currentBranch: null,
    defaultBranch: null
  });
  const [workspaceBranches, setWorkspaceBranches] = useState<string[]>([]);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
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
    const clampSidebarForViewport = () => {
      const maxByViewport = Math.max(SIDEBAR_MIN + 24, Math.min(SIDEBAR_MAX_FALLBACK, Math.floor(window.innerWidth * 0.45)));
      setSidebarWidth((prev) => Math.max(SIDEBAR_MIN, Math.min(maxByViewport, prev)));
    };
    clampSidebarForViewport();
    window.addEventListener('resize', clampSidebarForViewport);
    return () => {
      window.removeEventListener('resize', clampSidebarForViewport);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resolvedTheme = VALID_THEME_IDS.has(theme) ? theme : DEFAULT_THEME_ID;
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    window.localStorage.setItem(THEME_KEY, resolvedTheme);
  }, [theme]);

  useEffect(() => {
    if (!operationNotice) return;
    const timeoutId = window.setTimeout(() => {
      setOperationNotice(null);
    }, 3200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [operationNotice]);

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

  useEffect(() => {
    let cancelled = false;
    const loadWorkspaceInfo = async () => {
      const normalized = normalizeProjectPath(basePath);
      if (!normalized) {
        setWorkspaceInfo({ isRepo: false, currentBranch: null, defaultBranch: null });
        setWorkspaceBranches([]);
        return;
      }

      const [info, branchesRes] = await Promise.all([
        window.electronAPI.getWorkspaceInfo(normalized),
        window.electronAPI.listBranches(normalized)
      ]);
      if (cancelled || !info.success) {
        setWorkspaceInfo({ isRepo: false, currentBranch: null, defaultBranch: null });
        setWorkspaceBranches([]);
        return;
      }
      setWorkspaceInfo({
        isRepo: !!info.isRepo,
        currentBranch: info.currentBranch ?? null,
        defaultBranch: info.defaultBranch ?? null
      });
      const branches = Array.isArray(branchesRes.branches) ? branchesRes.branches : [];
      setWorkspaceBranches(branches);
    };
    void loadWorkspaceInfo();
    return () => {
      cancelled = true;
    };
  }, [basePath]);

  useEffect(() => {
    let cancelled = false;
    const pollSessions = async () => {
      const res = await window.electronAPI.listPtySessions();
      if (cancelled || !res.success || !Array.isArray(res.sessions)) return;
      setFlightDeckSessions(res.sessions.map((session) => ({
        taskId: session.taskId,
        running: !!session.running,
        isBlocked: !!session.isBlocked,
        exitCode: typeof session.exitCode === 'number' || session.exitCode === null ? session.exitCode : null,
        signal: session.signal,
        tailPreview: Array.isArray(session.tailPreview) ? session.tailPreview : [],
        resource: session.resource || null,
        sandbox: session.sandbox || null
      })));
    };
    void pollSessions();
    const timer = window.setInterval(() => {
      void pollSessions();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isOpenPalette = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isOpenPalette) {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }
      if (event.key === 'Escape' && isCommandPaletteOpen) {
        setIsCommandPaletteOpen(false);
        setCommandPaletteQuery('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCommandPaletteOpen]);

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
  const activeTaskTodos = activeTask ? (taskTodos[activeTask.id] || []) : [];
  const activeTaskStatus = activeTask ? taskStatuses[activeTask.id] : undefined;
  const activeTaskLivingSpecPreference = activeTask
    ? livingSpecPreferences[normalizeProjectPath(activeTask.basePath)]
    : undefined;
  const parentBranch = workspaceInfo.defaultBranch || workspaceInfo.currentBranch || 'main';
  const selectableBranches = Array.from(new Set([parentBranch, ...workspaceBranches].filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const sortedProjectPaths = Array.from(new Set([basePath, ...projectPaths, ...tabs.map(tab => tab.basePath)]))
    .map(path => normalizeProjectPath(path))
    .filter(path => !!path && !isLikelyWorktreePath(path))
    .sort((a, b) => a.localeCompare(b));
  const selectableProjectPaths = sortedProjectPaths;
  const projectLabelByPath = buildProjectLabels(selectableProjectPaths);
  const workspaceReady = !!basePath.trim() && !!sourceStatus?.valid;
  const activeStateLabel = !activeTask
    ? 'standby'
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
      : activeStateLabel === 'standby'
        ? 'text-zinc-300 border-zinc-800 bg-[#121212]'
        : 'text-emerald-300 border-emerald-900/80 bg-[#0b1a13]';
  const headerOffsetClass = collisions.length > 0
    ? (operationNotice ? 'mt-20' : 'mt-12')
    : (operationNotice ? 'mt-10' : '');
  const activeSession = activeTask
    ? flightDeckSessions.find((session) => session.taskId === activeTask.id)
    : null;
  const briefingSummary = activeTask?.prompt?.trim()
    ? activeTask.prompt.trim().split('\n')[0].slice(0, 220)
    : 'No explicit task prompt provided.';
  const briefingTail = activeSession?.tailPreview?.length ? activeSession.tailPreview : ['No recent output captured yet.'];
  const activeProjectLabel = normalizedBasePath
    ? (projectLabelByPath[normalizedBasePath] || basename(normalizedBasePath))
    : 'No project selected';
  const paletteItems: CommandPaletteItem[] = [
    ...selectableProjectPaths.map((projectPath) => ({
      id: `project:${projectPath}`,
      label: `Project: ${projectLabelByPath[projectPath] || formatProjectLabel(projectPath)}`,
      type: 'project' as const,
      projectPath
    })),
    ...tabs.map((tab) => ({
      id: `task:${tab.id}`,
      label: `Task: ${tab.name} (${basename(tab.basePath)})`,
      type: 'task' as const,
      projectPath: tab.basePath,
      taskId: tab.id
    }))
  ];
  const normalizedPaletteQuery = commandPaletteQuery.trim().toLowerCase();
  const filteredPaletteItems = normalizedPaletteQuery
    ? paletteItems.filter((item) => item.label.toLowerCase().includes(normalizedPaletteQuery))
    : paletteItems;
  const visiblePaletteItems = filteredPaletteItems.slice(0, 80);
  const projectStateBadge = (projectPath: string) => {
    const projectTabs = tabs.filter((tab) => normalizeProjectPath(tab.basePath) === normalizeProjectPath(projectPath));
    const hasBlocked = projectTabs.some((tab) => taskStatuses[tab.id]?.isBlocked);
    if (hasBlocked) return 'bg-red-500';
    const hasCollision = projectTabs.some((tab) => taskStatuses[tab.id]?.hasCollision);
    if (hasCollision) return 'bg-amber-400';
    const hasRunning = projectTabs.some((tab) => taskStatuses[tab.id]?.isReady);
    return hasRunning ? 'bg-emerald-400' : 'bg-[#2f2f2f]';
  };

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

  const removeProjectPath = (path: string) => {
    const normalized = normalizeProjectPath(path);
    if (!normalized) return;
    if (normalized === normalizedBasePath) {
      setOperationNotice('Current workspace cannot be removed.');
      return;
    }
    setProjectPaths(prev => prev.filter(entry => normalizeProjectPath(entry) !== normalized));
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

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    setCommandPaletteActiveIndex(0);
    commandPaletteItemRefs.current = [];
  }, []);

  const handleCommandPaletteSelect = (item: CommandPaletteItem) => {
    if (item.type === 'project') {
      handleProjectSwitch(item.projectPath);
      closeCommandPalette();
      return;
    }
    if (item.taskId) {
      handleProjectSwitch(item.projectPath);
      setActiveTab(item.taskId);
    }
    closeCommandPalette();
  };

  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    setCommandPaletteActiveIndex(0);
    commandPaletteItemRefs.current = [];
  }, [isCommandPaletteOpen, commandPaletteQuery]);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    if (visiblePaletteItems.length === 0) {
      if (commandPaletteActiveIndex !== 0) setCommandPaletteActiveIndex(0);
      return;
    }
    if (commandPaletteActiveIndex >= visiblePaletteItems.length) {
      setCommandPaletteActiveIndex(visiblePaletteItems.length - 1);
    }
  }, [commandPaletteActiveIndex, isCommandPaletteOpen, visiblePaletteItems.length]);

  useEffect(() => {
    if (!isCommandPaletteOpen || visiblePaletteItems.length === 0) return;
    const activeRow = commandPaletteItemRefs.current[commandPaletteActiveIndex];
    if (!activeRow) return;
    activeRow.scrollIntoView({ block: 'nearest' });
  }, [commandPaletteActiveIndex, isCommandPaletteOpen, visiblePaletteItems.length]);

  const handleNewTaskSubmit = async (
    rawTaskName: string,
    agentCommand: string,
    prompt: string,
    baseBranch: string,
    capabilities: { autoMerge: boolean },
    options?: { createBaseBranchIfMissing?: boolean }
  ) => {
    if (!basePath || !sourceStatus?.valid) {
      alert('Please select a valid base project path first.');
      return;
    }

    const result = await createTask({
      rawTaskName,
      agentCommand,
      prompt,
      baseBranch,
      createBaseBranchIfMissing: options?.createBaseBranchIfMissing === true,
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
    const tab = tabs.find(t => t.id === diffTask);
    const res = await closeTaskById(diffTask, 'merge');
    if (!res.success) {
      alert(`Failed to merge worktree: ${res.error}`);
      return;
    }
    setOperationNotice(tab ? `Merged ${tab.name} into ${parentBranch}.` : 'Merge completed.');
  };

  const handleDeleteClick = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return false;

    const confirmed = window.confirm(`Delete agent branch "${tab.name}" and remove its worktree?`);
    if (!confirmed) return false;

    const res = await closeTaskById(id, 'delete');
    if (!res.success) {
      alert(`Failed to delete worktree: ${res.error}`);
      return false;
    }
    setOperationNotice(`Deleted worktree for ${tab.name}.`);
    return true;
  };

  const handleDeleteWorktree = async (projectPath: string, worktreePath: string, branchName?: string | null) => {
    const normalizedWorktreePath = normalizeProjectPath(worktreePath);
    const matchingTab = tabs.find(tab => normalizeProjectPath(tab.worktreePath || '') === normalizedWorktreePath);
    if (matchingTab) {
      const deleted = await handleDeleteClick(matchingTab.id);
      if (deleted) {
        setIsWorktreeInventoryOpen(false);
      }
      return;
    }

    const resolvedBranch = (branchName || '').trim() || basename(normalizedWorktreePath);
    const confirmed = window.confirm(`Delete worktree "${resolvedBranch}" and remove the branch?`);
    if (!confirmed) return;
    const res = await window.electronAPI.removeWorktree(projectPath, resolvedBranch, worktreePath, true);
    if (!res.success) {
      alert(`Failed to delete worktree: ${res.error}`);
      return;
    }
    setOperationNotice(`Deleted worktree ${resolvedBranch}.`);
    setIsWorktreeInventoryOpen(false);
  };

  const handleHandoverSubmit = (command: string, prompt: string) => {
    if (!activeTab) return;
    handoverTask(activeTab, command, prompt);
  };

  return (
    <div className="flex h-screen w-full relative overflow-hidden">
      <aside className="w-14 shrink-0 border-r border-[#151515] bg-[#030303] flex flex-col items-center py-3 gap-2">
        {selectableProjectPaths.map((projectPath) => {
          const normalized = normalizeProjectPath(projectPath);
          const isActiveProject = normalized === normalizeProjectPath(basePath);
          const initial = basename(projectPath).slice(0, 1).toUpperCase();
          return (
            <button
              key={projectPath}
              type="button"
              onClick={() => handleProjectSwitch(projectPath)}
              className={`relative w-9 h-9 rounded-lg border text-[11px] font-mono flex items-center justify-center transition-colors ${
                isActiveProject
                  ? 'border-white text-white bg-[#111111]'
                  : 'border-[#1f1f1f] text-[#a3a3a3] bg-[#050505] hover:border-[#3a3a3a] hover:text-white'
              }`}
              title={formatProjectLabel(projectPath)}
            >
              {initial || '#'}
              <span className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border border-[#0a0a0a] ${projectStateBadge(projectPath)}`} />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            void handleBrowseProject(true);
          }}
          className="mt-1 w-9 h-9 rounded-lg border border-dashed border-[#2d2d2d] text-[#a3a3a3] hover:text-white hover:border-[#5a5a5a] flex items-center justify-center"
          title="Add project"
        >
          <Plus size={12} />
        </button>
      </aside>

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
        {operationNotice && (
          <div className={`absolute ${collisions.length > 0 ? 'top-14' : 'top-2'} left-0 right-2 h-9 app-panel border border-[#2a2a2a] rounded-lg flex items-center justify-center z-40 text-[11px] font-medium text-[#d1d5db] shadow-sm px-3`}>
            {operationNotice}
          </div>
        )}

        <div className={`app-panel rounded-xl px-3 py-2 z-30 ${headerOffsetClass}`}>
          <div className="flex items-center gap-3 min-w-0 flex-wrap lg:flex-nowrap">
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <span className="text-[11px] text-[#6b7280] uppercase tracking-[0.14em] font-mono">Project</span>
              <select
                value={normalizeProjectPath(basePath) || selectableProjectPaths[0] || ''}
                onChange={(e) => handleProjectSelect(e.target.value)}
                className="input-stealth rounded px-2 py-1.5 text-xs font-mono max-w-[14rem] min-w-[10rem]"
              >
                {selectableProjectPaths.length === 0 && <option value={basePath || ''}>{basePath || 'No project'}</option>}
                {selectableProjectPaths.map(path => (
                  <option key={path} value={path}>
                    {projectLabelByPath[path] || formatProjectLabel(path)}
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
              {workspaceInfo.isRepo && (
                <span className="text-[10px] uppercase tracking-wider border border-[#2a2a2a] rounded px-2 py-0.5 font-mono text-[#a3a3a3]">
                  {parentBranch}
                </span>
              )}
            </div>

            <div className="h-5 w-px bg-[#1f1f1f] shrink-0 hidden lg:block" />

            <div className="min-w-0 flex-1 basis-full lg:basis-auto">
              <div className="text-[11px] text-[#6b7280] uppercase tracking-[0.14em] font-mono">
                {activeTask ? `Active Agent • ${activeTask.name}` : 'No Active Agent'}
              </div>
              <div className="text-[13px] text-[#d4d4d8] font-mono truncate" title={currentWorkingPath || basePath}>
                {activeProjectLabel}
                <span className="text-[#7b7b80]"> • {currentDirectoryLabel}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <span title="Task state: standby (no active task), provisioning (creating worktree), blocked (needs input), collision (same file edited by multiple agents), dirty (uncommitted changes), clean (no local changes)." className={`text-[10px] uppercase tracking-wider border rounded px-2 py-0.5 font-mono ${activeStateClass}`}>
                {activeStateLabel}
              </span>
              {pendingApprovalCount > 0 && (
                <span className="text-[10px] text-amber-300 border border-amber-900/80 bg-[#1f1607] rounded px-2 py-0.5 font-mono">
                  approvals {pendingApprovalCount}
                </span>
              )}
              <button
                onClick={() => setIsCommandPaletteOpen(true)}
                className="px-2 py-1 rounded-md btn-ghost text-[10px] font-mono"
                title="Open command palette (Cmd/Ctrl+K)"
              >
                Cmd+K
              </button>
              <button
                onClick={() => setIsFlightDeckOpen(true)}
                className="px-2 py-1 rounded-md btn-ghost text-[10px] font-mono"
                title="Open flight deck"
              >
                Flight Deck
              </button>
              <button
                onClick={() => setIsProjectManagerOpen(true)}
                className="w-8 h-8 rounded-md btn-ghost flex items-center justify-center"
                title="Project Manager"
              >
                <FolderTree size={14} />
              </button>
              <button
                onClick={() => setIsWorktreeInventoryOpen(true)}
                className="w-8 h-8 rounded-md btn-ghost flex items-center justify-center"
                title="Worktree Inventory"
              >
                <GitBranch size={14} />
              </button>
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
            <div className="h-full flex flex-col gap-2">
              <div className="app-panel rounded-xl border border-[#1a1a1a] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[#9ca3af] font-mono">Briefing</div>
                    <div className="text-[12px] text-[#e5e5e5] mt-1 truncate">{activeTask.name}</div>
                    <div className="text-[11px] text-[#a3a3a3] mt-1 leading-relaxed">{briefingSummary}</div>
                  </div>
                  <div className="text-[10px] text-[#71717a] font-mono text-right shrink-0">
                    <div>{activeSession?.resource?.port ? `PORT ${activeSession.resource.port}` : 'PORT -'}</div>
                    <div>{activeSession?.sandbox?.active ? `sandbox ${activeSession.sandbox.mode}` : 'sandbox off'}</div>
                  </div>
                </div>
                <div className="mt-2 border-t border-[#161616] pt-2 text-[11px] font-mono text-[#c5c5c5] space-y-1">
                  {briefingTail.slice(-3).map((line, index) => (
                    <div key={`briefing-line-${index}`} className="truncate">{line}</div>
                  ))}
                </div>
              </div>

              <div className="flex-1 flex gap-2">
                <div className="flex-1 min-w-0 app-panel rounded-xl overflow-hidden">
                  <div className="h-full flex flex-col p-1 relative z-10">
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
                          mcpEnabled={mcpEnabled}
                          projectPath={activeTask.basePath}
                          livingSpecPreference={activeTaskLivingSpecPreference}
                          packageStoreStrategy={packageStoreStrategy}
                          pnpmStorePath={pnpmStorePath}
                          sharedCacheRoot={sharedCacheRoot}
                          sandboxMode={sandboxMode}
                          networkGuard={networkGuard}
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
        mcpEnabled={mcpEnabled}
        setMcpEnabled={setMcpEnabled}
        packageStoreStrategy={packageStoreStrategy}
        setPackageStoreStrategy={setPackageStoreStrategy}
        dependencyCloneMode={dependencyCloneMode}
        setDependencyCloneMode={setDependencyCloneMode}
        pnpmStorePath={pnpmStorePath}
        setPnpmStorePath={setPnpmStorePath}
        sharedCacheRoot={sharedCacheRoot}
        setSharedCacheRoot={setSharedCacheRoot}
        pnpmAutoInstall={pnpmAutoInstall}
        setPnpmAutoInstall={setPnpmAutoInstall}
        sandboxMode={sandboxMode}
        setSandboxMode={setSandboxMode}
        networkGuard={networkGuard}
        setNetworkGuard={setNetworkGuard}
        availableAgents={availableAgents}
        theme={theme}
        setTheme={setTheme}
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
          branchName={tabs.find(t => t.id === diffTask)?.name}
          targetBranch={parentBranch}
        />
      )}

      <NewTaskModal
        isOpen={isNewTaskOpen}
        onClose={() => setIsNewTaskOpen(false)}
        projectName={basePath.split('/').pop() || 'proj'}
        basePath={basePath}
        parentBranch={parentBranch}
        availableBranches={selectableBranches}
        mcpEnabled={mcpEnabled}
        dependencyCloneMode={dependencyCloneMode}
        onSubmit={(rawTaskName, agentCommand, prompt, baseBranch, capabilities, options) => {
          void handleNewTaskSubmit(rawTaskName, agentCommand, prompt, baseBranch, capabilities, options);
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
        currentAgent={activeTask?.agent}
        taskName={activeTask?.name}
        handoverPreview={activeTask?.worktreePath}
      />

      <ProjectManagerModal
        isOpen={isProjectManagerOpen}
        onClose={() => setIsProjectManagerOpen(false)}
        currentProjectPath={basePath}
        projectPaths={selectableProjectPaths}
        tabs={tabs}
        onSwitchProject={handleProjectSwitch}
        onCreateProjectPath={(projectPath, activate) => addProjectPath(projectPath, activate)}
        onRemoveProjectPath={removeProjectPath}
        onBrowseProject={handleBrowseProject}
      />

      <WorktreeInventoryModal
        isOpen={isWorktreeInventoryOpen}
        onClose={() => setIsWorktreeInventoryOpen(false)}
        projectPaths={selectableProjectPaths}
        tabs={tabs}
        statuses={taskStatuses}
        onOpenSession={(taskId) => setActiveTab(taskId)}
        onOpenWorktree={(projectPath, worktreePath, branchName) => {
          restoreExistingWorktree(projectPath, worktreePath, branchName);
        }}
        onDeleteWorktree={(projectPath, worktreePath, branchName) => {
          void handleDeleteWorktree(projectPath, worktreePath, branchName);
        }}
      />

      <LivingSpecModal
        isOpen={!!livingSpecSelectionPrompt}
        prompt={livingSpecSelectionPrompt}
        preference={livingSpecSelectionPrompt ? livingSpecPreferences[normalizeProjectPath(livingSpecSelectionPrompt.projectPath)] : undefined}
        onApply={resolveLivingSpecSelectionPrompt}
        onClose={dismissLivingSpecSelectionPrompt}
      />

      <FlightDeckModal
        isOpen={isFlightDeckOpen}
        onClose={() => setIsFlightDeckOpen(false)}
        sessions={flightDeckSessions}
        tabs={tabs}
        statuses={taskStatuses}
        onSelectTask={(taskId) => setActiveTab(taskId)}
      />

      {isCommandPaletteOpen && (
        <div className="fixed inset-0 z-[92] bg-black/70 flex items-start justify-center pt-[14vh] px-4" onClick={closeCommandPalette}>
          <div className="w-full max-w-2xl app-panel border border-[#1a1a1a] rounded-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="p-3 border-b border-[#1a1a1a]">
              <input
                value={commandPaletteQuery}
                onChange={(event) => setCommandPaletteQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeCommandPalette();
                    return;
                  }
                  if (visiblePaletteItems.length === 0) return;
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setCommandPaletteActiveIndex((prev) => (prev + 1) % visiblePaletteItems.length);
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setCommandPaletteActiveIndex((prev) => (prev - 1 + visiblePaletteItems.length) % visiblePaletteItems.length);
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const selected = visiblePaletteItems[commandPaletteActiveIndex] || visiblePaletteItems[0];
                    if (selected) handleCommandPaletteSelect(selected);
                  }
                }}
                placeholder="Jump to project or task..."
                autoFocus
                className="w-full input-stealth rounded px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2 space-y-1">
              {visiblePaletteItems.length === 0 ? (
                <div className="text-xs text-[#9ca3af] font-mono px-2 py-3">No matches</div>
              ) : (
                visiblePaletteItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    ref={(el) => {
                      commandPaletteItemRefs.current[index] = el;
                    }}
                    onMouseEnter={() => setCommandPaletteActiveIndex(index)}
                    onClick={() => handleCommandPaletteSelect(item)}
                    className={`w-full text-left px-3 py-2 rounded text-sm text-[#d4d4d8] font-mono ${
                      index === commandPaletteActiveIndex
                        ? 'bg-[#101010]'
                        : 'hover:bg-[#101010]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
