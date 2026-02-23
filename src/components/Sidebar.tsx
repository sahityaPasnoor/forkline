import React from 'react';
import { Plus, TerminalSquare, AlertTriangle, FileEdit, CheckCircle2, Loader2, MessageSquareWarning, Trash2 } from 'lucide-react';
import type { TaskStatus, TaskUsage } from '../models/orchestrator';
import { formatTaskUsage } from '../lib/usageUtils';

interface SidebarProps {
  tabs: {id: string, name: string, agent: string}[];
  activeTab: string | null;
  statuses: Record<string, TaskStatus>;
  usageByTask: Record<string, TaskUsage>;
  width: number;
  onSelectTab: (id: string) => void;
  onNewTask: () => void;
  onDeleteTask: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ tabs, activeTab, statuses, usageByTask, width, onSelectTab, onNewTask, onDeleteTask }) => {
  const compact = width < 250;

  const getStatusLabel = (status: TaskStatus) => {
    if (!status.isReady) return 'Provisioning';
    if (status.isBlocked) return 'Blocked';
    if (status.hasCollision) return 'Collision';
    if (status.isDirty) return 'Dirty';
    return 'Clean';
  };

  return (
    <aside style={{ width }} className="shrink-0 app-panel m-2 mr-0 rounded-xl flex flex-col h-[calc(100vh-1rem)] z-10 overflow-hidden min-w-0">
      <div className={`p-4 border-b border-[#1a1a1a] flex items-center ${compact ? 'justify-center' : 'justify-start'}`}>
        <div className="flex items-center space-x-3">
          <TerminalSquare size={18} className="text-white" />
          {!compact && (
            <h1 className="text-xs font-bold text-white tracking-[0.2em] uppercase">Agent Manager</h1>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {tabs.map(tab => {
          const status = statuses[tab.id] || { isReady: false, isDirty: false, hasCollision: false, isBlocked: false };
          const usage = usageByTask[tab.id];
          const isActive = activeTab === tab.id;
          
          return (
            <div 
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`relative p-3 rounded-lg cursor-pointer flex items-center group transition-all duration-200 ${
                isActive 
                  ? 'bg-[#121212] border border-[#333333]' 
                  : 'bg-transparent border border-transparent hover:bg-[#0a0a0a]'
              }`}
            >
              {/* Active Tab Glow */}
              {isActive && (
                <div className="absolute left-[-1px] top-2 bottom-2 w-[2px] bg-white rounded-r-full shadow-[0_0_8px_rgba(255,255,255,0.8)]"></div>
              )}

              {/* Status Indicator */}
              <div className="relative flex-shrink-0 flex items-center justify-center w-6 h-6">
                {!status.isReady ? (
                  <Loader2 className="text-[#888888] animate-spin" size={14} />
                ) : status.isBlocked ? (
                  <MessageSquareWarning className="text-red-500" size={14} />
                ) : status.hasCollision ? (
                  <AlertTriangle className="text-yellow-500" size={14} />
                ) : status.isDirty ? (
                  <FileEdit className="text-blue-400" size={14} />
                ) : (
                  <CheckCircle2 className="text-emerald-500" size={14} />
                )}
                
                {status.isBlocked && (
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
                )}
              </div>

              {!compact && (
                <div className="ml-3 flex flex-col overflow-hidden flex-1">
                  <div className={`text-[13px] font-medium truncate ${status.isBlocked ? 'text-red-400' : isActive ? 'text-white' : 'text-[#a3a3a3] group-hover:text-white transition-colors'}`}>
                    {tab.name}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <div className="text-[9px] text-[#737373] uppercase tracking-widest font-semibold">{getStatusLabel(status)}</div>
                    {isActive && (
                      <div className="text-[9px] text-[#666666] uppercase tracking-wider font-mono truncate ml-2">
                        {formatTaskUsage(usage)}
                      </div>
                    )}
                  </div>
                  {isActive && (
                    <div className="text-[9px] text-[#525252] uppercase tracking-widest font-mono mt-0.5 truncate">
                      {tab.agent}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTask(tab.id);
                }}
                className={`ml-2 p-1 rounded text-[#525252] hover:text-red-400 hover:bg-[#1a0a0a] transition-all ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                title={`Delete ${tab.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-[#1a1a1a]">
        <button 
          onClick={onNewTask}
          className="w-full flex items-center justify-center p-2.5 rounded-lg btn-primary text-xs uppercase tracking-wider gap-2"
        >
          <Plus size={14} />
          {!compact && <span>Spawn Agent</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
