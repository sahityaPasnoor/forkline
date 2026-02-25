import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, AlertTriangle, GitBranch, Plus, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import SettingsModal from './components/SettingsModal';
import DiffViewer from './components/DiffViewer';
import NewTaskModal from './components/NewTaskModal';
import ApprovalInboxModal from './components/ApprovalInboxModal';
import TodoPanel from './components/TodoPanel';
import WelcomeEmptyState from './components/WelcomeEmptyState';
import WorktreeInventoryModal from './components/WorktreeInventoryModal';
import LivingSpecModal from './components/LivingSpecModal';
import { useOrchestrator } from './hooks/useOrchestrator';
import { APP_THEMES, DEFAULT_THEME_ID } from './lib/themes';

const SIDEBAR_WIDTH_KEY = 'orchestrator.sidebar.width';
const PROJECT_HISTORY_KEY = 'orchestrator.project.paths';
const PROJECT_RAIL_EXPANDED_KEY = 'orchestrator.project.rail.expanded';
const THEME_KEY = 'orchestrator.theme';
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
const getTaskDisplayName = (tab: { name: string; displayName?: string }) => {
  const displayName = typeof tab.displayName === 'string' ? tab.displayName.trim() : '';
  return displayName || tab.name;
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

interface CommandPaletteItem {
  id: string;
  label: string;
  taskId: string;
  projectPath: string;
}

type SpawnPhase = 'creating_worktree' | 'preparing_environment' | 'launching_agent';

interface SpawnProgressState {
  taskName: string;
  taskId?: string;
  phase: SpawnPhase;
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
      pendingApprovals,
      blockedTasks,
      approvalInboxCount,
      attentionEvents,
      livingSpecPreferences,
      livingSpecCandidatesByProject,
      livingSpecSelectionPrompt
    },
    actions: {
      setActiveTab,
      switchProject,
      browseForBasePath,
      setContext,
      setEnvVars,
      setDefaultCommand,
      setPackageStoreStrategy,
      setDependencyCloneMode,
      setPnpmStorePath,
      setSharedCacheRoot,
      setPnpmAutoInstall,
      setSandboxMode,
      setNetworkGuard,
      createTask,
      renameTaskSession,
      markTaskBootstrapped,
      closeTaskById,
      restoreExistingWorktree,
      approveApprovalRequest,
      rejectApprovalRequest,
      approveAllPendingRequests,
      rejectAllPendingRequests,
      respondToBlockedTask,
      respondToAllBlockedTasks,
      resolveLivingSpecSelectionPrompt,
      dismissLivingSpecSelectionPrompt
    }
  } = useOrchestrator();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [isApprovalInboxOpen, setIsApprovalInboxOpen] = useState(false);
  const [isWorktreeInventoryOpen, setIsWorktreeInventoryOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0);
  const commandPaletteItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffTask, setDiffTask] = useState<string | null>(null);
  const [spawnProgress, setSpawnProgress] = useState<SpawnProgressState | null>(null);
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
  const [repositoryWebUrl, setRepositoryWebUrl] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [mountedTerminalTaskIds, setMountedTerminalTaskIds] = useState<string[]>([]);
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
  const [isProjectRailExpanded, setIsProjectRailExpanded] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(PROJECT_RAIL_EXPANDED_KEY) === '1';
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
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PROJECT_RAIL_EXPANDED_KEY, isProjectRailExpanded ? '1' : '0');
  }, [isProjectRailExpanded]);

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
        setRepositoryWebUrl(null);
        return;
      }

      const [info, branchesRes, repoUrlRes] = await Promise.all([
        window.electronAPI.getWorkspaceInfo(normalized).catch((error) => ({ success: false as const, error: error?.message || 'workspace info failed' })),
        window.electronAPI.listBranches(normalized).catch((error) => ({ success: false as const, error: error?.message || 'branch listing failed', branches: [] })),
        window.electronAPI.getRepositoryWebUrl(normalized).catch((error) => ({ success: false as const, error: error?.message || 'repo url lookup failed' }))
      ]);
      if (cancelled || !info.success) {
        setWorkspaceInfo({ isRepo: false, currentBranch: null, defaultBranch: null });
        setWorkspaceBranches([]);
        setRepositoryWebUrl(null);
        return;
      }
      setWorkspaceInfo({
        isRepo: !!info.isRepo,
        currentBranch: info.currentBranch ?? null,
        defaultBranch: info.defaultBranch ?? null
      });
      const branches = Array.isArray(branchesRes.branches) ? branchesRes.branches : [];
      setWorkspaceBranches(branches);
      setRepositoryWebUrl(repoUrlRes.success && typeof repoUrlRes.webUrl === 'string' ? repoUrlRes.webUrl : null);
    };
    void loadWorkspaceInfo();
    return () => {
      cancelled = true;
    };
  }, [basePath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isOpenPalette = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isOpenPalette) {
        event.preventDefault();
        event.stopPropagation();
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
          setCommandPaletteQuery('');
          setCommandPaletteActiveIndex(0);
          commandPaletteItemRefs.current = [];
        } else {
          setIsCommandPaletteOpen(true);
        }
        return;
      }
      if (event.key === 'Escape' && isCommandPaletteOpen) {
        setIsCommandPaletteOpen(false);
        setCommandPaletteQuery('');
        setCommandPaletteActiveIndex(0);
        commandPaletteItemRefs.current = [];
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    const onPaletteShortcut = () => {
      setIsCommandPaletteOpen(true);
    };
    window.addEventListener('orchestrator:open-command-palette', onPaletteShortcut as EventListener);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('orchestrator:open-command-palette', onPaletteShortcut as EventListener);
    };
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (!isHeaderMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!headerMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && headerMenuRef.current.contains(target)) return;
      setIsHeaderMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsHeaderMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isHeaderMenuOpen]);

  const normalizedBasePath = normalizeProjectPath(basePath);
  const visibleTabs = useMemo(() => (
    normalizedBasePath
      ? tabs.filter(tab => normalizeProjectPath(tab.basePath) === normalizedBasePath)
      : tabs
  ), [normalizedBasePath, tabs]);
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
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const sidebarTabs = useMemo(
    () => visibleTabs.map((tab) => ({ id: tab.id, name: getTaskDisplayName(tab), agent: tab.agent, tags: tab.tags })),
    [visibleTabs]
  );
  const mountedTerminalTabs = useMemo(() => (
    mountedTerminalTaskIds.flatMap((taskId) => {
      const tab = tabsById.get(taskId);
      if (!tab?.worktreePath) return [];
      return [tab];
    })
  ), [mountedTerminalTaskIds, tabsById]);
  const activeProjectLivingSpecCandidates = livingSpecCandidatesByProject[normalizeProjectPath(basePath)] || [];
  const parentBranch = workspaceInfo.defaultBranch || workspaceInfo.currentBranch || 'main';
  const selectableBranches = Array.from(new Set([parentBranch, ...workspaceBranches].filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const sortedProjectPaths = useMemo(() => (
    Array.from(new Set([basePath, ...projectPaths, ...tabs.map(tab => tab.basePath)]))
      .map(path => normalizeProjectPath(path))
      .filter(path => !!path && !isLikelyWorktreePath(path))
      .sort((a, b) => a.localeCompare(b))
  ), [basePath, projectPaths, tabs]);
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
  const operationNoticeTone = useMemo<'error' | 'success' | 'info'>(() => {
    const text = (operationNotice || '').trim().toLowerCase();
    if (!text) return 'info';
    if (
      text.includes('failed')
      || text.includes('error')
      || text.includes('cannot')
      || text.includes('no remote repository url')
    ) {
      return 'error';
    }
    if (text.includes('merged') || text.includes('deleted') || text.includes('completed')) {
      return 'success';
    }
    return 'info';
  }, [operationNotice]);
  const latestSpecDeviation = attentionEvents.find((event) => event.kind === 'spec_deviation');
  const latestContextAlert = attentionEvents.find((event) => event.kind === 'context_alert');
  const shouldShowNoticeStack = collisions.length > 0 || !!operationNotice || !!latestSpecDeviation || !!latestContextAlert;
  const headerAgentName = activeTask ? getTaskDisplayName(activeTask) : 'No active session';
  const headerPathHint = currentDirectoryLabel && currentDirectoryLabel !== '-' ? currentDirectoryLabel : (currentWorkingPath || basePath || '-');
  const paletteItems: CommandPaletteItem[] = [
    ...tabs.map((tab) => ({
      id: `task:${tab.id}`,
      label: `${getTaskDisplayName(tab)} (${basename(tab.basePath)})`,
      projectPath: tab.basePath,
      taskId: tab.id
    }))
  ];
  const activeTaskSpawnPhase = (() => {
    if (!activeTask) return null;
    if (spawnProgress && !spawnProgress.taskId && activeTask.hasBootstrapped === false && !activeTask.worktreePath) {
      return spawnProgress.phase;
    }
    if (spawnProgress?.taskId === activeTask.id) {
      return spawnProgress.phase;
    }
    if (activeTask.hasBootstrapped === false) {
      return activeTask.worktreePath ? 'launching_agent' : 'preparing_environment';
    }
    return null;
  })();
  const activeTaskSpawnLabel = activeTaskSpawnPhase === 'creating_worktree'
    ? 'Creating worktree'
    : activeTaskSpawnPhase === 'preparing_environment'
      ? 'Preparing environment'
      : activeTaskSpawnPhase === 'launching_agent'
        ? 'Launching agent'
        : '';
  const activeTaskSpawnName = spawnProgress?.taskName || (activeTask ? getTaskDisplayName(activeTask) : '');
  const showActiveSpawnOverlay = !!activeTaskSpawnPhase;

  useEffect(() => {
    setMountedTerminalTaskIds((prev) => {
      const liveTaskIds = new Set(
        tabs.filter((tab) => !!tab.worktreePath).map((tab) => tab.id)
      );
      const retained = prev.filter((taskId) => liveTaskIds.has(taskId));
      if (!activeTask?.worktreePath) return retained;
      if (retained.includes(activeTask.id)) return retained;
      return [...retained, activeTask.id];
    });
  }, [tabs, activeTask?.id, activeTask?.worktreePath]);
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
  const inboxTaskMetaById = useMemo(() => {
    const map: Record<string, { taskName: string; projectPath: string; worktreePath?: string }> = {};
    tabs.forEach((tab) => {
      map[tab.id] = {
        taskName: getTaskDisplayName(tab),
        projectPath: tab.basePath,
        worktreePath: tab.worktreePath
      };
    });
    return map;
  }, [tabs]);

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

  const handleOpenRepoInBrowser = useCallback(async () => {
    const normalizedBase = normalizeProjectPath(basePath);
    let candidate = typeof repositoryWebUrl === 'string' ? repositoryWebUrl.trim() : '';
    if (!candidate && normalizedBase) {
      const repoRes = await window.electronAPI.getRepositoryWebUrl(normalizedBase)
        .catch((error) => ({ success: false as const, error: error?.message || 'repo url lookup failed' }));
      if (repoRes.success && typeof repoRes.webUrl === 'string') {
        candidate = repoRes.webUrl.trim();
        setRepositoryWebUrl(candidate);
      }
    }
    if (!candidate) {
      setOperationNotice('No remote repository URL found for this project.');
      return;
    }
    const result = await window.electronAPI.openExternalUrl(candidate);
    if (!result.success) {
      setOperationNotice(`Failed to open repository URL: ${result.error || 'unknown error'}.`);
    }
  }, [basePath, repositoryWebUrl]);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    setCommandPaletteActiveIndex(0);
    commandPaletteItemRefs.current = [];
  }, []);

  const handleCommandPaletteSelect = (item: CommandPaletteItem) => {
    handleProjectSwitch(item.projectPath);
    setActiveTab(item.taskId);
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

  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    const rafId = requestAnimationFrame(() => {
      commandPaletteInputRef.current?.focus();
      commandPaletteInputRef.current?.select();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (!spawnProgress?.taskId) return;
    const task = tabs.find((tab) => tab.id === spawnProgress.taskId);
    if (!task) {
      setSpawnProgress(null);
      return;
    }
    if (task.hasBootstrapped) {
      setSpawnProgress(null);
      return;
    }
    if (task.worktreePath && spawnProgress.phase !== 'launching_agent') {
      setSpawnProgress((prev) => (
        prev && prev.taskId === task.id
          ? { ...prev, phase: 'launching_agent' }
          : prev
      ));
      return;
    }
    if (!task.worktreePath && spawnProgress.phase !== 'preparing_environment') {
      setSpawnProgress((prev) => (
        prev && prev.taskId === task.id
          ? { ...prev, phase: 'preparing_environment' }
          : prev
      ));
    }
  }, [spawnProgress, tabs]);

  const handleNewTaskSubmit = async (
    rawTaskName: string,
    agentCommand: string,
    prompt: string,
    baseBranch: string,
    capabilities: { autoMerge: boolean },
    options?: {
      createBaseBranchIfMissing?: boolean;
      dependencyCloneMode?: 'copy_on_write' | 'full_copy';
      livingSpecOverridePath?: string;
    }
  ) => {
    if (!basePath || !sourceStatus?.valid) {
      setOperationNotice('Please select a valid base project path first.');
      return;
    }

    const trimmedTaskName = rawTaskName.trim() || 'new-session';
    setSpawnProgress({
      taskName: trimmedTaskName,
      phase: 'creating_worktree'
    });

    const result = await createTask({
      rawTaskName,
      agentCommand,
      prompt,
      baseBranch,
      createBaseBranchIfMissing: options?.createBaseBranchIfMissing === true,
      dependencyCloneMode: options?.dependencyCloneMode,
      livingSpecOverridePath: options?.livingSpecOverridePath,
      capabilities,
      activate: true
    });

    if (!result.success) {
      setSpawnProgress(null);
      setOperationNotice(`Git worktree setup failed: ${result.error || 'unknown error'}.`);
      return;
    }

    setSpawnProgress({
      taskName: trimmedTaskName,
      taskId: result.taskId,
      phase: 'preparing_environment'
    });
  };

  const handleMergeClick = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab?.worktreePath) return;
    setDiffTask(id);
    setDiffOpen(true);
  }, [tabs]);

  const handleConfirmMerge = async () => {
    if (!diffTask) return;
    const tab = tabs.find(t => t.id === diffTask);
    const res = await closeTaskById(diffTask, 'merge');
    if (!res.success) {
      setOperationNotice(`Failed to merge worktree: ${res.error || 'unknown error'}.`);
      return;
    }
    setOperationNotice(tab ? `Merged ${getTaskDisplayName(tab)} into ${parentBranch}.` : 'Merge completed.');
  };

  const handleDeleteClick = useCallback(async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return false;

    const confirmed = window.confirm(`Delete agent branch "${tab.name}" and remove its worktree?`);
    if (!confirmed) return false;

    const res = await closeTaskById(id, 'delete');
    if (!res.success) {
      setOperationNotice(`Failed to delete worktree: ${res.error || 'unknown error'}.`);
      return false;
    }
    setOperationNotice(`Deleted worktree for ${getTaskDisplayName(tab)}.`);
    return true;
  }, [tabs, closeTaskById]);

  const handleTerminalDelete = useCallback((taskId: string) => {
    void handleDeleteClick(taskId);
  }, [handleDeleteClick]);

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
      setOperationNotice(`Failed to delete worktree: ${res.error || 'unknown error'}.`);
      return;
    }
    setOperationNotice(`Deleted worktree ${resolvedBranch}.`);
    setIsWorktreeInventoryOpen(false);
  };

  return (
    <div className="flex h-screen w-full relative overflow-hidden">
      <aside className={`${isProjectRailExpanded ? 'w-56' : 'w-14'} shrink-0 border-r border-[var(--panel-border)] bg-[var(--panel-subtle)] flex flex-col py-2 ${isProjectRailExpanded ? 'px-2' : 'items-center'} gap-1.5 transition-[width] duration-200`}>
        {isProjectRailExpanded ? (
          <div className="h-9 px-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--text-tertiary)]">Projects</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  void handleBrowseProject(true);
                }}
                className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--panel)] flex items-center justify-center"
                title="Add project"
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                onClick={() => setIsProjectRailExpanded(false)}
                className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--panel)] flex items-center justify-center"
                title="Collapse project rail"
              >
                <ChevronLeft size={12} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => setIsProjectRailExpanded(true)}
              className="h-8 w-9 rounded-md border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--panel)] flex items-center justify-center"
              title="Expand project rail"
            >
              <ChevronRight size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                void handleBrowseProject(true);
              }}
              className="h-8 w-9 rounded-md border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--panel)] flex items-center justify-center"
              title="Add project"
            >
              <Plus size={12} />
            </button>
          </div>
        )}

        <div className={`min-h-0 flex-1 ${isProjectRailExpanded ? 'overflow-y-auto space-y-1 pr-0.5' : 'overflow-y-auto flex flex-col items-center gap-1'}`}>
          {selectableProjectPaths.map((projectPath) => {
            const normalized = normalizeProjectPath(projectPath);
            const isActiveProject = normalized === normalizeProjectPath(basePath);
            const initial = basename(projectPath).slice(0, 1).toUpperCase();
            const stateDot = projectStateBadge(projectPath);
            return (
              <button
                key={projectPath}
                type="button"
                onClick={() => handleProjectSwitch(projectPath)}
                className={`relative rounded-md text-[11px] font-mono flex items-center transition-colors border ${
                  isProjectRailExpanded
                    ? `w-full h-10 px-2 justify-start gap-2 ${
                      isActiveProject
                        ? 'border-[var(--input-border-focus)] bg-[var(--panel-strong)] text-[var(--text-primary)]'
                        : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--panel)] hover:text-[var(--text-primary)]'
                    }`
                    : `w-9 h-9 justify-center ${isActiveProject ? 'border-[var(--input-border-focus)] bg-[var(--panel-strong)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--panel)]'}`
                }`}
                title={formatProjectLabel(projectPath)}
              >
                {isProjectRailExpanded ? (
                  <>
                    <span className="w-5 h-5 rounded border border-[var(--panel-border)] bg-[var(--panel)] text-[var(--text-secondary)] flex items-center justify-center text-[10px] shrink-0">
                      {initial || '#'}
                    </span>
                    <span className="truncate flex-1 text-left">{projectLabelByPath[projectPath] || basename(projectPath)}</span>
                    <span className={`w-2 h-2 rounded-full border border-[var(--panel)] shrink-0 ${stateDot}`} />
                  </>
                ) : (
                  <span className="relative w-5 h-5 rounded border border-[var(--panel-border)] bg-[var(--panel)] text-[10px] text-[var(--text-secondary)] flex items-center justify-center">
                    {initial || '#'}
                    <span className={`absolute -right-1 -bottom-1 w-2.5 h-2.5 rounded-full border border-[var(--panel)] ${stateDot}`} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      <Sidebar
        tabs={sidebarTabs}
        activeTab={activeTab}
        statuses={taskStatuses}
        usageByTask={taskUsage}
        width={sidebarWidth}
        repoWebUrl={repositoryWebUrl}
        onSelectTab={setActiveTab}
        onOpenRepo={() => {
          void handleOpenRepoInBrowser();
        }}
        onDeleteTask={handleTerminalDelete}
        onRenameTask={(taskId, nextName) => {
          const renamed = renameTaskSession(taskId, nextName);
          if (renamed) {
            setOperationNotice('Session name updated.');
          }
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
        className="w-1.5 shrink-0 mx-1 my-2 rounded bg-transparent hover:bg-[var(--panel-border)] active:bg-[var(--btn-ghost-border-hover)] cursor-col-resize"
        onMouseDown={(event) => {
          event.preventDefault();
          setIsSidebarResizing(true);
        }}
        aria-label="Resize sidebar"
        role="separator"
      />

      <main className="flex-1 min-w-0 flex flex-col h-full relative z-10 pt-2 pr-2 pb-2">
        {shouldShowNoticeStack && (
          <div className="space-y-2 mb-2">
            {collisions.length > 0 && (
              <div className="h-10 bg-[#1a0505] border border-red-900 rounded-lg flex items-center justify-center z-40 text-xs font-semibold text-red-400 shadow-sm px-3">
                <AlertTriangle size={14} className="mr-2 text-red-500 shrink-0" />
                <span className="truncate">
                  Collision Detected: Multiple agents modifying ({collisions.join(', ')}).
                </span>
              </div>
            )}
            {operationNotice && (
              <div
                className={`h-9 rounded-lg flex items-center z-40 text-[11px] font-semibold shadow-sm px-3 gap-2 ${
                  operationNoticeTone === 'error'
                    ? 'border border-red-900/80 bg-[#1a0505] text-red-300'
                    : operationNoticeTone === 'success'
                      ? 'border border-emerald-900/80 bg-[#0b1a13] text-emerald-300'
                      : 'app-panel border border-[var(--panel-border)] text-[var(--text-primary)]'
                }`}
                role={operationNoticeTone === 'error' ? 'alert' : undefined}
              >
                {operationNoticeTone === 'error' && <AlertTriangle size={13} className="shrink-0 text-red-400" />}
                <span className="truncate">{operationNotice}</span>
              </div>
            )}
            {latestSpecDeviation && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab(latestSpecDeviation.taskId);
                  setIsApprovalInboxOpen(true);
                }}
                className="btn-warning w-full h-9 rounded-lg z-40 text-[11px] px-3"
              >
                <span className="truncate">Spec deviation: {latestSpecDeviation.taskName} • {latestSpecDeviation.reason}</span>
              </button>
            )}
            {latestContextAlert && !latestSpecDeviation && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab(latestContextAlert.taskId);
                  setIsApprovalInboxOpen(true);
                }}
                className="btn-info w-full h-9 rounded-lg z-40 text-[11px] px-3"
              >
                <span className="truncate">Context alert: {latestContextAlert.taskName} • {latestContextAlert.reason}</span>
              </button>
            )}
          </div>
        )}

        <div className="app-panel rounded-xl px-3 py-2 z-30">
          <div className="flex items-center gap-3 min-w-0 flex-wrap lg:flex-nowrap">
            <div className="min-w-0 flex-1 basis-full lg:basis-auto">
              <div className="text-[13px] text-[var(--text-primary)] font-mono truncate" title={headerAgentName}>
                {headerAgentName}
              </div>
              <div className="mt-0.5 flex items-center gap-2 min-w-0">
                <div className="text-[11px] text-[var(--text-muted)] font-mono truncate min-w-0" title={currentWorkingPath || basePath}>
                  {headerPathHint}
                </div>
                {workspaceInfo.isRepo && (
                  <span className="text-[10px] tracking-wide border border-[var(--panel-border)] rounded px-2 py-0.5 font-mono text-[var(--text-secondary)] bg-[var(--panel-subtle)] shrink-0">
                    base {parentBranch}
                  </span>
                )}
              </div>
            </div>

            <div className="relative flex items-center gap-1.5 shrink-0 ml-auto" ref={headerMenuRef}>
              <span title="Task state: standby (no active task), provisioning (creating worktree), blocked (needs input), collision (same file edited by multiple agents), dirty (uncommitted changes), clean (no local changes)." className={`text-[10px] uppercase tracking-wider border rounded px-2 py-0.5 font-mono ${activeStateClass}`}>
                {activeStateLabel}
              </span>
              {approvalInboxCount > 0 && (
                <button
                  onClick={() => setIsApprovalInboxOpen(true)}
                  className="btn-warning px-2 py-0.5 text-[10px] font-mono"
                  title="Open approval inbox"
                >
                  inbox {approvalInboxCount}
                </button>
              )}
              <button
                onClick={() => setIsCommandPaletteOpen(true)}
                className="px-2 py-1 rounded-md btn-ghost text-[10px] font-mono"
                title="Open command palette (Cmd/Ctrl+K)"
              >
                ⌘K
              </button>
              <button
                onClick={() => setIsHeaderMenuOpen((prev) => !prev)}
                className="btn-ghost btn-icon rounded-md"
                title="More actions"
                aria-expanded={isHeaderMenuOpen}
                aria-haspopup="menu"
              >
                <MoreHorizontal size={14} />
              </button>
              {isHeaderMenuOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+0.4rem)] w-44 app-panel border border-[var(--panel-border)] rounded-lg shadow-xl p-1.5 z-40"
                  role="menu"
                  aria-label="Header actions"
                >
                  <button
                    type="button"
                    className="btn-ghost w-full justify-start px-2 py-1.5 text-[11px] font-mono"
                    onClick={() => {
                      setIsWorktreeInventoryOpen(true);
                      setIsHeaderMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <GitBranch size={13} />
                    Worktrees
                  </button>
                  <button
                    type="button"
                    className="btn-ghost w-full justify-start px-2 py-1.5 text-[11px] font-mono"
                    onClick={() => {
                      setIsSettingsOpen(true);
                      setIsHeaderMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <Settings size={13} />
                    Settings
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 mt-2 relative z-20 overflow-hidden">
          {activeTask ? (
            <div className="h-full flex gap-2">
              <div className="flex-1 min-w-0 app-panel rounded-xl overflow-hidden">
                <div className="h-full flex flex-col p-1 relative z-10">
                  {mountedTerminalTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={`absolute inset-0 transition-opacity duration-75 ${
                        tab.id === activeTask.id
                          ? 'opacity-100 pointer-events-auto z-20'
                          : 'opacity-0 pointer-events-none z-0'
                      }`}
                      aria-hidden={tab.id !== activeTask.id}
                    >
                      <Terminal
                        taskId={tab.id}
                        cwd={tab.worktreePath!}
                        agentCommand={tab.agent}
                        context={context}
                        envVars={envVars}
                        prompt={tab.prompt}
                        isActive={tab.id === activeTask.id}
                        shouldBootstrap={tab.hasBootstrapped === false}
                        onBootstrapped={markTaskBootstrapped}
                        capabilities={tab.capabilities}
                        taskUsage={taskUsage[tab.id]}
                        projectPath={tab.basePath}
                        parentBranch={tab.parentBranch || parentBranch}
                        livingSpecPreference={livingSpecPreferences[normalizeProjectPath(tab.basePath)]}
                        livingSpecOverridePath={tab.livingSpecOverridePath}
                        packageStoreStrategy={packageStoreStrategy}
                        pnpmStorePath={pnpmStorePath}
                        sharedCacheRoot={sharedCacheRoot}
                        sandboxMode={sandboxMode}
                        networkGuard={networkGuard}
                        isBlocked={taskStatuses[tab.id]?.isBlocked}
                        blockedReason={taskStatuses[tab.id]?.blockedReason}
                        onMerge={handleMergeClick}
                        onDelete={handleTerminalDelete}
                      />
                    </div>
                  ))}
                  {showActiveSpawnOverlay && (
                    <div className="absolute inset-0 z-30 app-panel flex items-center justify-center">
                      <div className="w-[22rem] max-w-[88%] rounded-lg border border-[var(--panel-border)] bg-[var(--panel-subtle)] px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] font-mono text-[var(--text-secondary)]">
                          Starting Session
                        </div>
                        <div className="mt-1 text-[13px] font-mono text-[var(--text-primary)] truncate" title={activeTaskSpawnName}>
                          {activeTaskSpawnName}
                        </div>
                        <div className="mt-3 space-y-2">
                          {[
                            { key: 'creating_worktree' as const, label: 'Create worktree' },
                            { key: 'preparing_environment' as const, label: 'Prepare environment' },
                            { key: 'launching_agent' as const, label: 'Launch agent' }
                          ].map((step) => {
                            const stepState = step.key === activeTaskSpawnPhase
                              ? 'active'
                              : (
                                (activeTaskSpawnPhase === 'preparing_environment' && step.key === 'creating_worktree')
                                || (activeTaskSpawnPhase === 'launching_agent' && (step.key === 'creating_worktree' || step.key === 'preparing_environment'))
                                  ? 'done'
                                  : 'pending'
                              );
                            return (
                              <div key={step.key} className="flex items-center gap-2 text-[11px] font-mono">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    stepState === 'done'
                                      ? 'bg-emerald-400'
                                      : stepState === 'active'
                                        ? 'bg-cyan-400 animate-pulse'
                                        : 'bg-[var(--panel-border)]'
                                  }`}
                                />
                                <span
                                  className={
                                    stepState === 'pending'
                                      ? 'text-[var(--text-muted)]'
                                      : 'text-[var(--text-primary)]'
                                  }
                                >
                                  {step.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-3 text-[10px] font-mono text-[var(--text-tertiary)]">
                          {activeTaskSpawnLabel}...
                        </div>
                      </div>
                    </div>
                  )}
                  {!showActiveSpawnOverlay && !activeTask.worktreePath && (
                    <div className="h-full w-full flex flex-col items-center justify-center font-mono">
                      <div className="mb-3 text-[var(--text-primary)] text-[11px] uppercase tracking-widest">Initializing Environment</div>
                      <div className="text-[var(--text-muted)] text-[10px]">{getTaskDisplayName(activeTask)}</div>
                    </div>
                  )}
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
        livingSpecCandidates={activeProjectLivingSpecCandidates}
        dependencyCloneMode={dependencyCloneMode}
        onSubmit={(rawTaskName, agentCommand, prompt, baseBranch, capabilities, options) => {
          void handleNewTaskSubmit(rawTaskName, agentCommand, prompt, baseBranch, capabilities, options);
        }}
        defaultCommand={defaultCommand}
        availableAgents={availableAgents}
      />

      <ApprovalInboxModal
        isOpen={isApprovalInboxOpen}
        onClose={() => setIsApprovalInboxOpen(false)}
        pendingApprovals={pendingApprovals}
        blockedTasks={blockedTasks}
        taskMetaById={inboxTaskMetaById}
        onSelectTask={(taskId) => {
          setActiveTab(taskId);
          setIsApprovalInboxOpen(false);
        }}
        onApproveOne={(requestId) => {
          void approveApprovalRequest(requestId);
        }}
        onRejectOne={rejectApprovalRequest}
        onApproveAll={() => {
          void approveAllPendingRequests();
        }}
        onRejectAll={rejectAllPendingRequests}
        onRespondBlocked={respondToBlockedTask}
        onRespondAllBlocked={respondToAllBlockedTasks}
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

      {isCommandPaletteOpen && (
        <div className="fixed inset-0 z-[92] bg-black/70 flex items-start justify-center pt-[10vh] px-4" onClick={closeCommandPalette}>
          <div className="w-full max-w-xl app-panel border border-[var(--panel-border)] rounded-xl overflow-hidden shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="px-3 py-2.5 border-b border-[var(--panel-border)]">
              <input
                ref={commandPaletteInputRef}
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
                placeholder="Jump to session..."
                className="w-full input-stealth rounded px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="max-h-[58vh] overflow-y-auto p-2 space-y-1">
              {visiblePaletteItems.length === 0 ? (
                <div className="text-xs text-[var(--text-secondary)] font-mono px-2 py-3">No matches</div>
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
                    className={`btn-ghost w-full text-left px-3 py-2 rounded text-sm font-mono ${
                      index === commandPaletteActiveIndex
                        ? 'bg-[var(--panel-subtle)] border-[var(--input-border-focus)] text-[var(--text-primary)]'
                        : 'border-transparent'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
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
