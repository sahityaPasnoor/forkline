import { shellQuote } from './shell';

export type McpSupport = 'native' | 'unsupported';

export interface AgentProfile {
  id: string;
  label: string;
  mcpSupport: McpSupport;
  mcpSupportNote: string;
}

export interface AgentLaunchPlan {
  command: string;
  mcpStatus: 'enabled' | 'disabled' | 'unsupported' | 'missing_config';
  mcpMessage?: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

const profileFor = (id: string, label: string, mcpSupport: McpSupport, mcpSupportNote: string): AgentProfile => ({
  id,
  label,
  mcpSupport,
  mcpSupportNote
});

const UNSUPPORTED_NOTE = 'No native MCP flag is wired for this agent in Forkline yet.';

export const resolveAgentProfile = (command: string): AgentProfile => {
  const normalized = normalize(command);
  if (normalized.includes('claude')) {
    return profileFor(
      'claude',
      'Claude',
      'native',
      'Forkline injects --mcp-config .agent_cache/mcp.json on launch when MCP is enabled.'
    );
  }
  if (normalized.includes('aider')) return profileFor('aider', 'Aider', 'unsupported', UNSUPPORTED_NOTE);
  if (normalized.includes('gemini')) return profileFor('gemini', 'Gemini', 'unsupported', UNSUPPORTED_NOTE);
  if (normalized.includes('codex')) return profileFor('codex', 'Codex', 'unsupported', UNSUPPORTED_NOTE);
  if (normalized.includes('amp')) return profileFor('amp', 'Amp', 'unsupported', UNSUPPORTED_NOTE);
  if (normalized.includes('cursor')) return profileFor('cursor', 'Cursor', 'unsupported', UNSUPPORTED_NOTE);
  if (normalized.includes('cline')) return profileFor('cline', 'Cline', 'unsupported', UNSUPPORTED_NOTE);
  if (normalized.includes('sweep')) return profileFor('sweep', 'Sweep', 'unsupported', UNSUPPORTED_NOTE);
  return profileFor('shell', 'Shell', 'unsupported', UNSUPPORTED_NOTE);
};

export const buildAgentLaunchPlan = (
  agentCommand: string,
  prompt: string | undefined,
  options: { mcpEnabled: boolean; hasMcpConfig: boolean; mcpConfigPath?: string }
): AgentLaunchPlan => {
  const profile = resolveAgentProfile(agentCommand);
  const mcpConfigPath = options.mcpConfigPath || '.agent_cache/mcp.json';

  let launchCommand = agentCommand;
  let mcpStatus: AgentLaunchPlan['mcpStatus'] = 'disabled';
  let mcpMessage = '';

  if (options.mcpEnabled) {
    if (!options.hasMcpConfig) {
      mcpStatus = 'missing_config';
      mcpMessage = 'MCP is enabled, but MCP JSON is empty. Add config in Workspace Settings to use MCP.';
    } else if (profile.mcpSupport === 'native') {
      launchCommand = `${agentCommand} --mcp-config ${shellQuote(mcpConfigPath)}`;
      mcpStatus = 'enabled';
      mcpMessage = `MCP enabled for ${profile.label}.`;
    } else {
      mcpStatus = 'unsupported';
      mcpMessage = `${profile.label} does not have native MCP launch wiring in Forkline yet.`;
    }
  }

  if (prompt && prompt.trim()) {
    launchCommand = `${launchCommand} ${shellQuote(prompt)}`;
  }

  return {
    command: launchCommand,
    mcpStatus,
    mcpMessage
  };
};
