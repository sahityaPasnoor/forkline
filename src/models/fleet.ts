export interface FleetOverview {
  totalTasks: number;
  activeTasks: number;
  closedTasks: number;
  archivedTasks: number;
  blockedTasks: number;
  collidingTasks: number;
  dirtyTasks: number;
  projectCount: number;
}

export interface FleetProjectSummary {
  basePath: string;
  name: string;
  updatedAt: number;
  totalTasks: number;
  activeTasks: number;
  closedTasks: number;
  archivedTasks: number;
}

export interface FleetTaskRecord {
  taskId: string;
  runtimeTaskId?: string;
  basePath: string;
  worktreePath?: string;
  name: string;
  agent: string;
  prompt?: string;
  parentTaskId?: string;
  status: string;
  isReady: boolean;
  isDirty: boolean;
  hasCollision: boolean;
  isBlocked: boolean;
  blockedReason?: string;
  contextTokens?: number;
  contextWindow?: number;
  totalTokens?: number;
  percentUsed?: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt?: number;
  closedAt?: number;
  closeAction?: string;
  archived: boolean;
  lastExitCode?: number;
  lastExitSignal?: number;
  eventCount: number;
  sessionCount: number;
}

export interface FleetSessionRecord {
  id: number;
  runtimeTaskId: string;
  cwd: string;
  startedAt: number;
  lastActivityAt: number;
  endedAt?: number;
  exitCode?: number;
  signal?: number;
  status: string;
}

export interface FleetEventRecord {
  id: number;
  eventType: string;
  payload: Record<string, unknown> | null;
  createdAt: number;
}

export interface FleetTaskTimeline {
  task: {
    taskId: string;
    basePath: string;
    worktreePath?: string;
    name: string;
    agent: string;
    status: string;
    createdAt: number;
    updatedAt: number;
    closedAt?: number;
    closeAction?: string;
    archived: boolean;
  } | null;
  sessions: FleetSessionRecord[];
  events: FleetEventRecord[];
}
