import React, { useEffect, useMemo, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowRightLeft, GitMerge, Code, Trash2, AlertTriangle, TerminalSquare, Pause, Play } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { shellQuote } from '../lib/shell';
import type { TaskUsage } from '../models/orchestrator';
import { formatTaskCost, formatTaskUsage } from '../lib/usageUtils';

type QuickActionMode = 'unknown' | 'shell' | 'agent';

const MAX_RECENT_OUTPUT = 8000;
const stripAnsi = (value: string) => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
const shellPromptPattern = /(?:^|\n)[^\n]{0,240}[#$%]\s$/;

interface TerminalProps {
  taskId: string;
  cwd: string;
  agentCommand: string;
  context?: string;
  envVars?: string;
  prompt?: string;
  mcpServers?: string;
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
  const lastQuickActionAtRef = useRef(0);
  const pendingStealthTimeoutRef = useRef<number | null>(null);
  const recentOutputRef = useRef('');
  const quickActionModeRef = useRef<QuickActionMode>('unknown');
  const lastAgentLaunchAtRef = useRef(0);
  const isInitialized = useRef(false);
  const onBootstrappedRef = useRef(onBootstrapped);
  const normalizedAgent = useMemo(() => agentCommand.toLowerCase(), [agentCommand]);
  const isAiderAgent = useMemo(() => normalizedAgent.includes('aider'), [normalizedAgent]);
  const isPromptAgent = useMemo(() => /(claude|codex|gemini|amp|cursor|cline|sweep)/.test(normalizedAgent), [normalizedAgent]);
  const usageSummaryLabel = useMemo(() => formatTaskUsage(taskUsage), [taskUsage]);
  const usageCostLabel = useMemo(() => formatTaskCost(taskUsage), [taskUsage]);
  const usageUpdatedLabel = useMemo(() => {
    if (!taskUsage?.updatedAt || !Number.isFinite(taskUsage.updatedAt)) return null;
    return new Date(taskUsage.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [taskUsage]);

  useEffect(() => {
    onBootstrappedRef.current = onBootstrapped;
  }, [onBootstrapped]);

  useEffect(() => {
    const tokenQuery = controlAuthTokenRef.current ? `?token=${encodeURIComponent(controlAuthTokenRef.current)}` : '';
    const next = `http://127.0.0.1:34567/api/task/${taskId}${tokenQuery}`;
    controlTaskUrlRef.current = next;
  }, [taskId]);

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
        term = new XTerm({
          theme: {
            background: '#000000',
            foreground: '#e5e5e5',
            cursor: '#ffffff',
            cursorAccent: '#000000',
            selectionBackground: 'rgba(255, 255, 255, 0.2)',
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

        const customEnv: Record<string, string> = {
          MULTI_AGENT_IDE_URL: controlTaskUrlRef.current,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'Forkline',
          FORCE_COLOR: '1',
          CLICOLOR: '1',
          CLICOLOR_FORCE: '1'
        };

        if (envVars) {
          envVars.split('\n').forEach(line => {
            const [k, ...rest] = line.split('=');
            const value = rest.join('=');
            if (k && value) customEnv[k.trim()] = value.trim();
          });
        }

        term.onData(data => {
          window.electronAPI.writePty(taskId, data);
        });

        removePtyListener = window.electronAPI.onPtyData(taskId, (data) => {
          term?.write(data);
          recentOutputRef.current = `${recentOutputRef.current}${data}`.slice(-MAX_RECENT_OUTPUT);
          const tail = stripAnsi(recentOutputRef.current).replace(/\r/g, '');
          if (shellPromptPattern.test(tail) || /command not found|is not recognized as an internal or external command/i.test(tail)) {
            quickActionModeRef.current = 'shell';
            return;
          }
          if (
            /thinking|tokens|context window|╭|╰|assistant|user|\/ask/i.test(tail)
            || (Date.now() - lastAgentLaunchAtRef.current < 30_000)
          ) {
            quickActionModeRef.current = 'agent';
          }
        });
        removePtyStateListener = window.electronAPI.onPtyState(taskId, ({ created }) => {
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
            const apiDoc = `IDE Capabilities API\n--------------------\nYou are running inside Forkline.\nYou can interact with the IDE by sending POST requests to the local control server.\n\nBase URL: ${taskControlUrl}\nEnvironment Variable Alias: $MULTI_AGENT_IDE_URL\nCurrent Permissions:\n- Merge Request: ${capabilities?.autoMerge ? 'Auto-Approve' : 'Requires Human Approval'}\n\nEndpoints:\n1. POST ${taskControlUrl}/merge\n2. POST ${taskControlUrl}/todos\n3. POST ${taskControlUrl}/message\n4. POST ${taskControlUrl}/usage (or /metrics)\n   Payload (example): {"contextTokens": 10240, "contextWindow": 200000, "promptTokens": 640, "completionTokens": 220, "totalTokens": 860}\n`;
            void window.electronAPI
              .prepareAgentWorkspace(cwd, context || '', mcpServers || '', apiDoc)
              .catch((err) => {
                console.error('Failed to prepare workspace metadata:', err);
              })
              .finally(() => {
                if (prompt) {
                  const quotedPrompt = shellQuote(prompt);
                  window.electronAPI.writePty(taskId, `clear && echo -e "\\033[1;37m[Orchestrator]\\033[0m Bootstrapping task..." && ${agentCommand} ${quotedPrompt}\r`);
                } else {
                  window.electronAPI.writePty(taskId, `clear && ${agentCommand}\r`);
                }
                lastAgentLaunchAtRef.current = Date.now();
                quickActionModeRef.current = 'agent';
                onBootstrappedRef.current?.();
              });
          }, 200);
        });
        removePtyExitListener = window.electronAPI.onPtyExit(taskId, ({ exitCode, signal }) => {
          term?.writeln(`\r\n[orchestrator] PTY exited (code=${exitCode ?? 'null'} signal=${signal ?? 'none'}).`);
          quickActionModeRef.current = 'unknown';
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
            const tokenQuery = normalizedToken ? `?token=${encodeURIComponent(normalizedToken)}` : '';
            const resolvedTaskUrl = `${resolvedBaseUrl}/api/task/${taskId}${tokenQuery}`;
            controlTaskUrlRef.current = resolvedTaskUrl;
            customEnv.MULTI_AGENT_IDE_URL = resolvedTaskUrl;
          })
          .catch(() => {
            customEnv.MULTI_AGENT_IDE_URL = fallbackTaskControlUrl;
          })
          .finally(() => {
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
      if (pendingStealthTimeoutRef.current !== null) {
        clearTimeout(pendingStealthTimeoutRef.current);
        pendingStealthTimeoutRef.current = null;
      }
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
  }, [taskId, cwd]);

  const executeMacro = (cmd: string) => {
    window.electronAPI.writePty(taskId, `${cmd}\r`);
    requestAnimationFrame(() => {
      terminalInstance.current?.focus();
    });
  };

  const writeOrchestratorHint = (message: string) => {
    terminalInstance.current?.writeln(`\r\n[orchestrator] ${message}`);
  };

  const dispatchStableInput = (text: string) => {
    const normalized = text
      .replace(/\$MULTI_AGENT_IDE_URL/g, controlTaskUrlRef.current)
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return;
    window.electronAPI.writePty(taskId, `${normalized}\r`);
    requestAnimationFrame(() => {
      terminalInstance.current?.focus();
    });
  };

  const recordQuickAction = (action: string, payload: Record<string, unknown> = {}) => {
    void window.electronAPI.fleetRecordEvent(taskId, 'quick_action', { action, ...payload });
  };

  const keepTerminalFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Prevent button from retaining focus so Enter keeps going to xterm.
    event.preventDefault();
    event.currentTarget.blur();
    requestAnimationFrame(() => {
      terminalInstance.current?.focus();
    });
  };

  const dispatchAgentInstruction = (payload: string) => {
    if (!payload.trim()) return;
    if (isAiderAgent) {
      dispatchStableInput(`/ask ${payload}`);
      return;
    }
    dispatchStableInput(payload);
  };

  const relaunchAgentStealth = (postInstruction?: string) => {
    if (pendingStealthTimeoutRef.current !== null) {
      clearTimeout(pendingStealthTimeoutRef.current);
      pendingStealthTimeoutRef.current = null;
    }
    window.electronAPI.writePty(taskId, `${agentCommand}\r`);
    lastAgentLaunchAtRef.current = Date.now();
    quickActionModeRef.current = 'agent';
    if (postInstruction && postInstruction.trim()) {
      pendingStealthTimeoutRef.current = window.setTimeout(() => {
        dispatchAgentInstruction(postInstruction);
        pendingStealthTimeoutRef.current = null;
      }, 900);
    }
  };

  const sendAgentInstruction = (lines: string[]) => {
    const now = Date.now();
    if (now - lastQuickActionAtRef.current < 250) return;
    lastQuickActionAtRef.current = now;

    const payload = lines.join(' ');
    dispatchAgentInstruction(payload);
  };

  const handleQuickTestFix = () => {
    recordQuickAction('test_and_fix');
    const mode = isBlocked ? 'blocked' : quickActionModeRef.current;
    const instruction = 'Run relevant tests, fix failures, and summarize the changes briefly.';
    if (mode === 'blocked') {
      executeMacro('y');
      return;
    }
    if (mode === 'shell') {
      writeOrchestratorHint('Relaunching agent before running test & fix.');
      relaunchAgentStealth(instruction);
      return;
    }
    sendAgentInstruction([instruction]);
  };

  const handleQuickResume = () => {
    recordQuickAction('resume');
    const mode = isBlocked ? 'blocked' : quickActionModeRef.current;
    if (mode === 'blocked') {
      executeMacro('y');
      return;
    }
    if (mode === 'shell') {
      writeOrchestratorHint('Relaunching agent for this session.');
      relaunchAgentStealth();
      return;
    }
    executeMacro('');
  };

  const handleQuickPause = () => {
    recordQuickAction('pause');
    window.electronAPI.writePty(taskId, '\u0003');
    requestAnimationFrame(() => {
      terminalInstance.current?.focus();
    });
  };

  const injectAgentCommand = (filePath: string) => {
    if (agentCommand.toLowerCase().includes('aider')) {
      executeMacro(`/add ${filePath}`);
      return;
    }
    executeMacro(`Please analyze this image and use it as task context: ${filePath}`);
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
    recordQuickAction('status');
    const mode = isBlocked ? 'blocked' : quickActionModeRef.current;
    if (mode === 'blocked') {
      writeOrchestratorHint('Status is unavailable while the agent is waiting for approval.');
      return;
    }
    if (mode === 'shell') {
      executeMacro('git status --short && echo "---" && git branch --show-current');
      return;
    }
    if (isAiderAgent) {
      executeMacro('/run git status --short && echo "---" && git branch --show-current');
      return;
    }

    if (isPromptAgent) {
      sendAgentInstruction([
        'Show the current git status and branch for this worktree.'
      ]);
      return;
    }

    executeMacro('git status --short && echo "---" && git branch --show-current');
  };

  return (
    <div className="w-full h-full flex flex-col relative bg-[#000000] rounded-xl overflow-hidden" onPaste={handlePaste}>
      <div
        className="flex-1 relative overflow-hidden bg-[#000000]"
        onMouseDown={() => {
          terminalInstance.current?.focus();
        }}
      >
        <div ref={terminalRef} className="w-full h-full absolute inset-0" />
      </div>

      <div className="p-3 border-t border-[#1a1a1a] bg-[#050505] flex flex-col shrink-0 relative z-30">
        {isBlocked && (
          <div className="mb-3 rounded-lg border border-red-900/70 bg-[#1a0505] px-3 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center">
              <AlertTriangle size={13} className="text-red-500 mr-2 flex-shrink-0" />
              <span className="text-[11px] text-red-300 font-mono truncate">
                Action Required: {blockedReason || 'agent is waiting for confirmation.'}
              </span>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
              <button onMouseDown={keepTerminalFocus} onClick={() => executeMacro('y')} className="btn-primary px-3 py-1.5 rounded text-[11px] font-mono">
                approve (y)
              </button>
              <button onMouseDown={keepTerminalFocus} onClick={() => executeMacro('n')} className="btn-ghost border border-[#262626] px-3 py-1.5 rounded text-[11px] font-mono">
                reject (n)
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] border border-[#1f1f1f] bg-[#0a0a0a] text-[#9ca3af] px-2 py-1 rounded font-mono">
                {usageSummaryLabel}
              </span>
              <span className="text-[10px] border border-[#1f1f1f] bg-[#0a0a0a] text-[#9ca3af] px-2 py-1 rounded font-mono">
                {usageCostLabel}
              </span>
            </div>
            {usageUpdatedLabel && (
              <span className="text-[10px] text-[#6b7280] font-mono">
                usage {usageUpdatedLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickStatus}
              title="Request git status snapshot for this task"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <TerminalSquare size={12} className="mr-2 text-[#525252]" /> status
            </button>
            <button
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickResume}
              title="Continue the current task without restarting context"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <Play size={12} className="mr-2 text-[#525252]" /> resume
            </button>
            <button
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickPause}
              title="Send Ctrl+C to interrupt current command/agent action"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <Pause size={12} className="mr-2 text-[#525252]" /> pause
            </button>
            <button
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickTestFix}
              title="Run relevant checks and fix failures"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <Code size={12} className="mr-2 text-[#525252]" /> test & fix
            </button>
            <button
              onMouseDown={keepTerminalFocus}
              onClick={onHandover}
              title="Hand over this task to another agent model"
              className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center"
            >
              <ArrowRightLeft size={12} className="mr-2 text-[#525252]" /> handover
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onMouseDown={keepTerminalFocus}
                onClick={onMerge}
                title="Review and merge this worktree"
                className="btn-ghost px-3 py-1.5 rounded text-xs font-mono flex items-center text-emerald-400 hover:text-emerald-300"
              >
                <GitMerge size={12} className="mr-2 text-emerald-500" /> merge
              </button>
              <button
                onMouseDown={keepTerminalFocus}
                onClick={onDelete}
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
