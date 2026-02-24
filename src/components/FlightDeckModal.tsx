import React from 'react';
import { X } from 'lucide-react';
import type { TaskStatus, TaskTab } from '../models/orchestrator';

interface FlightDeckSession {
  taskId: string;
  running: boolean;
  isBlocked: boolean;
  exitCode: number | null;
  signal?: number;
  tailPreview?: string[];
  resource?: { taskId: string; sessionId: string; port: number; host: string } | null;
  sandbox?: { mode: string; active: boolean; warning?: string; denyNetwork?: boolean } | null;
}

interface FlightDeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: FlightDeckSession[];
  tabs: TaskTab[];
  statuses: Record<string, TaskStatus>;
  onSelectTask: (taskId: string) => void;
}

const sessionStateLabel = (session: FlightDeckSession, status?: TaskStatus) => {
  if (session.exitCode !== null) return 'done';
  if (session.isBlocked || status?.isBlocked) return 'blocked';
  if (session.running) return 'thinking';
  return 'idle';
};

const stateClass = (label: string) => {
  if (label === 'blocked') return 'text-red-300 border-red-900/80 bg-[#240a0a]';
  if (label === 'done') return 'text-emerald-300 border-emerald-900/80 bg-[#0b1a13]';
  if (label === 'thinking') return 'text-cyan-300 border-cyan-900/80 bg-[#07161b]';
  return 'text-[#a3a3a3] border-[#262626] bg-[#050505]';
};

const FlightDeckModal: React.FC<FlightDeckModalProps> = ({
  isOpen,
  onClose,
  sessions,
  tabs,
  statuses,
  onSelectTask
}) => {
  if (!isOpen) return null;

  const rows = sessions
    .map((session) => {
      const tab = tabs.find((entry) => entry.id === session.taskId);
      if (!tab) return null;
      const status = statuses[session.taskId];
      const state = sessionStateLabel(session, status);
      return { session, tab, status, state };
    })
    .filter(Boolean) as Array<{ session: FlightDeckSession; tab: TaskTab; status?: TaskStatus; state: string }>;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[88] p-4">
      <div className="app-panel border border-[#1a1a1a] rounded-xl shadow-2xl w-full max-w-6xl h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#e5e5e5] uppercase tracking-widest">Flight Deck</h2>
            <p className="text-[11px] text-[#9ca3af] mt-1">Live summary across all active PTY sessions.</p>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {rows.length === 0 && (
            <div className="text-xs text-[#9ca3af] font-mono">No active sessions.</div>
          )}
          {rows.map(({ session, tab, state }) => (
            <button
              key={session.taskId}
              type="button"
              onClick={() => {
                onSelectTask(session.taskId);
                onClose();
              }}
              className="w-full text-left rounded-lg border border-[#1a1a1a] bg-[#050505] hover:border-[#2f2f2f] transition-colors p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#e5e5e5] truncate">{tab.name}</div>
                  <div className="text-[11px] text-[#9ca3af] font-mono truncate">{tab.agent}</div>
                </div>
                <div className={`text-[10px] uppercase tracking-wider border rounded px-2 py-0.5 font-mono ${stateClass(state)}`}>
                  {state}
                </div>
              </div>

              <div className="mt-3 space-y-1 text-[11px] text-[#d1d5db] font-mono">
                {(session.tailPreview && session.tailPreview.length > 0) ? (
                  session.tailPreview.map((line, index) => (
                    <div key={`${session.taskId}-line-${index}`} className="truncate">{line}</div>
                  ))
                ) : (
                  <div className="text-[#737373]">No recent output.</div>
                )}
              </div>

              <div className="mt-3 text-[10px] text-[#737373] font-mono flex flex-wrap gap-3">
                {session.resource?.port ? <span>PORT={session.resource.port}</span> : null}
                {session.resource?.sessionId ? <span>SID={session.resource.sessionId.slice(0, 8)}</span> : null}
                {session.sandbox?.active ? <span>sandbox={session.sandbox.mode}</span> : null}
                {session.sandbox?.denyNetwork ? <span>net=blocked</span> : null}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FlightDeckModal;
