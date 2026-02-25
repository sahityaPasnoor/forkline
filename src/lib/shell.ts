const isLikelyWindowsRuntime = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.platform === 'string') {
    return /win/i.test(navigator.platform);
  }
  const runtimeProcess = (globalThis as any).process;
  if (runtimeProcess && typeof runtimeProcess.platform === 'string') {
    return runtimeProcess.platform === 'win32';
  }
  return false;
};

export const shellQuote = (value: string) => {
  const source = String(value ?? '');
  if (isLikelyWindowsRuntime()) {
    // PowerShell single-quote escaping: doubled single quotes.
    return `'${source.replace(/'/g, "''")}'`;
  }
  // POSIX single-quote escaping.
  return `'${source.replace(/'/g, `'\"'\"'`)}'`;
};
