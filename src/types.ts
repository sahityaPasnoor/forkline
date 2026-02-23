export interface AgentCapabilities {
  autoMerge: boolean;
}

export type SessionStatus = 'provisioning' | 'running' | 'blocked' | 'error' | 'archived';

export interface Session {
  id: string;
  name: string; // Branch name
  agentCommand: string;
  basePath: string; // The workspace this session belongs to
  worktreePath?: string;
  prompt?: string;
  capabilities?: AgentCapabilities;
  status: SessionStatus;
  createdAt: number;
}

export interface WorkspaceConfig {
  path: string;
  name: string;
  context: string;
  envVars: string;
  defaultCommand: string;
  mcpServers: string;
  lastAccessed: number;
}

export interface GlobalState {
  workspaces: WorkspaceConfig[];
  sessions: Session[];
}
