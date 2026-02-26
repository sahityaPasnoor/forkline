import { shellQuote } from './shell';

export interface AgentProfile {
  id: string;
  label: string;
}

export interface AgentLaunchPlan {
  command: string;
}

export type AgentPermissionMode = 'default' | 'bypass';

const normalize = (value: string) => value.trim().toLowerCase();

const profileFor = (id: string, label: string): AgentProfile => ({ id, label });
const TELEMETRY_WRAPPED_PROFILES = new Set(['claude', 'gemini', 'amp', 'aider', 'codex']);
const PERMISSION_BYPASS_PROFILES = new Set(['claude', 'gemini', 'amp', 'codex']);

export const wrapCommandWithLifecycleMarkers = (command: string, providerId: string) => {
  const normalizedProvider = providerId.trim().toLowerCase();
  if (!normalizedProvider || !TELEMETRY_WRAPPED_PROFILES.has(normalizedProvider)) return command;
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return trimmedCommand;
  if (trimmedCommand.includes('ForklineEvent=')) return trimmedCommand;
  return `{ __forkline_emit(){ printf '\\033]1337;ForklineEvent=%s\\007' \"$1\"; }; __forkline_emit 'type=agent_started;provider=${normalizedProvider}'; ${trimmedCommand}; __forkline_ec=$?; __forkline_emit \"type=agent_exited;provider=${normalizedProvider};code=\${__forkline_ec}\"; }`;
};

export const resolveAgentProfile = (command: string): AgentProfile => {
  const normalized = normalize(command);
  if (normalized.includes('claude')) return profileFor('claude', 'Claude');
  if (normalized.includes('aider')) return profileFor('aider', 'Aider');
  if (normalized.includes('gemini')) return profileFor('gemini', 'Gemini');
  if (normalized.includes('codex')) return profileFor('codex', 'Codex');
  if (normalized.includes('amp')) return profileFor('amp', 'Amp');
  return profileFor('shell', 'Shell');
};

export const supportsAgentPermissionBypass = (command: string) => {
  const profile = resolveAgentProfile(command);
  return PERMISSION_BYPASS_PROFILES.has(profile.id);
};

export const applyAgentPermissionMode = (
  command: string,
  mode: AgentPermissionMode = 'default'
) => {
  const trimmedCommand = String(command || '').trim();
  if (!trimmedCommand || mode !== 'bypass') return trimmedCommand;
  const profile = resolveAgentProfile(trimmedCommand);

  if (profile.id === 'claude') {
    if (/\b--dangerously-skip-permissions\b/i.test(trimmedCommand)) return trimmedCommand;
    if (/\b--permission-mode(?:=|\s+)bypassPermissions\b/i.test(trimmedCommand)) return trimmedCommand;
    return `${trimmedCommand} --permission-mode bypassPermissions`;
  }

  if (profile.id === 'codex') {
    if (/\b--dangerously-bypass-approvals-and-sandbox\b/i.test(trimmedCommand)) return trimmedCommand;
    return `${trimmedCommand} --dangerously-bypass-approvals-and-sandbox`;
  }

  if (profile.id === 'gemini') {
    if (/\b--yolo\b/i.test(trimmedCommand)) return trimmedCommand;
    if (/\b--approval-mode(?:=|\s+)yolo\b/i.test(trimmedCommand)) return trimmedCommand;
    return `${trimmedCommand} --approval-mode yolo`;
  }

  if (profile.id === 'amp') {
    if (/\b--dangerously-allow-all\b/i.test(trimmedCommand)) return trimmedCommand;
    return `${trimmedCommand} --dangerously-allow-all`;
  }

  return trimmedCommand;
};

export const buildAgentLaunchPlan = (
  agentCommand: string,
  prompt: string | undefined,
  options: { permissionMode?: AgentPermissionMode } = {}
): AgentLaunchPlan => {
  const profile = resolveAgentProfile(agentCommand);
  const permissionMode = options.permissionMode === 'bypass' ? 'bypass' : 'default';
  let launchCommand = applyAgentPermissionMode(agentCommand, permissionMode);

  if (prompt && prompt.trim()) {
    launchCommand = `${launchCommand} ${shellQuote(prompt)}`;
  }

  launchCommand = wrapCommandWithLifecycleMarkers(launchCommand, profile.id);

  return {
    command: launchCommand
  };
};
