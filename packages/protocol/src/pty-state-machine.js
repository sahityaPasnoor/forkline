const PTY_MODES = Object.freeze({
  BOOTING: 'booting',
  SHELL: 'shell',
  AGENT: 'agent',
  TUI: 'tui',
  BLOCKED: 'blocked',
  EXITED: 'exited'
});

const PTY_MODE_CONFIDENCE = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
});

const SUPPORTED_PROVIDERS = new Set(['claude', 'gemini', 'amp', 'aider', 'codex']);
const MARKER_REGEX = /\x1b\]1337;ForklineEvent=([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_REGEX = /\x1b\][^\u0007]*(?:\u0007|\x1b\\)/g;
const BLOCK_REGEX = /((?:\(|\[)\s*[yY](?:es)?\s*\/\s*[nN](?:o)?\s*(?:\)|\])\s*$)|(\b(?:yes\/no|y\/n)\b\s*$)|(\b(?:press|hit)\s+(?:enter|return)\b(?:\s+to\s+(?:continue|confirm))?\s*$)|(\bselect\s+(?:an?\s+)?option\b\s*[:?]?\s*$)|(\benter\s+(?:choice|selection)\b\s*[:?]?\s*$)|(\btype\s+(?:yes|no|y|n)\b\s*[:?]?\s*$)|(\b(?:approve|reject)\s*\(\s*[yYnN]\s*\)\s*$)/i;
const PROVIDER_PROMPT_REGEX = /(?:action\s+required[:\s]|would\s+you\s+like\s+to\s+proceed\?|do\s+you\s+want\s+to\s+proceed\?|are\s+you\s+sure\?|approve|reject)(?:.{0,120}(?:y\/n|yes\/no|\(\s*[yn]\s*\/\s*[yn]\s*\)))?/i;

const normalizeProvider = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUPPORTED_PROVIDERS.has(normalized)) return normalized;
  return '';
};

const detectProviderFromCommand = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('amp')) return 'amp';
  if (normalized.includes('aider')) return 'aider';
  if (normalized.includes('codex')) return 'codex';
  return '';
};

const stripAnsi = (value) => String(value || '').replace(ANSI_REGEX, '');

const normalizeReasonText = (value) => {
  if (!value) return '';
  let text = String(value)
    .replace(OSC_REGEX, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  text = text
    .replace(/([.?!])([A-Za-z])/g, '$1 $2')
    .replace(/\b(Claude|Codex|Gemini|Aider|Amp)(has|is|would|wants|can)\b/g, '$1 $2')
    .replace(/\bhaswrittenupaplanandisreadytoexecute\b/ig, 'has written up a plan and is ready to execute')
    .replace(/\bwrittenupaplanandisreadytoexecute\b/ig, 'written up a plan and is ready to execute')
    .replace(/\bwouldyouliketoproceed\??\b/ig, 'Would you like to proceed?')
    .replace(/\?{2,}/g, '?');

  const compact = text.toLowerCase().replace(/[^a-z0-9?]/g, '');
  if (compact.includes('claudehaswrittenupaplanandisreadytoexecutewouldyouliketoproceed')) {
    return 'Action Required: Claude has written up a plan and is ready to execute. Would you like to proceed?';
  }
  return text;
};

const extractBlockReason = (value) => {
  const cleaned = stripAnsi(String(value || ''));
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => normalizeReasonText(line))
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (BLOCK_REGEX.test(lines[i])) return lines[i].slice(0, 240);
    if (PROVIDER_PROMPT_REGEX.test(lines[i])) return lines[i].slice(0, 240);
  }

  const singleLine = normalizeReasonText(cleaned);
  if (singleLine && (BLOCK_REGEX.test(singleLine) || PROVIDER_PROMPT_REGEX.test(singleLine))) {
    return singleLine.slice(0, 240);
  }
  return undefined;
};

const hasShellSignal = (value) => {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  return lines.some((line) => (
    /^\s*(?:quote|dquote|bquote|cmdsubst|heredoc|for|while|if|then|else|do)>\s*$/.test(line)
    || /^\s*PS [^\n\r>]{0,220}>\s*$/.test(line)
    || /^\s*[^\n\r]{0,220}[#$%]\s*$/.test(line)
    || /^\s*(?:~|\/)[^\s]{1,260}(?:\s+[A-Za-z0-9._/-]{1,120}){1,3}\s*$/.test(line)
    || /\b(?:zsh|bash|fish|pwsh|powershell|sh):\s+(?:command not found|not recognized|no such file|permission denied)\b/i.test(line)
  ));
};

const hasAgentSignal = (value, providerHint) => {
  const text = String(value || '');
  if (!text) return false;
  if (/(?:^|\n)\s*╭───\s*Claude Code v/i.test(text)) return true;
  if (/\bWelcome back\b/i.test(text) || /\bRecent activity\b/i.test(text)) return true;
  if (/\bType your message or @path\/to\/file\b/i.test(text)) return true;
  if (/\bAuthenticated with .*\/auth\b/i.test(text)) return true;
  if (providerHint === 'claude' && /\bClaude Code\b/i.test(text)) return true;
  if (providerHint === 'gemini' && /\bGemini\b/i.test(text)) return true;
  if (providerHint === 'aider' && /\baider\b/i.test(text)) return true;
  if (providerHint === 'codex' && /\bcodex\b/i.test(text)) return true;
  if (providerHint === 'amp' && /\bamp\b/i.test(text)) return true;
  return false;
};

const looksLikeTuiChunk = (value) => {
  const cleaned = stripAnsi(String(value || '')).replace(/\r/g, '\n');
  if (!cleaned.trim()) return false;
  return (
    /Type your message or @path\/to\/file/i.test(cleaned)
    || /for shortcuts/i.test(cleaned)
    || /\bno sandbox\b/i.test(cleaned)
    || /Welcome back/i.test(cleaned)
    || /Authenticated with .*\/auth/i.test(cleaned)
    || /GEMINI\.md file/i.test(cleaned)
    || /^\s*[█░▐▛▜▌▘▝]{8,}/m.test(cleaned)
  );
};

const parseMarkerPayload = (raw) => {
  const payload = {};
  const parts = String(raw || '').split(';');
  for (const part of parts) {
    const [k, ...rest] = part.split('=');
    const key = String(k || '').trim().toLowerCase();
    if (!key) continue;
    const value = rest.join('=').trim();
    payload[key] = value;
  }
  return payload;
};

const parseForklineMarkers = (data) => {
  const markers = [];
  const input = String(data || '');
  let match = MARKER_REGEX.exec(input);
  while (match) {
    markers.push(parseMarkerPayload(match[1]));
    match = MARKER_REGEX.exec(input);
  }
  MARKER_REGEX.lastIndex = 0;
  return markers;
};

const buildAgentWrapperCommand = (command, provider) => {
  const safeProvider = normalizeProvider(provider);
  if (!safeProvider) return command;
  const rawCommand = String(command || '').trim();
  if (!rawCommand) return rawCommand;

  return `{ __forkline_emit(){ printf '\\033]1337;ForklineEvent=%s\\007' \"$1\"; }; __forkline_emit 'type=agent_started;provider=${safeProvider}'; ${rawCommand}; __forkline_ec=$?; __forkline_emit \"type=agent_exited;provider=${safeProvider};code=\${__forkline_ec}\"; }`;
};

class PtySessionStateMachine {
  constructor(options = {}) {
    const providerHint = normalizeProvider(options.providerHint || detectProviderFromCommand(options.agentCommand || ''));
    this.state = {
      mode: PTY_MODES.BOOTING,
      confidence: PTY_MODE_CONFIDENCE.LOW,
      source: 'init',
      seq: 0,
      isBlocked: false,
      blockedReason: undefined,
      running: false,
      provider: providerHint || undefined,
      exitCode: null,
      signal: undefined,
      updatedAt: Date.now()
    };
    this.tail = '';
    this.altScreen = false;
  }

  snapshot() {
    return { ...this.state };
  }

  updateAltScreen(next) {
    this.altScreen = !!next;
    return this.reconcile('alt_screen_update');
  }

  start() {
    return this.transition({
      mode: PTY_MODES.BOOTING,
      confidence: PTY_MODE_CONFIDENCE.LOW,
      source: 'session_started',
      running: true,
      isBlocked: false,
      blockedReason: undefined,
      exitCode: null,
      signal: undefined
    });
  }

  reconcile(source = 'reconcile') {
    if (this.altScreen) {
      return this.transition({
        mode: PTY_MODES.TUI,
        confidence: PTY_MODE_CONFIDENCE.HIGH,
        source,
        isBlocked: false,
        blockedReason: undefined
      });
    }

    const reason = extractBlockReason(this.tail);
    if (reason) {
      return this.transition({
        mode: PTY_MODES.BLOCKED,
        confidence: PTY_MODE_CONFIDENCE.MEDIUM,
        source: 'fallback_prompt',
        isBlocked: true,
        blockedReason: reason
      });
    }

    if (looksLikeTuiChunk(this.tail)) {
      return this.transition({
        mode: PTY_MODES.TUI,
        confidence: PTY_MODE_CONFIDENCE.MEDIUM,
        source: 'fallback_tui',
        isBlocked: false,
        blockedReason: undefined
      });
    }

    if (hasAgentSignal(this.tail, this.state.provider || '')) {
      return this.transition({
        mode: PTY_MODES.AGENT,
        confidence: PTY_MODE_CONFIDENCE.MEDIUM,
        source: 'fallback_agent',
        isBlocked: false,
        blockedReason: undefined
      });
    }

    if (hasShellSignal(this.tail)) {
      return this.transition({
        mode: PTY_MODES.SHELL,
        confidence: PTY_MODE_CONFIDENCE.MEDIUM,
        source: 'fallback_shell',
        isBlocked: false,
        blockedReason: undefined
      });
    }

    return { changed: false, snapshot: this.snapshot() };
  }

  consumeOutput(data, options = {}) {
    const chunk = String(data || '');
    const chunkWithoutMarkers = chunk.replace(MARKER_REGEX, '');
    MARKER_REGEX.lastIndex = 0;
    const cleaned = stripAnsi(chunkWithoutMarkers).replace(/\r/g, '\n');
    if (cleaned) {
      this.tail = `${this.tail}${cleaned}`.slice(-6000);
    }
    if (typeof options.altScreen === 'boolean') {
      this.altScreen = options.altScreen;
    }

    const markers = parseForklineMarkers(chunk);
    let lastChange = { changed: false, snapshot: this.snapshot() };
    for (const marker of markers) {
      const markerType = String(marker.type || '').toLowerCase();
      const markerProvider = normalizeProvider(marker.provider || this.state.provider || '');
      if (markerProvider && markerProvider !== this.state.provider) {
        lastChange = this.transition({ provider: markerProvider });
      }

      if (markerType === 'agent_started') {
        lastChange = this.transition({
          mode: PTY_MODES.AGENT,
          confidence: PTY_MODE_CONFIDENCE.HIGH,
          source: 'marker',
          running: true,
          isBlocked: false,
          blockedReason: undefined
        });
        continue;
      }

      if (markerType === 'agent_exited') {
        const parsedCode = Number.parseInt(String(marker.code || ''), 10);
        lastChange = this.transition({
          mode: PTY_MODES.SHELL,
          confidence: PTY_MODE_CONFIDENCE.HIGH,
          source: 'marker',
          isBlocked: false,
          blockedReason: undefined,
          exitCode: Number.isFinite(parsedCode) ? parsedCode : null
        });
        continue;
      }

      if (markerType === 'awaiting_confirmation') {
        lastChange = this.transition({
          mode: PTY_MODES.BLOCKED,
          confidence: PTY_MODE_CONFIDENCE.HIGH,
          source: 'marker',
          isBlocked: true,
          blockedReason: normalizeReasonText(marker.reason || marker.message || 'Agent is waiting for confirmation.')
        });
        continue;
      }

      if (markerType === 'confirmation_resolved') {
        lastChange = this.transition({
          mode: PTY_MODES.AGENT,
          confidence: PTY_MODE_CONFIDENCE.HIGH,
          source: 'marker',
          isBlocked: false,
          blockedReason: undefined
        });
        continue;
      }
    }

    const reconciled = this.reconcile('output');
    return reconciled.changed ? reconciled : lastChange;
  }

  consumeInput(data) {
    const text = String(data || '');
    if (!text) return { changed: false, snapshot: this.snapshot() };

    // Any user input resolves stale blocked state immediately.
    if (this.state.isBlocked) {
      return this.transition({
        mode: PTY_MODES.AGENT,
        confidence: PTY_MODE_CONFIDENCE.MEDIUM,
        source: 'user_input',
        isBlocked: false,
        blockedReason: undefined
      });
    }

    if (text.includes('\u0003')) {
      return this.transition({
        mode: PTY_MODES.SHELL,
        confidence: PTY_MODE_CONFIDENCE.MEDIUM,
        source: 'user_interrupt',
        isBlocked: false,
        blockedReason: undefined
      });
    }
    return { changed: false, snapshot: this.snapshot() };
  }

  consumeExit(exitCode, signal) {
    return this.transition({
      mode: PTY_MODES.EXITED,
      confidence: PTY_MODE_CONFIDENCE.HIGH,
      source: 'process_exit',
      running: false,
      isBlocked: false,
      blockedReason: undefined,
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      signal: typeof signal === 'number' ? signal : undefined
    });
  }

  transition(patch) {
    const next = { ...this.state, ...patch };
    let changed = false;
    for (const key of Object.keys(next)) {
      if (next[key] !== this.state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return { changed: false, snapshot: this.snapshot() };
    }
    next.seq = this.state.seq + 1;
    next.updatedAt = Date.now();
    this.state = next;
    return { changed: true, snapshot: this.snapshot() };
  }
}

module.exports = {
  PTY_MODES,
  PTY_MODE_CONFIDENCE,
  SUPPORTED_PROVIDERS,
  detectProviderFromCommand,
  buildAgentWrapperCommand,
  parseForklineMarkers,
  extractBlockReason,
  looksLikeTuiChunk,
  PtySessionStateMachine
};
