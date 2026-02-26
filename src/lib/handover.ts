import type { AgentTodo, HandoverPacket, TaskStatus, TaskUsage } from '../models/orchestrator';

interface BuildHandoverPacketInput {
  taskId: string;
  taskName: string;
  worktreePath?: string;
  sourceAgent: string;
  targetAgent: string;
  parentBranch?: string;
  currentBranch?: string;
  objective?: string;
  operatorInstruction: string;
  status?: TaskStatus;
  todos?: AgentTodo[];
  usage?: TaskUsage;
  modifiedFiles?: string[];
}

const truncate = (value: string, max = 320) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

const summarizeTodos = (todos: AgentTodo[]) => {
  const pending = todos.filter((todo) => todo.status === 'pending').length;
  const inProgress = todos.filter((todo) => todo.status === 'in_progress').length;
  const done = todos.filter((todo) => todo.status === 'done').length;
  return `${pending} pending, ${inProgress} in progress, ${done} done`;
};

const summarizeUsage = (usage?: TaskUsage) => {
  if (!usage) return 'n/a';
  const total = typeof usage.totalTokens === 'number' ? usage.totalTokens.toLocaleString() : null;
  const percent = typeof usage.percentUsed === 'number' ? `${usage.percentUsed.toFixed(1)}%` : null;
  const cost = typeof usage.costUsd === 'number' ? `$${usage.costUsd.toFixed(4)}` : null;
  return [total && `${total} tokens`, percent && `${percent} context`, cost && cost].filter(Boolean).join(' · ') || 'n/a';
};

export const buildHandoverBrief = (packet: Omit<HandoverPacket, 'transferBrief'>) => {
  const filesLine = packet.git.modifiedFiles.length > 0
    ? packet.git.modifiedFiles.map((file) => truncate(file, 140)).join(', ')
    : 'none';
  const todosLine = packet.task.todos.length > 0
    ? packet.task.todos
      .slice(0, 10)
      .map((todo) => `[${todo.status}] ${truncate(todo.title, 100)}`)
      .join(', ')
    : 'none';

  const segments = [
    'Handover context follows.',
    `Task=${packet.taskName} (${packet.taskId})`,
    `Source=${packet.sourceAgent}`,
    `Target=${packet.targetAgent}`,
    `Worktree=${packet.worktreePath || 'unknown'}`,
    `CurrentBranch=${packet.currentBranch || packet.taskName}`,
    `ParentBranch=${packet.parentBranch || 'main'}`,
    `Objective=${truncate(packet.objective || packet.taskName, 240)}`,
    `OperatorInstruction=${truncate(packet.operatorInstruction, 360)}`,
    `ModifiedFiles=${packet.git.modifiedCount}${packet.git.truncated ? ' (truncated)' : ''}: ${filesLine}`,
    `TodoSummary=${packet.task.todoSummary}; Todos=${todosLine}`,
    `Blocked=${packet.task.isBlocked ? `yes (${truncate(packet.task.blockedReason || 'unknown', 140)})` : 'no'}`,
    `Usage=${summarizeUsage(packet.usage)}`,
    'Reply with state confirmation + 3-step immediate plan + first concrete action.'
  ];

  return segments.join(' | ');
};

export const buildHandoverPacket = (input: BuildHandoverPacketInput): HandoverPacket => {
  const todos = Array.isArray(input.todos) ? input.todos.slice(0, 20) : [];
  const allModified = Array.isArray(input.modifiedFiles)
    ? input.modifiedFiles.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const limitedModified = allModified.slice(0, 20);
  const packetWithoutBrief: Omit<HandoverPacket, 'transferBrief'> = {
    generatedAt: Date.now(),
    taskId: input.taskId,
    taskName: input.taskName,
    worktreePath: input.worktreePath,
    sourceAgent: input.sourceAgent,
    targetAgent: input.targetAgent,
    parentBranch: input.parentBranch,
    currentBranch: input.currentBranch,
    objective: input.objective,
    operatorInstruction: truncate(input.operatorInstruction, 1200),
    git: {
      modifiedCount: allModified.length,
      modifiedFiles: limitedModified,
      truncated: allModified.length > limitedModified.length
    },
    task: {
      isBlocked: !!input.status?.isBlocked,
      blockedReason: input.status?.isBlocked ? input.status?.blockedReason : undefined,
      todos,
      todoSummary: summarizeTodos(todos)
    },
    usage: input.usage
  };

  return {
    ...packetWithoutBrief,
    transferBrief: buildHandoverBrief(packetWithoutBrief)
  };
};
