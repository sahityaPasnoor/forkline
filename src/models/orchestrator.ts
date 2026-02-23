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
  agent: string;
  basePath: string;
  worktreePath?: string;
  parentTaskId?: string;
  prompt?: string;
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

export interface AttentionEvent {
  id: string;
  kind: 'blocked' | 'approval_required' | 'approval_auto_approved';
  projectPath: string;
  taskId: string;
  taskName: string;
  reason: string;
  createdAt: number;
  requiresAction: boolean;
}
