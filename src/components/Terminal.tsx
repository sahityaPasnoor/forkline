import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowRightLeft, GitMerge, Code, AlertTriangle, TerminalSquare, Pause, Play, Map, Trash2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { LivingSpecPreference, TaskUsage } from '../models/orchestrator';
import { formatTaskCost, formatTaskUsage } from '../lib/usageUtils';
import { detectAgentCapabilities, resolveQuickActionPlan, type QuickActionId, type QuickActionStep } from '../lib/quickActions';
import { buildAgentLaunchPlan } from '../lib/agentProfiles';

interface TerminalProps {
  taskId: string;
  cwd: string;
  agentCommand: string;
  context?: string;
  envVars?: string;
  prompt?: string;
  mcpServers?: string;
  mcpEnabled?: boolean;
  projectPath: string;
  livingSpecPreference?: LivingSpecPreference;
  packageStoreStrategy?: 'off' | 'pnpm_global' | 'polyglot_global';
  pnpmStorePath?: string;
  sharedCacheRoot?: string;
  sandboxMode?: 'off' | 'auto' | 'seatbelt' | 'firejail';
  networkGuard?: 'off' | 'none';
  shouldBootstrap?: boolean;
  onBootstrapped?: () => void;
  capabilities?: { autoMerge: boolean };
  taskUsage?: TaskUsage;
  isBlocked?: boolean;
  blockedReason?: string;
  onHandover?: () => void;
  onMerge?: () => void;
  onDelete?: () => void;
}

const Terminal: React.FC<TerminalProps> = ({
  taskId,
  cwd,
  agentCommand,
  context,
  envVars,
  prompt,
  mcpServers,
  mcpEnabled,
  projectPath,
  livingSpecPreference,
  packageStoreStrategy,
  pnpmStorePath,
  sharedCacheRoot,
  sandboxMode,
  networkGuard,
  shouldBootstrap,
  onBootstrapped,
  capabilities,
  taskUsage,
  isBlocked,
  blockedReason,
  onHandover,
  onMerge,
  onDelete
}) => {
  const fallbackTaskControlUrl = `http://127.0.0.1:34567/api/task/${taskId}`;
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<XTerm | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const controlTaskUrlRef = useRef(fallbackTaskControlUrl);
  const controlAuthTokenRef = useRef('');
  const ptyEnvRef = useRef<Record<string, string> | null>(null);
  const lastQuickActionAtRef = useRef(0);
  const lastAgentLaunchAtRef = useRef(0);
  const ptyRunningRef = useRef(false);
  const isInitialized = useRef(false);
  const onBootstrappedRef = useRef(onBootstrapped);
  const capabilitiesProfile = useMemo(() => detectAgentCapabilities(agentCommand), [agentCommand]);
  const usageSummaryLabel = useMemo(() => formatTaskUsage(taskUsage), [taskUsage]);
  const usageCostLabel = useMemo(() => formatTaskCost(taskUsage), [taskUsage]);
  const hasUsageBadge = !!usageSummaryLabel || !!usageCostLabel;
  const usageUpdatedLabel = useMemo(() => {
    if (!taskUsage?.updatedAt || !Number.isFinite(taskUsage.updatedAt)) return null;
    return new Date(taskUsage.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [taskUsage]);

  const buildPtyEnv = useCallback((controlTaskUrl: string, controlAuthToken?: string) => {
    const customEnv: Record<string, string> = {
      MULTI_AGENT_IDE_URL: controlTaskUrl || fallbackTaskControlUrl,
      MULTI_AGENT_IDE_TOKEN: controlAuthToken || '',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Forkline',
      FORCE_COLOR: '1',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      FORKLINE_MCP_ENABLED: mcpEnabled ? '1' : '0',
      FORKLINE_MCP_CONFIG_PATH: '.agent_cache/mcp.json',
      FORKLINE_SPEC_PATH: '.agent_cache/FORKLINE_SPEC.md',
      FORKLINE_PACKAGE_STORE_STRATEGY: packageStoreStrategy || 'off',
      FORKLINE_SANDBOX_MODE: sandboxMode || 'off',
      FORKLINE_NETWORK_GUARD: networkGuard || 'off'
    };
    if (pnpmStorePath?.trim()) {
      customEnv.FORKLINE_PNPM_STORE_PATH = pnpmStorePath.trim();
    }
    if (sharedCacheRoot?.trim()) {
      customEnv.FORKLINE_SHARED_CACHE_ROOT = sharedCacheRoot.trim();
    }

    if (envVars) {
      envVars.split('\n').forEach(line => {
        const [k, ...rest] = line.split('=');
        const value = rest.join('=');
        if (k && value) customEnv[k.trim()] = value.trim();
      });
    }

    return customEnv;
  }, [envVars, mcpEnabled, fallbackTaskControlUrl, sandboxMode, networkGuard, packageStoreStrategy, pnpmStorePath, sharedCacheRoot]);

  useEffect(() => {
    onBootstrappedRef.current = onBootstrapped;
  }, [onBootstrapped]);

  useEffect(() => {
    const next = `http://127.0.0.1:34567/api/task/${taskId}`;
    controlTaskUrlRef.current = next;
  }, [taskId]);

  useEffect(() => {
    const applyTheme = () => {
      const term = terminalInstance.current;
      if (!term) return;
      const cssVars = getComputedStyle(document.documentElement);
      const terminalBackground = cssVars.getPropertyValue('--xterm-bg').trim() || '#000000';
      const terminalForeground = cssVars.getPropertyValue('--xterm-fg').trim() || '#e5e5e5';
      const terminalCursor = cssVars.getPropertyValue('--xterm-cursor').trim() || '#ffffff';
      const terminalSelection = cssVars.getPropertyValue('--xterm-selection').trim() || 'rgba(255, 255, 255, 0.2)';
      term.options.theme = {
        background: terminalBackground,
        foreground: terminalForeground,
        cursor: terminalCursor,
        cursorAccent: '#000000',
        selectionBackground: terminalSelection,
        black: '#1f2937',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#e5e7eb',
        brightBlack: '#6b7280',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#e879f9',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff'
      };
      try {
        term.refresh(0, term.rows - 1);
      } catch {
        // Ignore transient refresh issues while terminal is mounting.
      }
    };

    applyTheme();
    const observer = new MutationObserver(() => {
      applyTheme();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current || isInitialized.current) return;

    let term: XTerm | null = null;
    let fitAddon: FitAddon | null = null;
    let initializeObserver: ResizeObserver | null = null;
    let layoutObserver: ResizeObserver | null = null;
    let removePtyListener: (() => void) | null = null;
    let removePtyStateListener: (() => void) | null = null;
    let removePtyExitListener: (() => void) | null = null;
    let didBootstrap = false;
    let disposed = false;
    let focusRafId: number | null = null;

    const initTerminal = () => {
      if (isInitialized.current || !terminalRef.current) return false;
      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      try {
        const cssVars = getComputedStyle(document.documentElement);
        const terminalBackground = cssVars.getPropertyValue('--xterm-bg').trim() || '#000000';
        const terminalForeground = cssVars.getPropertyValue('--xterm-fg').trim() || '#e5e5e5';
        const terminalCursor = cssVars.getPropertyValue('--xterm-cursor').trim() || '#ffffff';
        const terminalSelection = cssVars.getPropertyValue('--xterm-selection').trim() || 'rgba(255, 255, 255, 0.2)';
        term = new XTerm({
          theme: {
            background: terminalBackground,
            foreground: terminalForeground,
            cursor: terminalCursor,
            cursorAccent: '#000000',
            selectionBackground: terminalSelection,
            black: '#1f2937',
            red: '#ef4444',
            green: '#22c55e',
            yellow: '#eab308',
            blue: '#3b82f6',
            magenta: '#d946ef',
            cyan: '#06b6d4',
            white: '#e5e7eb',
            brightBlack: '#6b7280',
            brightRed: '#f87171',
            brightGreen: '#4ade80',
            brightYellow: '#facc15',
            brightBlue: '#60a5fa',
            brightMagenta: '#e879f9',
            brightCyan: '#22d3ee',
            brightWhite: '#ffffff'
          },
          cursorBlink: true,
          scrollback: 100000,
          allowTransparency: false,
          drawBoldTextInBrightColors: true,
          rightClickSelectsWord: true,
          macOptionIsMeta: true,
          altClickMovesCursor: true,
          fastScrollModifier: 'alt',
          fastScrollSensitivity: 4,
          fontFamily: '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 13,
          lineHeight: 1.45
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);
        fitAddon.fit();

        terminalInstance.current = term;
        fitAddonInstance.current = fitAddon;
        isInitialized.current = true;

        term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          const key = event.key.toLowerCase();
          const isMac = navigator.platform.toUpperCase().includes('MAC');
          const primary = isMac ? event.metaKey : event.ctrlKey;
          const wantsCopy = (primary && key === 'c') || (event.ctrlKey && event.shiftKey && key === 'c');
          const wantsPaste = (primary && key === 'v') || (event.ctrlKey && event.shiftKey && key === 'v');

          if (wantsCopy && term?.hasSelection()) {
            const selected = term.getSelection();
            if (selected) {
              void navigator.clipboard.writeText(selected).catch(() => {});
            }
            return false;
          }

          if (wantsPaste) {
            void navigator.clipboard.readText()
              .then((text) => {
                if (!text || disposed) return;
                term?.paste(text);
              })
              .catch(() => {});
            return false;
          }

          return true;
        });

        let customEnv = buildPtyEnv(controlTaskUrlRef.current);
        ptyEnvRef.current = customEnv;

        term.onData(data => {
          window.electronAPI.writePty(taskId, data);
        });

        removePtyListener = window.electronAPI.onPtyData(taskId, (data) => {
          term?.write(data);
        });
        removePtyStateListener = window.electronAPI.onPtyState(taskId, ({ created, running }) => {
          ptyRunningRef.current = !!running;
          if (didBootstrap) return;
          didBootstrap = true;
          const shouldRelaunchAfterRestart = !!created && !shouldBootstrap;
          if (!shouldBootstrap && !shouldRelaunchAfterRestart) {
            term?.writeln('\r\n[orchestrator] Restored tab session attached. Agent bootstrap was skipped to preserve prior context.');
            return;
          }
          if (shouldRelaunchAfterRestart) {
            term?.writeln('\r\n[orchestrator] Previous PTY session is not live. Relaunching agent for this tab.');
          }
          setTimeout(() => {
            const taskControlUrl = controlTaskUrlRef.current;
            const apiDoc = `IDE Capabilities API\n--------------------\nYou are running inside Forkline.\nYou can interact with the IDE by sending POST requests to the local control server.\n\nBase URL: ${taskControlUrl}\nAuthentication:\n- Header: x-forkline-token: $MULTI_AGENT_IDE_TOKEN\n- Alternate: Authorization: Bearer $MULTI_AGENT_IDE_TOKEN\nCurrent Permissions:\n- Merge Request: ${capabilities?.autoMerge ? 'Auto-Approve' : 'Requires Human Approval'}\n\nWorkspace Metadata Paths:\n- Living Spec (if available): .agent_cache/FORKLINE_SPEC.md\n- Memory Context: .agent_cache/agent_memory.md\n\nEndpoints:\n1. POST ${taskControlUrl}/merge\n2. POST ${taskControlUrl}/todos\n3. POST ${taskControlUrl}/message\n4. POST ${taskControlUrl}/usage (or /metrics)\n\ncurl example:\ncurl -s -H \"x-forkline-token: $MULTI_AGENT_IDE_TOKEN\" -H \"content-type: application/json\" -X POST ${taskControlUrl}/todos -d '{\"todos\":[{\"id\":\"1\",\"title\":\"Implement fix\",\"status\":\"in_progress\"}]}'\n`;
            void window.electronAPI
              .prepareAgentWorkspace(cwd, projectPath, context || '', mcpServers || '', apiDoc, livingSpecPreference)
              .then((prepRes) => {
                const prepareSucceeded = prepRes?.success !== false;
                if (!prepareSucceeded) {
                  const message = prepRes?.error ? `Workspace metadata warning: ${prepRes.error}` : 'Workspace metadata preparation failed.';
                  term?.writeln(`\r\n[orchestrator] ${message}`);
                }

                const launchPlan = buildAgentLaunchPlan(agentCommand, prompt, {
                  mcpEnabled: !!mcpEnabled,
                  hasMcpConfig: !!mcpServers?.trim() && prepareSucceeded,
                  mcpConfigPath: '.agent_cache/mcp.json'
                });
                if (launchPlan.mcpStatus !== 'disabled' && launchPlan.mcpMessage) {
                  term?.writeln(`\r\n[orchestrator] ${launchPlan.mcpMessage}`);
                }

                if (prompt) {
                  window.electronAPI.writePty(taskId, `clear && echo -e "\\033[1;37m[Orchestrator]\\033[0m Bootstrapping task..." && ${launchPlan.command}\r`);
                } else {
                  window.electronAPI.writePty(taskId, `clear && ${launchPlan.command}\r`);
                }
                lastAgentLaunchAtRef.current = Date.now();
                onBootstrappedRef.current?.();
              })
              .catch((err) => {
                console.error('Failed to prepare workspace metadata:', err);
                term?.writeln('\r\n[orchestrator] Workspace metadata setup failed. Continuing without MCP injection.');

                const launchPlan = buildAgentLaunchPlan(agentCommand, prompt, {
                  mcpEnabled: !!mcpEnabled,
                  hasMcpConfig: false,
                  mcpConfigPath: '.agent_cache/mcp.json'
                });
                if (launchPlan.mcpStatus !== 'disabled' && launchPlan.mcpMessage) {
                  term?.writeln(`\r\n[orchestrator] ${launchPlan.mcpMessage}`);
                }

                if (prompt) {
                  window.electronAPI.writePty(taskId, `clear && echo -e "\\033[1;37m[Orchestrator]\\033[0m Bootstrapping task..." && ${launchPlan.command}\r`);
                } else {
                  window.electronAPI.writePty(taskId, `clear && ${launchPlan.command}\r`);
                }
                lastAgentLaunchAtRef.current = Date.now();
                onBootstrappedRef.current?.();
              });
          }, 200);
        });
        removePtyExitListener = window.electronAPI.onPtyExit(taskId, ({ exitCode, signal }) => {
          ptyRunningRef.current = false;
          term?.writeln(`\r\n[orchestrator] PTY exited (code=${exitCode ?? 'null'} signal=${signal ?? 'none'}).`);
        });

        void Promise.all([
          window.electronAPI.getControlBaseUrl().catch(() => ''),
          window.electronAPI.getControlAuthToken().catch(() => '')
        ])
          .then(([baseUrl, authToken]) => {
            const trimmed = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
            const resolvedBaseUrl = trimmed || 'http://127.0.0.1:34567';
            const normalizedToken = typeof authToken === 'string' ? authToken.trim() : '';
            controlAuthTokenRef.current = normalizedToken;
            const resolvedTaskUrl = `${resolvedBaseUrl}/api/task/${taskId}`;
            controlTaskUrlRef.current = resolvedTaskUrl;
            customEnv = buildPtyEnv(resolvedTaskUrl, normalizedToken);
            ptyEnvRef.current = customEnv;
          })
          .catch(() => {
            customEnv = buildPtyEnv(fallbackTaskControlUrl, '');
            ptyEnvRef.current = customEnv;
          })
          .finally(() => {
            ptyEnvRef.current = customEnv;
            window.electronAPI.createPty(taskId, cwd, customEnv);
          });

        window.addEventListener('resize', handleResize);
        layoutObserver = new ResizeObserver(() => {
          handleResize();
        });
        layoutObserver.observe(terminalRef.current);

        setTimeout(handleResize, 0);
        focusRafId = requestAnimationFrame(() => {
          term?.focus();
        });

        return true;
      } catch (e) {
        console.error('Failed to initialize xterm:', e);
        return false;
      }
    };

    const handleResize = () => {
      if (fitAddonInstance.current && terminalInstance.current) {
        try {
          fitAddonInstance.current.fit();
          window.electronAPI.resizePty(taskId, terminalInstance.current.cols, terminalInstance.current.rows);
        } catch (e) {
          // Ignore fit race conditions while panes are resizing.
        }
      }
    };

    if (!initTerminal()) {
      initializeObserver = new ResizeObserver(() => {
        if (initTerminal() && initializeObserver && terminalRef.current) {
          initializeObserver.unobserve(terminalRef.current);
          initializeObserver.disconnect();
        }
      });
      initializeObserver.observe(terminalRef.current);
    }

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      if (focusRafId !== null) {
        cancelAnimationFrame(focusRafId);
      }
      if (initializeObserver) initializeObserver.disconnect();
      if (layoutObserver) layoutObserver.disconnect();
      if (removePtyListener) {
        removePtyListener();
      } else {
        window.electronAPI.removePtyDataListener(taskId);
      }
      if (removePtyExitListener) {
        removePtyExitListener();
      }
      if (removePtyStateListener) {
        removePtyStateListener();
      }
      window.electronAPI.detachPty(taskId);
      if (term) term.dispose();
      isInitialized.current = false;
    };
  }, [taskId, cwd, projectPath, livingSpecPreference]);

  const focusTerminal = () => {
    requestAnimationFrame(() => {
      terminalInstance.current?.focus();
    });
  };

  const sendRaw = (data: string) => {
    if (!data) return;
    window.electronAPI.writePty(taskId, data);
    focusTerminal();
  };

  const sendLine = (line: string, clearLine = false) => {
    const prefix = clearLine && line ? '\u0015' : '';
    window.electronAPI.writePty(taskId, `${prefix}${line}\r`);
    focusTerminal();
  };

  const writeOrchestratorHint = (message: string) => {
    terminalInstance.current?.writeln(`\r\n[orchestrator] ${message}`);
  };

  const recordQuickAction = (action: string, payload: Record<string, unknown> = {}) => {
    void window.electronAPI.fleetRecordEvent(taskId, 'quick_action', { action, ...payload });
  };

  const keepTerminalFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Prevent button from retaining focus so Enter keeps going to xterm.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
    focusTerminal();
  };

  const blurButtonOnFocus = (event: React.FocusEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    focusTerminal();
  };

  const ensurePtyRunning = useCallback((continuation: () => void) => {
    if (ptyRunningRef.current) {
      continuation();
      return;
    }
    writeOrchestratorHint('Restoring terminal process for this task.');
    const relaunchEnv = ptyEnvRef.current || buildPtyEnv(controlTaskUrlRef.current || fallbackTaskControlUrl);
    ptyEnvRef.current = relaunchEnv;
    window.electronAPI.createPty(taskId, cwd, relaunchEnv);
    window.setTimeout(continuation, 220);
  }, [cwd, taskId, buildPtyEnv, fallbackTaskControlUrl]);

  const runQuickActionPlan = useCallback((steps: QuickActionStep[]) => {
    for (const step of steps) {
      if (step.kind === 'hint') {
        writeOrchestratorHint(step.message);
        continue;
      }
      if (step.kind === 'send') {
        sendRaw(step.data);
        continue;
      }
      if (step.kind === 'send_line') {
        const normalized = step.line.replace(/\$MULTI_AGENT_IDE_URL/g, controlTaskUrlRef.current).trim();
        if (!normalized) continue;
        sendLine(normalized, step.clearLine ?? false);
        continue;
      }
      if (step.kind === 'launch_agent') {
        sendLine(agentCommand, true);
        lastAgentLaunchAtRef.current = Date.now();
        if (step.postInstruction?.trim()) {
          window.setTimeout(() => {
            sendLine(step.postInstruction!.trim(), true);
          }, 900);
        }
      }
    }
  }, [agentCommand]);

  const dispatchQuickAction = useCallback((action: QuickActionId) => {
    const now = Date.now();
    if (now - lastQuickActionAtRef.current < 180) return;
    lastQuickActionAtRef.current = now;

    const plan = resolveQuickActionPlan({
      action,
      agentCommand,
      isBlocked: !!isBlocked
    });
    recordQuickAction(action, {
      target: plan.target,
      profile: plan.capabilities.profile
    });

    const needsPty = plan.steps.some(step => step.kind !== 'hint');
    if (!needsPty) {
      runQuickActionPlan(plan.steps);
      return;
    }

    ensurePtyRunning(() => {
      runQuickActionPlan(plan.steps);
    });
  }, [agentCommand, ensurePtyRunning, isBlocked, runQuickActionPlan]);

  const handleQuickTestFix = () => {
    dispatchQuickAction('test_and_fix');
  };

  const handleQuickResume = () => {
    dispatchQuickAction('resume');
  };

  const handleQuickPause = () => {
    dispatchQuickAction('pause');
  };

  const handleQuickPlan = () => {
    dispatchQuickAction('plan');
  };

  const injectAgentCommand = (filePath: string) => {
    if (capabilitiesProfile.profile === 'aider') {
      sendLine(`/add ${filePath}`);
      return;
    }
    sendLine(`Please analyze this image and use it as task context: ${filePath}`);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let handledImage = false;
    for (let i = 0; i < items.length; i += 1) {
      if (!items[i].type.includes('image')) continue;
      const file = items[i].getAsFile();
      if (!file) continue;
      handledImage = true;
      e.preventDefault();

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const filename = `img_${Date.now()}.png`;
        const res = await window.electronAPI.saveImage(cwd, base64, filename);
        if (res.success && res.path) {
          injectAgentCommand(res.path);
        }
      };
      reader.readAsDataURL(file);
    }

    if (handledImage) return;

    const text = e.clipboardData.getData('text');
    if (text && terminalInstance.current) {
      e.preventDefault();
      terminalInstance.current.paste(text);
    }
  };

  const handleQuickStatus = () => {
    dispatchQuickAction('status');
  };

  return (
    <div className="w-full h-full flex flex-col relative bg-[var(--xterm-bg)] rounded-xl overflow-hidden" onPaste={handlePaste}>
      <div
        className="flex-1 relative overflow-hidden bg-[var(--xterm-bg)]"
        onMouseDown={() => {
          terminalInstance.current?.focus();
        }}
      >
        <div ref={terminalRef} className="w-full h-full absolute inset-0" />
      </div>

      <div className="p-3 border-t border-[var(--panel-border)] bg-[var(--panel)] flex flex-col shrink-0 relative z-30">
        {isBlocked && (
          <div className="mb-3 rounded-lg border border-red-900/70 bg-[#1a0505] px-3 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center">
              <AlertTriangle size={13} className="text-red-500 mr-2 flex-shrink-0" />
              <span className="text-[11px] text-red-300 font-mono truncate">
                Action Required: {blockedReason || 'agent is waiting for confirmation.'}
              </span>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
              <button type="button" tabIndex={-1} onFocus={blurButtonOnFocus} onMouseDown={keepTerminalFocus} onClick={() => sendLine('y', false)} className="btn-primary px-3 py-1.5 rounded text-[11px] font-mono">
                approve (y)
              </button>
              <button type="button" tabIndex={-1} onFocus={blurButtonOnFocus} onMouseDown={keepTerminalFocus} onClick={() => sendLine('n', false)} className="btn-ghost border border-[#262626] px-3 py-1.5 rounded text-[11px] font-mono">
                reject (n)
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              {usageSummaryLabel && (
                <span className="text-[10px] border border-[#1f1f1f] bg-[#0a0a0a] text-[#9ca3af] px-2 py-1 rounded font-mono">
                  {usageSummaryLabel}
                </span>
              )}
              {usageCostLabel && (
                <span className="text-[10px] border border-[#1f1f1f] bg-[#0a0a0a] text-[#9ca3af] px-2 py-1 rounded font-mono">
                  {usageCostLabel}
                </span>
              )}
            </div>
            {hasUsageBadge && usageUpdatedLabel && (
              <span className="text-[10px] text-[#6b7280] font-mono">
                usage {usageUpdatedLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              tabIndex={-1}
              onFocus={blurButtonOnFocus}
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickStatus}
              title="Request git status snapshot for this task"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <TerminalSquare size={12} className="mr-2 text-[#525252]" /> status
            </button>
            <button
              type="button"
              tabIndex={-1}
              onFocus={blurButtonOnFocus}
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickResume}
              title="Continue the current task without restarting context"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <Play size={12} className="mr-2 text-[#525252]" /> resume
            </button>
            <button
              type="button"
              tabIndex={-1}
              onFocus={blurButtonOnFocus}
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickPause}
              title="Send Ctrl+C to interrupt current command/agent action"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <Pause size={12} className="mr-2 text-[#525252]" /> pause
            </button>
            <button
              type="button"
              tabIndex={-1}
              onFocus={blurButtonOnFocus}
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickTestFix}
              title="Run relevant checks and fix failures"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <Code size={12} className="mr-2 text-[#525252]" /> test & fix
            </button>
            <button
              type="button"
              tabIndex={-1}
              onFocus={blurButtonOnFocus}
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickPlan}
              title="Create a concise execution plan"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <Map size={12} className="mr-2 text-[#525252]" /> plan
            </button>
            <button
              type="button"
              tabIndex={-1}
              onFocus={blurButtonOnFocus}
              onMouseDown={keepTerminalFocus}
              onClick={() => onHandover?.()}
              title="Hand over this task to another agent model"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <ArrowRightLeft size={12} className="mr-2 text-[#525252]" /> handover
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                tabIndex={-1}
                onFocus={blurButtonOnFocus}
                onMouseDown={keepTerminalFocus}
                onClick={() => onMerge?.()}
                title="Review and merge this worktree"
                className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center text-emerald-400 hover:text-emerald-300"
              >
                <GitMerge size={12} className="mr-2 text-emerald-500" /> merge
              </button>
              <button
                type="button"
                tabIndex={-1}
                onFocus={blurButtonOnFocus}
                onMouseDown={keepTerminalFocus}
                onClick={() => onDelete?.()}
                title="Delete this branch and worktree"
                className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center text-red-400 hover:text-red-300"
              >
                <Trash2 size={12} className="mr-2 text-red-500" /> delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Terminal;
