const STATUS_COMMAND = 'git status --short && echo "---" && git branch --show-current';
const TEST_COMMAND =
  'if command -v npm >/dev/null 2>&1; then npm test; elif command -v pnpm >/dev/null 2>&1; then pnpm test; elif command -v yarn >/dev/null 2>&1; then yarn test; elif command -v bun >/dev/null 2>&1; then bun test; else echo "No Node test runner found."; fi';

const normalizeAgentCommand = (value) => String(value || '').trim().toLowerCase();

const detectAgentCapabilities = (agentCommand) => {
  const normalized = normalizeAgentCommand(agentCommand);
  if (normalized.includes('aider')) {
    return { profile: 'aider', supportsAsk: true, supportsRun: true };
  }
  if (/(claude|codex|gemini|amp|cursor|cline|sweep)/.test(normalized)) {
    return { profile: 'prompt', supportsAsk: false, supportsRun: false };
  }
  return { profile: 'shell', supportsAsk: false, supportsRun: false };
};

const toAgentInstruction = (capabilities, instruction) => {
  if (capabilities.profile === 'aider') return `/ask ${instruction}`;
  return instruction;
};

const toShellInstruction = (capabilities, command) => {
  if (capabilities.profile === 'aider') return `/run ${command}`;
  return command;
};

const chooseTarget = (action, capabilities) => {
  if (action === 'pause') return 'shell';
  if (action === 'resume') return 'shell';
  if (action === 'status' || action === 'test_and_fix') return 'shell';
  if ((action === 'plan' || action === 'context' || action === 'cost') && capabilities.profile !== 'shell') return 'agent';
  return 'shell';
};

const resolveQuickActionPlan = ({ action, agentCommand, isBlocked }) => {
  const capabilities = detectAgentCapabilities(agentCommand);
  const target = chooseTarget(action, capabilities);

  if (action === 'pause') {
    return { action, target, capabilities, steps: [{ kind: 'send', data: '\u0003' }] };
  }

  if (isBlocked) {
    if (action === 'resume') {
      return {
        action,
        target,
        capabilities,
        steps: [{ kind: 'send_line', line: 'y', clearLine: false }]
      };
    }
    return {
      action,
      target,
      capabilities,
      steps: [{ kind: 'hint', message: 'Action is waiting on a confirmation prompt. Use resume first.' }]
    };
  }

  if (action === 'resume') {
    if (target === 'shell') {
      return { action, target, capabilities, steps: [{ kind: 'send', data: '\r' }] };
    }
    return {
      action,
      target,
      capabilities,
      steps: [{
        kind: 'send_line',
        line: toAgentInstruction(capabilities, 'Continue from the current context without restarting. Execute the next concrete step now.')
      }]
    };
  }

  if (action === 'status') {
    if (target === 'shell') {
      return {
        action,
        target,
        capabilities,
        steps: [{ kind: 'send_line', line: toShellInstruction(capabilities, STATUS_COMMAND) }]
      };
    }
    return {
      action,
      target,
      capabilities,
      steps: [{
        kind: 'send_line',
        line: toAgentInstruction(capabilities, 'Show only the current git status and branch for this worktree.')
      }]
    };
  }

  if (action === 'test_and_fix') {
    if (target === 'shell') {
      return {
        action,
        target,
        capabilities,
        steps: [{ kind: 'send_line', line: toShellInstruction(capabilities, TEST_COMMAND) }]
      };
    }
    return {
      action,
      target,
      capabilities,
      steps: [{
        kind: 'send_line',
        line: toAgentInstruction(capabilities, 'Run the relevant tests, fix failures, and summarize what changed.')
      }]
    };
  }

  if (action === 'plan') {
    return {
      action,
      target,
      capabilities,
      steps: [{
        kind: 'send_line',
        line: toAgentInstruction(capabilities, 'Create a concise 5-8 step execution plan and keep one step in progress at a time.')
      }]
    };
  }

  if (action === 'context') {
    return {
      action,
      target,
      capabilities,
      steps: [{
        kind: 'send_line',
        line: toAgentInstruction(capabilities, 'Report current context usage and remaining context window in one concise line.')
      }]
    };
  }

  if (action === 'cost') {
    return {
      action,
      target,
      capabilities,
      steps: [{
        kind: 'send_line',
        line: toAgentInstruction(capabilities, 'Report the latest token usage and estimated USD cost for this session in one concise line.')
      }]
    };
  }

  return {
    action,
    target,
    capabilities,
    steps: [{ kind: 'hint', message: 'Unknown quick action.' }]
  };
};

module.exports = {
  detectAgentCapabilities,
  resolveQuickActionPlan
};
