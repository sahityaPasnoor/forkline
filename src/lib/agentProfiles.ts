import { shellQuote } from './shell';

export interface AgentProfile {
  id: string;
  label: string;
}

export interface AgentLaunchPlan {
  command: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

const profileFor = (id: string, label: string): AgentProfile => ({ id, label });
const TELEMETRY_WRAPPED_PROFILES = new Set(['claude', 'gemini', 'amp', 'aider', 'codex']);

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
  if (normalized.includes('cursor')) return profileFor('cursor', 'Cursor');
  if (normalized.includes('cline')) return profileFor('cline', 'Cline');
  if (normalized.includes('sweep')) return profileFor('sweep', 'Sweep');
  return profileFor('shell', 'Shell');
};

export const buildAgentLaunchPlan = (
  agentCommand: string,
  prompt: string | undefined
): AgentLaunchPlan => {
  const profile = resolveAgentProfile(agentCommand);
  let launchCommand = agentCommand;

  if (prompt && prompt.trim()) {
    launchCommand = `${launchCommand} ${shellQuote(prompt)}`;
  }

  launchCommand = wrapCommandWithLifecycleMarkers(launchCommand, profile.id);

  return {
    command: launchCommand
  };
};
