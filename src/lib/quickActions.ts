export type QuickActionId =
  | 'status'
  | 'resume'
  | 'pause'
  | 'test_and_fix'
  | 'plan'
  | 'context'
  | 'cost';

export type QuickActionTarget = 'agent' | 'shell';

export type QuickActionStep =
  | { kind: 'hint'; message: string }
  | { kind: 'send'; data: string }
  | { kind: 'send_line'; line: string; clearLine?: boolean }
  | { kind: 'launch_agent'; postInstruction?: string };

export interface AgentCapabilities {
  profile: 'aider' | 'prompt' | 'shell';
  supportsAsk: boolean;
  supportsRun: boolean;
}

export interface QuickActionContext {
  action: QuickActionId;
  agentCommand: string;
  isBlocked: boolean;
}

export interface QuickActionPlan {
  action: QuickActionId;
  target: QuickActionTarget;
  capabilities: AgentCapabilities;
  steps: QuickActionStep[];
}

const STATUS_COMMAND = 'git status --short && echo "---" && git branch --show-current';
const TEST_COMMAND =
  'if command -v npm >/dev/null 2>&1; then npm test; elif command -v pnpm >/dev/null 2>&1; then pnpm test; elif command -v yarn >/dev/null 2>&1; then yarn test; elif command -v bun >/dev/null 2>&1; then bun test; else echo "No Node test runner found."; fi';

const normalizeAgentCommand = (value: string) => value.trim().toLowerCase();

export const detectAgentCapabilities = (agentCommand: string): AgentCapabilities => {
  const normalized = normalizeAgentCommand(agentCommand);
  if (normalized.includes('aider')) {
    return { profile: 'aider', supportsAsk: true, supportsRun: true };
  }
  if (/(claude|codex|gemini|amp|cursor|cline|sweep)/.test(normalized)) {
    return { profile: 'prompt', supportsAsk: false, supportsRun: false };
  }
  return { profile: 'shell', supportsAsk: false, supportsRun: false };
};

const toAgentInstruction = (capabilities: AgentCapabilities, instruction: string) => {
  if (capabilities.profile === 'aider') {
    return `/ask ${instruction}`;
  }
  return instruction;
};

const toShellInstruction = (capabilities: AgentCapabilities, command: string) => {
  if (capabilities.profile === 'aider') {
    return `/run ${command}`;
  }
  return command;
};

const chooseTarget = (
  action: QuickActionId,
  capabilities: AgentCapabilities
): QuickActionTarget => {
  if (action === 'pause') return 'shell';
  if (action === 'resume') return 'shell';
  if (action === 'status' || action === 'test_and_fix') return 'shell';
  if ((action === 'plan' || action === 'context' || action === 'cost') && capabilities.profile !== 'shell') return 'agent';
  return 'shell';
};

export const resolveQuickActionPlan = (context: QuickActionContext): QuickActionPlan => {
  const capabilities = detectAgentCapabilities(context.agentCommand);
  const target = chooseTarget(context.action, capabilities);
  const blocked = context.isBlocked;

  if (context.action === 'pause') {
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send', data: '\u0003' }]
    };
  }

  if (blocked) {
    if (context.action === 'resume') {
      return {
        action: context.action,
        target,
        capabilities,
        steps: [{ kind: 'send_line', line: 'y', clearLine: false }]
      };
    }
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'hint', message: 'Action is waiting on a confirmation prompt. Use resume or approve/reject first.' }]
    };
  }

  if (context.action === 'resume') {
    if (target === 'shell') {
      return {
        action: context.action,
        target,
        capabilities,
        steps: [{ kind: 'send', data: '\r' }]
      };
    }
    const instruction = toAgentInstruction(
      capabilities,
      'Continue from the current context without restarting. Execute the next concrete step now.'
    );
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: instruction }]
    };
  }

  if (context.action === 'status') {
    if (target === 'shell') {
      return {
        action: context.action,
        target,
        capabilities,
        steps: [{ kind: 'send_line', line: toShellInstruction(capabilities, STATUS_COMMAND) }]
      };
    }
    const instruction = toAgentInstruction(
      capabilities,
      'Show only the current git status and branch for this worktree.'
    );
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: instruction }]
    };
  }

  if (context.action === 'test_and_fix') {
    if (target === 'shell') {
      return {
        action: context.action,
        target,
        capabilities,
        steps: [{ kind: 'send_line', line: toShellInstruction(capabilities, TEST_COMMAND) }]
      };
    }
    const instruction = toAgentInstruction(
      capabilities,
      'Run the relevant tests, fix failures, and summarize what changed.'
    );
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: instruction }]
    };
  }

  if (context.action === 'plan') {
    const instruction = toAgentInstruction(
      capabilities,
      'Create a concise 5-8 step execution plan and keep one step in progress at a time.'
    );
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: instruction }]
    };
  }

  if (context.action === 'context') {
    const instruction = toAgentInstruction(
      capabilities,
      'Report current context usage and remaining context window in one concise line.'
    );
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: instruction }]
    };
  }

  if (context.action === 'cost') {
    const instruction = toAgentInstruction(
      capabilities,
      'Report the latest token usage and estimated USD cost for this session in one concise line.'
    );
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: instruction }]
    };
  }

  return {
    action: context.action,
    target,
    capabilities,
    steps: [{ kind: 'hint', message: 'Unknown quick action.' }]
  };
};
