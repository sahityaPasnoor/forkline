import React, { useMemo, useState } from 'react';
import { Check, Eye, ListChecks, X } from 'lucide-react';

interface PendingApprovalItem {
  requestId: string;
  taskId: string;
  action: string;
  payload: unknown;
  projectPath: string;
}

interface BlockedTaskItem {
  taskId: string;
  taskName: string;
  projectPath: string;
  reason: string;
}

interface TaskMeta {
  taskName: string;
  projectPath: string;
  worktreePath?: string;
}

interface ApprovalInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingApprovals: PendingApprovalItem[];
  blockedTasks: BlockedTaskItem[];
  taskMetaById: Record<string, TaskMeta>;
  onSelectTask: (taskId: string) => void;
  onApproveOne: (requestId: string) => void;
  onRejectOne: (requestId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onRespondBlocked: (taskId: string, response: 'y' | 'n') => void;
  onRespondAllBlocked: (response: 'y' | 'n') => void;
}

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
};

const ApprovalInboxModal: React.FC<ApprovalInboxModalProps> = ({
  isOpen,
  onClose,
  pendingApprovals,
  blockedTasks,
  taskMetaById,
  onSelectTask,
  onApproveOne,
  onRejectOne,
  onApproveAll,
  onRejectAll,
  onRespondBlocked,
  onRespondAllBlocked
}) => {
  const [expandedApprovalId, setExpandedApprovalId] = useState<string | null>(null);
  const [loadingDiffId, setLoadingDiffId] = useState<string | null>(null);
  const [diffByApprovalId, setDiffByApprovalId] = useState<Record<string, string>>({});
  const [diffErrorByApprovalId, setDiffErrorByApprovalId] = useState<Record<string, string>>({});

  const totalCount = pendingApprovals.length + blockedTasks.length;
  const hasApprovals = pendingApprovals.length > 0;
  const hasBlocked = blockedTasks.length > 0;
  const sortedApprovals = useMemo(
    () => [...pendingApprovals].sort((a, b) => a.taskId.localeCompare(b.taskId)),
    [pendingApprovals]
  );

  if (!isOpen) return null;

  const loadDiff = async (approvalId: string, taskId: string) => {
    if (diffByApprovalId[approvalId] || loadingDiffId === approvalId) return;
    const worktreePath = taskMetaById[taskId]?.worktreePath;
    if (!worktreePath) {
      setDiffErrorByApprovalId((prev) => ({ ...prev, [approvalId]: 'No worktree available for diff preview.' }));
      return;
    }

    setLoadingDiffId(approvalId);
    const res = await window.electronAPI.getDiff(worktreePath, { syntaxAware: true });
    if (!res.success) {
      setDiffErrorByApprovalId((prev) => ({ ...prev, [approvalId]: res.error || 'Failed to load diff.' }));
      setLoadingDiffId(null);
      return;
    }

    setDiffByApprovalId((prev) => ({ ...prev, [approvalId]: res.diff || '' }));
    setLoadingDiffId(null);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[96] flex items-center justify-center p-4">
      <div className="app-panel rounded-xl border border-[#1a1a1a] shadow-2xl w-full max-w-5xl h-[84vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] font-mono">Human Gatekeeper</div>
            <h2 className="text-lg text-white font-semibold mt-1">Approval Inbox</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[#a1a1aa]">items {totalCount}</span>
            <button onClick={onClose} className="btn-ghost px-3 py-1.5 rounded text-[11px] uppercase tracking-wider">close</button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center gap-2 flex-wrap">
          <button
            onClick={onApproveAll}
            disabled={!hasApprovals}
            className="btn-primary px-3 py-1 rounded text-[11px] uppercase tracking-wider disabled:opacity-40"
          >
            <Check size={12} className="inline mr-1" /> approve all requests
          </button>
          <button
            onClick={onRejectAll}
            disabled={!hasApprovals}
            className="btn-danger px-3 py-1 rounded text-[11px] uppercase tracking-wider disabled:opacity-40"
          >
            <X size={12} className="inline mr-1" /> reject all requests
          </button>
          <button
            onClick={() => onRespondAllBlocked('y')}
            disabled={!hasBlocked}
            className="btn-warning px-3 py-1 rounded text-[11px] uppercase tracking-wider disabled:opacity-40"
          >
            respond y to blocked
          </button>
          <button
            onClick={() => onRespondAllBlocked('n')}
            disabled={!hasBlocked}
            className="btn-danger px-3 py-1 rounded text-[11px] uppercase tracking-wider disabled:opacity-40"
          >
            respond n to blocked
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2">
          <section className="border-r border-[#1a1a1a] overflow-y-auto p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#6b7280] font-mono px-1">Approval Requests</div>
            {sortedApprovals.length === 0 && (
              <div className="text-xs text-[#71717a] font-mono p-2">No pending approval requests.</div>
            )}
            {sortedApprovals.map((item) => {
              const meta = taskMetaById[item.taskId] || {
                taskName: item.taskId,
                projectPath: item.projectPath,
                worktreePath: undefined
              };
              const expanded = expandedApprovalId === item.requestId;
              const diffContent = diffByApprovalId[item.requestId];
              const diffError = diffErrorByApprovalId[item.requestId];

              return (
                <div key={item.requestId} className="rounded-lg border border-[#1f1f1f] bg-[#090909] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTask(item.taskId);
                        }}
                        className="btn-link text-left text-sm truncate"
                      >
                        {meta.taskName}
                      </button>
                      <div className="text-[10px] text-[#71717a] font-mono mt-0.5 truncate">{meta.projectPath}</div>
                      <div className="text-[11px] text-amber-300 uppercase tracking-wider font-mono mt-2">{item.action}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <button onClick={() => onRejectOne(item.requestId)} className="btn-danger px-2 py-1 rounded text-[10px] font-mono">reject</button>
                      <button onClick={() => void onApproveOne(item.requestId)} className="btn-primary px-2 py-1 rounded text-[10px] font-mono">approve</button>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedApprovalId((prev) => (prev === item.requestId ? null : item.requestId));
                      }}
                      className="btn-ghost px-2 py-1 rounded text-[10px] uppercase tracking-wider"
                    >
                      <ListChecks size={11} className="inline mr-1" /> payload
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void loadDiff(item.requestId, item.taskId);
                        setExpandedApprovalId(item.requestId);
                      }}
                      className="btn-ghost px-2 py-1 rounded text-[10px] uppercase tracking-wider"
                    >
                      <Eye size={11} className="inline mr-1" /> diff
                    </button>
                  </div>

                  {expanded && (
                    <div className="mt-2 rounded border border-[#1f1f1f] bg-[#050505] p-2 text-[11px] font-mono overflow-auto max-h-56">
                      <div className="text-[#9ca3af] uppercase tracking-wider mb-1">payload</div>
                      <pre className="whitespace-pre-wrap text-[#d4d4d8]">{safeStringify(item.payload)}</pre>
                      <div className="text-[#9ca3af] uppercase tracking-wider mt-3 mb-1">diff preview</div>
                      {loadingDiffId === item.requestId && <div className="text-[#6b7280]">loading diff...</div>}
                      {diffError && <div className="text-rose-300">{diffError}</div>}
                      {!loadingDiffId && !diffError && (
                        <pre className="whitespace-pre-wrap text-[#d4d4d8]">{diffContent || 'No diff loaded yet.'}</pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section className="overflow-y-auto p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#6b7280] font-mono px-1">Blocked Sessions</div>
            {blockedTasks.length === 0 && (
              <div className="text-xs text-[#71717a] font-mono p-2">No blocked terminal prompts.</div>
            )}
            {blockedTasks.map((item) => (
              <div key={item.taskId} className="rounded-lg border border-[#1f1f1f] bg-[#090909] p-3">
                <button
                  type="button"
                  onClick={() => onSelectTask(item.taskId)}
                  className="btn-link text-left text-sm truncate"
                >
                  {item.taskName}
                </button>
                <div className="text-[10px] text-[#71717a] font-mono mt-0.5 truncate">{item.projectPath}</div>
                <div className="text-[11px] text-[#d4d4d8] mt-2">{item.reason}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => onRespondBlocked(item.taskId, 'y')} className="btn-primary px-2 py-1 rounded text-[10px] font-mono">send y</button>
                  <button onClick={() => onRespondBlocked(item.taskId, 'n')} className="btn-danger px-2 py-1 rounded text-[10px] font-mono">send n</button>
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ApprovalInboxModal;
