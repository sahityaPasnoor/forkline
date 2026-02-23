export const sanitizeTaskName = (rawTaskName: string, fallbackId: string): string => {
  const singleSegment = rawTaskName
    .replace(/[\\/]+/g, '-')
    .replace(/\.\.+/g, '-');

  const sanitized = singleSegment
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/\.+$/, '');

  return sanitized || `task-${fallbackId.slice(-4)}`;
};

export const buildSubtaskPrompt = (
  parentTaskName: string,
  objective: string,
  index: number,
  total: number
): string => {
  return [
    `You are subtask agent ${index} of ${total} for parent task "${parentTaskName}".`,
    `Parent objective: ${objective}`,
    'Focus on one clearly scoped implementation chunk and avoid unrelated edits.',
    'Run relevant checks, then summarize exactly what changed and why.'
  ].join('\n');
};
