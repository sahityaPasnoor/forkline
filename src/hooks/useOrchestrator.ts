import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSubtaskPrompt, sanitizeTaskName } from '../lib/taskUtils';
import { buildHandoverPacket } from '../lib/handover';
import { buildHandoverDispatchPlan, defaultHandoverModeForCommand } from '../lib/handoverAdapters';
import type {
  AttentionEvent,
  AgentCapabilities,
  AgentInfo,
  AgentTodo,
  HandoverMode,
  HandoverResult,
  LivingSpecCandidate,
  LivingSpecPreference,
  LivingSpecSelectionPrompt,
  PendingApprovalRequest,
  ProjectPermissionPolicy,
  SourceStatus,
  TaskStatus,
  TaskTab,
  TaskUsage
} from '../models/orchestrator';

type CloseAction = 'merge' | 'delete';
const SESSION_STORAGE_KEY = 'orchestrator.runtime.session';
const ATTENTION_FEED_ENABLED = true;
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
  baseBranch?: string;
  createBaseBranchIfMissing?: boolean;
  dependencyCloneMode?: 'copy_on_write' | 'full_copy';
  livingSpecOverridePath?: string;
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

interface LivingSpecGuardResult {
  success: boolean;
  error?: string;
}

interface LivingSpecSummary {
  preferredLanguage?: string;
  requiredExts?: string[];
  forbiddenExts?: string[];
}

const normalizeProjectPath = (value: string) => value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
const normalizeRelativeRepoPath = (value: string) => value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
const isAgentsInstructionPath = (value: string) => {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();
  if (!normalized) return false;
  return normalized.split('/').pop() === 'agents.md';
};
const rankLivingSpecCandidate = (candidate: LivingSpecCandidate) => {
  const normalized = normalizeRelativePath(candidate.path).toLowerCase();
  if (normalized === 'agents.md') return 0;
  if (normalized === '.github/agents.md') return 1;
  return 2;
};
const pickPreferredLivingSpecCandidate = (candidates: LivingSpecCandidate[]) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const agentsCandidates = candidates
    .filter((candidate) => isAgentsInstructionPath(candidate.path))
    .sort((a, b) => {
      const rankDiff = rankLivingSpecCandidate(a) - rankLivingSpecCandidate(b);
      if (rankDiff !== 0) return rankDiff;
      return normalizeRelativePath(a.path).localeCompare(normalizeRelativePath(b.path));
    });
  if (agentsCandidates.length > 0) return agentsCandidates[0];
  return null;
};
const fileExtension = (filePath: string) => {
  const idx = filePath.lastIndexOf('.');
  if (idx <= 0) return '';
  return filePath.slice(idx).toLowerCase();
};

const HIGH_IMPACT_FILE_PATTERNS = [
  /^openapi(\.|$)/i,
  /(^|\/)(openapi|swagger)\.(json|ya?ml)$/i,
  /(^|\/)(schema|db|database)\.prisma$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)go\.(mod|work|sum)$/i,
  /(^|\/)Cargo\.(toml|lock)$/i,
  /(^|\/)packages\/protocol\//i,
  /(^|\/)(api|contracts|schema|proto)\//i
];

const hasHighImpactFile = (files: string[]) => files.some((file) => HIGH_IMPACT_FILE_PATTERNS.some((pattern) => pattern.test(file)));

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
      // Blocked state is runtime/ephemeral and must come from live PTY events.
      // Restoring it from persisted session data causes stale "Action Required" banners.
      isBlocked: false,
      blockedReason: undefined
    };
  }
  return map;
};

const toPersistedTaskStatusMap = (value: Record<string, TaskStatus>): Record<string, TaskStatus> => {
  const map: Record<string, TaskStatus> = {};
  for (const [taskId, status] of Object.entries(value || {})) {
    map[taskId] = {
      isReady: !!status?.isReady,
      isDirty: !!status?.isDirty,
      hasCollision: !!status?.hasCollision,
      // Persist only durable status fields. Blocked state must hydrate from live PTY events.
      isBlocked: false,
      blockedReason: undefined
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

const normalizeRelativePath = (value: string) => value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');

const sanitizeLivingSpecPreferences = (value: unknown): Record<string, LivingSpecPreference> => {
  if (!value || typeof value !== 'object') return {};
  const map: Record<string, LivingSpecPreference> = {};
  for (const [rawProjectPath, rawPreference] of Object.entries(value as Record<string, unknown>)) {
    const normalizedPath = normalizeProjectPath(rawProjectPath);
    if (!normalizedPath || !rawPreference || typeof rawPreference !== 'object') continue;
    const preference = rawPreference as Record<string, unknown>;
    const mode = preference.mode === 'consolidated' ? 'consolidated' : (preference.mode === 'single' ? 'single' : null);
    if (!mode) continue;
    if (mode === 'single') {
      const selectedPathRaw = typeof preference.selectedPath === 'string' ? normalizeRelativePath(preference.selectedPath) : '';
      if (!selectedPathRaw || selectedPathRaw.startsWith('/') || selectedPathRaw.includes('..')) continue;
      map[normalizedPath] = { mode: 'single', selectedPath: selectedPathRaw };
      continue;
    }
    map[normalizedPath] = { mode: 'consolidated' };
  }
  return map;
};

const inferWorktreeName = (worktreePath: string) => {
  const normalized = worktreePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = normalized.split('/').pop();
  return last && last.trim() ? last.trim() : 'restored-worktree';
};

const MAX_SESSION_DISPLAY_NAME_LENGTH = 72;
const MAX_SESSION_TAG_LENGTH = 24;
const MAX_SESSION_TAG_COUNT = 8;

const sanitizeSessionDisplayName = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_SESSION_DISPLAY_NAME_LENGTH);
};

const sanitizeSessionTag = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const compact = value.trim().toLowerCase().replace(/\s+/g, '-');
  const cleaned = compact.replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, MAX_SESSION_TAG_LENGTH);
};

const sanitizeSessionTags = (value: unknown) => {
  const rawValues = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of rawValues) {
    const tag = sanitizeSessionTag(rawValue);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
    if (normalized.length >= MAX_SESSION_TAG_COUNT) break;
  }
  return normalized;
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
    const displayName = sanitizeSessionDisplayName(tab.displayName);
    const tags = sanitizeSessionTags(tab.tags);
    const agent = typeof tab.agent === 'string' && tab.agent.trim()
      ? tab.agent.trim()
      : defaultCommandFallback;
    const basePath = typeof tab.basePath === 'string' && tab.basePath.trim()
      ? tab.basePath.trim()
      : basePathFallback;

    const sanitizedTab: TaskTab = {
      id,
      name,
      displayName: displayName && displayName !== name ? displayName : undefined,
      tags: tags.length > 0 ? tags : undefined,
      agent,
      basePath,
      worktreePath: typeof tab.worktreePath === 'string' && tab.worktreePath.trim() ? tab.worktreePath : undefined,
      parentBranch: typeof tab.parentBranch === 'string' && tab.parentBranch.trim() ? tab.parentBranch.trim() : undefined,
      parentTaskId: typeof tab.parentTaskId === 'string' && tab.parentTaskId.trim() ? tab.parentTaskId : undefined,
      prompt: typeof tab.prompt === 'string' ? tab.prompt : undefined,
      livingSpecOverridePath: typeof tab.livingSpecOverridePath === 'string' && tab.livingSpecOverridePath.trim()
        ? normalizeRelativeRepoPath(tab.livingSpecOverridePath)
        : undefined,
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

const buildRestoredTaskId = () => `restored-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  const [packageStoreStrategy, setPackageStoreStrategy] = useState<'off' | 'pnpm_global' | 'polyglot_global'>('off');
  const [dependencyCloneMode, setDependencyCloneMode] = useState<'copy_on_write' | 'full_copy'>('copy_on_write');
  const [pnpmStorePath, setPnpmStorePath] = useState('');
  const [sharedCacheRoot, setSharedCacheRoot] = useState('');
  const [pnpmAutoInstall, setPnpmAutoInstall] = useState(false);
  const [sandboxMode, setSandboxMode] = useState<'off' | 'auto' | 'seatbelt' | 'firejail'>('off');
  const [networkGuard, setNetworkGuard] = useState<'off' | 'none'>('off');
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);

  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>({});
  const [taskTodos, setTaskTodos] = useState<Record<string, AgentTodo[]>>({});
  const [taskUsage, setTaskUsage] = useState<Record<string, TaskUsage>>({});
  const [collisions, setCollisions] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalQueueItem[]>([]);
  const [attentionEvents, setAttentionEvents] = useState<AttentionEvent[]>([]);
  const [projectPermissions, setProjectPermissions] = useState<Record<string, ProjectPermissionPolicy>>({});
  const [livingSpecPreferences, setLivingSpecPreferences] = useState<Record<string, LivingSpecPreference>>({});
  const [livingSpecCandidatesByProject, setLivingSpecCandidatesByProject] = useState<Record<string, LivingSpecCandidate[]>>({});
  const [livingSpecSummariesByProject, setLivingSpecSummariesByProject] = useState<Record<string, LivingSpecSummary>>({});
  const [livingSpecSelectionPrompt, setLivingSpecSelectionPrompt] = useState<LivingSpecSelectionPrompt | null>(null);
  const projectPermissionsRef = useRef<Record<string, ProjectPermissionPolicy>>({});
  const livingSpecPreferencesRef = useRef<Record<string, LivingSpecPreference>>({});
  const livingSpecSummariesRef = useRef<Record<string, LivingSpecSummary>>({});
  const autoPromptLastResponseRef = useRef<Record<string, number>>({});
  const attentionDedupRef = useRef<Record<string, number>>({});
  const fleetSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingApproval = pendingApprovals[0] || null;
  const refreshLivingSpecSummaryForProject = useCallback(async (projectPath: string) => {
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath) return;
    const preference = livingSpecPreferencesRef.current[normalizedPath];
    const response = await window.electronAPI.getLivingSpecSummary(normalizedPath, preference);
    if (!response.success || !response.summary) {
      setLivingSpecSummariesByProject((prev) => {
        const next = { ...prev };
        delete next[normalizedPath];
        return next;
      });
      return;
    }
    setLivingSpecSummariesByProject((prev) => ({
      ...prev,
      [normalizedPath]: response.summary as LivingSpecSummary
    }));
  }, []);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabByProjectRef.current = activeTabByProject;
  }, [activeTabByProject]);

  useEffect(() => {
    projectPermissionsRef.current = projectPermissions;
  }, [projectPermissions]);

  useEffect(() => {
    livingSpecPreferencesRef.current = livingSpecPreferences;
  }, [livingSpecPreferences]);

  useEffect(() => {
    livingSpecSummariesRef.current = livingSpecSummariesByProject;
  }, [livingSpecSummariesByProject]);

  useEffect(() => {
    const normalizedPath = normalizeProjectPath(basePath);
    if (!normalizedPath) return;
    void refreshLivingSpecSummaryForProject(normalizedPath);
  }, [basePath, livingSpecPreferences, refreshLivingSpecSummaryForProject]);

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

  const isLivingSpecPreferenceValid = useCallback((preference: LivingSpecPreference | undefined, candidates: LivingSpecCandidate[]) => {
    if (!preference) return false;
    if (candidates.length === 0) return true;
    const agentsCandidates = candidates.filter((candidate) => isAgentsInstructionPath(candidate.path));
    if (agentsCandidates.length > 0) {
      if (preference.mode !== 'single' || !preference.selectedPath) return false;
      const normalizedSelection = normalizeRelativePath(preference.selectedPath);
      return agentsCandidates.some((candidate) => normalizeRelativePath(candidate.path) === normalizedSelection);
    }
    if (preference.mode === 'consolidated') return true;
    if (!preference.selectedPath) return false;
    const normalizedSelection = normalizeRelativePath(preference.selectedPath);
    return candidates.some((candidate) => normalizeRelativePath(candidate.path) === normalizedSelection);
  }, []);

  const setProjectLivingSpecPreference = useCallback((projectPath: string, preference: LivingSpecPreference) => {
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath) return;
    setLivingSpecPreferences((prev) => ({ ...prev, [normalizedPath]: preference }));
    void refreshLivingSpecSummaryForProject(normalizedPath);
  }, [refreshLivingSpecSummaryForProject]);

  const detectLivingSpecCandidatesForProject = useCallback(async (projectPath: string): Promise<LivingSpecCandidate[]> => {
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath) return [];
    const response = await window.electronAPI.detectLivingSpecCandidates(normalizedPath);
    if (!response.success || !Array.isArray(response.candidates)) {
      setLivingSpecCandidatesByProject((prev) => ({ ...prev, [normalizedPath]: [] }));
      return [];
    }
    const candidates = response.candidates
      .filter((candidate) => candidate && typeof candidate.path === 'string' && candidate.path.trim())
      .map((candidate) => ({
        path: normalizeRelativePath(candidate.path),
        kind: typeof candidate.kind === 'string' && candidate.kind.trim() ? candidate.kind.trim() : 'spec'
      }))
      .filter((candidate) => candidate.path && !candidate.path.startsWith('/') && !candidate.path.includes('..'));
    setLivingSpecCandidatesByProject((prev) => ({ ...prev, [normalizedPath]: candidates }));
    return candidates;
  }, []);

  const ensureLivingSpecSelection = useCallback(async (projectPath: string): Promise<LivingSpecGuardResult> => {
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath) return { success: true };
    const existingCandidates = livingSpecCandidatesByProject[normalizedPath];
    const candidates = Array.isArray(existingCandidates)
      ? existingCandidates
      : await detectLivingSpecCandidatesForProject(normalizedPath);
    if (candidates.length === 0) return { success: true };

    const currentPreference = livingSpecPreferencesRef.current[normalizedPath];
    if (isLivingSpecPreferenceValid(currentPreference, candidates)) {
      return { success: true };
    }

    const preferredCandidate = pickPreferredLivingSpecCandidate(candidates);
    if (preferredCandidate) {
      setProjectLivingSpecPreference(normalizedPath, {
        mode: 'single',
        selectedPath: preferredCandidate.path
      });
      return { success: true };
    }

    if (candidates.length === 1) {
      setProjectLivingSpecPreference(normalizedPath, {
        mode: 'single',
        selectedPath: candidates[0].path
      });
      return { success: true };
    }

    setLivingSpecSelectionPrompt({ projectPath: normalizedPath, candidates });
    return {
      success: false,
      error: 'Choose an AGENTS.md instruction file before spawning a new task.'
    };
  }, [detectLivingSpecCandidatesForProject, isLivingSpecPreferenceValid, livingSpecCandidatesByProject, setProjectLivingSpecPreference]);

  const resolveLivingSpecSelectionPrompt = useCallback((preference: LivingSpecPreference) => {
    const currentPrompt = livingSpecSelectionPrompt;
    if (!currentPrompt) return;
    if (preference.mode === 'single') {
      const normalizedSelection = normalizeRelativePath(preference.selectedPath || '');
      const isKnown = currentPrompt.candidates.some((candidate) => normalizeRelativePath(candidate.path) === normalizedSelection);
      if (!isKnown) return;
      setProjectLivingSpecPreference(currentPrompt.projectPath, { mode: 'single', selectedPath: normalizedSelection });
      setLivingSpecSelectionPrompt(null);
      return;
    }
    setProjectLivingSpecPreference(currentPrompt.projectPath, { mode: 'consolidated' });
    setLivingSpecSelectionPrompt(null);
  }, [livingSpecSelectionPrompt, setProjectLivingSpecPreference]);

  const dismissLivingSpecSelectionPrompt = useCallback(() => {
    setLivingSpecSelectionPrompt(null);
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
    const dedupeWindowMs = event.kind === 'context_alert' || event.kind === 'spec_deviation' ? 120_000 : 1_500;
    if (now - lastAt < dedupeWindowMs) return;
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
    baseBranch,
    createBaseBranchIfMissing,
    dependencyCloneMode: taskDependencyCloneMode,
    livingSpecOverridePath,
    capabilities,
    parentTaskId,
    activate = true
  }: CreateTaskInput): Promise<CreateTaskResult> => {
    if (!basePath) {
      return { success: false, error: 'Base path is empty' };
    }
    const livingSpecGuard = await ensureLivingSpecSelection(basePath);
    if (!livingSpecGuard.success) {
      return { success: false, error: livingSpecGuard.error || 'Living Spec selection is required.' };
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taskName = sanitizeTaskName(rawTaskName, id);
    const selectedParentBranch = typeof baseBranch === 'string' && baseBranch.trim() ? baseBranch.trim() : undefined;
    const newTask: TaskTab = {
      id,
      name: taskName,
      agent: agentCommand,
      basePath,
      parentBranch: selectedParentBranch,
      parentTaskId,
      prompt,
      livingSpecOverridePath: livingSpecOverridePath ? normalizeRelativeRepoPath(livingSpecOverridePath) : undefined,
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
      const result = await window.electronAPI.createWorktree(basePath, taskName, baseBranch, {
        createBaseBranchIfMissing,
        dependencyCloneMode: taskDependencyCloneMode || dependencyCloneMode,
        packageStoreStrategy,
        pnpmStorePath,
        sharedCacheRoot,
        pnpmAutoInstall
      });
      if (result.success && result.worktreePath) {
        tabsRef.current = tabsRef.current.map(t => (t.id === id ? { ...t, worktreePath: result.worktreePath } : t));
        setTabs(tabsRef.current);
        void window.electronAPI.fleetRecordEvent(id, 'task_spawned', {
          basePath,
          worktreePath: result.worktreePath,
          agent: agentCommand,
          parentBranch: selectedParentBranch || null,
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
  }, [basePath, dependencyCloneMode, ensureLivingSpecSelection, packageStoreStrategy, pnpmAutoInstall, pnpmStorePath, removeTaskFromState, sharedCacheRoot]);

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

  const renameTaskSession = useCallback((taskId: string, requestedName: string) => {
    const requested = sanitizeSessionDisplayName(requestedName);
    let changed = false;
    let persistedDisplayName: string | undefined;

    tabsRef.current = tabsRef.current.map((tab) => {
      if (tab.id !== taskId) return tab;
      const fallbackName = sanitizeSessionDisplayName(tab.name);
      const previousDisplayName = sanitizeSessionDisplayName(tab.displayName);
      const normalizedPrevious = previousDisplayName && previousDisplayName !== fallbackName ? previousDisplayName : '';
      const normalizedNext = requested && requested !== fallbackName ? requested : '';
      if (normalizedNext === normalizedPrevious) return tab;
      changed = true;
      persistedDisplayName = normalizedNext || undefined;
      return {
        ...tab,
        displayName: normalizedNext || undefined
      };
    });

    if (!changed) return false;
    setTabs(tabsRef.current);
    void window.electronAPI.fleetRecordEvent(taskId, 'session_renamed', {
      displayName: persistedDisplayName || null
    });
    return true;
  }, []);

  const setTaskTags = useCallback((taskId: string, requestedTags: string[] | string) => {
    const normalizedNextTags = sanitizeSessionTags(requestedTags);
    let changed = false;

    tabsRef.current = tabsRef.current.map((tab) => {
      if (tab.id !== taskId) return tab;
      const normalizedPreviousTags = sanitizeSessionTags(tab.tags);
      const isSameLength = normalizedPreviousTags.length === normalizedNextTags.length;
      const isSameValue = isSameLength && normalizedPreviousTags.every((tag, index) => normalizedNextTags[index] === tag);
      if (isSameValue) return tab;
      changed = true;
      return {
        ...tab,
        tags: normalizedNextTags.length > 0 ? normalizedNextTags : undefined
      };
    });

    if (!changed) return false;
    setTabs(tabsRef.current);
    void window.electronAPI.fleetRecordEvent(taskId, 'session_tags_updated', {
      tags: normalizedNextTags
    });
    return true;
  }, []);

  const handoverTask = useCallback(async (
    taskId: string,
    command: string,
    prompt: string,
    modeOverride?: HandoverMode
  ): Promise<HandoverResult> => {
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    try {
      const tab = tabsRef.current.find((item) => item.id === taskId);
      if (!tab) {
        return { success: false, error: 'Task not found.' };
      }
      if (!tab.worktreePath) {
        return { success: false, error: 'Task worktree is not ready for handover.' };
      }
      const targetCommand = command.trim();
      if (!targetCommand) {
        return { success: false, error: 'Target agent command is empty.' };
      }
      const operatorInstruction = prompt.trim();
      if (!operatorInstruction) {
        return { success: false, error: 'Handover instruction cannot be empty.' };
      }

      const ensurePtySession = async () => {
        try {
          const sessionsResult = await window.electronAPI.listPtySessions();
          const session = sessionsResult.success
            ? sessionsResult.sessions?.find((item) => item.taskId === taskId)
            : undefined;
          if (!session || !session.running) {
            window.electronAPI.createPty(taskId, tab.worktreePath);
            await sleep(450);
          }
        } catch {
          window.electronAPI.createPty(taskId, tab.worktreePath);
          await sleep(450);
        }
      };

      await ensurePtySession();
      const modifiedResult = await window.electronAPI.getModifiedFiles(tab.worktreePath);
      const modifiedFiles = modifiedResult.success && Array.isArray(modifiedResult.files)
        ? modifiedResult.files
        : [];
      const packet = buildHandoverPacket({
        taskId,
        taskName: tab.name,
        worktreePath: tab.worktreePath,
        sourceAgent: tab.agent,
        targetAgent: targetCommand,
        parentBranch: tab.parentBranch,
        currentBranch: tab.name,
        objective: tab.prompt,
        operatorInstruction,
        status: taskStatuses[taskId],
        todos: taskTodos[taskId] || [],
        usage: taskUsage[taskId],
        modifiedFiles
      });
      const mode = modeOverride || defaultHandoverModeForCommand(targetCommand);

      const artifactRes = await window.electronAPI.writeHandoverArtifact(tab.worktreePath, packet, targetCommand)
        .catch(() => ({ success: false as const }));
      const artifactPath = artifactRes.success ? artifactRes.latestPath : undefined;
      if (artifactPath) {
        packet.artifactPath = artifactPath;
        packet.transferBrief = `${packet.transferBrief} | Artifact=${artifactPath}`;
      }

      const plan = buildHandoverDispatchPlan(targetCommand, packet.transferBrief, mode);
      if (mode === 'clean') {
        const restartResult = await window.electronAPI.restartPty(taskId)
          .catch((error: any) => ({ success: false, error: error?.message || 'PTY restart failed.' }));
        if (!restartResult.success) {
          // Fallback: recover by recreating/interrupting the existing PTY.
          await ensurePtySession();
          window.electronAPI.writePty(taskId, '\x03');
          await sleep(180);
        }
      } else if (plan.interruptBeforeLaunch) {
        window.electronAPI.writePty(taskId, '\x03');
        await sleep(150);
      }

      await sleep(plan.launchDelayMs);
      window.electronAPI.writePty(taskId, `\u0015clear && echo "Handover initiated..." && ${plan.launchCommand}\r`);
      if (!plan.inlineTransfer) {
        await sleep(plan.transferDelayMs);
        const sanitizedTransferLine = plan.transferLine.replace(/[\r\n]+/g, ' ').trim();
        if (sanitizedTransferLine) {
          window.electronAPI.writePty(taskId, `${sanitizedTransferLine}\r`);
        }
      }

      tabsRef.current = tabsRef.current.map((item) => (
        item.id === taskId
          ? { ...item, agent: targetCommand, hasBootstrapped: true }
          : item
      ));
      setTabs(tabsRef.current);
      void window.electronAPI.fleetRecordEvent(taskId, 'handover', {
        command: targetCommand,
        mode,
        promptLength: operatorInstruction.length,
        modifiedCount: packet.git.modifiedCount,
        todoCount: packet.task.todos.length,
        blocked: packet.task.isBlocked,
        artifactPath: artifactPath || null,
        inlineTransfer: plan.inlineTransfer,
        provider: plan.provider
      });
      return { success: true, packet, mode };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Handover failed unexpectedly.' };
    }
  }, [taskStatuses, taskTodos, taskUsage]);

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

  const restoreExistingWorktree = useCallback((projectPath: string, worktreePath: string, branchName?: string | null) => {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const normalizedWorktreePath = normalizeProjectPath(worktreePath);
    if (!normalizedProjectPath || !normalizedWorktreePath) return null;

    const existing = tabsRef.current.find(tab => normalizeProjectPath(tab.worktreePath || '') === normalizedWorktreePath);
    if (existing) {
      selectTab(existing.id);
      return existing.id;
    }

    const restoredTab: TaskTab = {
      id: buildRestoredTaskId(),
      name: (branchName && branchName.trim()) ? branchName.trim() : inferWorktreeName(normalizedWorktreePath),
      agent: defaultCommand,
      basePath: normalizedProjectPath,
      worktreePath: normalizedWorktreePath,
      capabilities: { autoMerge: false },
      hasBootstrapped: true
    };

    const nextTabs = [...tabsRef.current, restoredTab];
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setActiveTab(restoredTab.id);
    setBasePath(normalizedProjectPath);
    setActiveTabByProject(prev => ({ ...prev, [normalizedProjectPath]: restoredTab.id }));
    void validatePath(normalizedProjectPath);
    void window.electronAPI.fleetRecordEvent(restoredTab.id, 'worktree_session_restored', {
      basePath: normalizedProjectPath,
      worktreePath: normalizedWorktreePath
    });
    return restoredTab.id;
  }, [defaultCommand, selectTab, validatePath]);

  const approveApprovalRequest = useCallback(async (requestId: string) => {
    const request = pendingApprovals.find((item) => item.requestId === requestId);
    if (!request) return;

    window.electronAPI.respondToAgent(request.requestId, 200, { status: 'approved' });
    if (request.action === 'merge') {
      const res = await closeTaskById(request.taskId, 'merge');
      if (!res.success) {
        const tab = tabsRef.current.find((item) => item.id === request.taskId);
        pushAttentionEvent({
          kind: 'approval_required',
          projectPath: tab?.basePath || '',
          taskId: request.taskId,
          taskName: tab?.name || request.taskId,
          reason: `Merge approval accepted, but local merge failed: ${res.error || 'unknown error'}.`,
          requiresAction: true
        });
      }
    }
    void window.electronAPI.fleetRecordEvent(request.taskId, 'approval_accepted', { action: request.action });
    clearAttentionForTask(request.taskId, ['approval_required']);
    setPendingApprovals(prev => prev.filter(item => item.requestId !== request.requestId));
  }, [pendingApprovals, closeTaskById, clearAttentionForTask, pushAttentionEvent]);

  const rejectApprovalRequest = useCallback((requestId: string) => {
    const request = pendingApprovals.find((item) => item.requestId === requestId);
    if (!request) return;
    window.electronAPI.respondToAgent(request.requestId, 403, { error: 'Request denied by user' });
    void window.electronAPI.fleetRecordEvent(request.taskId, 'approval_rejected', { action: request.action });
    clearAttentionForTask(request.taskId, ['approval_required']);
    setPendingApprovals(prev => prev.filter(item => item.requestId !== request.requestId));
  }, [pendingApprovals, clearAttentionForTask]);

  const approvePendingRequest = useCallback(async () => {
    if (!pendingApproval) return;
    await approveApprovalRequest(pendingApproval.requestId);
  }, [pendingApproval, approveApprovalRequest]);

  const rejectPendingRequest = useCallback(() => {
    if (!pendingApproval) return;
    rejectApprovalRequest(pendingApproval.requestId);
  }, [pendingApproval, rejectApprovalRequest]);

  const approveAllPendingRequests = useCallback(async () => {
    const ids = pendingApprovals.map((item) => item.requestId);
    for (const requestId of ids) {
      // eslint-disable-next-line no-await-in-loop
      await approveApprovalRequest(requestId);
    }
  }, [pendingApprovals, approveApprovalRequest]);

  const rejectAllPendingRequests = useCallback(() => {
    const ids = pendingApprovals.map((item) => item.requestId);
    ids.forEach((requestId) => rejectApprovalRequest(requestId));
  }, [pendingApprovals, rejectApprovalRequest]);

  const respondToBlockedTask = useCallback((taskId: string, response: 'y' | 'n') => {
    window.electronAPI.writePty(taskId, `${response}\r`);
    void window.electronAPI.fleetRecordEvent(taskId, 'blocked_prompt_response', { response });
  }, []);

  const respondToAllBlockedTasks = useCallback((response: 'y' | 'n') => {
    const blockedTaskIds = Object.entries(taskStatuses)
      .filter(([, status]) => !!status?.isBlocked)
      .map(([taskId]) => taskId);
    blockedTaskIds.forEach((taskId) => {
      window.electronAPI.writePty(taskId, `${response}\r`);
      void window.electronAPI.fleetRecordEvent(taskId, 'blocked_prompt_response', { response, source: 'bulk' });
    });
  }, [taskStatuses]);

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
      const sanitizedLivingSpecPreferences = sanitizeLivingSpecPreferences(storeData?.livingSpecPreferences);

      setBasePath(resolvedBasePath);
      void validatePath(resolvedBasePath);
      if (storeData?.context) setContext(storeData.context);
        // Env vars are intentionally not loaded from persistent disk storage.
      if (storeData?.defaultCommand) setDefaultCommand(storeData.defaultCommand);
      if (storeData?.packageStoreStrategy === 'pnpm_global' || storeData?.packageStoreStrategy === 'polyglot_global') {
        setPackageStoreStrategy(storeData.packageStoreStrategy);
      }
      if (storeData?.dependencyCloneMode === 'full_copy') setDependencyCloneMode('full_copy');
      if (typeof storeData?.pnpmStorePath === 'string') setPnpmStorePath(storeData.pnpmStorePath);
      if (typeof storeData?.sharedCacheRoot === 'string') setSharedCacheRoot(storeData.sharedCacheRoot);
      if (typeof storeData?.pnpmAutoInstall === 'boolean') setPnpmAutoInstall(storeData.pnpmAutoInstall);
      if (storeData?.sandboxMode === 'auto' || storeData?.sandboxMode === 'seatbelt' || storeData?.sandboxMode === 'firejail' || storeData?.sandboxMode === 'off') {
        setSandboxMode(storeData.sandboxMode);
      }
      if (storeData?.networkGuard === 'none' || storeData?.networkGuard === 'off') {
        setNetworkGuard(storeData.networkGuard);
      }

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
      setLivingSpecPreferences(sanitizedLivingSpecPreferences);
      setTaskUsage(runtimeTaskUsage);
      setTaskTodos(runtimeTaskTodos);
      setTaskStatuses(runtimeTaskStatuses);

      const pendingAgentRequests = await window.electronAPI.listPendingAgentRequests()
        .catch(() => [] as Array<{ requestId: string; taskId: string; action: string; payload: any }>);
      if (cancelled) return;
      const hydratedPendingApprovals: PendingApprovalQueueItem[] = (Array.isArray(pendingAgentRequests) ? pendingAgentRequests : [])
        .map((req) => {
          const tab = finalTabs.find((item) => item.id === req.taskId);
          return {
            requestId: req.requestId,
            taskId: req.taskId,
            action: req.action,
            payload: req.payload,
            projectPath: tab?.basePath || resolvedBasePath
          };
        });
      setPendingApprovals((prev) => {
        const nextById = new Map<string, PendingApprovalQueueItem>();
        prev.forEach((item) => nextById.set(item.requestId, item));
        hydratedPendingApprovals.forEach((item) => nextById.set(item.requestId, item));
        return Array.from(nextById.values());
      });
      hydratedPendingApprovals.forEach((item) => {
        const tab = finalTabs.find((entry) => entry.id === item.taskId);
        pushAttentionEvent({
          kind: 'approval_required',
          projectPath: item.projectPath,
          taskId: item.taskId,
          taskName: tab?.name || item.taskId,
          reason: `Approval required for ${item.action}`,
          requiresAction: true
        });
      });

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
    const normalizedProjectPath = normalizeProjectPath(basePath);
    if (!normalizedProjectPath) return;
    let cancelled = false;

    const refreshLivingSpec = async () => {
      const candidates = await detectLivingSpecCandidatesForProject(normalizedProjectPath);
      if (cancelled) return;
      if (candidates.length === 0) {
        setLivingSpecSelectionPrompt((prev) => (prev?.projectPath === normalizedProjectPath ? null : prev));
        return;
      }

      const currentPreference = livingSpecPreferencesRef.current[normalizedProjectPath];
      if (isLivingSpecPreferenceValid(currentPreference, candidates)) {
        setLivingSpecSelectionPrompt((prev) => (prev?.projectPath === normalizedProjectPath ? null : prev));
        return;
      }

      const preferredCandidate = pickPreferredLivingSpecCandidate(candidates);
      if (preferredCandidate) {
        setProjectLivingSpecPreference(normalizedProjectPath, {
          mode: 'single',
          selectedPath: preferredCandidate.path
        });
        setLivingSpecSelectionPrompt((prev) => (prev?.projectPath === normalizedProjectPath ? null : prev));
        return;
      }

      if (candidates.length === 1) {
        setProjectLivingSpecPreference(normalizedProjectPath, {
          mode: 'single',
          selectedPath: candidates[0].path
        });
        setLivingSpecSelectionPrompt((prev) => (prev?.projectPath === normalizedProjectPath ? null : prev));
        return;
      }

      setLivingSpecSelectionPrompt({
        projectPath: normalizedProjectPath,
        candidates
      });
    };

    void refreshLivingSpec();

    return () => {
      cancelled = true;
    };
  }, [
    isLoaded,
    basePath,
    detectLivingSpecCandidatesForProject,
    isLivingSpecPreferenceValid,
    setProjectLivingSpecPreference
  ]);

  useEffect(() => {
    if (!isLoaded) return;
    // Persist workspace defaults only. Env vars are excluded from disk persistence for safety.
    void window.electronAPI.saveStore({
      basePath,
      context,
      defaultCommand,
      packageStoreStrategy,
      dependencyCloneMode,
      pnpmStorePath,
      sharedCacheRoot,
      pnpmAutoInstall,
      sandboxMode,
      networkGuard,
      projectPermissions,
      livingSpecPreferences
    });
  }, [
    isLoaded,
    basePath,
    context,
    defaultCommand,
    packageStoreStrategy,
    dependencyCloneMode,
    pnpmStorePath,
    sharedCacheRoot,
    pnpmAutoInstall,
    sandboxMode,
    networkGuard,
    projectPermissions,
    livingSpecPreferences
  ]);

  useEffect(() => {
    if (!isLoaded) return;
    // Session state is persisted to survive renderer refreshes and full app restarts.
    const persistedTaskStatuses = toPersistedTaskStatusMap(taskStatuses);
    void window.electronAPI.saveRuntimeSession({
      basePath,
      tabs,
      activeTab,
      activeTabByProject,
      taskUsage,
      taskTodos,
      taskStatuses: persistedTaskStatuses
    });

    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({ basePath, tabs, activeTab, activeTabByProject, taskUsage, taskTodos, taskStatuses: persistedTaskStatuses })
        );
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
      const message = typeof req.payload === 'string'
        ? req.payload.slice(0, 800)
        : (req.payload && typeof req.payload === 'object'
          ? JSON.stringify(req.payload).slice(0, 1200)
          : '');
      void window.electronAPI.fleetRecordEvent(req.taskId, 'agent_message', {
        hasMessage: !!message,
        message
      });
    });
    unsubscribers.push(unsubAgentMessage);

    const unsubAgentUsage = window.electronAPI.onAgentUsage((req) => {
      applyUsagePayload(req.taskId, req.payload);
      void window.electronAPI.fleetRecordEvent(req.taskId, 'agent_usage_reported', {
        payload: req.payload && typeof req.payload === 'object' ? req.payload : null
      });
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

        const tabsToEvaluate = currentTabs.filter(tab => !!tab.worktreePath);
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
        const tabById = new Map(currentTabs.map((tab) => [tab.id, tab]));

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

        // Cross-worktree context leakage: high-impact changes in one task can break siblings.
        for (const [sourceTaskId, files] of Object.entries(modifiedFilesMap)) {
          if (!hasHighImpactFile(files)) continue;
          const sourceTab = tabById.get(sourceTaskId);
          if (!sourceTab) continue;
          const sourceProject = normalizeProjectPath(sourceTab.basePath);
          const impactFile = files.find((file) => HIGH_IMPACT_FILE_PATTERNS.some((pattern) => pattern.test(file))) || files[0];

          for (const tab of currentTabs) {
            if (tab.id === sourceTaskId) continue;
            if (normalizeProjectPath(tab.basePath) !== sourceProject) continue;
            if (!tab.worktreePath) continue;
            pushAttentionEvent({
              kind: 'context_alert',
              projectPath: tab.basePath,
              taskId: tab.id,
              taskName: tab.name,
              reason: `Shared context updated by ${sourceTab.name}: ${impactFile}`,
              requiresAction: false
            });
          }
        }

        // Spec-driven orchestration: flag likely drifts from selected Living Spec.
        for (const [taskId, files] of Object.entries(modifiedFilesMap)) {
          if (files.length === 0) continue;
          const tab = tabById.get(taskId);
          if (!tab) continue;
          const summary = livingSpecSummariesRef.current[normalizeProjectPath(tab.basePath)];
          if (!summary) continue;

          const forbidden = new Set((summary.forbiddenExts || []).map((ext) => ext.toLowerCase()));
          const required = new Set((summary.requiredExts || []).map((ext) => ext.toLowerCase()));
          const changedExts = new Set(files.map((file) => fileExtension(file)).filter(Boolean));
          const violatingExt = Array.from(changedExts).find((ext) => forbidden.has(ext));
          if (violatingExt) {
            pushAttentionEvent({
              kind: 'spec_deviation',
              projectPath: tab.basePath,
              taskId: tab.id,
              taskName: tab.name,
              reason: `Spec expects ${summary.preferredLanguage || 'configured stack'} but task changed ${violatingExt} files.`,
              requiresAction: true
            });
            continue;
          }
          if (required.size > 0) {
            const touchedRequired = Array.from(changedExts).some((ext) => required.has(ext));
            const touchedCode = Array.from(changedExts).some((ext) => ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'].includes(ext));
            if (touchedCode && !touchedRequired) {
              pushAttentionEvent({
                kind: 'spec_deviation',
                projectPath: tab.basePath,
                taskId: tab.id,
                taskName: tab.name,
                reason: `Spec favors ${summary.preferredLanguage || 'the selected spec'}, but recent edits target a different language set.`,
                requiresAction: true
              });
            }
          }
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
  }, [pushAttentionEvent]);

  const blockedTasks = tabs
    .filter((tab) => !!taskStatuses[tab.id]?.isBlocked)
    .map((tab) => ({
      taskId: tab.id,
      taskName: tab.name,
      projectPath: tab.basePath,
      reason: taskStatuses[tab.id]?.blockedReason || 'Agent is waiting for confirmation.'
    }));

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
      pendingApprovals,
      pendingApprovalCount: pendingApprovals.length,
      blockedTasks,
      approvalInboxCount: pendingApprovals.length + blockedTasks.length,
      attentionEvents,
      projectPermissions,
      livingSpecPreferences,
      livingSpecCandidatesByProject,
      livingSpecSummariesByProject,
      livingSpecSelectionPrompt,
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
      setPackageStoreStrategy,
      setDependencyCloneMode,
      setPnpmStorePath,
      setSharedCacheRoot,
      setPnpmAutoInstall,
      setSandboxMode,
      setNetworkGuard,
      updateProjectPermission,
      resolveLivingSpecSelectionPrompt,
      dismissLivingSpecSelectionPrompt,
      dismissAttentionEvent,
      clearAttentionEvents,
      createTask,
      renameTaskSession,
      setTaskTags,
      markTaskBootstrapped,
      closeTaskById,
      handoverTask,
      splitTask,
      restoreExistingWorktree,
      approveApprovalRequest,
      rejectApprovalRequest,
      approveAllPendingRequests,
      rejectAllPendingRequests,
      respondToBlockedTask,
      respondToAllBlockedTasks,
      approvePendingRequest,
      rejectPendingRequest,
      validatePath
    }
  };
};
