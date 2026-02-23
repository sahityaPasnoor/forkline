import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: string;
  setContext: (ctx: string) => void;
  envVars: string;
  setEnvVars: (env: string) => void;
  defaultCommand: string;
  setDefaultCommand: (cmd: string) => void;
  mcpServers: string;
  setMcpServers: (mcp: string) => void;
  availableAgents: {name: string, command: string, version: string}[];
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, onClose, context, setContext, envVars, setEnvVars, defaultCommand, setDefaultCommand, mcpServers, setMcpServers, availableAgents
}) => {
  const [localCtx, setLocalCtx] = useState(context);
  const [localEnv, setLocalEnv] = useState(envVars);
  const [localCmd, setLocalCmd] = useState(defaultCommand);
  const [localMcp, setLocalMcp] = useState(mcpServers);

  useEffect(() => {
    if (isOpen) {
      const validCommand = availableAgents.some(a => a.command === defaultCommand) 
        ? defaultCommand 
        : (availableAgents[0]?.command || 'claude');
      setLocalCmd(validCommand);
      setLocalCtx(context);
      setLocalEnv(envVars);
      setLocalMcp(mcpServers);
    }
  }, [isOpen, defaultCommand, availableAgents, context, envVars, mcpServers]);

  if (!isOpen) return null;

  const handleSave = () => {
    setContext(localCtx);
    setEnvVars(localEnv);
    setDefaultCommand(localCmd);
    setMcpServers(localMcp);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="app-panel border border-[#1a1a1a] rounded-xl shadow-2xl w-full max-w-3xl flex flex-col h-[85vh]">
        <div className="flex justify-between items-center p-5 border-b border-[#1a1a1a] bg-[#050505]">
          <h2 className="text-sm font-bold text-[#e5e5e5] uppercase tracking-widest">Workspace Settings</h2>
          <button onClick={onClose} className="text-[#525252] hover:text-white transition-colors"><X size={18} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-[#000000]">
          <div>
            <h3 className="text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">Default Agent</h3>
            <p className="text-xs text-[#888888] mb-3">The local agent to use by default for new tasks.</p>
            <select 
              value={localCmd}
              onChange={(e) => setLocalCmd(e.target.value)}
              className="w-full input-stealth rounded py-2 px-3 text-xs font-mono appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23525252%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
            >
              {availableAgents.map(agent => (
                <option key={agent.command} value={agent.command}>
                  {agent.name} {agent.version !== 'unknown' ? `(${agent.version})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">Shared Project Memory (Context)</h3>
            <p className="text-xs text-[#888888] mb-3">Instructions placed here will be automatically injected into every new Agent terminal session.</p>
            <textarea 
              value={localCtx}
              onChange={(e) => setLocalCtx(e.target.value)}
              placeholder="e.g. We use React and Tailwind. Do not use inline styles."
              className="w-full h-32 input-stealth rounded p-3 text-xs"
            />
          </div>

          <details className="border border-[#1a1a1a] rounded-lg p-3">
            <summary className="text-[11px] uppercase tracking-[0.18em] text-[#9ca3af] font-mono cursor-pointer">
              Advanced
            </summary>

            <div className="mt-4 space-y-6">
              <div>
                <h3 className="text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">Environment Variables (Secrets)</h3>
                <p className="text-xs text-[#888888] mb-3">Define securely injected variables (Format: KEY=VALUE, one per line). These are NOT saved to disk.</p>
                <textarea
                  value={localEnv}
                  onChange={(e) => setLocalEnv(e.target.value)}
                  placeholder="ANTHROPIC_API_KEY=sk-...\nOPENAI_API_KEY=sk-..."
                  className="w-full h-24 input-stealth rounded p-3 text-xs font-mono"
                />
              </div>

              <div>
                <h3 className="text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">Model Context Protocol (MCP)</h3>
                <p className="text-xs text-[#888888] mb-3">Provide JSON config for MCP servers. It is written as `mcp.json` in each task worktree.</p>
                <textarea
                  value={localMcp}
                  onChange={(e) => setLocalMcp(e.target.value)}
                  placeholder='{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-github"]\n    }\n  }\n}'
                  className="w-full h-32 input-stealth rounded p-3 text-xs font-mono"
                />
              </div>
            </div>
          </details>
        </div>

        <div className="p-5 border-t border-[#1a1a1a] flex justify-end bg-[#050505]">
          <button onClick={onClose} className="px-5 py-2 text-xs font-bold btn-ghost rounded mr-2">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 btn-primary text-xs uppercase tracking-wider font-bold rounded flex items-center shadow-[0_0_15px_rgba(255,255,255,0.1)]">
            <Save size={14} className="mr-2" /> Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
