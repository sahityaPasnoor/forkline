export type QuickActionId =
  | 'status'
  | 'pause'
  | 'resume'
  | 'test_and_fix'
  | 'plan'
  | 'create_pr';

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
  parentBranch?: string;
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
const SAFE_BRANCH_PATTERN = /^[a-zA-Z0-9._/-]{1,120}$/;

const normalizeAgentCommand = (value: string) => value.trim().toLowerCase();
const shellQuote = (value: string) => `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;

export const detectAgentCapabilities = (agentCommand: string): AgentCapabilities => {
  const normalized = normalizeAgentCommand(agentCommand);
  if (normalized.includes('aider')) {
    return { profile: 'aider', supportsAsk: true, supportsRun: true };
  }
  if (/(claude|codex|gemini|amp)/.test(normalized)) {
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
  if (action === 'status' || action === 'test_and_fix' || action === 'create_pr') return 'shell';
  if (action === 'plan' && capabilities.profile !== 'shell') return 'agent';
  return 'shell';
};

const resolvePrCommand = (parentBranch?: string) => {
  const normalized = String(parentBranch || '').trim();
  const targetBranch = SAFE_BRANCH_PATTERN.test(normalized) && !normalized.includes('..') ? normalized : 'main';
  const quotedTarget = shellQuote(targetBranch);
  return `TARGET_BRANCH=${quotedTarget}; CURRENT_BRANCH="$(git branch --show-current)"; if [ -z "$CURRENT_BRANCH" ]; then echo "Unable to detect current branch."; elif [ "$CURRENT_BRANCH" = "$TARGET_BRANCH" ]; then echo "Current branch equals target branch ($TARGET_BRANCH). Commit on a task branch first."; elif command -v gh >/dev/null 2>&1; then echo "Opening GitHub PR for $CURRENT_BRANCH -> $TARGET_BRANCH"; gh pr create --base "$TARGET_BRANCH" --head "$CURRENT_BRANCH" --fill --web || gh pr create --base "$TARGET_BRANCH" --head "$CURRENT_BRANCH" --title "PR: $CURRENT_BRANCH -> $TARGET_BRANCH" --body "Automated PR from Forkline task session." --web; elif command -v glab >/dev/null 2>&1; then echo "Opening GitLab MR for $CURRENT_BRANCH -> $TARGET_BRANCH"; glab mr create --source-branch "$CURRENT_BRANCH" --target-branch "$TARGET_BRANCH" --fill --web || glab mr create --source-branch "$CURRENT_BRANCH" --target-branch "$TARGET_BRANCH" --title "MR: $CURRENT_BRANCH -> $TARGET_BRANCH" --description "Automated MR from Forkline task session." --web; else echo "No PR CLI found. Install gh or glab, then run:"; echo "  gh pr create --base $TARGET_BRANCH --head $CURRENT_BRANCH --fill --web"; fi`;
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

  if (context.action === 'resume') {
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: toShellInstruction(capabilities, context.agentCommand), clearLine: true }]
    };
  }

  if (blocked) {
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'hint', message: 'Action is waiting on a confirmation prompt. Use approve/reject first.' }]
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

  if (context.action === 'create_pr') {
    const command = resolvePrCommand(context.parentBranch);
    return {
      action: context.action,
      target,
      capabilities,
      steps: [{ kind: 'send_line', line: toShellInstruction(capabilities, command) }]
    };
  }

  return {
    action: context.action,
    target,
    capabilities,
    steps: [{ kind: 'hint', message: 'Unknown quick action.' }]
  };
};
