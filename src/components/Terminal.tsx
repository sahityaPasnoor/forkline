import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { GitMerge, AlertTriangle, Trash2, GitPullRequest } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { LivingSpecPreference, TaskUsage } from '../models/orchestrator';
import { formatTaskCost, formatTaskUsage } from '../lib/usageUtils';
import { detectAgentCapabilities, resolveQuickActionPlan, type QuickActionId, type QuickActionStep } from '../lib/quickActions';
import { buildAgentLaunchPlan, resolveAgentProfile } from '../lib/agentProfiles';

interface TerminalProps {
  taskId: string;
  cwd: string;
  agentCommand: string;
  context?: string;
  envVars?: string;
  prompt?: string;
  launchCommandOverride?: string;
  projectPath: string;
  parentBranch?: string;
  livingSpecPreference?: LivingSpecPreference;
  livingSpecOverridePath?: string;
  packageStoreStrategy?: 'off' | 'pnpm_global' | 'polyglot_global';
  pnpmStorePath?: string;
  sharedCacheRoot?: string;
  sandboxMode?: 'off' | 'auto' | 'seatbelt' | 'firejail';
  networkGuard?: 'off' | 'none';
  isActive?: boolean;
  shouldBootstrap?: boolean;
  capabilities?: { autoMerge: boolean };
  taskUsage?: TaskUsage;
  isBlocked?: boolean;
  blockedReason?: string;
  onMerge?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onBootstrapped?: (taskId: string) => void;
}

interface PendingPtyContinuation {
  continuation: () => void;
  timeoutId: number;
}

interface PendingShellPlan {
  steps: QuickActionStep[];
  timeoutId: number;
}

interface PtyModeSnapshot {
  mode: string;
  modeSeq: number;
  isBlocked: boolean;
  blockedReason?: string;
}

type RelaunchPhase = 'restoring' | 'preparing_workspace' | 'launching_agent';

interface RelaunchProgressState {
  phase: RelaunchPhase;
  detail?: string;
}

interface PtySandboxSnapshot {
  mode: string;
  active: boolean;
  warning?: string;
  denyNetwork?: boolean;
}

const isShellLikeMode = (mode: string) => mode === 'shell' || mode === 'exited';
const isAgentLikeMode = (mode: string) => mode === 'agent' || mode === 'blocked' || mode === 'tui';
const isResumeEligibleMode = (mode: string) => isShellLikeMode(mode) || mode === 'booting';
const isCsiResponseParam = (value: string) => (
  (value >= '0' && value <= '9')
  || value === ';'
  || value === '?'
  || value === '>'
  || value === ':'
);

const stripOrphanTerminalResponsePayload = (input: string) => {
  let sanitized = input;
  // Split DA/DSR payload fragments can occasionally leak without ESC prefix.
  sanitized = sanitized.replace(
    /(^|[\r\n])[ \t]*\??[0-9]{1,3}(?:;[0-9]{1,3}){0,6}[cnR](?=$|[\r\n])/g,
    '$1'
  );
  // Handle compact fragments that are concatenated onto a prompt line.
  sanitized = sanitized.replace(
    /(^|[\r\n>:\s])[ \t]*(?:[0-9]{1,3}(?:;[0-9]{1,3}){1,6}c){1,8}(?=$|[\r\n:\s])/g,
    '$1'
  );
  sanitized = sanitized.replace(
    /(^|[\r\n>:\s])[ \t]*(?:25h){1,6}(?=$|[\r\n:\s])/g,
    '$1'
  );
  return {
    sanitized,
    changed: sanitized !== input
  };
};

const stripTerminalControlResponses = (input: string, carry = '', stripOrphansFromPreviousChunk = false) => {
  const chunk = `${carry}${String(input || '')}`;
  if (!chunk) return { sanitized: '', carry: '', strippedControlResponse: false };

  let sanitized = '';
  let nextCarry = '';
  let strippedControlResponse = false;

  const consumeCsiResponse = (marker: string, start: number, payloadOffset: number) => {
    if (marker === 'I' || marker === 'O') {
      strippedControlResponse = true;
      return { consumed: true, nextIndex: start + payloadOffset + 1 };
    }
    if (marker === '?' || marker === '>' || (marker >= '0' && marker <= '9')) {
      let j = start + payloadOffset + 1;
      while (j < chunk.length && isCsiResponseParam(chunk[j])) {
        j += 1;
      }
      if (j >= chunk.length) {
        nextCarry = chunk.slice(start);
        return { consumed: true, nextIndex: chunk.length };
      }
      if (chunk[j] === 'c' || chunk[j] === 'n' || chunk[j] === 'R') {
        strippedControlResponse = true;
        return { consumed: true, nextIndex: j + 1 };
      }
    }
    return { consumed: false, nextIndex: start + 1 };
  };

  for (let i = 0; i < chunk.length;) {
    const ch = chunk[i];
    if (ch !== '\x1b') {
      if (ch === '\x9b') {
        if (i + 1 >= chunk.length) {
          nextCarry = chunk.slice(i);
          break;
        }
        const parsed = consumeCsiResponse(chunk[i + 1], i, 1);
        if (parsed.consumed) {
          i = parsed.nextIndex;
          continue;
        }
      }
      sanitized += ch;
      i += 1;
      continue;
    }

    if (i + 1 >= chunk.length) {
      nextCarry = chunk.slice(i);
      break;
    }

    if (chunk[i + 1] !== '[') {
      if (chunk[i + 1] === ']') {
        let j = i + 2;
        let terminated = false;
        while (j < chunk.length) {
          if (chunk[j] === '\u0007') {
            terminated = true;
            j += 1;
            break;
          }
          if (chunk[j] === '\x1b' && j + 1 < chunk.length && chunk[j + 1] === '\\') {
            terminated = true;
            j += 2;
            break;
          }
          j += 1;
        }
        if (!terminated) {
          nextCarry = chunk.slice(i);
          break;
        }
        strippedControlResponse = true;
        i = j;
        continue;
      }
      sanitized += ch;
      i += 1;
      continue;
    }

    if (i + 2 >= chunk.length) {
      nextCarry = chunk.slice(i);
      break;
    }

    const marker = chunk[i + 2];
    if (marker === 'I' || marker === 'O') {
      strippedControlResponse = true;
      i += 3;
      continue;
    }

    const parsed = consumeCsiResponse(marker, i, 2);
    if (parsed.consumed) {
      i = parsed.nextIndex;
      continue;
    }

    sanitized += ch;
    i += 1;
  }

  if ((strippedControlResponse || stripOrphansFromPreviousChunk) && sanitized) {
    const orphanResult = stripOrphanTerminalResponsePayload(sanitized);
    sanitized = orphanResult.sanitized;
    if (orphanResult.changed) {
      strippedControlResponse = true;
    }
  }

  return { sanitized, carry: nextCarry, strippedControlResponse };
};
const SAFE_BRANCH_PATTERN = /^[a-zA-Z0-9._/-]{1,120}$/;

const isLivingSpecPreferenceEqual = (a?: LivingSpecPreference, b?: LivingSpecPreference) => (
  (a?.mode || '') === (b?.mode || '')
  && (a?.selectedPath || '') === (b?.selectedPath || '')
);

const isTaskUsageEqual = (a?: TaskUsage, b?: TaskUsage) => (
  (a?.contextTokens ?? null) === (b?.contextTokens ?? null)
  && (a?.promptTokens ?? null) === (b?.promptTokens ?? null)
  && (a?.completionTokens ?? null) === (b?.completionTokens ?? null)
  && (a?.totalTokens ?? null) === (b?.totalTokens ?? null)
  && (a?.contextWindow ?? null) === (b?.contextWindow ?? null)
  && (a?.percentUsed ?? null) === (b?.percentUsed ?? null)
  && (a?.costUsd ?? null) === (b?.costUsd ?? null)
  && (a?.promptCostUsd ?? null) === (b?.promptCostUsd ?? null)
  && (a?.completionCostUsd ?? null) === (b?.completionCostUsd ?? null)
  && (a?.updatedAt ?? null) === (b?.updatedAt ?? null)
);

const areTerminalPropsEqual = (prev: TerminalProps, next: TerminalProps) => (
  prev.taskId === next.taskId
  && prev.cwd === next.cwd
  && prev.agentCommand === next.agentCommand
  && prev.context === next.context
  && prev.envVars === next.envVars
  && prev.prompt === next.prompt
  && prev.launchCommandOverride === next.launchCommandOverride
  && prev.projectPath === next.projectPath
  && prev.parentBranch === next.parentBranch
  && isLivingSpecPreferenceEqual(prev.livingSpecPreference, next.livingSpecPreference)
  && prev.livingSpecOverridePath === next.livingSpecOverridePath
  && prev.packageStoreStrategy === next.packageStoreStrategy
  && prev.pnpmStorePath === next.pnpmStorePath
  && prev.sharedCacheRoot === next.sharedCacheRoot
  && prev.sandboxMode === next.sandboxMode
  && prev.networkGuard === next.networkGuard
  && prev.isActive === next.isActive
  && prev.shouldBootstrap === next.shouldBootstrap
  && (prev.capabilities?.autoMerge ?? false) === (next.capabilities?.autoMerge ?? false)
  && isTaskUsageEqual(prev.taskUsage, next.taskUsage)
  && prev.isBlocked === next.isBlocked
  && prev.blockedReason === next.blockedReason
  && prev.onMerge === next.onMerge
  && prev.onDelete === next.onDelete
  && prev.onBootstrapped === next.onBootstrapped
);

const resolveTerminalTheme = () => {
  const cssVars = getComputedStyle(document.documentElement);
  const terminalBackground = cssVars.getPropertyValue('--xterm-bg').trim() || '#000000';
  const terminalForeground = cssVars.getPropertyValue('--xterm-fg').trim() || '#e5e5e5';
  const terminalCursor = cssVars.getPropertyValue('--xterm-cursor').trim() || '#ffffff';
  const terminalSelection = cssVars.getPropertyValue('--xterm-selection').trim() || 'rgba(255, 255, 255, 0.2)';
  const themeId = (document.documentElement.getAttribute('data-theme') || '').trim().toLowerCase();
  const isLightTheme = themeId.endsWith('light');

  const palette = isLightTheme
    ? {
        black: '#1f2937',
        red: '#dc2626',
        green: '#16a34a',
        yellow: '#a16207',
        blue: '#2563eb',
        magenta: '#a21caf',
        cyan: '#0e7490',
        white: '#334155',
        brightBlack: '#64748b',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#ca8a04',
        brightBlue: '#3b82f6',
        brightMagenta: '#c026d3',
        brightCyan: '#0891b2',
        brightWhite: '#0f172a'
      }
    : {
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

  return {
    minimumContrastRatio: isLightTheme ? 4.5 : 1,
    theme: {
      background: terminalBackground,
      foreground: terminalForeground,
      cursor: terminalCursor,
      cursorAccent: isLightTheme ? '#f8fafc' : '#000000',
      selectionBackground: terminalSelection,
      ...palette
    }
  };
};

const Terminal: React.FC<TerminalProps> = ({
  taskId,
  cwd,
  agentCommand,
  context,
  envVars,
  prompt,
  launchCommandOverride,
  projectPath,
  parentBranch,
  livingSpecPreference,
  livingSpecOverridePath,
  packageStoreStrategy,
  pnpmStorePath,
  sharedCacheRoot,
  sandboxMode,
  networkGuard,
  isActive = true,
  shouldBootstrap,
  onBootstrapped,
  capabilities,
  taskUsage,
  isBlocked,
  blockedReason,
  onMerge,
  onDelete
}) => {
  const fallbackTaskControlUrl = `http://127.0.0.1:34567/api/task/${taskId}`;
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<XTerm | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const lastFittedSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const controlTaskUrlRef = useRef(fallbackTaskControlUrl);
  const controlAuthTokenRef = useRef('');
  const ptyEnvRef = useRef<Record<string, string> | null>(null);
  const lastQuickActionAtRef = useRef(0);
  const lastPauseAtRef = useRef(0);
  const lastAgentLaunchAtRef = useRef(0);
  const modeSeqRef = useRef(-1);
  const terminalModeRef = useRef('booting');
  const modeSnapshotRef = useRef<PtyModeSnapshot>({ mode: 'booting', modeSeq: 0, isBlocked: false });
  const ptyRunningRef = useRef(false);
  const ptyStartInFlightRef = useRef(false);
  const agentLikelyActiveRef = useRef(false);
  const shouldBootstrapRef = useRef(shouldBootstrap);
  const pendingShellPlanRef = useRef<PendingShellPlan | null>(null);
  const [terminalMode, setTerminalMode] = useState('booting');
  const [quickActionNotice, setQuickActionNotice] = useState<string | null>(null);
  const [relaunchProgress, setRelaunchProgress] = useState<RelaunchProgressState | null>(null);
  const [sandboxSnapshot, setSandboxSnapshot] = useState<PtySandboxSnapshot | null>(null);
  const [showSessionLoadProgress, setShowSessionLoadProgress] = useState(false);
  const quickActionNoticeTimeoutRef = useRef<number | null>(null);
  const sessionLoadProgressTimerRef = useRef<number | null>(null);
  const isDisposedRef = useRef(false);
  const pendingPtyContinuationsRef = useRef<PendingPtyContinuation[]>([]);
  const shellInputCarryRef = useRef('');
  const recentControlResponseRef = useRef(false);
  const lastCursorRecoverAtRef = useRef(0);
  const isInitialized = useRef(false);
  const onBootstrappedRef = useRef(onBootstrapped);
  const capabilitiesProfile = useMemo(() => detectAgentCapabilities(agentCommand), [agentCommand]);
  const agentProfile = useMemo(() => resolveAgentProfile(agentCommand), [agentCommand]);
  const [hasLiveMode, setHasLiveMode] = useState(false);
  const [liveBlockedState, setLiveBlockedState] = useState<{ isBlocked: boolean; blockedReason?: string }>({
    isBlocked: !!isBlocked,
    blockedReason: isBlocked ? blockedReason : undefined
  });
  const effectiveBlocked = hasLiveMode ? liveBlockedState.isBlocked : !!isBlocked;
  const effectiveBlockedReason = (hasLiveMode ? liveBlockedState.blockedReason : blockedReason) || blockedReason;
  const usageSummaryLabel = useMemo(() => formatTaskUsage(taskUsage), [taskUsage]);
  const usageCostLabel = useMemo(() => formatTaskCost(taskUsage), [taskUsage]);
  const hasUsageBadge = !!usageSummaryLabel || !!usageCostLabel;
  const usageUpdatedLabel = useMemo(() => {
    if (!taskUsage?.updatedAt || !Number.isFinite(taskUsage.updatedAt)) return null;
    return new Date(taskUsage.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [taskUsage]);
  const resolvedLivingSpecPath = useMemo(() => {
    const override = livingSpecOverridePath?.trim();
    if (override) return override;
    const selected = livingSpecPreference?.mode === 'single' ? livingSpecPreference.selectedPath?.trim() : '';
    if (selected) return selected;
    return '.agent_cache/FORKLINE_SPEC.md';
  }, [livingSpecOverridePath, livingSpecPreference]);

  const setAgentModeLikely = useCallback((next: boolean) => {
    if (agentLikelyActiveRef.current === next) return;
    agentLikelyActiveRef.current = next;
  }, []);
  const setRelaunchProgressPhase = useCallback((phase: RelaunchPhase, detail?: string) => {
    setRelaunchProgress({ phase, detail });
  }, []);
  const clearRelaunchProgress = useCallback(() => {
    setRelaunchProgress(null);
  }, []);
  const relaunchProgressMeta = useMemo(() => {
    if (!relaunchProgress) return null;
    if (relaunchProgress.phase === 'restoring') return { label: 'Restoring session', percent: 30 };
    if (relaunchProgress.phase === 'preparing_workspace') return { label: 'Preparing workspace metadata', percent: 65 };
    return { label: 'Relaunching agent', percent: 92 };
  }, [relaunchProgress]);
  const startupProgressMeta = useMemo(() => {
    if (relaunchProgress && relaunchProgressMeta) {
      return {
        label: relaunchProgressMeta.label,
        percent: relaunchProgressMeta.percent,
        detail: relaunchProgress.detail
      };
    }
    if (!showSessionLoadProgress) return null;
    return {
      label: 'Loading session',
      percent: 24,
      detail: 'Attaching PTY and restoring task state for this tab.'
    };
  }, [relaunchProgress, relaunchProgressMeta, showSessionLoadProgress]);
  const dispatchRelaunchCommand = useCallback((command: string) => {
    const normalizedCommand = String(command || '').trim();
    if (!normalizedCommand) return;
    const MAX_ATTEMPTS = 8;
    const tryLaunch = (attempt = 0) => {
      void window.electronAPI.launchPty(taskId, normalizedCommand, { suppressEcho: true })
        .then((result) => {
          if (result?.success) return;
          const message = String(result?.error || '');
          if (attempt < MAX_ATTEMPTS && /not running|session not found/i.test(message)) {
            const relaunchEnv = ptyEnvRef.current || {};
            window.electronAPI.createPty(taskId, cwd, relaunchEnv);
            window.setTimeout(() => {
              if (isDisposedRef.current) return;
              tryLaunch(attempt + 1);
            }, Math.min(1200, 140 * (attempt + 1)));
            return;
          }
          clearRelaunchProgress();
          setAgentModeLikely(false);
          terminalInstance.current?.writeln(`\r\n[orchestrator] Failed to relaunch agent: ${message || 'unknown error'}`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'unknown error';
          clearRelaunchProgress();
          setAgentModeLikely(false);
          terminalInstance.current?.writeln(`\r\n[orchestrator] Failed to relaunch agent: ${message}`);
        });
    };
    tryLaunch(0);
  }, [taskId, cwd, clearRelaunchProgress, setAgentModeLikely]);
  const beginSessionLoadProgress = useCallback(() => {
    if (sessionLoadProgressTimerRef.current !== null) {
      window.clearTimeout(sessionLoadProgressTimerRef.current);
      sessionLoadProgressTimerRef.current = null;
    }
    sessionLoadProgressTimerRef.current = window.setTimeout(() => {
      setShowSessionLoadProgress(true);
      sessionLoadProgressTimerRef.current = null;
    }, 60);
  }, []);
  const clearSessionLoadProgress = useCallback(() => {
    if (sessionLoadProgressTimerRef.current !== null) {
      window.clearTimeout(sessionLoadProgressTimerRef.current);
      sessionLoadProgressTimerRef.current = null;
    }
    setShowSessionLoadProgress(false);
  }, []);
  const sandboxBanner = useMemo(() => {
    if (!sandboxSnapshot) return null;
    const mode = String(sandboxSnapshot.mode || 'sandbox').toLowerCase();
    const modeLabel = mode === 'off' ? 'Sandbox' : `Sandbox (${mode})`;
    const warning = typeof sandboxSnapshot.warning === 'string' ? sandboxSnapshot.warning.trim() : '';
    if (warning) {
      return {
        tone: 'warning' as const,
        message: `${modeLabel}: ${warning}`
      };
    }
    if (sandboxSnapshot.active && sandboxSnapshot.denyNetwork) {
      return {
        tone: 'warning' as const,
        message: `${modeLabel} is active. Outbound network is blocked for this session.`
      };
    }
    if (sandboxSnapshot.active) {
      return {
        tone: 'info' as const,
        message: `${modeLabel} is active for this terminal session.`
      };
    }
    if (sandboxSnapshot.denyNetwork) {
      return {
        tone: 'warning' as const,
        message: 'Network guard was requested but could not be enforced for this session.'
      };
    }
    return null;
  }, [sandboxSnapshot]);

  const ensureCursorVisible = useCallback(() => {
    if (!ptyRunningRef.current) return;
    if (!isShellLikeMode(terminalModeRef.current)) return;
    const now = Date.now();
    if (now - lastCursorRecoverAtRef.current < 300) return;
    lastCursorRecoverAtRef.current = now;
    // Keep cursor recovery local to xterm so control bytes are not injected into agent input.
    terminalInstance.current?.write('\u001b[?25h');
  }, []);
  const fitTerminalToContainer = useCallback(() => {
    const fitAddon = fitAddonInstance.current;
    const terminal = terminalInstance.current;
    if (!fitAddon || !terminal || isDisposedRef.current) return;
    try {
      fitAddon.fit();
      const nextCols = terminal.cols;
      const nextRows = terminal.rows;
      const lastSize = lastFittedSizeRef.current;
      if (nextCols === lastSize.cols && nextRows === lastSize.rows) return;
      lastFittedSizeRef.current = { cols: nextCols, rows: nextRows };
      window.electronAPI.resizePty(taskId, nextCols, nextRows);
    } catch {
      // Ignore fit/resize races while layout is settling.
    }
  }, [taskId]);
  const scheduleTerminalFit = useCallback(() => {
    if (fitFrameRef.current !== null) return;
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;
      fitTerminalToContainer();
    });
  }, [fitTerminalToContainer]);

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
      FORKLINE_SPEC_PATH: resolvedLivingSpecPath,
      FORKLINE_PACKAGE_STORE_STRATEGY: packageStoreStrategy || 'off',
      FORKLINE_SANDBOX_MODE: sandboxMode || 'off',
      FORKLINE_NETWORK_GUARD: networkGuard || 'off',
      FORKLINE_AGENT_COMMAND: agentCommand,
      FORKLINE_AGENT_PROVIDER: agentProfile.id
    };
    if (pnpmStorePath?.trim()) {
      customEnv.FORKLINE_PNPM_STORE_PATH = pnpmStorePath.trim();
    }
    if (sharedCacheRoot?.trim()) {
      customEnv.FORKLINE_SHARED_CACHE_ROOT = sharedCacheRoot.trim();
    }
    if (livingSpecOverridePath?.trim()) {
      customEnv.FORKLINE_SPEC_OVERRIDE_PATH = livingSpecOverridePath.trim();
    }

    if (envVars) {
      envVars.split('\n').forEach(line => {
        const [k, ...rest] = line.split('=');
        const value = rest.join('=');
        if (k && value) customEnv[k.trim()] = value.trim();
      });
    }

    return customEnv;
  }, [envVars, fallbackTaskControlUrl, sandboxMode, networkGuard, packageStoreStrategy, pnpmStorePath, sharedCacheRoot, livingSpecOverridePath, resolvedLivingSpecPath, agentCommand, agentProfile.id]);

  useEffect(() => {
    onBootstrappedRef.current = onBootstrapped;
  }, [onBootstrapped]);

  useEffect(() => {
    shouldBootstrapRef.current = shouldBootstrap;
  }, [shouldBootstrap]);

  useEffect(() => {
    return () => {
      if (quickActionNoticeTimeoutRef.current !== null) {
        window.clearTimeout(quickActionNoticeTimeoutRef.current);
        quickActionNoticeTimeoutRef.current = null;
      }
      if (sessionLoadProgressTimerRef.current !== null) {
        window.clearTimeout(sessionLoadProgressTimerRef.current);
        sessionLoadProgressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hasLiveMode) {
      setLiveBlockedState({
        isBlocked: !!isBlocked,
        blockedReason: isBlocked ? blockedReason : undefined
      });
    }
  }, [blockedReason, hasLiveMode, isBlocked]);

  useEffect(() => {
    if (effectiveBlocked) {
      setAgentModeLikely(true);
    }
  }, [effectiveBlocked, setAgentModeLikely]);

  const clearPendingShellPlan = useCallback(() => {
    const pending = pendingShellPlanRef.current;
    if (!pending) return null;
    pendingShellPlanRef.current = null;
    window.clearTimeout(pending.timeoutId);
    return pending;
  }, []);

  const applyModeSnapshot = useCallback((snapshot: PtyModeSnapshot) => {
    const seq = Number.isFinite(snapshot.modeSeq) ? snapshot.modeSeq : 0;
    if (seq <= modeSeqRef.current) return;
    modeSeqRef.current = seq;
    const mode = snapshot.mode || 'booting';
    terminalModeRef.current = mode;
    modeSnapshotRef.current = {
      mode,
      modeSeq: seq,
      isBlocked: !!snapshot.isBlocked,
      blockedReason: snapshot.isBlocked ? snapshot.blockedReason : undefined
    };
    setHasLiveMode(true);
    setLiveBlockedState({
      isBlocked: !!snapshot.isBlocked,
      blockedReason: snapshot.isBlocked ? snapshot.blockedReason : undefined
    });
    setTerminalMode(mode);

    if (snapshot.isBlocked) {
      clearRelaunchProgress();
      setAgentModeLikely(true);
      return;
    }

    if (isShellLikeMode(mode)) {
      clearRelaunchProgress();
      setAgentModeLikely(false);
      ensureCursorVisible();
      return;
    }
    if (isAgentLikeMode(mode)) {
      clearRelaunchProgress();
      setAgentModeLikely(true);
      return;
    }
    if (mode === 'booting') {
      setAgentModeLikely(true);
    }
  }, [clearRelaunchProgress, ensureCursorVisible, setAgentModeLikely]);

  useEffect(() => {
    const term = terminalInstance.current;
    if (!term) return;
    if (!isActive) {
      try {
        term.blur();
      } catch {
        // Ignore blur failures from transient mounts.
      }
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const terminal = terminalInstance.current;
      if (!terminal || isDisposedRef.current) return;
      scheduleTerminalFit();
      terminal.focus();
      // Restore local cursor visibility only for shell prompts.
      ensureCursorVisible();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive, ensureCursorVisible, scheduleTerminalFit]);

  useEffect(() => {
    const next = `http://127.0.0.1:34567/api/task/${taskId}`;
    controlTaskUrlRef.current = next;
  }, [taskId]);

  useEffect(() => {
    const applyTheme = () => {
      const term = terminalInstance.current;
      if (!term) return;
      const resolvedTheme = resolveTerminalTheme();
      term.options.minimumContrastRatio = resolvedTheme.minimumContrastRatio;
      term.options.theme = resolvedTheme.theme;
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
    setSandboxSnapshot(null);
    beginSessionLoadProgress();

    let term: XTerm | null = null;
    let fitAddon: FitAddon | null = null;
    let initializeObserver: ResizeObserver | null = null;
    let layoutObserver: ResizeObserver | null = null;
    let removePtyListener: (() => void) | null = null;
    let removePtyStateListener: (() => void) | null = null;
    let removePtyExitListener: (() => void) | null = null;
    let removePtyModeListener: (() => void) | null = null;
    let didBootstrap = false;
    let disposed = false;
    let focusRafId: number | null = null;
    isDisposedRef.current = false;

    const initTerminal = () => {
      if (disposed || isDisposedRef.current) return false;
      if (isInitialized.current || !terminalRef.current) return false;
      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      try {
        const resolvedTheme = resolveTerminalTheme();
        term = new XTerm({
          theme: resolvedTheme.theme,
          minimumContrastRatio: resolvedTheme.minimumContrastRatio,
          cursorBlink: true,
          cursorStyle: 'block',
          cursorInactiveStyle: 'block',
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
          lineHeight: 1.2
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
          const wantsCommandPalette = primary && key === 'k';

          if (wantsCopy && term?.hasSelection()) {
            const selected = term.getSelection();
            if (selected) {
              void window.electronAPI.writeClipboardText(selected)
                .then((result) => {
                  if (!result?.success) {
                    throw new Error(result?.error || 'Clipboard write failed.');
                  }
                })
                .catch(() => {});
            }
            return false;
          }

          if (wantsPaste) {
            void window.electronAPI.readClipboardText()
              .then((text) => {
                if (!text || disposed) return;
                term?.paste(text);
              })
              .catch(() => {});
            return false;
          }

          if (wantsCommandPalette) {
            event.preventDefault();
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent('orchestrator:open-command-palette'));
            return false;
          }

          return true;
        });

        let customEnv = buildPtyEnv(controlTaskUrlRef.current);
        ptyEnvRef.current = customEnv;

        term.onData(data => {
          const filtered = stripTerminalControlResponses(
            data,
            shellInputCarryRef.current,
            recentControlResponseRef.current
          );
          shellInputCarryRef.current = filtered.carry;
          recentControlResponseRef.current = !!filtered.strippedControlResponse;
          const outbound = filtered.sanitized;

          if (!outbound) return;
          window.electronAPI.writePty(taskId, outbound);
        });

        removePtyListener = window.electronAPI.onPtyData(taskId, (data) => {
          clearSessionLoadProgress();
          term?.write(data);
        });
        removePtyStateListener = window.electronAPI.onPtyState(taskId, ({ created, running, restarted, sandbox }) => {
          if (disposed || isDisposedRef.current) return;
          if (sandbox && typeof sandbox === 'object') {
            setSandboxSnapshot({
              mode: typeof sandbox.mode === 'string' ? sandbox.mode : 'off',
              active: !!sandbox.active,
              warning: typeof sandbox.warning === 'string' ? sandbox.warning : undefined,
              denyNetwork: !!sandbox.denyNetwork
            });
          } else if (created) {
            setSandboxSnapshot(null);
          }
          ptyRunningRef.current = !!running;
          ptyStartInFlightRef.current = false;
          if (running) {
            const queued = pendingPtyContinuationsRef.current.splice(0);
            queued.forEach(({ continuation, timeoutId }) => {
              window.clearTimeout(timeoutId);
              continuation();
            });
          }
          if (didBootstrap) return;
          didBootstrap = true;
          const currentShouldBootstrap = !!shouldBootstrapRef.current;
          const restoredSessionAtShellLikeMode = !currentShouldBootstrap
            && !created
            && !restarted
            && isResumeEligibleMode(terminalModeRef.current);
          const shouldRelaunchRestoredTab = !currentShouldBootstrap && (!!created || !!restarted || restoredSessionAtShellLikeMode);
          if (!currentShouldBootstrap && !shouldRelaunchRestoredTab) {
            clearRelaunchProgress();
            clearSessionLoadProgress();
            return;
          }
          if (shouldRelaunchRestoredTab) {
            const reason = created
              ? 'previous PTY session was missing'
              : (restarted
                ? 'previous PTY session was not live'
                : (terminalModeRef.current === 'booting'
                  ? 'restored terminal mode was unresolved'
                  : 'restored terminal was at a shell prompt'));
            setRelaunchProgressPhase('restoring', reason);
          }
          window.setTimeout(() => {
            if (disposed || isDisposedRef.current) return;
            const taskControlUrl = controlTaskUrlRef.current;
            const launchPlan = currentShouldBootstrap && launchCommandOverride?.trim()
              ? { command: launchCommandOverride.trim() }
              : buildAgentLaunchPlan(agentCommand, prompt);
            const apiDoc = `IDE Capabilities API\n--------------------\nYou are running inside Forkline.\nYou can interact with the IDE by sending HTTP requests to the local control server.\n\nBase URL: ${taskControlUrl}\nAuthentication:\n- Header: x-forkline-token: $MULTI_AGENT_IDE_TOKEN\n- Alternate: Authorization: Bearer $MULTI_AGENT_IDE_TOKEN\nCurrent Permissions:\n- Merge Request: ${capabilities?.autoMerge ? 'Auto-Approve' : 'Requires Human Approval'}\n\nWorkspace Metadata Paths:\n- Living Spec (if available): ${resolvedLivingSpecPath}\n- Memory Context: .agent_cache/agent_memory.md\n\nEndpoints:\n1. POST ${taskControlUrl}/merge (returns 202 + requestId)\n2. GET ${taskControlUrl.replace('/api/task/' + taskId, '')}/api/approval/:requestId (poll merge status)\n3. POST ${taskControlUrl}/todos\n4. POST ${taskControlUrl}/message\n5. POST ${taskControlUrl}/usage (or /metrics)\n\nMerge wait mode:\n- Use ${taskControlUrl}/merge?wait=1 to wait for a decision inline (times out after 10 minutes).\n\ncurl example:\ncurl -s -H \"x-forkline-token: $MULTI_AGENT_IDE_TOKEN\" -H \"content-type: application/json\" -X POST ${taskControlUrl}/todos -d '{\"todos\":[{\"id\":\"1\",\"title\":\"Implement fix\",\"status\":\"in_progress\"}]}'\n`;
            setRelaunchProgressPhase('preparing_workspace');
            void window.electronAPI
              .prepareAgentWorkspace(
                cwd,
                projectPath,
                context || '',
                apiDoc,
                livingSpecPreference,
                livingSpecOverridePath,
                launchPlan.command
              )
              .then((prepRes) => {
                if (disposed || isDisposedRef.current) return;
                const prepareSucceeded = prepRes?.success !== false;
                if (!prepareSucceeded) {
                  const message = prepRes?.error ? `Workspace metadata warning: ${prepRes.error}` : 'Workspace metadata preparation failed.';
                  term?.writeln(`\r\n[orchestrator] ${message}`);
                }
                const launchScriptPath = typeof prepRes?.launchScriptPath === 'string'
                  ? prepRes.launchScriptPath.trim().replace(/\\/g, '/')
                  : '';
                const resolvedLaunchCommand = launchScriptPath.startsWith('.agent_cache/')
                  ? `./${launchScriptPath}`
                  : launchPlan.command;
                setRelaunchProgressPhase('launching_agent');
                dispatchRelaunchCommand(resolvedLaunchCommand);
                setAgentModeLikely(true);
                lastAgentLaunchAtRef.current = Date.now();
                onBootstrappedRef.current?.(taskId);
              })
              .catch((err) => {
                if (disposed || isDisposedRef.current) return;
                console.error('Failed to prepare workspace metadata:', err);
                term?.writeln('\r\n[orchestrator] Workspace metadata setup failed. Continuing.');
                setRelaunchProgressPhase('launching_agent', 'workspace metadata setup failed; launching with fallback');
                dispatchRelaunchCommand(launchPlan.command);
                setAgentModeLikely(true);
                lastAgentLaunchAtRef.current = Date.now();
                onBootstrappedRef.current?.(taskId);
              });
          }, 200);
        });
        removePtyModeListener = window.electronAPI.onPtyMode(taskId, (snapshot) => {
          if (disposed || isDisposedRef.current) return;
          applyModeSnapshot({
            mode: snapshot.mode || 'booting',
            modeSeq: Number.isFinite(snapshot.modeSeq) ? snapshot.modeSeq : 0,
            isBlocked: !!snapshot.isBlocked,
            blockedReason: snapshot.blockedReason
          });
        });
        removePtyExitListener = window.electronAPI.onPtyExit(taskId, ({ exitCode, signal }) => {
          clearSessionLoadProgress();
          clearRelaunchProgress();
          ptyRunningRef.current = false;
          ptyStartInFlightRef.current = false;
          didBootstrap = false;
          clearPendingShellPlan();
          modeSeqRef.current += 1;
          modeSnapshotRef.current = {
            mode: 'exited',
            modeSeq: modeSeqRef.current,
            isBlocked: false
          };
          setHasLiveMode(true);
          setLiveBlockedState({ isBlocked: false, blockedReason: undefined });
          terminalModeRef.current = 'exited';
          setTerminalMode('exited');
          setAgentModeLikely(false);
          term?.writeln(`\r\n[orchestrator] PTY exited (code=${exitCode ?? 'null'} signal=${signal ?? 'none'}).`);
        });

        void Promise.all([
          window.electronAPI.getControlBaseUrl().catch(() => ''),
          window.electronAPI.getControlAuthToken().catch(() => '')
        ])
          .then(([baseUrl, authToken]) => {
            if (disposed || isDisposedRef.current) return;
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
            if (disposed || isDisposedRef.current) return;
            customEnv = buildPtyEnv(fallbackTaskControlUrl, '');
            ptyEnvRef.current = customEnv;
          })
          .finally(() => {
            if (disposed || isDisposedRef.current) return;
            ptyEnvRef.current = customEnv;
            ptyStartInFlightRef.current = true;
            modeSeqRef.current = -1;
            terminalModeRef.current = 'booting';
            modeSnapshotRef.current = { mode: 'booting', modeSeq: 0, isBlocked: false };
            setHasLiveMode(false);
            setLiveBlockedState({ isBlocked: false, blockedReason: undefined });
            setTerminalMode('booting');
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
      scheduleTerminalFit();
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
      isDisposedRef.current = true;
      window.removeEventListener('resize', handleResize);
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      lastFittedSizeRef.current = { cols: 0, rows: 0 };
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
      if (removePtyModeListener) {
        removePtyModeListener();
      }
      if (removePtyStateListener) {
        removePtyStateListener();
      }
      const queued = pendingPtyContinuationsRef.current.splice(0);
      queued.forEach(({ timeoutId }) => window.clearTimeout(timeoutId));
      clearPendingShellPlan();
      ptyRunningRef.current = false;
      ptyStartInFlightRef.current = false;
      shellInputCarryRef.current = '';
      recentControlResponseRef.current = false;
      modeSeqRef.current = -1;
      terminalModeRef.current = 'booting';
      modeSnapshotRef.current = { mode: 'booting', modeSeq: 0, isBlocked: false };
      setHasLiveMode(false);
      setLiveBlockedState({ isBlocked: false, blockedReason: undefined });
      setTerminalMode('booting');
      setSandboxSnapshot(null);
      clearSessionLoadProgress();
      setAgentModeLikely(false);
      clearRelaunchProgress();
      window.electronAPI.detachPty(taskId);
      if (term) term.dispose();
      isInitialized.current = false;
    };
  }, [
    taskId,
    cwd,
    setAgentModeLikely,
    applyModeSnapshot,
    clearPendingShellPlan,
    clearRelaunchProgress,
    setRelaunchProgressPhase,
    scheduleTerminalFit,
    beginSessionLoadProgress,
    clearSessionLoadProgress,
    dispatchRelaunchCommand
  ]);

  const focusTerminal = () => {
    requestAnimationFrame(() => {
      terminalInstance.current?.focus();
      const mode = terminalModeRef.current;
      if (mode === 'shell' || mode === 'exited') {
        ensureCursorVisible();
      }
    });
  };

  const sendRaw = useCallback((data: string) => {
    if (!data) return;
    window.electronAPI.writePty(taskId, data);
    focusTerminal();
  }, [taskId]);

  const sendLine = useCallback((line: string, clearLine = false) => {
    const prefix = clearLine && line ? '\u0015' : '';
    window.electronAPI.writePty(taskId, `${prefix}${line}\r`);
    focusTerminal();
  }, [taskId]);

  const showQuickActionNotice = useCallback((message: string, ttlMs = 4200) => {
    const normalized = String(message || '').trim();
    if (!normalized) return;
    setQuickActionNotice(normalized);
    if (quickActionNoticeTimeoutRef.current !== null) {
      window.clearTimeout(quickActionNoticeTimeoutRef.current);
      quickActionNoticeTimeoutRef.current = null;
    }
    if (ttlMs <= 0) return;
    quickActionNoticeTimeoutRef.current = window.setTimeout(() => {
      setQuickActionNotice((current) => (current === normalized ? null : current));
      quickActionNoticeTimeoutRef.current = null;
    }, ttlMs);
  }, []);

  const writeOrchestratorHint = useCallback((message: string) => {
    showQuickActionNotice(message);
    const mode = terminalModeRef.current;
    const shouldWriteInTerminal = isShellLikeMode(mode);
    if (shouldWriteInTerminal) {
      terminalInstance.current?.writeln(`\r\n[orchestrator] ${message}`);
    }
  }, [showQuickActionNotice]);
  const sendHiddenLine = useCallback(async (line: string) => {
    const normalized = String(line || '').replace(/[\r\n]+/g, ' ').trim();
    if (!normalized) return false;

    const relaunchEnv = ptyEnvRef.current || buildPtyEnv(controlTaskUrlRef.current || fallbackTaskControlUrl);
    ptyEnvRef.current = relaunchEnv;
    const maxAttempts = 8;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await window.electronAPI.launchPty(taskId, normalized, { suppressEcho: true });
        if (result?.success) {
          focusTerminal();
          return true;
        }
        const message = String(result?.error || 'PTY command dispatch failed.');
        if (attempt < maxAttempts && /not running|session not found/i.test(message)) {
          window.electronAPI.createPty(taskId, cwd, relaunchEnv);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(900, 120 * (attempt + 1))));
          continue;
        }
        writeOrchestratorHint(`Quick action failed: ${message}`);
        return false;
      } catch (error: any) {
        const message = String(error?.message || 'PTY command dispatch failed.');
        if (attempt < maxAttempts && /not running|session not found/i.test(message)) {
          window.electronAPI.createPty(taskId, cwd, relaunchEnv);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(900, 120 * (attempt + 1))));
          continue;
        }
        writeOrchestratorHint(`Quick action failed: ${message}`);
        return false;
      }
    }

    writeOrchestratorHint('Quick action failed: PTY command dispatch timed out.');
    return false;
  }, [taskId, cwd, buildPtyEnv, fallbackTaskControlUrl, writeOrchestratorHint]);

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

  const ensurePtyRunning = useCallback((continuation: () => void) => {
    if (isDisposedRef.current) return;
    if (ptyRunningRef.current) {
      continuation();
      return;
    }
    if (pendingPtyContinuationsRef.current.length === 0) {
      writeOrchestratorHint('Restoring terminal process for this task.');
    }
    const timeoutId = window.setTimeout(() => {
      const index = pendingPtyContinuationsRef.current.findIndex((entry) => entry.timeoutId === timeoutId);
      if (index === -1 || isDisposedRef.current) return;
      const [entry] = pendingPtyContinuationsRef.current.splice(index, 1);
      if (!ptyRunningRef.current && pendingPtyContinuationsRef.current.length === 0) {
        ptyStartInFlightRef.current = false;
      }
      if (!ptyRunningRef.current) {
        writeOrchestratorHint('PTY startup is still in progress. Retry the action in a moment.');
        const relaunchEnv = ptyEnvRef.current || buildPtyEnv(controlTaskUrlRef.current || fallbackTaskControlUrl);
        ptyEnvRef.current = relaunchEnv;
        if (!ptyStartInFlightRef.current) {
          ptyStartInFlightRef.current = true;
          window.electronAPI.createPty(taskId, cwd, relaunchEnv);
        }
        return;
      }
      entry.continuation();
    }, 4500);
    pendingPtyContinuationsRef.current.push({ continuation, timeoutId });
    const relaunchEnv = ptyEnvRef.current || buildPtyEnv(controlTaskUrlRef.current || fallbackTaskControlUrl);
    ptyEnvRef.current = relaunchEnv;
    if (!ptyStartInFlightRef.current) {
      ptyStartInFlightRef.current = true;
      window.electronAPI.createPty(taskId, cwd, relaunchEnv);
    }
  }, [cwd, taskId, buildPtyEnv, fallbackTaskControlUrl]);

  const runQuickActionPlan = useCallback(async (steps: QuickActionStep[]) => {
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
        if (step.clearLine) {
          sendRaw('\u0015');
        }
        const sent = await sendHiddenLine(normalized);
        if (!sent) break;
        continue;
      }
      if (step.kind === 'launch_agent') {
        sendRaw('\u0015');
        const launched = await sendHiddenLine(agentCommand);
        if (!launched) break;
        lastAgentLaunchAtRef.current = Date.now();
        if (step.postInstruction?.trim()) {
          // Allow shell prompt/agent boot to settle before sending follow-up instruction.
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => window.setTimeout(resolve, 800));
          // eslint-disable-next-line no-await-in-loop
          await sendHiddenLine(step.postInstruction!.trim());
        }
      }
    }
  }, [agentCommand, sendRaw, sendHiddenLine, writeOrchestratorHint]);

  const queueShellPlan = useCallback((steps: QuickActionStep[]) => {
    if (isDisposedRef.current) return;
    if (isShellLikeMode(terminalModeRef.current)) {
      void runQuickActionPlan(steps);
      return;
    }

    clearPendingShellPlan();
    const timeoutId = window.setTimeout(() => {
      if (pendingShellPlanRef.current?.timeoutId !== timeoutId) return;
      pendingShellPlanRef.current = null;
      writeOrchestratorHint('Could not reach a shell prompt yet. Retry once the terminal settles.');
    }, 3200);
    pendingShellPlanRef.current = { steps, timeoutId };

    writeOrchestratorHint('Interrupting active session and waiting for shell prompt.');
    sendRaw('\u0003');
  }, [clearPendingShellPlan, runQuickActionPlan, sendRaw, writeOrchestratorHint]);

  useEffect(() => {
    if (!isShellLikeMode(terminalMode)) return;
    const pending = clearPendingShellPlan();
    if (!pending) return;
    void runQuickActionPlan(pending.steps);
  }, [terminalMode, clearPendingShellPlan, runQuickActionPlan]);

  const dispatchQuickAction = useCallback((action: QuickActionId) => {
    const now = Date.now();
    if (now - lastQuickActionAtRef.current < 180) return;
    lastQuickActionAtRef.current = now;
    const mode = terminalModeRef.current;
    const blocked = hasLiveMode ? liveBlockedState.isBlocked : (!!isBlocked || !!modeSnapshotRef.current.isBlocked);

    if (action === 'pause') {
      if (isShellLikeMode(mode) && !blocked) {
        setAgentModeLikely(false);
        writeOrchestratorHint('Terminal is already at a shell prompt. Use resume to relaunch the agent.');
        return;
      }
      if (now - lastPauseAtRef.current < 900) {
        writeOrchestratorHint('Pause already sent. Use resume if you want to relaunch the agent.');
        return;
      }
      lastPauseAtRef.current = now;
      recordQuickAction(action, {
        target: 'shell',
        profile: capabilitiesProfile.profile
      });
      ensurePtyRunning(() => {
        clearPendingShellPlan();
        sendRaw('\u0003');
        setAgentModeLikely(false);
      });
      return;
    }

    if (action === 'resume') {
      if (blocked) {
        writeOrchestratorHint('Agent is waiting on a confirmation prompt. Use approve/reject first.');
        return;
      }
      if (!isResumeEligibleMode(mode)) {
        writeOrchestratorHint('Agent already appears active.');
        setAgentModeLikely(true);
        return;
      }
      recordQuickAction(action, {
        target: 'shell',
        profile: capabilitiesProfile.profile
      });
      ensurePtyRunning(() => {
        const launchPlan = buildAgentLaunchPlan(agentCommand, undefined);
        sendRaw('\u0015');
        void sendHiddenLine(launchPlan.command).then((sent) => {
          if (!sent) {
            setAgentModeLikely(false);
            return;
          }
          lastAgentLaunchAtRef.current = Date.now();
          setAgentModeLikely(true);
        });
      });
      return;
    }

    if (action === 'create_pr') {
      if (blocked) {
        writeOrchestratorHint('Agent is waiting on a confirmation prompt. Use approve/reject first.');
        return;
      }
      const normalizedParent = String(parentBranch || '').trim();
      const prTargetBranch = SAFE_BRANCH_PATTERN.test(normalizedParent) && !normalizedParent.includes('..')
        ? normalizedParent
        : 'main';
      if (isShellLikeMode(mode)) {
        setAgentModeLikely(false);
      }
      const canUseAgentPath = capabilitiesProfile.profile !== 'shell'
        && isAgentLikeMode(mode);
      if (canUseAgentPath) {
        const instruction = `Create a pull request from the current branch into ${prTargetBranch}. Use this repository's configured provider tooling, open the PR in browser, and then paste the PR link.`;
        const line = capabilitiesProfile.profile === 'aider' ? `/ask ${instruction}` : instruction;
        recordQuickAction(action, {
          target: 'agent',
          profile: capabilitiesProfile.profile,
          prTarget: prTargetBranch
        });
        ensurePtyRunning(() => {
          void sendHiddenLine(line);
        });
        return;
      }
    }

    const plan = resolveQuickActionPlan({
      action,
      agentCommand,
      isBlocked: blocked,
      parentBranch
    });
    recordQuickAction(action, {
      target: plan.target,
      profile: plan.capabilities.profile,
      prTarget: action === 'create_pr' ? (parentBranch || 'main') : undefined
    });

    const needsPty = plan.steps.some(step => step.kind !== 'hint');
    if (!needsPty) {
      void runQuickActionPlan(plan.steps);
      return;
    }

    ensurePtyRunning(() => {
      if (plan.target === 'shell') {
        queueShellPlan(plan.steps);
        return;
      }
      void runQuickActionPlan(plan.steps);
    });
  }, [
    agentCommand,
    capabilitiesProfile.profile,
    ensurePtyRunning,
    hasLiveMode,
    isBlocked,
    liveBlockedState.isBlocked,
    parentBranch,
    runQuickActionPlan,
    sendHiddenLine,
    setAgentModeLikely,
    clearPendingShellPlan,
    queueShellPlan
  ]);

  const handleQuickCreatePr = () => {
    dispatchQuickAction('create_pr');
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
        try {
          const res = await window.electronAPI.saveImage(cwd, base64, filename);
          if (res.success && res.path) {
            injectAgentCommand(res.path);
          } else {
            writeOrchestratorHint(res.error || 'Image paste failed: unable to save image to workspace cache.');
          }
        } catch (error: any) {
          writeOrchestratorHint(`Image paste failed: ${error?.message || 'unknown error'}`);
        }
      };
      reader.onerror = () => {
        writeOrchestratorHint('Image paste failed: could not read clipboard image data.');
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

  return (
    <div className="w-full h-full flex flex-col relative bg-[var(--xterm-bg)] rounded-xl overflow-hidden" onPaste={handlePaste}>
      <div
        className="flex-1 relative overflow-hidden bg-[var(--xterm-bg)] p-2"
        onMouseDown={() => {
          terminalInstance.current?.focus();
        }}
      >
        {startupProgressMeta && (
          <div className="terminal-startup-overlay" role="status" aria-live="polite">
            <div className="terminal-startup-overlay-card">
              <div className="terminal-startup-progress-head">
                <span>{startupProgressMeta.label}</span>
                <span>{startupProgressMeta.percent}%</span>
              </div>
              <div className="terminal-startup-progress-track">
                <div
                  className={`terminal-startup-progress-fill ${startupProgressMeta.label === 'Loading session' ? 'animate-pulse' : ''}`}
                  style={{ width: `${startupProgressMeta.percent}%` }}
                />
              </div>
              {startupProgressMeta.detail && (
                <div className="terminal-startup-progress-detail">{startupProgressMeta.detail}</div>
              )}
            </div>
          </div>
        )}
        <div className="w-full h-full rounded-lg overflow-hidden border border-[var(--panel-border)] bg-[var(--xterm-bg)] p-2">
          <div ref={terminalRef} className="w-full h-full rounded-md overflow-hidden" />
        </div>
      </div>

      <div className="terminal-action-bar flex flex-col shrink-0 relative z-30">
        {sandboxBanner && (
          <div
            className={`terminal-guardrail-banner ${sandboxBanner.tone === 'warning' ? 'terminal-guardrail-banner--warning' : 'terminal-guardrail-banner--info'}`}
            role="status"
            aria-live="polite"
          >
            <AlertTriangle size={12} className="flex-shrink-0" />
            <span>{sandboxBanner.message}</span>
          </div>
        )}
        {startupProgressMeta && (
          <div className="terminal-startup-progress" role="status" aria-live="polite">
            <div className="terminal-startup-progress-head">
              <span>{startupProgressMeta.label}</span>
              <span>{startupProgressMeta.percent}%</span>
            </div>
            <div className="terminal-startup-progress-track">
              <div
                className={`terminal-startup-progress-fill ${startupProgressMeta.label === 'Loading session' ? 'animate-pulse' : ''}`}
                style={{ width: `${startupProgressMeta.percent}%` }}
              />
            </div>
            {startupProgressMeta.detail && (
              <div className="terminal-startup-progress-detail">{startupProgressMeta.detail}</div>
            )}
          </div>
        )}
        {quickActionNotice && (
          <div className="terminal-action-notice">
            {quickActionNotice}
          </div>
        )}
        {effectiveBlocked && (
          <div className="terminal-blocked-banner mb-2">
            <div className="min-w-0 flex items-center">
              <AlertTriangle size={13} className="text-red-500 mr-2 flex-shrink-0" />
              <span className="text-[11px] text-red-300 font-mono truncate">
                Action Required: {effectiveBlockedReason || 'agent is waiting for confirmation.'}
              </span>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
              <button type="button" onMouseDown={keepTerminalFocus} onClick={() => sendLine('y', false)} className="btn-primary px-3 py-1.5 rounded text-[11px] font-mono">
                approve (y)
              </button>
              <button type="button" onMouseDown={keepTerminalFocus} onClick={() => sendLine('n', false)} className="btn-ghost px-3 py-1.5 rounded text-[11px] font-mono">
                reject (n)
              </button>
            </div>
          </div>
        )}

        <div className="terminal-action-meta">
          <div className="terminal-action-chips">
            {usageSummaryLabel && (
              <span className="terminal-action-chip">
                {usageSummaryLabel}
              </span>
            )}
            {usageCostLabel && (
              <span className="terminal-action-chip">
                {usageCostLabel}
              </span>
            )}
          </div>
          <div className="terminal-action-updated">
            {hasUsageBadge && usageUpdatedLabel ? `updated ${usageUpdatedLabel}` : ''}
          </div>
        </div>

        <div className="terminal-quick-toolbar">
          <div className="terminal-quick-group">
            <button
              type="button"
              onMouseDown={keepTerminalFocus}
              onClick={handleQuickCreatePr}
              title={`Create PR/MR into ${parentBranch || 'main'} and open it in browser`}
              className="terminal-quick-btn terminal-quick-btn--primary"
            >
              <GitPullRequest size={12} className="mr-2 shrink-0" /> create PR
            </button>
          </div>
          <div className="terminal-quick-group terminal-quick-group--right">
            <button
              type="button"
              onMouseDown={keepTerminalFocus}
              onClick={() => onMerge?.(taskId)}
              title="Review and merge this worktree"
              className="terminal-quick-btn terminal-quick-btn--merge"
            >
              <GitMerge size={12} className="mr-2 shrink-0" /> merge
            </button>
            <button
              type="button"
              onMouseDown={keepTerminalFocus}
              onClick={() => onDelete?.(taskId)}
              title="Delete this branch and worktree"
              className="terminal-quick-btn terminal-quick-btn--delete"
            >
              <Trash2 size={12} className="mr-2 shrink-0" /> delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Terminal, areTerminalPropsEqual);
