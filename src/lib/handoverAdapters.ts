import type { HandoverMode } from '../models/orchestrator';
import { wrapCommandWithLifecycleMarkers } from './agentProfiles';
import { shellQuote } from './shell';

export type HandoverProvider = 'claude' | 'gemini' | 'amp' | 'aider' | 'codex' | 'shell';

export interface HandoverDispatchPlan {
  provider: HandoverProvider;
  mode: HandoverMode;
  inlineTransfer: boolean;
  interruptBeforeLaunch: boolean;
  launchDelayMs: number;
  transferDelayMs: number;
  launchCommand: string;
  transferLine: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

export const resolveHandoverProvider = (command: string): HandoverProvider => {
  const normalized = normalize(command);
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('amp')) return 'amp';
  if (normalized.includes('aider')) return 'aider';
  if (normalized.includes('codex')) return 'codex';
  return 'shell';
};

export const defaultHandoverModeForCommand = (command: string): HandoverMode => {
  const provider = resolveHandoverProvider(command);
  if (provider === 'aider') return 'in_place';
  if (provider === 'shell') return 'in_place';
  return 'clean';
};

export const buildHandoverDispatchPlan = (
  targetCommand: string,
  transferBrief: string,
  mode: HandoverMode
): HandoverDispatchPlan => {
  const provider = resolveHandoverProvider(targetCommand);
  const trimmedCommand = targetCommand.trim();
  const supportsInlineTransfer = provider === 'claude'
    || provider === 'gemini'
    || provider === 'amp'
    || provider === 'codex';
  const launchBaseCommand = supportsInlineTransfer
    ? `${trimmedCommand} ${shellQuote(transferBrief)}`
    : trimmedCommand;
  const launchCommand = wrapCommandWithLifecycleMarkers(
    launchBaseCommand,
    provider === 'shell' ? '' : provider
  );
  const transferLine = provider === 'aider'
    ? `/ask ${transferBrief}`
    : transferBrief;

  if (provider === 'gemini' || provider === 'amp') {
    return {
      provider,
      mode,
      inlineTransfer: supportsInlineTransfer,
      interruptBeforeLaunch: mode === 'in_place',
      launchDelayMs: mode === 'clean' ? 350 : 300,
      transferDelayMs: mode === 'clean' ? 2200 : 1800,
      launchCommand,
      transferLine
    };
  }

  if (provider === 'claude' || provider === 'codex') {
    return {
      provider,
      mode,
      inlineTransfer: supportsInlineTransfer,
      interruptBeforeLaunch: mode === 'in_place',
      launchDelayMs: mode === 'clean' ? 320 : 260,
      transferDelayMs: mode === 'clean' ? 1500 : 1200,
      launchCommand,
      transferLine
    };
  }

  if (provider === 'aider') {
    return {
      provider,
      mode,
      inlineTransfer: supportsInlineTransfer,
      interruptBeforeLaunch: mode === 'in_place',
      launchDelayMs: mode === 'clean' ? 260 : 220,
      transferDelayMs: mode === 'clean' ? 900 : 800,
      launchCommand,
      transferLine
    };
  }

  return {
    provider,
    mode,
    inlineTransfer: supportsInlineTransfer,
    interruptBeforeLaunch: mode === 'in_place',
    launchDelayMs: mode === 'clean' ? 300 : 250,
    transferDelayMs: mode === 'clean' ? 1200 : 900,
    launchCommand,
    transferLine
  };
};
