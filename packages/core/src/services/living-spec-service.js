const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT_FILE_BYTES = 256_000;
const MAX_LIVING_SPEC_FILES = 32;
const MAX_LIVING_SPEC_FILE_BYTES = 256_000;
const AGENTS_PRIMARY_FILES = [
  'AGENTS.md',
  'agents.md',
  '.github/AGENTS.md',
  '.github/agents.md'
];
const AGENTIC_ROOT_CANDIDATE_FILES = [
  'SPEC.md',
  'SPECIFICATION.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'COPILOT_INSTRUCTIONS.md',
  '.cursorrules',
  '.windsurfrules',
  '.aider.conf.yml',
  '.aider.conf.yaml',
  '.github/copilot-instructions.md',
  '.github/instructions.md',
  '.github/agents.md',
  '.claude/CLAUDE.md'
];
const AGENTIC_DIR_CANDIDATES = [
  '.cursor/rules',
  '.github/instructions',
  '.claude/commands'
];
const ALLOWED_AGENTIC_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.yaml',
  '.yml',
  '.json',
  '.toml'
]);

const clampUtf8 = (value, maxBytes) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const bytes = Buffer.byteLength(trimmed, 'utf8');
  if (bytes <= maxBytes) return trimmed;
  return Buffer.from(trimmed, 'utf8').subarray(0, maxBytes).toString('utf8');
};

const isPathInside = (parentPath, targetPath) => {
  const parent = path.resolve(parentPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const normalizeRelativeRepoPath = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return '';
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return '';
  if (segments.some((segment) => segment === '.' || segment === '..')) return '';
  return segments.join('/');
};

const isAgentsInstructionPath = (relativePath) => path.basename(relativePath).toLowerCase() === 'agents.md';

const rankAgentsInstructionPath = (relativePath) => {
  const normalized = relativePath.toLowerCase();
  if (normalized === 'agents.md') return 0;
  if (normalized === '.github/agents.md') return 1;
  return 2;
};

const isLikelyTextSpecPath = (relativePath) => {
  const ext = path.extname(relativePath).toLowerCase();
  if (ALLOWED_AGENTIC_EXTENSIONS.has(ext)) return true;
  const basename = path.basename(relativePath).toLowerCase();
  return basename.endsWith('rules') || basename.endsWith('.md');
};

const listAgenticDirectoryFiles = (basePath, relativeDir, maxDepth = 3) => {
  const results = [];
  const normalizedDir = normalizeRelativeRepoPath(relativeDir);
  if (!normalizedDir) return results;
  const absoluteDir = path.join(basePath, normalizedDir);
  if (!isPathInside(basePath, absoluteDir)) return results;
  if (!fs.existsSync(absoluteDir)) return results;
  let dirStat;
  try {
    dirStat = fs.statSync(absoluteDir);
  } catch {
    return results;
  }
  if (!dirStat.isDirectory()) return results;

  const stack = [{ absolute: absoluteDir, relative: normalizedDir, depth: 0 }];
  while (stack.length > 0 && results.length < MAX_LIVING_SPEC_FILES) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.cursorrules') continue;
      const absoluteChild = path.join(current.absolute, entry.name);
      const relativeChild = normalizeRelativeRepoPath(path.join(current.relative, entry.name));
      if (!relativeChild) continue;
      if (!isPathInside(basePath, absoluteChild)) continue;
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          stack.push({ absolute: absoluteChild, relative: relativeChild, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isLikelyTextSpecPath(relativeChild)) continue;
      results.push(relativeChild);
      if (results.length >= MAX_LIVING_SPEC_FILES) break;
    }
  }

  return results;
};

const collectAgenticSpecCandidates = (basePath) => {
  const primaryMatches = new Map();
  for (const relativePath of AGENTS_PRIMARY_FILES) {
    const normalized = normalizeRelativeRepoPath(relativePath);
    if (!normalized) continue;
    const absolute = path.join(basePath, normalized);
    if (!isPathInside(basePath, absolute)) continue;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) continue;
      const dedupeKey = normalized.toLowerCase();
      if (!primaryMatches.has(dedupeKey)) {
        primaryMatches.set(dedupeKey, normalized);
      }
    } catch {
      // ignore missing candidates
    }
  }

  if (primaryMatches.size > 0) {
    return Array.from(primaryMatches.values())
      .sort((a, b) => {
        const rankDiff = rankAgentsInstructionPath(a) - rankAgentsInstructionPath(b);
        if (rankDiff !== 0) return rankDiff;
        return a.localeCompare(b);
      })
      .map((relativePath) => ({
        path: relativePath,
        kind: 'agents'
      }));
  }

  const matches = new Set();

  for (const relativePath of AGENTIC_ROOT_CANDIDATE_FILES) {
    const normalized = normalizeRelativeRepoPath(relativePath);
    if (!normalized) continue;
    const absolute = path.join(basePath, normalized);
    if (!isPathInside(basePath, absolute)) continue;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) continue;
      matches.add(normalized);
    } catch {
      // ignore missing candidates
    }
  }

  for (const relativeDir of AGENTIC_DIR_CANDIDATES) {
    const files = listAgenticDirectoryFiles(basePath, relativeDir, 4);
    files.forEach((file) => matches.add(file));
  }

  return Array.from(matches)
    .sort((a, b) => a.localeCompare(b))
    .map((relativePath) => ({
      path: relativePath,
      kind: isAgentsInstructionPath(relativePath)
        ? 'agents'
        : (relativePath.includes('/rules') || relativePath.endsWith('rules') ? 'rules' : 'spec')
    }));
};

const sanitizeLivingSpecPreference = (value) => {
  if (!value || typeof value !== 'object') return null;
  const input = value;
  const mode = input.mode === 'consolidated' ? 'consolidated' : (input.mode === 'single' ? 'single' : null);
  if (!mode) return null;
  const selectedPath = normalizeRelativeRepoPath(input.selectedPath);
  if (mode === 'single' && !selectedPath) return null;
  if (mode === 'single') {
    return { mode, selectedPath };
  }
  return { mode };
};

const resolveLivingSpecDocument = (basePath, preference) => {
  const candidates = collectAgenticSpecCandidates(basePath);
  if (candidates.length === 0) return null;

  const candidateSet = new Set(candidates.map((candidate) => candidate.path));
  const sourcePaths = [];
  let mode = 'single';
  const preferredAgentsCandidate = candidates
    .filter((candidate) => isAgentsInstructionPath(candidate.path))
    .sort((a, b) => {
      const rankDiff = rankAgentsInstructionPath(a.path) - rankAgentsInstructionPath(b.path);
      if (rankDiff !== 0) return rankDiff;
      return a.path.localeCompare(b.path);
    })[0];

  if (preferredAgentsCandidate) {
    sourcePaths.push(preferredAgentsCandidate.path);
    mode = 'single';
  } else if (preference?.mode === 'single' && preference.selectedPath && candidateSet.has(preference.selectedPath)) {
    sourcePaths.push(preference.selectedPath);
    mode = 'single';
  } else if (preference?.mode === 'consolidated') {
    sourcePaths.push(...candidates.map((candidate) => candidate.path));
    mode = 'consolidated';
  } else if (candidates.length === 1) {
    sourcePaths.push(candidates[0].path);
    mode = 'single';
  } else {
    sourcePaths.push(...candidates.map((candidate) => candidate.path));
    mode = 'consolidated';
  }

  const sections = [];
  for (const relativePath of sourcePaths.slice(0, MAX_LIVING_SPEC_FILES)) {
    const absolutePath = path.join(basePath, relativePath);
    if (!isPathInside(basePath, absolutePath)) continue;
    try {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile() || stat.size > MAX_LIVING_SPEC_FILE_BYTES) continue;
      const raw = fs.readFileSync(absolutePath, 'utf8');
      const content = clampUtf8(raw, MAX_LIVING_SPEC_FILE_BYTES);
      if (!content) continue;
      sections.push(`## Source: ${relativePath}\n\n${content}`);
    } catch {
      // skip unreadable sources
    }
  }

  if (sections.length === 0) return null;
  const doc = [
    '# Forkline Living Spec',
    '',
    `Mode: ${mode}`,
    '',
    ...sections
  ].join('\n');

  return {
    content: clampUtf8(doc, MAX_TEXT_FILE_BYTES),
    sources: sourcePaths,
    mode,
    resolvedPath: mode === 'single' && sourcePaths.length === 1 ? sourcePaths[0] : null
  };
};

const LANGUAGE_HINTS = [
  { language: 'typescript', include: ['typescript', 'ts/tsx', 'tsx'], requiredExts: ['.ts', '.tsx'], forbiddenExts: ['.py'] },
  { language: 'python', include: ['python', 'pyproject', 'pep8'], requiredExts: ['.py'], forbiddenExts: ['.ts', '.tsx'] },
  { language: 'go', include: ['golang', ' go '], requiredExts: ['.go'], forbiddenExts: [] },
  { language: 'rust', include: ['rust'], requiredExts: ['.rs'], forbiddenExts: [] }
];

const resolveLivingSpecSummary = (basePath, preference) => {
  const resolved = resolveLivingSpecDocument(basePath, preference);
  if (!resolved || !resolved.content) return null;
  const lower = resolved.content.toLowerCase();

  for (const hint of LANGUAGE_HINTS) {
    if (hint.include.some((token) => lower.includes(token))) {
      return {
        preferredLanguage: hint.language,
        requiredExts: hint.requiredExts.slice(),
        forbiddenExts: hint.forbiddenExts.slice()
      };
    }
  }

  return null;
};

module.exports = {
  collectAgenticSpecCandidates,
  sanitizeLivingSpecPreference,
  resolveLivingSpecDocument,
  resolveLivingSpecSummary
};
