#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const TARGETS = [
  path.join(ROOT, 'src', 'App.tsx'),
  ...fs.readdirSync(path.join(ROOT, 'src', 'components'))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => path.join(ROOT, 'src', 'components', name))
];

const CLASS_PATTERN = /(?:hover:|focus:|active:)?(?:text|bg|border)-\[#(?:[0-9a-fA-F]{3,8})\]/g;
const LEGACY_WHITE_PATTERN = /\b(?:text-white|border-white|bg-white|hover:text-white|group-hover:text-white)\b/g;

const tally = new Map();

const countMatches = (value, filePath) => {
  let match = CLASS_PATTERN.exec(value);
  while (match) {
    const key = match[0];
    const current = tally.get(key) || { count: 0, files: new Set() };
    current.count += 1;
    current.files.add(path.relative(ROOT, filePath));
    tally.set(key, current);
    match = CLASS_PATTERN.exec(value);
  }
  CLASS_PATTERN.lastIndex = 0;

  match = LEGACY_WHITE_PATTERN.exec(value);
  while (match) {
    const key = match[0];
    const current = tally.get(key) || { count: 0, files: new Set() };
    current.count += 1;
    current.files.add(path.relative(ROOT, filePath));
    tally.set(key, current);
    match = LEGACY_WHITE_PATTERN.exec(value);
  }
  LEGACY_WHITE_PATTERN.lastIndex = 0;
};

for (const target of TARGETS) {
  const content = fs.readFileSync(target, 'utf8');
  countMatches(content, target);
}

const rows = Array.from(tally.entries())
  .map(([token, info]) => ({
    token,
    count: info.count,
    files: Array.from(info.files).sort()
  }))
  .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));

console.log(`[css-audit] scanned ${TARGETS.length} files`);
console.log(`[css-audit] found ${rows.length} hard-coded utility tokens`);

for (const row of rows.slice(0, 40)) {
  console.log(`${String(row.count).padStart(4, ' ')}  ${row.token}  (${row.files.length} files)`);
}

if (rows.length > 40) {
  console.log(`[css-audit] ... ${rows.length - 40} more token(s)`);
}

