import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSubtaskPrompt, sanitizeTaskName } from '../lib/taskUtils';
import { shellQuote } from '../lib/shell';
import type {
  AttentionEvent,
  AgentCapabilities,
  AgentInfo,
  AgentTodo,
  PendingApprovalRequest,
  ProjectPermissionPolicy,
  SourceStatus,
  TaskStatus,
  TaskTab,
  TaskUsage
} from '../models/orchestrator';

type CloseAction = 'merge' | 'delete';
const SESSION_STORAGE_KEY = 'orchestrator.runtime.session';
const ATTENTION_FEED_ENABLED = false;
const DEFAULT_PROJECT_POLICY: ProjectPermissionPolicy = {
  autonomousMode: false,
  autoApproveMerge: false,
  autoRespondPrompts: false,
  promptResponse: 'y'
};

interface PendingApprovalQueueItem extends PendingApprovalRequest {
  projectPath: string;
}

interface CreateTaskInput {
  rawTaskName: string;
  agentCommand: string;
  prompt: string;
  capabilities: AgentCapabilities;
  parentTaskId?: string;
  activate?: boolean;
}

interface SplitTaskInput {
  parentTaskId: string;
  objective: string;
  count: number;
  command: string;
}

interface CreateTaskResult {
  success: boolean;
  taskId?: string;
  error?: string;
}

const normalizeProjectPath = (value: string) => value.trim().replace(/\\/g, '/').replace(/\/+$/, '');

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const pickNumber = (input: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = toFiniteNumber(input[key]);
    if (typeof value === 'number') return value;
  }
  return undefined;
};

const extractTaskUsage = (payload: unknown): TaskUsage | null => {
  const root = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : null;
  const candidates: Record<string, unknown>[] = [];
  if (root) {
    candidates.push(root);
    for (const key of ['usage', 'metrics', 'tokenUsage', 'stats', 'context']) {
      const child = root[key];
      if (child && typeof child === 'object') {
        candidates.push(child as Record<string, unknown>);
      }
    }
  }

  for (const candidate of candidates) {
    const contextTokens = pickNumber(candidate, ['contextTokens', 'context_tokens', 'contextSize', 'context_size', 'currentContextTokens', 'current_context_tokens']);
    const promptTokens = pickNumber(candidate, ['promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens']);
    const completionTokens = pickNumber(candidate, ['completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens']);
    const totalTokens = pickNumber(candidate, ['totalTokens', 'total_tokens']);
    const contextWindow = pickNumber(candidate, ['contextWindow', 'context_window', 'maxContextTokens', 'max_context_tokens', 'modelContextWindow', 'model_context_window']);
    const percentRaw = pickNumber(candidate, ['percentUsed', 'contextUsagePercent', 'context_usage_percent', 'contextUsagePct', 'context_usage_pct']);
    const costUsd = pickNumber(candidate, ['costUsd', 'cost_usd', 'estimatedCostUsd', 'estimated_cost_usd', 'totalCostUsd', 'total_cost_usd']);
    const promptCostUsd = pickNumber(candidate, ['promptCostUsd', 'prompt_cost_usd', 'inputCostUsd', 'input_cost_usd']);
    const completionCostUsd = pickNumber(candidate, ['completionCostUsd', 'completion_cost_usd', 'outputCostUsd', 'output_cost_usd']);

    const usage: TaskUsage = { updatedAt: Date.now() };
    if (typeof contextTokens === 'number') usage.contextTokens = contextTokens;
    if (typeof promptTokens === 'number') usage.promptTokens = promptTokens;
    if (typeof completionTokens === 'number') usage.completionTokens = completionTokens;
    if (typeof totalTokens === 'number') usage.totalTokens = totalTokens;
    if (typeof contextWindow === 'number') usage.contextWindow = contextWindow;
    if (typeof percentRaw === 'number') usage.percentUsed = percentRaw <= 1 ? percentRaw * 100 : percentRaw;
    if (typeof costUsd === 'number') usage.costUsd = costUsd;
    if (typeof promptCostUsd === 'number') usage.promptCostUsd = promptCostUsd;
    if (typeof completionCostUsd === 'number') usage.completionCostUsd = completionCostUsd;
    if (typeof usage.percentUsed !== 'number' && typeof contextTokens === 'number' && typeof contextWindow === 'number' && contextWindow > 0) {
      usage.percentUsed = (contextTokens / contextWindow) * 100;
    }

    if (
      typeof usage.contextTokens === 'number'
      || typeof usage.promptTokens === 'number'
      || typeof usage.completionTokens === 'number'
      || typeof usage.totalTokens === 'number'
      || typeof usage.contextWindow === 'number'
      || typeof usage.percentUsed === 'number'
      || typeof usage.costUsd === 'number'
      || typeof usage.promptCostUsd === 'number'
      || typeof usage.completionCostUsd === 'number'
    ) {
      return usage;
    }
  }

  return null;
};

const sanitizeTaskUsageMap = (value: unknown): Record<string, TaskUsage> => {
  if (!value || typeof value !== 'object') return {};
  const map: Record<string, TaskUsage> = {};
  for (const [taskId, rawUsage] of Object.entries(value as Record<string, unknown>)) {
    const parsed = extractTaskUsage(rawUsage);
    if (!parsed) continue;
    const rawUpdatedAt = (rawUsage && typeof rawUsage === 'object')
      ? toFiniteNumber((rawUsage as Record<string, unknown>).updatedAt)
      : undefined;
    if (typeof rawUpdatedAt === 'number') {
      parsed.updatedAt = rawUpdatedAt;
    }
    map[taskId] = parsed;
  }
  return map;
};

const sanitizeTaskStatusMap = (value: unknown): Record<string, TaskStatus> => {
  if (!value || typeof value !== 'object') return {};
  const map: Record<string, TaskStatus> = {};
  for (const [taskId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const status = raw as Record<string, unknown>;
    map[taskId] = {
      isReady: !!status.isReady,
      isDirty: !!status.isDirty,
      hasCollision: !!status.hasCollision,
      isBlocked: !!status.isBlocked,
      blockedReason: typeof status.blockedReason === 'string' ? status.blockedReason : undefined
    };
  }
  return map;
};

const sanitizeTaskTodosMap = (value: unknown): Record<string, AgentTodo[]> => {
  if (!value || typeof value !== 'object') return {};
  const map: Record<string, AgentTodo[]> = {};
  for (const [taskId, rawTodos] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawTodos)) continue;
    const todos: AgentTodo[] = [];
    for (const rawTodo of rawTodos) {
      if (!rawTodo || typeof rawTodo !== 'object') continue;
      const todo = rawTodo as Record<string, unknown>;
      const title = typeof todo.title === 'string' ? todo.title.trim() : '';
      if (!title) continue;
      const status = todo.status === 'in_progress' || todo.status === 'done' ? todo.status : 'pending';
      const id = typeof todo.id === 'string' || typeof todo.id === 'number'
        ? todo.id
        : `${taskId}-${todos.length + 1}`;
      todos.push({ id, title, status });
    }
    if (todos.length > 0) {
      map[taskId] = todos;
    }
  }
  return map;
};

const sanitizeActiveTabByProjectMap = (value: unknown): Record<string, string | null> => {
  if (!value || typeof value !== 'object') return {};
  const map: Record<string, string | null> = {};
  for (const [rawProjectPath, rawTaskId] of Object.entries(value as Record<string, unknown>)) {
    const normalizedPath = normalizeProjectPath(rawProjectPath);
    if (!normalizedPath) continue;
    if (typeof rawTaskId === 'string' && rawTaskId.trim()) {
      map[normalizedPath] = rawTaskId.trim();
      continue;
    }
    map[normalizedPath] = null;
  }
  return map;
};

const sanitizeProjectPermissions = (value: unknown): Record<string, ProjectPermissionPolicy> => {
  if (!value || typeof value !== 'object') return {};
  const map: Record<string, ProjectPermissionPolicy> = {};
  for (const [rawProjectPath, rawPolicy] of Object.entries(value as Record<string, unknown>)) {
    const normalizedPath = normalizeProjectPath(rawProjectPath);
    if (!normalizedPath || !rawPolicy || typeof rawPolicy !== 'object') continue;
    const policy = rawPolicy as Record<string, unknown>;
    const promptResponse = policy.promptResponse === 'n' ? 'n' : 'y';
    map[normalizedPath] = {
      autonomousMode: !!policy.autonomousMode,
      autoApproveMerge: !!policy.autoApproveMerge,
      autoRespondPrompts: !!policy.autoRespondPrompts,
      promptResponse
    };
  }
  return map;
};

const inferWorktreeName = (worktreePath: string) => {
  const normalized = worktreePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = normalized.split('/').pop();
  return last && last.trim() ? last.trim() : 'restored-worktree';
};

const sanitizeTaskTabs = (value: unknown, basePathFallback: string, defaultCommandFallback: string): TaskTab[] => {
  if (!Array.isArray(value)) return [];
  const tabs: TaskTab[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const tab = item as Record<string, unknown>;

    const id = typeof tab.id === 'string' && tab.id.trim()
      ? tab.id
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = typeof tab.name === 'string' && tab.name.trim()
      ? tab.name.trim()
      : 'restored-task';
    const agent = typeof tab.agent === 'string' && tab.agent.trim()
      ? tab.agent.trim()
      : defaultCommandFallback;
    const basePath = typeof tab.basePath === 'string' && tab.basePath.trim()
      ? tab.basePath.trim()
      : basePathFallback;

    const sanitizedTab: TaskTab = {
      id,
      name,
      agent,
      basePath,
      worktreePath: typeof tab.worktreePath === 'string' && tab.worktreePath.trim() ? tab.worktreePath : undefined,
      parentTaskId: typeof tab.parentTaskId === 'string' && tab.parentTaskId.trim() ? tab.parentTaskId : undefined,
      prompt: typeof tab.prompt === 'string' ? tab.prompt : undefined,
      capabilities: tab.capabilities && typeof tab.capabilities === 'object'
        ? { autoMerge: !!(tab.capabilities as Record<string, unknown>).autoMerge }
        : undefined,
      // Restored tabs should not auto-bootstrap again unless explicitly marked false.
      hasBootstrapped: typeof tab.hasBootstrapped === 'boolean' ? tab.hasBootstrapped : true
    };

    tabs.push(sanitizedTab);
  }

  return tabs;
};

export const useOrchestrator = () => {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TaskTab[]>([]);
  const tabsRef = useRef<TaskTab[]>([]);
  const [activeTabByProject, setActiveTabByProject] = useState<Record<string, string | null>>({});
  const activeTabByProjectRef = useRef<Record<string, string | null>>({});

  const [basePath, setBasePath] = useState('');
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const [context, setContext] = useState('');
  const [envVars, setEnvVars] = useState('');
  const [defaultCommand, setDefaultCommand] = useState('claude');
  const [mcpServers, setMcpServers] = useState('');
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);

  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>({});
  const [taskTodos, setTaskTodos] = useState<Record<string, AgentTodo[]>>({});
  const [taskUsage, setTaskUsage] = useState<Record<string, TaskUsage>>({});
  const [collisions, setCollisions] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalQueueItem[]>([]);
  const [attentionEvents, setAttentionEvents] = useState<AttentionEvent[]>([]);
  const [projectPermissions, setProjectPermissions] = useState<Record<string, ProjectPermissionPolicy>>({});
  const projectPermissionsRef = useRef<Record<string, ProjectPermissionPolicy>>({});
  const autoPromptLastResponseRef = useRef<Record<string, number>>({});
  const attentionDedupRef = useRef<Record<string, number>>({});
  const fleetSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingApproval = pendingApprovals[0] || null;

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabByProjectRef.current = activeTabByProject;
  }, [activeTabByProject]);

  useEffect(() => {
    projectPermissionsRef.current = projectPermissions;
  }, [projectPermissions]);

  const validatePath = useCallback(async (path: string) => {
    if (!path) {
      setSourceStatus(null);
      return;
    }
    const result = await window.electronAPI.validateSource(path);
    setSourceStatus(result);
  }, []);

  const setBasePathAndValidate = useCallback((path: string) => {
    setBasePath(path);
    void validatePath(path);
  }, [validatePath]);

  const resolveProjectPolicy = useCallback((path: string): ProjectPermissionPolicy => {
    const normalizedPath = normalizeProjectPath(path);
    if (!normalizedPath) return DEFAULT_PROJECT_POLICY;
    return projectPermissionsRef.current[normalizedPath] || DEFAULT_PROJECT_POLICY;
  }, []);

  const updateProjectPermission = useCallback((projectPath: string, updates: Partial<ProjectPermissionPolicy>) => {
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath) return;
    setProjectPermissions(prev => {
      const current = prev[normalizedPath] || DEFAULT_PROJECT_POLICY;
      const nextPolicy: ProjectPermissionPolicy = {
        autonomousMode: updates.autonomousMode ?? current.autonomousMode,
        autoApproveMerge: updates.autoApproveMerge ?? current.autoApproveMerge,
        autoRespondPrompts: updates.autoRespondPrompts ?? current.autoRespondPrompts,
        promptResponse: updates.promptResponse === 'n' ? 'n' : (updates.promptResponse === 'y' ? 'y' : current.promptResponse)
      };
      return { ...prev, [normalizedPath]: nextPolicy };
    });
  }, []);

  const switchProject = useCallback((path: string) => {
    setBasePath(path);
    void validatePath(path);
    const normalizedPath = normalizeProjectPath(path);
    if (!normalizedPath) {
      setActiveTab(null);
      return;
    }

    const projectTabs = tabsRef.current.filter(tab => normalizeProjectPath(tab.basePath) === normalizedPath);
    const preferredTaskId = activeTabByProjectRef.current[normalizedPath];
    const nextTaskId = preferredTaskId && projectTabs.some(tab => tab.id === preferredTaskId)
      ? preferredTaskId
      : (projectTabs[0]?.id || null);
    setActiveTab(nextTaskId);
    setActiveTabByProject(prev => ({ ...prev, [normalizedPath]: nextTaskId }));
  }, [validatePath]);

  const selectTab = useCallback((taskId: string | null) => {
    if (!taskId) {
      setActiveTab(null);
      return;
    }

    const tab = tabsRef.current.find(item => item.id === taskId);
    if (!tab) return;

    setActiveTab(taskId);
    const normalizedPath = normalizeProjectPath(tab.basePath);
    if (normalizedPath) {
      setActiveTabByProject(prev => ({ ...prev, [normalizedPath]: taskId }));
    }
    if (tab.basePath !== basePath) {
      setBasePath(tab.basePath);
      void validatePath(tab.basePath);
    }
  }, [basePath, validatePath]);

  const browseForBasePath = useCallback(async () => {
    const selectedPath = await window.electronAPI.openDirectoryDialog();
    if (selectedPath) {
      switchProject(selectedPath);
    }
    return selectedPath;
  }, [switchProject]);

  const pushAttentionEvent = useCallback((event: Omit<AttentionEvent, 'id' | 'createdAt'>) => {
    if (!ATTENTION_FEED_ENABLED) return;
    const now = Date.now();
    const dedupeKey = `${event.kind}::${event.projectPath}::${event.taskId}::${event.reason}`;
    const lastAt = attentionDedupRef.current[dedupeKey] || 0;
    if (now - lastAt < 1000) return;
    attentionDedupRef.current[dedupeKey] = now;

    setAttentionEvents(prev => {
      const next: AttentionEvent[] = [
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: now,
          ...event
        },
        ...prev
      ];
      return next.slice(0, 250);
    });
  }, []);

  const dismissAttentionEvent = useCallback((eventId: string) => {
    if (!ATTENTION_FEED_ENABLED) return;
    setAttentionEvents(prev => prev.filter(event => event.id !== eventId));
  }, []);

  const clearAttentionEvents = useCallback(() => {
    if (!ATTENTION_FEED_ENABLED) return;
    setAttentionEvents([]);
  }, []);

  const clearAttentionForTask = useCallback((taskId: string, kinds?: AttentionEvent['kind'][]) => {
    if (!ATTENTION_FEED_ENABLED) return;
    setAttentionEvents(prev => prev.filter((event) => {
      if (event.taskId !== taskId) return true;
      if (!kinds || kinds.length === 0) return false;
      return !kinds.includes(event.kind);
    }));
  }, []);

  const removeTaskFromState = useCallback((taskId: string) => {
    const base = tabsRef.current;
    const removedTab = base.find(t => t.id === taskId);
    const remainingTabs = base.filter(t => t.id !== taskId);
    tabsRef.current = remainingTabs;
    setTabs(remainingTabs);
    setTaskStatuses(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    setTaskTodos(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    setTaskUsage(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    if (removedTab) {
      const normalizedProjectPath = normalizeProjectPath(removedTab.basePath);
      if (normalizedProjectPath) {
        const nextProjectTask = remainingTabs.find(tab => normalizeProjectPath(tab.basePath) === normalizedProjectPath)?.id || null;
        setActiveTabByProject(prev => ({ ...prev, [normalizedProjectPath]: nextProjectTask }));
      }
    }

    setActiveTab(prevActive => {
      if (prevActive !== taskId) return prevActive;
      if (removedTab) {
        const removedProjectPath = normalizeProjectPath(removedTab.basePath);
        const sameProject = remainingTabs.find(tab => normalizeProjectPath(tab.basePath) === removedProjectPath);
        if (sameProject) return sameProject.id;
      }
      return remainingTabs[0]?.id || null;
    });
  }, []);

  const closeTaskById = useCallback(async (taskId: string, action: CloseAction) => {
    const tabToClose = tabsRef.current.find(t => t.id === taskId);
    if (!tabToClose) return { success: false, error: 'Task not found' };

    if (!tabToClose.worktreePath) {
      window.electronAPI.destroyPty(taskId);
      removeTaskFromState(taskId);
      return { success: true };
    }

    const res = action === 'merge'
      ? await window.electronAPI.mergeWorktree(tabToClose.basePath, tabToClose.name, tabToClose.worktreePath)
      : await window.electronAPI.removeWorktree(tabToClose.basePath, tabToClose.name, tabToClose.worktreePath, true);

    if (res.success) {
      void window.electronAPI.fleetMarkClosed(taskId, action);
      void window.electronAPI.fleetRecordEvent(taskId, action === 'merge' ? 'worktree_merged' : 'worktree_deleted', {
        branch: tabToClose.name,
        worktreePath: tabToClose.worktreePath
      });
      window.electronAPI.destroyPty(taskId);
      removeTaskFromState(taskId);
    }

    return res;
  }, [removeTaskFromState]);

  const createTask = useCallback(async ({
    rawTaskName,
    agentCommand,
    prompt,
    capabilities,
    parentTaskId,
    activate = true
  }: CreateTaskInput): Promise<CreateTaskResult> => {
    if (!basePath) {
      return { success: false, error: 'Base path is empty' };
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taskName = sanitizeTaskName(rawTaskName, id);
    const newTask: TaskTab = {
      id,
      name: taskName,
      agent: agentCommand,
      basePath,
      parentTaskId,
      prompt,
      capabilities,
      hasBootstrapped: false
    };

    const nextTabs = [...tabsRef.current, newTask];
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    const normalizedProjectPath = normalizeProjectPath(basePath);
    if (normalizedProjectPath) {
      setActiveTabByProject(prev => ({ ...prev, [normalizedProjectPath]: activate ? id : (prev[normalizedProjectPath] ?? null) }));
    }
    if (activate) setActiveTab(id);

    try {
      const result = await window.electronAPI.createWorktree(basePath, taskName);
      if (result.success && result.worktreePath) {
        tabsRef.current = tabsRef.current.map(t => (t.id === id ? { ...t, worktreePath: result.worktreePath } : t));
        setTabs(tabsRef.current);
        void window.electronAPI.fleetRecordEvent(id, 'task_spawned', {
          basePath,
          worktreePath: result.worktreePath,
          agent: agentCommand,
          parentTaskId: parentTaskId || null
        });
        return { success: true, taskId: id };
      }

      removeTaskFromState(id);
      return { success: false, error: result.error || 'Unable to create worktree' };
    } catch (e: any) {
      removeTaskFromState(id);
      return { success: false, error: e.message };
    }
  }, [basePath, removeTaskFromState]);

  const markTaskBootstrapped = useCallback((taskId: string) => {
    let changed = false;
    tabsRef.current = tabsRef.current.map(tab => {
      if (tab.id !== taskId) return tab;
      if (tab.hasBootstrapped) return tab;
      changed = true;
      return { ...tab, hasBootstrapped: true };
    });
    if (changed) {
      setTabs(tabsRef.current);
    }
  }, []);

  const handoverTask = useCallback((taskId: string, command: string, prompt: string) => {
    window.electronAPI.writePty(taskId, '\x03');
    setTimeout(() => {
      const quotedPrompt = shellQuote(prompt);
      window.electronAPI.writePty(taskId, `clear && echo "Handover initiated..." && ${command} ${quotedPrompt}\r`);
    }, 500);

    tabsRef.current = tabsRef.current.map(t => (t.id === taskId ? { ...t, agent: command } : t));
    setTabs(tabsRef.current);
    void window.electronAPI.fleetRecordEvent(taskId, 'handover', { command, promptLength: prompt.length });
  }, []);

  const splitTask = useCallback(async ({ parentTaskId, objective, count, command }: SplitTaskInput) => {
    const parentTab = tabsRef.current.find(t => t.id === parentTaskId);
    if (!parentTab) return [];

    const safeCount = Math.min(8, Math.max(2, count));
    const suffixSeed = Date.now().toString().slice(-4);
    const createdTaskIds: string[] = [];

    for (let i = 1; i <= safeCount; i += 1) {
      const branchName = `${parentTab.name}-sub-${i}-${suffixSeed}`;
      const subtaskPrompt = buildSubtaskPrompt(parentTab.name, objective, i, safeCount);
      const result = await createTask({
        rawTaskName: branchName,
        agentCommand: command,
        prompt: subtaskPrompt,
        capabilities: { autoMerge: false },
        parentTaskId: parentTaskId,
        activate: false
      });
      if (result.success && result.taskId) {
        createdTaskIds.push(result.taskId);
      }
    }

    if (createdTaskIds.length > 0) {
      selectTab(createdTaskIds[0]);
      void window.electronAPI.fleetRecordEvent(parentTaskId, 'subtasks_spawned', {
        objective,
        count: safeCount,
        createdTaskIds
      });
    }

    return createdTaskIds;
  }, [createTask, selectTab]);

  const approvePendingRequest = useCallback(async () => {
    if (!pendingApproval) return;

    window.electronAPI.respondToAgent(pendingApproval.requestId, 200, { status: 'approved' });
    if (pendingApproval.action === 'merge') {
      const res = await closeTaskById(pendingApproval.taskId, 'merge');
      if (!res.success) {
        alert(`Failed to merge worktree: ${res.error}`);
      }
    }
    void window.electronAPI.fleetRecordEvent(pendingApproval.taskId, 'approval_accepted', { action: pendingApproval.action });
    clearAttentionForTask(pendingApproval.taskId, ['approval_required']);
    setPendingApprovals(prev => prev.filter(item => item.requestId !== pendingApproval.requestId));
  }, [pendingApproval, closeTaskById, clearAttentionForTask]);

  const rejectPendingRequest = useCallback(() => {
    if (!pendingApproval) return;
    window.electronAPI.respondToAgent(pendingApproval.requestId, 403, { error: 'Request denied by user' });
    void window.electronAPI.fleetRecordEvent(pendingApproval.taskId, 'approval_rejected', { action: pendingApproval.action });
    clearAttentionForTask(pendingApproval.taskId, ['approval_required']);
    setPendingApprovals(prev => prev.filter(item => item.requestId !== pendingApproval.requestId));
  }, [pendingApproval, clearAttentionForTask]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const detectAgentsPromise = window.electronAPI.detectAgents()
        .then((agents) => {
          if (!cancelled) setAvailableAgents(agents);
        })
        .catch(() => {
          if (!cancelled) setAvailableAgents([]);
        });

      const [storeRes, runtimeRes] = await Promise.all([
        window.electronAPI.loadStore(),
        window.electronAPI.loadRuntimeSession()
      ]);
      if (cancelled) return;

      const storeData = (storeRes.success && storeRes.data) ? storeRes.data : null;
      const runtimeData = (runtimeRes.success && runtimeRes.data) ? runtimeRes.data : null;
      let sessionStorageData: any = null;
      if (typeof window !== 'undefined') {
        try {
          const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
          if (raw) sessionStorageData = JSON.parse(raw);
        } catch {
          // Ignore malformed session storage and continue.
        }
      }

      const defaultPath = await window.electronAPI.getDefaultPath();
      if (cancelled) return;

      const rawTabs = runtimeData?.tabs ?? sessionStorageData?.tabs ?? [];
      const firstRuntimeBasePath = Array.isArray(rawTabs) && rawTabs[0] && typeof rawTabs[0] === 'object'
        ? (rawTabs[0] as Record<string, unknown>).basePath
        : undefined;
      const resolvedBasePath = normalizeProjectPath(storeData?.basePath
        || runtimeData?.basePath
        || sessionStorageData?.basePath
        || (typeof firstRuntimeBasePath === 'string' ? firstRuntimeBasePath : '')
        || defaultPath);
      const resolvedDefaultCommand = storeData?.defaultCommand || runtimeData?.defaultCommand || 'claude';
      const runtimeActiveTabByProject = sanitizeActiveTabByProjectMap(runtimeData?.activeTabByProject ?? sessionStorageData?.activeTabByProject);
      const sanitizedProjectPermissions = sanitizeProjectPermissions(storeData?.projectPermissions);

      setBasePath(resolvedBasePath);
      void validatePath(resolvedBasePath);
      if (storeData?.context) setContext(storeData.context);
        // Env vars are intentionally not loaded from persistent disk storage.
      if (storeData?.defaultCommand) setDefaultCommand(storeData.defaultCommand);
      if (storeData?.mcpServers) setMcpServers(storeData.mcpServers);

      const rawActiveTab = runtimeData?.activeTab ?? sessionStorageData?.activeTab ?? null;
      const runtimeTaskUsage = sanitizeTaskUsageMap(runtimeData?.taskUsage ?? sessionStorageData?.taskUsage);
      const runtimeTaskTodos = sanitizeTaskTodosMap(runtimeData?.taskTodos ?? sessionStorageData?.taskTodos);
      const runtimeTaskStatuses = sanitizeTaskStatusMap(runtimeData?.taskStatuses ?? sessionStorageData?.taskStatuses);

      const candidateTabs = sanitizeTaskTabs(rawTabs, resolvedBasePath, resolvedDefaultCommand)
        .map(tab => ({ ...tab, basePath: normalizeProjectPath(tab.basePath) || resolvedBasePath }));
      const projectPaths = Array.from(new Set([
        resolvedBasePath,
        ...candidateTabs.map(tab => normalizeProjectPath(tab.basePath)).filter(Boolean)
      ]));

      const rebuiltTabs: TaskTab[] = [];
      const now = Date.now();
      let restoredCount = 0;
      const worktreeResults = await Promise.all(
        projectPaths.map(async (projectPath) => ({
          projectPath,
          worktreeRes: await window.electronAPI.listWorktrees(projectPath)
        }))
      );

      for (const { projectPath, worktreeRes } of worktreeResults) {
        const projectTabs = candidateTabs
          .filter(tab => normalizeProjectPath(tab.basePath) === projectPath)
          .map(tab => ({ ...tab, basePath: projectPath }));
        if (!cancelled && worktreeRes.success && Array.isArray(worktreeRes.worktrees)) {
          const worktrees = worktreeRes.worktrees;
          const pathToWorktree = new Map<string, { path: string; branchName?: string | null }>();
          const nameToPath = new Map<string, string>();

          for (const wt of worktrees) {
            if (!wt?.path) continue;
            pathToWorktree.set(normalizeProjectPath(wt.path), wt);
            if (wt.branchName) {
              nameToPath.set(wt.branchName, wt.path);
            }
          }

          const matchedTabs = projectTabs
            .map(tab => {
              const normalizedWorktree = tab.worktreePath ? normalizeProjectPath(tab.worktreePath) : '';
              if (normalizedWorktree && pathToWorktree.has(normalizedWorktree)) {
                return { ...tab, worktreePath: normalizedWorktree };
              }
              const matchedPath = nameToPath.get(tab.name);
              if (matchedPath) {
                return { ...tab, worktreePath: normalizeProjectPath(matchedPath) };
              }
              return tab;
            })
            .filter(tab => !!tab.worktreePath);

          const knownWorktreePaths = new Set(matchedTabs.map(tab => normalizeProjectPath(tab.worktreePath || '')).filter(Boolean));
          const knownNames = new Set(matchedTabs.map(tab => tab.name));
          for (const wt of worktrees) {
            if (!wt.path) continue;
            const normalizedWorktreePath = normalizeProjectPath(wt.path);
            const fallbackName = wt.branchName || inferWorktreeName(normalizedWorktreePath);
            if (knownWorktreePaths.has(normalizedWorktreePath) || knownNames.has(fallbackName)) continue;
            restoredCount += 1;
            matchedTabs.push({
              id: `restored-${now}-${restoredCount}`,
              name: fallbackName,
              agent: resolvedDefaultCommand,
              basePath: projectPath,
              worktreePath: normalizedWorktreePath,
              capabilities: { autoMerge: false },
              hasBootstrapped: true
            });
          }

          rebuiltTabs.push(...matchedTabs);
          continue;
        }

        if (!cancelled) {
          const checks = await Promise.all(
            projectTabs.map(async (tab) => {
              if (!tab.worktreePath) return { tab, valid: false };
              const validation = await window.electronAPI.validateSource(tab.worktreePath);
              return { tab, valid: !!validation.valid };
            })
          );
          rebuiltTabs.push(...checks.filter(entry => entry.valid).map(entry => entry.tab));
        }
      }

      const uniqueTabs = new Map<string, TaskTab>();
      for (const tab of rebuiltTabs) {
        if (!tab.worktreePath) continue;
        const key = `${normalizeProjectPath(tab.basePath)}::${normalizeProjectPath(tab.worktreePath)}`;
        uniqueTabs.set(key, tab);
      }
      const finalTabs = Array.from(uniqueTabs.values());
      const finalActiveTabByProject: Record<string, string | null> = { ...runtimeActiveTabByProject };
      const projectSet = new Set<string>([resolvedBasePath]);
      finalTabs.forEach((tab) => projectSet.add(normalizeProjectPath(tab.basePath)));
      for (const projectPath of projectSet) {
        const tabsForProject = finalTabs.filter(tab => normalizeProjectPath(tab.basePath) === projectPath);
        const preferredTaskId = finalActiveTabByProject[projectPath];
        finalActiveTabByProject[projectPath] = preferredTaskId && tabsForProject.some(tab => tab.id === preferredTaskId)
          ? preferredTaskId
          : (tabsForProject[0]?.id || null);
      }

      const finalActiveTab = finalTabs.some(tab => tab.id === rawActiveTab)
        ? rawActiveTab
        : (finalActiveTabByProject[resolvedBasePath] || finalTabs[0]?.id || null);
      const seededProjectPolicies: Record<string, ProjectPermissionPolicy> = { ...sanitizedProjectPermissions };
      for (const projectPath of projectSet) {
        if (!seededProjectPolicies[projectPath]) {
          seededProjectPolicies[projectPath] = { ...DEFAULT_PROJECT_POLICY };
        }
      }

      tabsRef.current = finalTabs;
      setTabs(finalTabs);
      setActiveTab(finalActiveTab);
      setActiveTabByProject(finalActiveTabByProject);
      setProjectPermissions(seededProjectPolicies);
      setTaskUsage(runtimeTaskUsage);
      setTaskTodos(runtimeTaskTodos);
      setTaskStatuses(runtimeTaskStatuses);
      setPendingApprovals([]);

      if (!cancelled) setIsLoaded(true);
      await detectAgentsPromise;
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [validatePath]);

  useEffect(() => {
    if (!isLoaded) return;
    // Persist workspace defaults only. Env vars are excluded from disk persistence for safety.
    void window.electronAPI.saveStore({ basePath, context, defaultCommand, mcpServers, projectPermissions });
  }, [isLoaded, basePath, context, defaultCommand, mcpServers, projectPermissions]);

  useEffect(() => {
    if (!isLoaded) return;
    // Session state is persisted to survive renderer refreshes and full app restarts.
    void window.electronAPI.saveRuntimeSession({ basePath, tabs, activeTab, activeTabByProject, taskUsage, taskTodos, taskStatuses });

    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ basePath, tabs, activeTab, activeTabByProject, taskUsage, taskTodos, taskStatuses }));
      } catch {
        // Ignore session storage write failures.
      }
    }
  }, [isLoaded, basePath, tabs, activeTab, activeTabByProject, taskUsage, taskTodos, taskStatuses]);

  useEffect(() => {
    if (!isLoaded) return;
    if (fleetSyncTimerRef.current) {
      clearTimeout(fleetSyncTimerRef.current);
    }

    fleetSyncTimerRef.current = setTimeout(() => {
      const currentTabs = tabsRef.current;
      currentTabs.forEach((tab) => {
        const status = taskStatuses[tab.id];
        const usage = taskUsage[tab.id];
        void window.electronAPI.fleetTrackTask({
          taskId: tab.id,
          runtimeTaskId: tab.id,
          basePath: tab.basePath,
          worktreePath: tab.worktreePath,
          name: tab.name,
          agent: tab.agent,
          prompt: tab.prompt,
          parentTaskId: tab.parentTaskId,
          status: status?.isBlocked ? 'blocked' : (status?.isReady ? 'running' : 'provisioning'),
          isReady: status?.isReady || false,
          isDirty: status?.isDirty || false,
          hasCollision: status?.hasCollision || false,
          isBlocked: status?.isBlocked || false,
          blockedReason: status?.blockedReason,
          usage
        });
      });
    }, 250);

    return () => {
      if (fleetSyncTimerRef.current) {
        clearTimeout(fleetSyncTimerRef.current);
        fleetSyncTimerRef.current = null;
      }
    };
  }, [isLoaded, tabs, taskStatuses, taskUsage]);

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    const unsubAgentRequest = window.electronAPI.onAgentRequest((req) => {
      const currentTabs = tabsRef.current;
      const tab = currentTabs.find(t => t.id === req.taskId);
      if (!tab) {
        window.electronAPI.respondToAgent(req.requestId, 404, { error: 'Task not found' });
        return;
      }
      const policy = resolveProjectPolicy(tab.basePath);
      const shouldAutoApproveMerge = req.action === 'merge' && (tab.capabilities?.autoMerge || policy.autonomousMode || policy.autoApproveMerge);
      if (shouldAutoApproveMerge) {
        pushAttentionEvent({
          kind: 'approval_auto_approved',
          projectPath: tab.basePath,
          taskId: req.taskId,
          taskName: tab.name,
          reason: `Auto-approved ${req.action} request`,
          requiresAction: false
        });
        window.electronAPI.respondToAgent(req.requestId, 200, { status: 'approved', message: 'Merge initiated' });
        void window.electronAPI.fleetRecordEvent(req.taskId, 'approval_auto_accepted', {
          action: req.action,
          source: policy.autonomousMode ? 'project_autonomous_mode' : (policy.autoApproveMerge ? 'project_policy' : 'task_capability')
        });
        setTimeout(() => {
          void closeTaskById(req.taskId, 'merge');
        }, 100);
        return;
      }

      if (policy.autonomousMode) {
        pushAttentionEvent({
          kind: 'approval_auto_approved',
          projectPath: tab.basePath,
          taskId: req.taskId,
          taskName: tab.name,
          reason: `Autonomous mode approved ${req.action} request`,
          requiresAction: false
        });
        window.electronAPI.respondToAgent(req.requestId, 200, { status: 'approved', message: 'Approved by autonomous mode' });
        void window.electronAPI.fleetRecordEvent(req.taskId, 'approval_auto_accepted', {
          action: req.action,
          source: 'project_autonomous_mode'
        });
        return;
      }

      pushAttentionEvent({
        kind: 'approval_required',
        projectPath: tab.basePath,
        taskId: req.taskId,
        taskName: tab.name,
        reason: `Approval required for ${req.action}`,
        requiresAction: true
      });
      setPendingApprovals(prev => {
        if (prev.some(item => item.requestId === req.requestId)) return prev;
        return [...prev, { ...req, projectPath: tab.basePath }];
      });
    });
    unsubscribers.push(unsubAgentRequest);

    const unsubAgentBlocked = window.electronAPI.onAgentBlocked(({ taskId, isBlocked, reason }) => {
      setTaskStatuses(prev => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { isReady: true, isDirty: false, hasCollision: false }),
          isBlocked,
          blockedReason: isBlocked ? reason : undefined
        }
      }));

      if (!isBlocked) {
        clearAttentionForTask(taskId, ['blocked']);
        return;
      }
      const tab = tabsRef.current.find(entry => entry.id === taskId);
      if (!tab) return;
      pushAttentionEvent({
        kind: 'blocked',
        projectPath: tab.basePath,
        taskId,
        taskName: tab.name,
        reason: reason || 'Agent is waiting for confirmation',
        requiresAction: true
      });
      const policy = resolveProjectPolicy(tab.basePath);
      if (!policy.autonomousMode && !policy.autoRespondPrompts) return;

      const lastSentAt = autoPromptLastResponseRef.current[taskId] || 0;
      const now = Date.now();
      if (now - lastSentAt < 1200) return;
      autoPromptLastResponseRef.current[taskId] = now;

      setTimeout(() => {
        window.electronAPI.writePty(taskId, `${policy.promptResponse}\r`);
      }, 120);
      void window.electronAPI.fleetRecordEvent(taskId, 'prompt_auto_response', {
        response: policy.promptResponse,
        reason: reason || null,
        source: policy.autonomousMode ? 'project_autonomous_mode' : 'project_policy'
      });
    });
    unsubscribers.push(unsubAgentBlocked);

    const unsubAgentTodos = window.electronAPI.onAgentTodos((req) => {
      if (!Array.isArray(req.payload)) return;
      setTaskTodos(prev => ({ ...prev, [req.taskId]: req.payload }));
    });
    unsubscribers.push(unsubAgentTodos);

    const applyUsagePayload = (taskId: string, payload: unknown) => {
      const tabExists = tabsRef.current.some(tab => tab.id === taskId);
      if (!tabExists) return;
      const usage = extractTaskUsage(payload);
      if (!usage) return;
      setTaskUsage(prev => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || {}),
          ...usage
        }
      }));
    };

    const unsubAgentMessage = window.electronAPI.onAgentMessage((req) => {
      applyUsagePayload(req.taskId, req.payload);
    });
    unsubscribers.push(unsubAgentMessage);

    const unsubAgentUsage = window.electronAPI.onAgentUsage((req) => {
      applyUsagePayload(req.taskId, req.payload);
    });
    unsubscribers.push(unsubAgentUsage);

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [closeTaskById, resolveProjectPolicy, pushAttentionEvent, clearAttentionForTask]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const pollStatuses = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlight = true;

      try {
        const currentTabs = tabsRef.current;
        if (currentTabs.length === 0) {
          setCollisions([]);
          setTaskStatuses({});
          return;
        }

        const normalizedCurrentProject = normalizeProjectPath(basePath);
        const activeTabs = currentTabs.filter((tab) => {
          if (!tab.worktreePath) return false;
          if (!normalizedCurrentProject) return true;
          return normalizeProjectPath(tab.basePath) === normalizedCurrentProject;
        });
        const tabsToEvaluate = activeTabs.length > 0
          ? activeTabs
          : currentTabs.filter(tab => !!tab.worktreePath);
        const modifiedFilesMap: Record<string, string[]> = {};
        const readinessMap: Record<string, boolean> = {};
        const results = await Promise.all(
          tabsToEvaluate.map(async (tab) => {
            const res = await window.electronAPI.getModifiedFiles(tab.worktreePath!);
            return { tabId: tab.id, res };
          })
        );
        for (const { tabId, res } of results) {
          readinessMap[tabId] = !!res.success;
          if (res.success && res.files) {
            modifiedFilesMap[tabId] = res.files;
          }
        }

        const allFiles = new Map<string, string[]>();
        for (const [tabId, files] of Object.entries(modifiedFilesMap)) {
          for (const file of files) {
            const existing = allFiles.get(file) || [];
            existing.push(tabId);
            allFiles.set(file, existing);
          }
        }

        const collidingFiles: string[] = [];
        const newCollisionState: Record<string, boolean> = {};
        const newDirtyState: Record<string, boolean> = {};

        for (const [file, tabIds] of allFiles.entries()) {
          if (tabIds.length > 1) {
            collidingFiles.push(file);
            tabIds.forEach(id => {
              newCollisionState[id] = true;
            });
          }
        }

        for (const tabId of Object.keys(modifiedFilesMap)) {
          newDirtyState[tabId] = modifiedFilesMap[tabId].length > 0;
        }

        setCollisions(collidingFiles);
        setTaskStatuses(prev => {
          const next: Record<string, TaskStatus> = {};
          currentTabs.forEach(tab => {
            next[tab.id] = {
              isReady: !!tab.worktreePath && (tab.worktreePath ? readinessMap[tab.id] !== false : false),
              isDirty: newDirtyState[tab.id] || false,
              hasCollision: newCollisionState[tab.id] || false,
              isBlocked: prev[tab.id]?.isBlocked || false,
              blockedReason: prev[tab.id]?.isBlocked ? prev[tab.id]?.blockedReason : undefined
            };
          });
          return next;
        });
      } finally {
        inFlight = false;
      }
    };

    const intervalId = setInterval(() => {
      void pollStatuses();
    }, 10000);
    void pollStatuses();

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [basePath]);

  return {
    state: {
      activeTab,
      tabs,
      basePath,
      sourceStatus,
      isLoaded,
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
      pendingApprovalCount: pendingApprovals.length,
      attentionEvents,
      projectPermissions,
      activeTabByProject
    },
    actions: {
      setActiveTab: selectTab,
      setBasePathAndValidate,
      switchProject,
      browseForBasePath,
      setContext,
      setEnvVars,
      setDefaultCommand,
      setMcpServers,
      updateProjectPermission,
      dismissAttentionEvent,
      clearAttentionEvents,
      createTask,
      markTaskBootstrapped,
      closeTaskById,
      handoverTask,
      splitTask,
      approvePendingRequest,
      rejectPendingRequest,
      validatePath
    }
  };
};
