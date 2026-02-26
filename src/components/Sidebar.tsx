import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, TerminalSquare, AlertTriangle, FileEdit, CheckCircle2, Loader2, MessageSquareWarning, Trash2, ExternalLink, Pencil } from 'lucide-react';
import type { TaskStatus, TaskUsage } from '../models/orchestrator';
import { formatTaskUsage } from '../lib/usageUtils';

interface SidebarProps {
  tabs: {id: string, name: string, agent: string, tags?: string[]}[];
  activeTab: string | null;
  statuses: Record<string, TaskStatus>;
  usageByTask: Record<string, TaskUsage>;
  width: number;
  repoWebUrl: string | null;
  onSelectTab: (id: string) => void;
  onOpenRepo: () => void;
  onNewTask: () => void;
  onDeleteTask: (id: string) => void;
  onRenameTask: (id: string, nextName: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  tabs,
  activeTab,
  statuses,
  usageByTask,
  width,
  repoWebUrl,
  onSelectTab,
  onOpenRepo,
  onNewTask,
  onDeleteTask,
  onRenameTask
}) => {
  const compact = width < 220;
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const getStatusLabel = (status: TaskStatus) => {
    if (!status.isReady) return 'Provisioning';
    if (status.isBlocked) return 'Blocked';
    if (status.hasCollision) return 'Collision';
    if (status.isDirty) return 'Dirty';
    return 'Clean';
  };

  const cancelRename = useCallback(() => {
    setEditingTaskId(null);
    setEditingName('');
  }, []);

  const beginRename = useCallback((taskId: string, currentName: string, event?: React.SyntheticEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (compact) {
      const prompted = window.prompt('Rename session', currentName);
      if (prompted === null) return;
      onRenameTask(taskId, prompted);
      return;
    }
    setEditingTaskId(taskId);
    setEditingName(currentName);
  }, [compact, onRenameTask]);

  const submitRename = useCallback((taskId: string) => {
    onRenameTask(taskId, editingName);
    cancelRename();
  }, [cancelRename, editingName, onRenameTask]);

  useEffect(() => {
    if (!editingTaskId) return;
    if (tabs.some((tab) => tab.id === editingTaskId)) return;
    cancelRename();
  }, [tabs, editingTaskId, cancelRename]);

  useEffect(() => {
    if (!editingTaskId) return;
    const rafId = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(rafId);
  }, [editingTaskId]);

  return (
    <aside style={{ width }} className="shrink-0 app-panel m-2 mr-0 rounded-xl flex flex-col h-[calc(100vh-1rem)] z-10 overflow-hidden min-w-0">
      <div className="px-3 py-2.5 border-b border-[var(--panel-border)]">
        <div className={`flex items-center gap-2 ${compact ? 'justify-center' : ''}`}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <TerminalSquare size={16} className="text-[var(--text-primary)] shrink-0" />
            {!compact && (
              <h1 className="text-xs font-bold text-[var(--text-primary)] tracking-[0.2em] uppercase truncate">Sessions</h1>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenRepo}
            title={repoWebUrl ? `Open repository in browser: ${repoWebUrl}` : 'No repository remote URL available'}
            className={`btn-ghost shrink-0 rounded px-2 py-1 text-[10px] font-mono uppercase tracking-wide ${
              repoWebUrl
                ? 'text-[var(--text-secondary)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            <ExternalLink size={10} />
            {!compact && <span>Repo</span>}
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {tabs.map(tab => {
            const status = statuses[tab.id] || { isReady: false, isDirty: false, hasCollision: false, isBlocked: false };
            const usage = usageByTask[tab.id];
            const usageLabel = formatTaskUsage(usage);
            const isActive = activeTab === tab.id;
            const tags = Array.isArray(tab.tags) ? tab.tags : [];
            
            return (
              <div
                key={tab.id}
                onClick={() => {
                  if (editingTaskId === tab.id) return;
                  onSelectTab(tab.id);
                }}
                className={`group relative rounded-md px-2.5 py-2 cursor-pointer transition-colors border ${
                  isActive
                    ? 'border-[var(--input-border-focus)] bg-[var(--panel-strong)]'
                    : 'border-transparent hover:border-[var(--panel-border)] hover:bg-[var(--panel-subtle)]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="relative flex-shrink-0 flex items-center justify-center w-5 h-5 mt-0.5" title={`Session state: ${getStatusLabel(status)}`}>
                    {!status.isReady ? (
                      <Loader2 className="text-[var(--text-muted)] animate-spin" size={13} />
                    ) : status.isBlocked ? (
                      <MessageSquareWarning className="text-red-500" size={13} />
                    ) : status.hasCollision ? (
                      <AlertTriangle className="text-yellow-500" size={13} />
                    ) : status.isDirty ? (
                      <FileEdit className="text-blue-400" size={13} />
                    ) : (
                      <CheckCircle2 className="text-emerald-500" size={13} />
                    )}
                    {status.isBlocked && (
                      <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                    )}
                  </div>

                  {!compact && (
                    <div className="min-w-0 flex-1">
                      {editingTaskId === tab.id ? (
                        <input
                          ref={(node) => {
                            renameInputRef.current = node;
                          }}
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              submitRename(tab.id);
                              return;
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          onBlur={() => submitRename(tab.id)}
                          className="input-stealth rounded px-2 py-1 text-[12px] font-mono text-[var(--text-primary)] w-full"
                          maxLength={72}
                          aria-label={`Rename session ${tab.name}`}
                        />
                      ) : (
                        <div
                          className={`text-[13px] font-semibold truncate ${
                            status.isBlocked
                              ? 'text-red-400'
                              : (isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]')
                          }`}
                          onDoubleClick={(event) => beginRename(tab.id, tab.name, event)}
                          title="Double-click to rename session"
                        >
                          {tab.name}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--panel-border)] bg-[var(--panel-subtle)] text-[var(--text-primary)] uppercase tracking-[0.12em] font-mono truncate"
                          title={`Agent command: ${tab.agent}`}
                        >
                          {tab.agent}
                        </span>
                        {isActive && usageLabel && (
                          <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-[0.08em] font-mono truncate">
                            {usageLabel}
                          </span>
                        )}
                      </div>
                      {tags.length > 0 && (
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {tags.slice(0, 3).map((tag) => (
                            <span
                              key={`${tab.id}-tag-${tag}`}
                              className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--panel-border)] bg-[var(--panel-subtle)] text-[var(--text-secondary)] font-mono"
                              title={`Tag: ${tag}`}
                            >
                              #{tag}
                            </span>
                          ))}
                          {tags.length > 3 && (
                            <span className="text-[9px] text-[var(--text-muted)] font-mono">
                              +{tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`flex items-center gap-1 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                    {!compact && (
                      <button
                        onClick={(event) => beginRename(tab.id, tab.name, event)}
                        className="btn-ghost btn-icon-sm rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        title={`Rename ${tab.name}`}
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTask(tab.id);
                      }}
                      className="btn-danger btn-icon-sm rounded text-[var(--text-muted)] hover:text-red-100"
                      title={`Delete ${tab.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {tabs.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--panel-border)] bg-[var(--panel)] px-3 py-4 text-[11px] text-[var(--text-tertiary)] font-mono text-center">
              No sessions yet.
            </div>
          )}
        </div>
      </div>

      <div className="p-2 border-t border-[var(--panel-border)]">
        <button
          onClick={onNewTask}
          className="w-full flex items-center justify-center p-2 rounded-md btn-primary text-[11px] uppercase tracking-[0.12em] gap-2"
          title="Spawn agent"
        >
          <Plus size={12} />
          <span>{compact ? 'Spawn' : 'Spawn Agent'}</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
