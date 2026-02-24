import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Save, X } from 'lucide-react';
import { APP_THEMES } from '../lib/themes';
import { resolveAgentProfile } from '../lib/agentProfiles';

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
  mcpEnabled: boolean;
  setMcpEnabled: (enabled: boolean) => void;
  packageStoreStrategy: 'off' | 'pnpm_global' | 'polyglot_global';
  setPackageStoreStrategy: (strategy: 'off' | 'pnpm_global' | 'polyglot_global') => void;
  dependencyCloneMode: 'copy_on_write' | 'full_copy';
  setDependencyCloneMode: (mode: 'copy_on_write' | 'full_copy') => void;
  pnpmStorePath: string;
  setPnpmStorePath: (value: string) => void;
  sharedCacheRoot: string;
  setSharedCacheRoot: (value: string) => void;
  pnpmAutoInstall: boolean;
  setPnpmAutoInstall: (value: boolean) => void;
  sandboxMode: 'off' | 'auto' | 'seatbelt' | 'firejail';
  setSandboxMode: (mode: 'off' | 'auto' | 'seatbelt' | 'firejail') => void;
  networkGuard: 'off' | 'none';
  setNetworkGuard: (guard: 'off' | 'none') => void;
  availableAgents: { name: string; command: string; version: string }[];
  theme: string;
  setTheme: (theme: string) => void;
}

const MCP_EXAMPLE = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}`;

const normalizeMultiline = (value: string) => value.replace(/\r\n/g, '\n').trimEnd();

const findInvalidEnvLines = (value: string) => {
  const lines = value.split('\n');
  const invalid: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(trimmed)) {
      invalid.push(index + 1);
    }
  });
  return invalid;
};

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  context,
  setContext,
  envVars,
  setEnvVars,
  defaultCommand,
  setDefaultCommand,
  mcpServers,
  setMcpServers,
  mcpEnabled,
  setMcpEnabled,
  packageStoreStrategy,
  setPackageStoreStrategy,
  dependencyCloneMode,
  setDependencyCloneMode,
  pnpmStorePath,
  setPnpmStorePath,
  sharedCacheRoot,
  setSharedCacheRoot,
  pnpmAutoInstall,
  setPnpmAutoInstall,
  sandboxMode,
  setSandboxMode,
  networkGuard,
  setNetworkGuard,
  availableAgents,
  theme,
  setTheme
}) => {
  const [localCtx, setLocalCtx] = useState(context);
  const [localEnv, setLocalEnv] = useState(envVars);
  const [localCmd, setLocalCmd] = useState(defaultCommand);
  const [localMcp, setLocalMcp] = useState(mcpServers);
  const [localMcpEnabled, setLocalMcpEnabled] = useState(mcpEnabled);
  const [localPackageStoreStrategy, setLocalPackageStoreStrategy] = useState<'off' | 'pnpm_global' | 'polyglot_global'>(packageStoreStrategy);
  const [localDependencyCloneMode, setLocalDependencyCloneMode] = useState<'copy_on_write' | 'full_copy'>(dependencyCloneMode);
  const [localPnpmStorePath, setLocalPnpmStorePath] = useState(pnpmStorePath);
  const [localSharedCacheRoot, setLocalSharedCacheRoot] = useState(sharedCacheRoot);
  const [localPnpmAutoInstall, setLocalPnpmAutoInstall] = useState(pnpmAutoInstall);
  const [localSandboxMode, setLocalSandboxMode] = useState<'off' | 'auto' | 'seatbelt' | 'firejail'>(sandboxMode);
  const [localNetworkGuard, setLocalNetworkGuard] = useState<'off' | 'none'>(networkGuard);
  const [localTheme, setLocalTheme] = useState(theme);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const sortedAgents = useMemo(
    () => [...availableAgents].sort((a, b) => a.name.localeCompare(b.name)),
    [availableAgents]
  );
  const selectedTheme = APP_THEMES.find((appTheme) => appTheme.id === localTheme) || APP_THEMES[0];
  const selectedAgent = sortedAgents.find((agent) => agent.command === localCmd) || sortedAgents[0];
  const selectedAgentProfile = resolveAgentProfile(selectedAgent?.command || localCmd);

  const invalidEnvLines = useMemo(() => findInvalidEnvLines(localEnv), [localEnv]);
  const envError =
    invalidEnvLines.length > 0
      ? `Invalid ENV format on line${invalidEnvLines.length > 1 ? 's' : ''}: ${invalidEnvLines.join(', ')}`
      : '';

  const mcpError = useMemo(() => {
    if (!localMcpEnabled) return '';
    const trimmed = localMcp.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'MCP config must be a JSON object.';
      }
      return '';
    } catch {
      return 'MCP config is not valid JSON.';
    }
  }, [localMcp, localMcpEnabled]);

  const hasChanges = useMemo(() => {
    return (
      normalizeMultiline(localCtx) !== normalizeMultiline(context) ||
      normalizeMultiline(localEnv) !== normalizeMultiline(envVars) ||
      (localCmd || '') !== (defaultCommand || '') ||
      normalizeMultiline(localMcp) !== normalizeMultiline(mcpServers) ||
      localMcpEnabled !== mcpEnabled ||
      localPackageStoreStrategy !== packageStoreStrategy ||
      localDependencyCloneMode !== dependencyCloneMode ||
      normalizeMultiline(localPnpmStorePath) !== normalizeMultiline(pnpmStorePath) ||
      normalizeMultiline(localSharedCacheRoot) !== normalizeMultiline(sharedCacheRoot) ||
      localPnpmAutoInstall !== pnpmAutoInstall ||
      localSandboxMode !== sandboxMode ||
      localNetworkGuard !== networkGuard ||
      localTheme !== theme
    );
  }, [
    context,
    defaultCommand,
    envVars,
    localCmd,
    localCtx,
    localEnv,
    localMcp,
    localMcpEnabled,
    localPackageStoreStrategy,
    localDependencyCloneMode,
    localPnpmStorePath,
    localSharedCacheRoot,
    localPnpmAutoInstall,
    localSandboxMode,
    localNetworkGuard,
    localTheme,
    mcpEnabled,
    mcpServers,
    packageStoreStrategy,
    dependencyCloneMode,
    pnpmStorePath,
    sharedCacheRoot,
    pnpmAutoInstall,
    sandboxMode,
    networkGuard,
    theme
  ]);

  const canSave = hasChanges && !envError && !mcpError;

  useEffect(() => {
    if (!isOpen) return;
    const validCommand = availableAgents.some((a) => a.command === defaultCommand)
      ? defaultCommand
      : (availableAgents[0]?.command || 'claude');
    setLocalCmd(validCommand);
    setLocalCtx(context);
    setLocalEnv(envVars);
    setLocalMcp(mcpServers);
    setLocalMcpEnabled(mcpEnabled);
    setLocalPackageStoreStrategy(packageStoreStrategy);
    setLocalDependencyCloneMode(dependencyCloneMode);
    setLocalPnpmStorePath(pnpmStorePath);
    setLocalSharedCacheRoot(sharedCacheRoot);
    setLocalPnpmAutoInstall(pnpmAutoInstall);
    setLocalSandboxMode(sandboxMode);
    setLocalNetworkGuard(networkGuard);
    setLocalTheme(theme);
    setShowAdvanced(false);
  }, [
    isOpen,
    defaultCommand,
    availableAgents,
    context,
    envVars,
    mcpServers,
    mcpEnabled,
    packageStoreStrategy,
    dependencyCloneMode,
    pnpmStorePath,
    sharedCacheRoot,
    pnpmAutoInstall,
    sandboxMode,
    networkGuard,
    theme
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSave) {
        event.preventDefault();
        setContext(localCtx);
        setEnvVars(localEnv);
        setDefaultCommand(localCmd);
        setMcpServers(localMcp);
        setMcpEnabled(localMcpEnabled);
        setPackageStoreStrategy(localPackageStoreStrategy);
        setDependencyCloneMode(localDependencyCloneMode);
        setPnpmStorePath(localPnpmStorePath);
        setSharedCacheRoot(localSharedCacheRoot);
        setPnpmAutoInstall(localPnpmAutoInstall);
        setSandboxMode(localSandboxMode);
        setNetworkGuard(localNetworkGuard);
        setTheme(localTheme);
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    canSave,
    isOpen,
    localCmd,
    localCtx,
    localEnv,
    localMcp,
    localMcpEnabled,
    localPackageStoreStrategy,
    localDependencyCloneMode,
    localPnpmStorePath,
    localSharedCacheRoot,
    localPnpmAutoInstall,
    localSandboxMode,
    localNetworkGuard,
    localTheme,
    onClose,
    setContext,
    setDefaultCommand,
    setEnvVars,
    setMcpEnabled,
    setMcpServers,
    setPackageStoreStrategy,
    setDependencyCloneMode,
    setPnpmStorePath,
    setSharedCacheRoot,
    setPnpmAutoInstall,
    setSandboxMode,
    setNetworkGuard,
    setTheme
  ]);

  if (!isOpen) return null;

  const handleReset = () => {
    const validCommand = availableAgents.some((a) => a.command === defaultCommand)
      ? defaultCommand
      : (availableAgents[0]?.command || 'claude');
    setLocalCmd(validCommand);
    setLocalCtx(context);
    setLocalEnv(envVars);
    setLocalMcp(mcpServers);
    setLocalMcpEnabled(mcpEnabled);
    setLocalPackageStoreStrategy(packageStoreStrategy);
    setLocalDependencyCloneMode(dependencyCloneMode);
    setLocalPnpmStorePath(pnpmStorePath);
    setLocalSharedCacheRoot(sharedCacheRoot);
    setLocalPnpmAutoInstall(pnpmAutoInstall);
    setLocalSandboxMode(sandboxMode);
    setLocalNetworkGuard(networkGuard);
    setLocalTheme(theme);
  };

  const handleSave = () => {
    if (!canSave) return;
    setContext(localCtx);
    setEnvVars(localEnv);
    setDefaultCommand(localCmd);
    setMcpServers(localMcp);
    setMcpEnabled(localMcpEnabled);
    setPackageStoreStrategy(localPackageStoreStrategy);
    setDependencyCloneMode(localDependencyCloneMode);
    setPnpmStorePath(localPnpmStorePath);
    setSharedCacheRoot(localSharedCacheRoot);
    setPnpmAutoInstall(localPnpmAutoInstall);
    setSandboxMode(localSandboxMode);
    setNetworkGuard(localNetworkGuard);
    setTheme(localTheme);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[90] p-4">
      <div className="app-panel border border-[#1a1a1a] rounded-xl shadow-2xl w-full max-w-3xl flex flex-col h-[85vh]">
        <div className="flex justify-between items-center p-5 border-b border-[#1a1a1a] bg-[#050505]">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-[#e5e5e5] uppercase tracking-widest">Workspace Settings</h2>
            {hasChanges ? (
              <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300 font-mono">Unsaved changes</span>
            ) : (
              <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-300 font-mono">Saved</span>
            )}
          </div>
          <button onClick={onClose} className="text-[#525252] hover:text-white transition-colors" title="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#000000]">
          <section className="space-y-4">
            <h3 className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-[0.2em]">Essentials</h3>

            <div className="rounded-lg border border-[#1a1a1a] p-4 space-y-3">
              <label className="block text-xs text-[#d4d4d8] font-semibold">Default Agent</label>
              <p className="text-xs text-[#888888]">Used automatically when spawning a new task.</p>
              <select
                value={localCmd}
                onChange={(e) => setLocalCmd(e.target.value)}
                className="w-full input-stealth rounded py-2 px-3 text-xs font-mono appearance-none"
                style={{
                  backgroundImage:
                    'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23525252%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right .7em top 50%',
                  backgroundSize: '.65em auto'
                }}
              >
                {sortedAgents.map((agent) => (
                  <option key={agent.command} value={agent.command}>
                    {agent.name} {agent.version !== 'unknown' ? `(${agent.version})` : ''}
                  </option>
                ))}
              </select>
              <div className="text-[11px] font-mono text-[#9ca3af] break-all">
                command: <span className="text-[#d4d4d8]">{selectedAgent?.command || localCmd}</span>
              </div>
              <div className={`text-[11px] font-mono ${selectedAgentProfile.mcpSupport === 'native' ? 'text-emerald-300' : 'text-amber-300'}`}>
                MCP: {selectedAgentProfile.mcpSupport === 'native' ? 'supported' : 'not supported'}
              </div>
            </div>

            <div className="rounded-lg border border-[#1a1a1a] p-4 space-y-3">
              <label className="block text-xs text-[#d4d4d8] font-semibold">Theme</label>
              <p className="text-xs text-[#888888]">Pick a visual theme for long sessions.</p>
              <select
                value={localTheme}
                onChange={(e) => setLocalTheme(e.target.value)}
                className="w-full input-stealth rounded py-2 px-3 text-xs font-mono appearance-none"
                style={{
                  backgroundImage:
                    'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23525252%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right .7em top 50%',
                  backgroundSize: '.65em auto'
                }}
              >
                {APP_THEMES.map((appTheme) => (
                  <option key={appTheme.id} value={appTheme.id}>
                    {appTheme.name}
                  </option>
                ))}
              </select>
              <div className="rounded border p-3" style={{ backgroundColor: selectedTheme.preview.panel, borderColor: selectedTheme.preview.border }}>
                <div className="text-xs font-semibold" style={{ color: selectedTheme.preview.text }}>
                  {selectedTheme.name}
                </div>
                <div className="text-[10px] mt-1" style={{ color: selectedTheme.preview.text, opacity: 0.8 }}>
                  {selectedTheme.description}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2.5 w-10 rounded" style={{ backgroundColor: selectedTheme.preview.accent }} />
                  <div className="h-2.5 w-10 rounded" style={{ backgroundColor: selectedTheme.preview.border }} />
                  <div className="h-2.5 w-10 rounded" style={{ backgroundColor: selectedTheme.preview.text, opacity: 0.25 }} />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-[0.2em]">Shared Instructions</h3>
            <div className="rounded-lg border border-[#1a1a1a] p-4 space-y-3">
              <label className="block text-xs text-[#d4d4d8] font-semibold">Project Memory</label>
              <p className="text-xs text-[#888888]">Added to every new task in this workspace.</p>
              <textarea
                value={localCtx}
                onChange={(e) => setLocalCtx(e.target.value)}
                placeholder="Example: We use React + Tailwind. Keep changes small and include tests for risky logic."
                className="w-full h-32 input-stealth rounded p-3 text-xs"
              />
            </div>
          </section>

          <section className="rounded-lg border border-[#1a1a1a] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="w-full px-4 py-3 text-left flex items-center justify-between bg-[#050505] hover:bg-[#0b0b0b] transition-colors"
            >
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#9ca3af] font-mono">Advanced</span>
              <span className="text-[11px] text-[#71717a] font-mono">{showAdvanced ? 'hide' : 'show'}</span>
            </button>

            {showAdvanced && (
              <div className="p-4 space-y-6">
                <div className="space-y-3">
                  <label className="block text-xs text-[#d4d4d8] font-semibold">Environment Variables</label>
                  <p className="text-xs text-[#888888]">Format: <span className="font-mono">KEY=VALUE</span> per line. Not written to disk.</p>
                  <textarea
                    value={localEnv}
                    onChange={(e) => setLocalEnv(e.target.value)}
                    placeholder="ANTHROPIC_API_KEY=...\nOPENAI_API_KEY=..."
                    className="w-full h-24 input-stealth rounded p-3 text-xs font-mono"
                  />
                  {envError ? (
                    <div className="flex items-center gap-2 text-xs text-rose-300">
                      <AlertCircle size={14} />
                      {envError}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-emerald-300">
                      <CheckCircle2 size={14} />
                      Environment format looks valid.
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="block text-xs text-[#d4d4d8] font-semibold">MCP Configuration</label>
                    <label className="flex items-center gap-2 text-xs text-[#a3a3a3]">
                      <input
                        type="checkbox"
                        checked={localMcpEnabled}
                        onChange={(event) => setLocalMcpEnabled(event.target.checked)}
                        className="appearance-none w-4 h-4 rounded-sm border border-[#262626] bg-[#0a0a0a] checked:bg-white checked:border-white transition-colors"
                      />
                      Enabled
                    </label>
                  </div>
                  <p className="text-xs text-[#888888]">
                    Stored as <span className="font-mono">.agent_cache/mcp.json</span> in each task worktree.
                  </p>
                  <textarea
                    value={localMcp}
                    onChange={(e) => setLocalMcp(e.target.value)}
                    placeholder={MCP_EXAMPLE}
                    className="w-full h-32 input-stealth rounded p-3 text-xs font-mono"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs rounded border border-[#2a2a2a] text-[#d4d4d8] hover:border-[#444444] hover:text-white"
                      onClick={() => setLocalMcp(MCP_EXAMPLE)}
                    >
                      Use Example
                    </button>
                    {mcpError ? (
                      <div className="flex items-center gap-2 text-xs text-rose-300">
                        <AlertCircle size={14} />
                        {mcpError}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-emerald-300">
                        <CheckCircle2 size={14} />
                        MCP config looks valid.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-xs text-[#d4d4d8] font-semibold">Dependencies For New Tasks</label>
                  <p className="text-xs text-[#888888]">Choose between saving disk space or full isolated copies.</p>
                  <select
                    value={localDependencyCloneMode}
                    onChange={(e) => setLocalDependencyCloneMode(e.target.value === 'full_copy' ? 'full_copy' : 'copy_on_write')}
                    className="w-full input-stealth rounded py-2 px-3 text-xs font-mono"
                  >
                    <option value="copy_on_write">Save disk space (recommended)</option>
                    <option value="full_copy">Use full copies (more disk usage)</option>
                  </select>
                  <p className="text-[11px] text-[#9ca3af]">
                    {localDependencyCloneMode === 'copy_on_write'
                      ? 'Reuses dependency files when possible to keep worktrees lightweight.'
                      : 'Copies dependencies into each worktree for maximum isolation.'}
                  </p>

                  <label className="flex items-center gap-2 text-xs text-[#a3a3a3]">
                    <input
                      type="checkbox"
                      checked={localPackageStoreStrategy !== 'off'}
                      onChange={(event) => setLocalPackageStoreStrategy(event.target.checked ? 'polyglot_global' : 'off')}
                      className="appearance-none w-4 h-4 rounded-sm border border-[#262626] bg-[#0a0a0a] checked:bg-white checked:border-white transition-colors"
                    />
                    Use shared dependency cache for faster installs
                  </label>

                  {localPackageStoreStrategy !== 'off' && (
                    <details className="rounded border border-[#1f1f1f] p-3 space-y-3">
                      <summary className="text-[11px] text-[#9ca3af] font-mono cursor-pointer">Optional cache paths</summary>
                      <div className="mt-3 space-y-3">
                        <input
                          value={localSharedCacheRoot}
                          onChange={(e) => setLocalSharedCacheRoot(e.target.value)}
                          placeholder="/Users/you/.forkline-cache"
                          className="w-full input-stealth rounded p-3 text-xs font-mono"
                        />
                        <input
                          value={localPnpmStorePath}
                          onChange={(e) => setLocalPnpmStorePath(e.target.value)}
                          placeholder="/Users/you/.forkline-cache/pnpm-store"
                          className="w-full input-stealth rounded p-3 text-xs font-mono"
                        />
                      </div>
                    </details>
                  )}

                  {localPackageStoreStrategy !== 'off' && (
                    <label className="flex items-center gap-2 text-xs text-[#a3a3a3]">
                      <input
                        type="checkbox"
                        checked={localPnpmAutoInstall}
                        onChange={(event) => setLocalPnpmAutoInstall(event.target.checked)}
                        className="appearance-none w-4 h-4 rounded-sm border border-[#262626] bg-[#0a0a0a] checked:bg-white checked:border-white transition-colors"
                      />
                      Auto-run pnpm install when creating a worktree
                    </label>
                  )}
                </div>

                <div className="space-y-3">
                  <label className="block text-xs text-[#d4d4d8] font-semibold">Sandbox & Network Guardrails</label>
                  <p className="text-xs text-[#888888]">Best-effort PTY wrapper. Uses seatbelt on macOS or firejail on Linux when available.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                      value={localSandboxMode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        if (mode === 'auto' || mode === 'seatbelt' || mode === 'firejail') {
                          setLocalSandboxMode(mode);
                          return;
                        }
                        setLocalSandboxMode('off');
                      }}
                      className="w-full input-stealth rounded py-2 px-3 text-xs font-mono"
                    >
                      <option value="off">sandbox off</option>
                      <option value="auto">auto</option>
                      <option value="seatbelt">seatbelt (macOS)</option>
                      <option value="firejail">firejail (Linux)</option>
                    </select>
                    <select
                      value={localNetworkGuard}
                      onChange={(e) => setLocalNetworkGuard(e.target.value === 'none' ? 'none' : 'off')}
                      className="w-full input-stealth rounded py-2 px-3 text-xs font-mono"
                    >
                      <option value="off">network guard off</option>
                      <option value="none">block network egress</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="p-5 border-t border-[#1a1a1a] flex items-center justify-between bg-[#050505]">
          <button onClick={handleReset} className="px-4 py-2 text-xs font-semibold rounded btn-ghost" disabled={!hasChanges}>
            Discard Changes
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-5 py-2 text-xs font-bold btn-ghost rounded">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-5 py-2 btn-primary disabled:opacity-50 disabled:cursor-not-allowed text-xs uppercase tracking-wider font-bold rounded flex items-center shadow-[0_0_15px_rgba(255,255,255,0.1)]"
            >
              <Save size={14} className="mr-2" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
