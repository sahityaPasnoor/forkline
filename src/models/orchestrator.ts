export interface AgentCapabilities {
  autoMerge: boolean;
}

export interface AgentInfo {
  name: string;
  command: string;
  version: string;
}

export interface TaskTab {
  id: string;
  name: string;
  displayName?: string;
  tags?: string[];
  agent: string;
  basePath: string;
  worktreePath?: string;
  parentBranch?: string;
  parentTaskId?: string;
  prompt?: string;
  livingSpecOverridePath?: string;
  capabilities?: AgentCapabilities;
  hasBootstrapped?: boolean;
}

export interface TaskStatus {
  isReady: boolean;
  isDirty: boolean;
  hasCollision: boolean;
  isBlocked?: boolean;
  blockedReason?: string;
}

export interface TaskUsage {
  contextTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contextWindow?: number;
  percentUsed?: number;
  costUsd?: number;
  promptCostUsd?: number;
  completionCostUsd?: number;
  updatedAt: number;
}

export interface SourceStatus {
  valid: boolean;
  isRepo?: boolean;
  type?: string;
  error?: string;
}

export interface PendingApprovalRequest {
  requestId: string;
  taskId: string;
  action: string;
  payload: any;
}

export interface AgentTodo {
  id: string | number;
  title: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface ProjectPermissionPolicy {
  autonomousMode: boolean;
  autoApproveMerge: boolean;
  autoRespondPrompts: boolean;
  promptResponse: 'y' | 'n';
}

export interface LivingSpecCandidate {
  path: string;
  kind: string;
}

export interface LivingSpecPreference {
  mode: 'single' | 'consolidated';
  selectedPath?: string;
}

export interface LivingSpecSelectionPrompt {
  projectPath: string;
  candidates: LivingSpecCandidate[];
}

export interface AttentionEvent {
  id: string;
  kind: 'blocked' | 'approval_required' | 'approval_auto_approved' | 'context_alert' | 'spec_deviation';
  projectPath: string;
  taskId: string;
  taskName: string;
  reason: string;
  createdAt: number;
  requiresAction: boolean;
}

export interface HandoverPacket {
  generatedAt: number;
  taskId: string;
  taskName: string;
  worktreePath?: string;
  sourceAgent: string;
  targetAgent: string;
  parentBranch?: string;
  currentBranch?: string;
  objective?: string;
  operatorInstruction: string;
  git: {
    modifiedCount: number;
    modifiedFiles: string[];
    truncated: boolean;
  };
  task: {
    isBlocked: boolean;
    blockedReason?: string;
    todos: AgentTodo[];
    todoSummary: string;
  };
  usage?: TaskUsage;
  artifactPath?: string;
  transferBrief: string;
}

export type HandoverMode = 'clean' | 'in_place';

export interface HandoverResult {
  success: boolean;
  packet?: HandoverPacket;
  mode?: HandoverMode;
  error?: string;
}
