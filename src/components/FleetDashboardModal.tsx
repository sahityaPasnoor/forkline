import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Archive, ArchiveRestore, FolderTree, Layers, PlayCircle, X } from 'lucide-react';
import type { FleetProjectSummary, FleetTaskRecord, FleetTaskTimeline } from '../models/fleet';
import type { TaskTab } from '../models/orchestrator';

interface FleetDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  liveTabs: TaskTab[];
  onOpenLiveTask: (taskId: string) => void;
}

const formatDateTime = (value?: number) => {
  if (!value || !Number.isFinite(value)) return '-';
  return new Date(value).toLocaleString();
};

const formatRelative = (value?: number) => {
  if (!value || !Number.isFinite(value)) return '-';
  const deltaMs = Date.now() - value;
  const minutes = Math.floor(Math.abs(deltaMs) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const basename = (value: string) => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = normalized.split('/').pop();
  return last && last.trim() ? last : normalized;
};

const truncate = (value: string, max = 120) => (value.length <= max ? value : `${value.slice(0, max - 1)}...`);

const statusClass = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized.includes('block')) return 'text-red-300 border-red-900/80 bg-[#220a0a]';
  if (normalized.includes('colli')) return 'text-amber-300 border-amber-900/80 bg-[#1f1607]';
  if (normalized.includes('closed')) return 'text-slate-300 border-slate-700 bg-[#111315]';
  if (normalized.includes('exit') || normalized.includes('destroy')) return 'text-zinc-300 border-zinc-700 bg-[#141414]';
  if (normalized.includes('run')) return 'text-emerald-300 border-emerald-900/80 bg-[#0b1a13]';
  if (normalized.includes('provision')) return 'text-cyan-300 border-cyan-900/80 bg-[#07161b]';
  return 'text-zinc-300 border-zinc-700 bg-[#111111]';
};

const isAttentionTask = (task: FleetTaskRecord) => {
  if (task.isBlocked || task.hasCollision || task.isDirty) return true;
  const status = task.status.toLowerCase();
  if (status.includes('block') || status.includes('colli') || status.includes('provision')) return true;
  if (status.includes('exit') || status.includes('destroy')) return true;
  return false;
};

const FleetDashboardModal: React.FC<FleetDashboardModalProps> = ({
  isOpen,
  onClose,
  liveTabs,
  onOpenLiveTask
}) => {
  const [includeClosed, setIncludeClosed] = useState(false);
  const [projectPath, setProjectPath] = useState('');
  const [search, setSearch] = useState('');
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<FleetProjectSummary[]>([]);
  const [tasks, setTasks] = useState<FleetTaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<FleetTaskTimeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const liveTaskIds = useMemo(() => new Set(liveTabs.map(t => t.id)), [liveTabs]);
  const visibleTasks = useMemo(() => {
    if (showAllTasks) return tasks;
    return tasks.filter(isAttentionTask);
  }, [tasks, showAllTasks]);
  const attentionCount = useMemo(() => tasks.filter(isAttentionTask).length, [tasks]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const [projectsRes, tasksRes] = await Promise.all([
      window.electronAPI.fleetListProjects(),
      window.electronAPI.fleetListTasks({
        scope: includeClosed ? 'all' : 'active',
        projectPath: projectPath || undefined,
        search: search.trim() || undefined,
        limit: 500
      })
    ]);

    if (projectsRes.success && Array.isArray(projectsRes.projects)) {
      setProjects(projectsRes.projects as FleetProjectSummary[]);
    } else {
      setProjects([]);
    }

    if (tasksRes.success && Array.isArray(tasksRes.tasks)) {
      const nextTasks = tasksRes.tasks as FleetTaskRecord[];
      setTasks(nextTasks);
      const nextVisible = showAllTasks ? nextTasks : nextTasks.filter(isAttentionTask);
      if (!selectedTaskId && nextVisible.length > 0) {
        setSelectedTaskId(nextVisible[0].taskId);
      }
      if (selectedTaskId && !nextVisible.some(task => task.taskId === selectedTaskId)) {
        setSelectedTaskId(nextVisible[0]?.taskId || null);
      }
    } else {
      setTasks([]);
    }

    setLoading(false);
  }, [includeClosed, projectPath, search, selectedTaskId, showAllTasks]);

  const loadTimeline = useCallback(async (taskId: string) => {
    setTimelineLoading(true);
    const res = await window.electronAPI.fleetGetTaskTimeline(taskId);
    if (res.success && res.timeline) {
      setTimeline(res.timeline as FleetTaskTimeline);
    } else {
      setTimeline(null);
    }
    setTimelineLoading(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadDashboard();
    const intervalId = setInterval(() => {
      void loadDashboard();
    }, 6000);
    return () => {
      clearInterval(intervalId);
    };
  }, [isOpen, loadDashboard]);

  useEffect(() => {
    if (!isOpen || !selectedTaskId) return;
    void loadTimeline(selectedTaskId);
  }, [isOpen, selectedTaskId, loadTimeline]);

  useEffect(() => {
    if (!isOpen) return;
    void loadDashboard();
  }, [isOpen, includeClosed, projectPath, search, loadDashboard]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-[92vw] border border-[#1a1a1a] h-[86vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] font-mono">Fleet</div>
            <h2 className="text-lg text-white font-semibold mt-1 flex items-center">
              <Layers size={18} className="mr-2" />
              Task Monitor
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 rounded text-[11px] uppercase tracking-wider flex items-center">
            <X size={12} className="mr-1.5" />
            close
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[#1a1a1a] grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="app-panel rounded p-2"><div className="text-[#737373]">needs attention</div><div className="text-white">{attentionCount}</div></div>
          <div className="app-panel rounded p-2"><div className="text-[#737373]">visible tasks</div><div className="text-white">{visibleTasks.length}</div></div>
        </div>

        <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center gap-2 flex-wrap">
          <select value={projectPath} onChange={(e) => setProjectPath(e.target.value)} className="input-stealth px-2 py-1 rounded text-xs font-mono max-w-[28rem] truncate">
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.basePath} value={project.basePath}>
                {project.name}
              </option>
            ))}
          </select>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search task or agent"
            className="input-stealth px-2 py-1 rounded text-xs font-mono min-w-[14rem]"
          />

          <button onClick={() => void loadDashboard()} className="btn-ghost px-3 py-1 rounded text-[11px] uppercase tracking-wider">
            refresh
          </button>
          <button
            onClick={() => setShowAllTasks(prev => !prev)}
            className="btn-ghost px-3 py-1 rounded text-[11px] uppercase tracking-wider"
          >
            {showAllTasks ? 'attention only' : 'show all'}
          </button>
          <label className="btn-ghost px-3 py-1 rounded text-[11px] uppercase tracking-wider flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
            />
            include closed
          </label>
          <div className="ml-auto text-[10px] text-[#737373] font-mono">{loading ? 'refreshing' : `${visibleTasks.length} tasks`}</div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="overflow-y-auto p-3 space-y-2">
            {visibleTasks.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-[#71717a] text-xs font-mono text-center">
                <div>{showAllTasks ? 'No tasks for current filters.' : 'No tasks need attention right now.'}</div>
                {!showAllTasks && tasks.length > 0 && (
                  <button onClick={() => setShowAllTasks(true)} className="mt-3 btn-ghost px-3 py-1 rounded text-[11px] uppercase tracking-wider">
                    show all tasks
                  </button>
                )}
              </div>
            )}

            {visibleTasks.map((task) => {
              const isLive = liveTaskIds.has(task.taskId);
              const isSelected = selectedTaskId === task.taskId;
              return (
                <div
                  key={task.taskId}
                  onClick={() => setSelectedTaskId(task.taskId)}
                  className={`rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                    isSelected ? 'border-[#3f3f46] bg-[#101012]' : 'border-[#1f1f1f] bg-[#090909] hover:bg-[#0f0f10]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-white text-sm truncate">{task.name}</div>
                      <div className="text-[10px] text-[#6b7280] font-mono mt-0.5 truncate">
                        {basename(task.basePath)} • {task.agent}
                      </div>
                    </div>
                    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusClass(task.status)}`}>
                      {task.status}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[10px] text-[#71717a] font-mono">
                      updated {formatRelative(task.updatedAt)}
                    </div>
                    {isLive && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenLiveTask(task.taskId);
                          onClose();
                        }}
                        className="btn-primary px-2 py-1 rounded text-[10px] uppercase tracking-wider flex items-center"
                      >
                        <PlayCircle size={11} className="mr-1" />
                        open
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="border-l border-[#1a1a1a] bg-[#070707] p-3 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#a1a1aa] font-mono flex items-center mb-3">
              <Activity size={12} className="mr-2" />
              Details
            </div>

            {!selectedTaskId && <div className="text-[#71717a] text-xs font-mono">Select a task to inspect.</div>}
            {timelineLoading && <div className="text-[#a1a1aa] text-xs font-mono">Loading details...</div>}

            {timeline && timeline.task && !timelineLoading && (
              <div className="space-y-3 text-xs">
                <div className="app-panel rounded p-3">
                  <div className="text-white text-sm">{timeline.task.name}</div>
                  <div className="text-[10px] text-[#71717a] font-mono mt-1">{timeline.task.taskId}</div>
                  <div className="mt-2 text-[10px] text-[#9ca3af] font-mono">{timeline.task.agent}</div>
                  <div className="mt-2">
                    {timeline.task.archived ? (
                      <button
                        onClick={() => {
                          void window.electronAPI.fleetSetArchived(timeline.task!.taskId, false).then(() => loadDashboard());
                        }}
                        className="btn-ghost px-2 py-1 rounded text-[10px] uppercase tracking-wider flex items-center"
                      >
                        <ArchiveRestore size={11} className="mr-1" />
                        restore
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          void window.electronAPI.fleetSetArchived(timeline.task!.taskId, true).then(() => loadDashboard());
                        }}
                        className="btn-ghost px-2 py-1 rounded text-[10px] uppercase tracking-wider flex items-center"
                      >
                        <Archive size={11} className="mr-1" />
                        archive
                      </button>
                    )}
                  </div>
                </div>

                <div className="app-panel rounded p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-mono">Project</div>
                  <div className="text-[#d4d4d8] font-mono break-all">{truncate(timeline.task.basePath, 80)}</div>
                  {timeline.task.worktreePath && (
                    <>
                      <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-mono mt-2 flex items-center">
                        <FolderTree size={11} className="mr-1" />
                        Worktree
                      </div>
                      <div className="text-[#d4d4d8] font-mono break-all">{truncate(timeline.task.worktreePath, 80)}</div>
                    </>
                  )}
                </div>

                <div className="app-panel rounded p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-mono">Latest Session</div>
                  {timeline.sessions[0] ? (
                    <>
                      <div className="text-[#d4d4d8] font-mono">{timeline.sessions[0].status}</div>
                      <div className="text-[#71717a] font-mono">start: {formatDateTime(timeline.sessions[0].startedAt)}</div>
                      <div className="text-[#71717a] font-mono">last: {formatDateTime(timeline.sessions[0].lastActivityAt)}</div>
                      <div className="text-[#71717a] font-mono">end: {formatDateTime(timeline.sessions[0].endedAt)}</div>
                    </>
                  ) : (
                    <div className="text-[#71717a] font-mono">No session records.</div>
                  )}
                </div>

                <div className="app-panel rounded p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-mono mb-2">Recent Events</div>
                  <div className="space-y-1">
                    {timeline.events.slice(0, 8).map((event) => (
                      <div key={event.id} className="text-[10px] font-mono">
                        <span className="text-[#d4d4d8]">{event.eventType}</span>
                        <span className="text-[#71717a]"> • {formatRelative(event.createdAt)}</span>
                      </div>
                    ))}
                    {timeline.events.length === 0 && <div className="text-[#71717a] font-mono text-[10px]">No events.</div>}
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default FleetDashboardModal;
