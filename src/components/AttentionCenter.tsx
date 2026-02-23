import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, ExternalLink, ShieldAlert, X } from 'lucide-react';
import type { AttentionEvent } from '../models/orchestrator';

interface AttentionCenterProps {
  isOpen: boolean;
  onClose: () => void;
  events: AttentionEvent[];
  onDismissEvent: (eventId: string) => void;
  onClearEvents: () => void;
  onSwitchProject: (projectPath: string) => void;
}

const normalizePath = (value: string) => value.trim().replace(/\\/g, '/').replace(/\/+$/, '');

const basename = (value: string) => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
};
const compactPath = (value: string, keepSegments = 3) => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= keepSegments) return normalized;
  return `.../${parts.slice(-keepSegments).join('/')}`;
};

const formatRelative = (timestamp: number) => {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 5) return 'just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  return `${Math.floor(deltaSeconds / 3600)}h ago`;
};

const AttentionCenter: React.FC<AttentionCenterProps> = ({
  isOpen,
  onClose,
  events,
  onDismissEvent,
  onClearEvents,
  onSwitchProject
}) => {
  const [toastIds, setToastIds] = useState<string[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const sortedEvents = useMemo(() => [...events].sort((a, b) => b.createdAt - a.createdAt), [events]);
  const toastEvents = toastIds
    .map(id => sortedEvents.find(event => event.id === id))
    .filter((event): event is AttentionEvent => !!event)
    .filter(event => event.requiresAction)
    .slice(0, 4);

  useEffect(() => {
    const newToasts: string[] = [];
    for (const event of sortedEvents) {
      if (seenRef.current.has(event.id)) continue;
      seenRef.current.add(event.id);
      newToasts.push(event.id);
      timersRef.current[event.id] = setTimeout(() => {
        setToastIds(prev => prev.filter(id => id !== event.id));
        delete timersRef.current[event.id];
      }, 12000);
    }
    if (newToasts.length > 0) {
      setToastIds(prev => [...newToasts, ...prev].slice(0, 8));
    }
  }, [sortedEvents]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer);
      }
      timersRef.current = {};
    };
  }, []);

  const iconForEvent = (event: AttentionEvent) => {
    if (event.kind === 'blocked') return <AlertTriangle size={13} className="text-red-400 shrink-0" />;
    if (event.kind === 'approval_auto_approved') return <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />;
    return <ShieldAlert size={13} className="text-amber-400 shrink-0" />;
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none">
        {toastEvents.map((event) => (
          <div key={event.id} className="pointer-events-auto w-[22rem] rounded-lg border border-[#262626] bg-[#070707]/95 backdrop-blur px-3 py-2 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  {iconForEvent(event)}
                  <span className="text-[#d4d4d8] truncate">{basename(event.projectPath)} → {event.taskName}</span>
                </div>
                <div className="text-[11px] text-[#a1a1aa] mt-1 break-words">{event.reason}</div>
                <div className="text-[10px] text-[#6b7280] font-mono mt-1">{formatRelative(event.createdAt)}</div>
              </div>
              <button
                onClick={() => {
                  setToastIds(prev => prev.filter(id => id !== event.id));
                }}
                className="btn-ghost p-1 rounded"
                title="Dismiss toast"
              >
                <X size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-end">
          <div className="h-full w-full max-w-xl app-panel border-l border-[#1a1a1a] shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] font-mono">Global Signals</div>
                <h2 className="text-lg text-white font-semibold mt-1 flex items-center">
                  <BellRing size={17} className="mr-2" />
                  Attention Center
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onClearEvents} className="btn-ghost px-3 py-1 rounded text-[11px] uppercase tracking-wider">
                  clear
                </button>
                <button onClick={onClose} className="btn-ghost px-3 py-1 rounded text-[11px] uppercase tracking-wider">
                  close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sortedEvents.length === 0 && (
                <div className="h-full flex items-center justify-center text-xs font-mono text-[#6b7280]">
                  No attention events yet.
                </div>
              )}

              {sortedEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-[#1f1f1f] bg-[#090909] px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {iconForEvent(event)}
                        <span className="text-sm text-white truncate">{event.taskName}</span>
                        {event.requiresAction && (
                          <span className="text-[10px] uppercase tracking-wider font-mono text-red-300">action</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#9ca3af] font-mono truncate mt-1" title={event.projectPath}>{compactPath(event.projectPath, 4)}</div>
                      <div className="text-[12px] text-[#d4d4d8] mt-1">{event.reason}</div>
                      <div className="text-[10px] text-[#6b7280] font-mono mt-1">{formatRelative(event.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onSwitchProject(event.projectPath)}
                        className="btn-ghost px-2 py-1 rounded text-[10px] uppercase tracking-wider flex items-center"
                      >
                        <ExternalLink size={11} className="mr-1" />
                        switch
                      </button>
                      <button
                        onClick={() => onDismissEvent(event.id)}
                        className="btn-ghost px-2 py-1 rounded text-[10px] uppercase tracking-wider"
                      >
                        dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AttentionCenter;
