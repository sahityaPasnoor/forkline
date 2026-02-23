import type { TaskUsage } from '../models/orchestrator';

const formatCompactNumber = (value: number) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
};

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const formatUsd = (value: number) => {
  if (!Number.isFinite(value)) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

export const formatTaskUsage = (usage?: TaskUsage) => {
  if (!usage) return 'CTX n/a';

  if (typeof usage.contextTokens === 'number' && typeof usage.contextWindow === 'number' && usage.contextWindow > 0) {
    const percent = clampPercent((usage.contextTokens / usage.contextWindow) * 100);
    return `CTX ${formatCompactNumber(usage.contextTokens)}/${formatCompactNumber(usage.contextWindow)} (${percent.toFixed(1)}%)`;
  }

  if (typeof usage.contextTokens === 'number') {
    return `CTX ${formatCompactNumber(usage.contextTokens)}`;
  }

  if (typeof usage.totalTokens === 'number') {
    return `TOK ${formatCompactNumber(usage.totalTokens)}`;
  }

  if (typeof usage.promptTokens === 'number' || typeof usage.completionTokens === 'number') {
    const inTokens = typeof usage.promptTokens === 'number' ? formatCompactNumber(usage.promptTokens) : '-';
    const outTokens = typeof usage.completionTokens === 'number' ? formatCompactNumber(usage.completionTokens) : '-';
    return `IN ${inTokens} OUT ${outTokens}`;
  }

  return 'CTX n/a';
};

export const formatTaskCost = (usage?: TaskUsage) => {
  if (!usage) return 'COST n/a';

  if (typeof usage.costUsd === 'number') {
    return `COST ${formatUsd(usage.costUsd)}`;
  }

  if (typeof usage.promptCostUsd === 'number' || typeof usage.completionCostUsd === 'number') {
    const input = typeof usage.promptCostUsd === 'number' ? formatUsd(usage.promptCostUsd) : '-';
    const output = typeof usage.completionCostUsd === 'number' ? formatUsd(usage.completionCostUsd) : '-';
    return `COST in ${input} out ${output}`;
  }

  return 'COST n/a';
};
