import React, { useState, useEffect } from 'react';
import Sidebar, { TaskStatus } from './components/Sidebar';
import Terminal from './components/Terminal';
import SettingsModal from './components/SettingsModal';
import DiffViewer from './components/DiffViewer';
import NewTaskModal from './components/NewTaskModal';
import ApprovalModal from './components/ApprovalModal';
import HandoverModal from './components/HandoverModal';
import TodoPanel, { Todo } from './components/TodoPanel';
import { FolderOpen, CheckCircle, AlertCircle, GitMerge, Trash2, Settings, AlertTriangle, ArrowRightLeft, TerminalSquare } from 'lucide-react';

interface TaskTab {
  id: string;
  name: string;
  agent: string;
  basePath: string;
  worktreePath?: string;
  prompt?: string;
  capabilities?: { autoMerge: boolean };
}

function App() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TaskTab[]>([]);
  const [basePath, setBasePath] = useState<string>('');
  const [sourceStatus, setSourceStatus] = useState<{valid: boolean, type?: string, error?: string} | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [isHandoverOpen, setIsHandoverOpen] = useState(false);
  
  // Settings & System State
  const [context, setContext] = useState('');
  const [envVars, setEnvVars] = useState('');
  const [defaultCommand, setDefaultCommand] = useState('claude');
  const [mcpServers, setMcpServers] = useState('');
  const [availableAgents, setAvailableAgents] = useState<{name: string, command: string, version: string}[]>([]);

  // Agent API State
  const [taskTodos, setTaskTodos] = useState<Record<string, Todo[]>>({});
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffTask, setDiffTask] = useState<string | null>(null);
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>({});
  const [collisions, setCollisions] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{ requestId: string, taskId: string, action: string, payload: any } | null>(null);

  useEffect(() => {
    const initApp = async () => {
      const agents = await window.electronAPI.detectAgents();
      setAvailableAgents(agents);
      
      const storeRes = await window.electronAPI.loadStore();
      if (storeRes.success && storeRes.data) {
        setTabs(storeRes.data.tabs || []);
        if (storeRes.data.basePath) {
          setBasePath(storeRes.data.basePath);
          validatePath(storeRes.data.basePath);
        }
        if (storeRes.data.activeTab) setActiveTab(storeRes.data.activeTab);
        if (storeRes.data.context) setContext(storeRes.data.context);
        if (storeRes.data.envVars) setEnvVars(storeRes.data.envVars);
        if (storeRes.data.defaultCommand) setDefaultCommand(storeRes.data.defaultCommand);
        if (storeRes.data.mcpServers) setMcpServers(storeRes.data.mcpServers);
      } else {
        const defaultPath = await window.electronAPI.getDefaultPath();
        setBasePath(defaultPath);
        validatePath(defaultPath);
      }
      setIsLoaded(true);
    };
    initApp();

    if (window.electronAPI.onAgentRequest) {
      window.electronAPI.onAgentRequest((req) => {
        setTabs(currentTabs => {
          const tab = currentTabs.find(t => t.id === req.taskId);
          if (tab) {
            if (req.action === 'merge' && tab.capabilities?.autoMerge) {
              window.electronAPI.respondToAgent(req.requestId, 200, { status: 'approved', message: 'Merge initiated' });
              setTimeout(() => performCloseTask(req.taskId, 'merge', currentTabs), 100);
            } else {
              setPendingApproval(req);
            }
          } else {
            window.electronAPI.respondToAgent(req.requestId, 404, { error: 'Task not found' });
          }
          return currentTabs;
        });
      });
    }

    if (window.electronAPI.onAgentTodos) {
      window.electronAPI.onAgentTodos((req) => {
        if (Array.isArray(req.payload)) {
          setTaskTodos(prev => ({ ...prev, [req.taskId]: req.payload }));
        }
      });
    }

    if (window.electronAPI.onAgentBlocked) {
      window.electronAPI.onAgentBlocked(({taskId, isBlocked}) => {
         setTaskStatuses(prev => ({
           ...prev,
           [taskId]: { ...(prev[taskId] || { isReady: true, isDirty: false, hasCollision: false }), isBlocked }
         }));
      });
    }

    if (window.electronAPI.onGlobalShortcutNewTask) {
       window.electronAPI.onGlobalShortcutNewTask(() => {
         setIsNewTaskOpen(true);
       });
    }

  }, []);

  useEffect(() => {
    if (isLoaded) {
      window.electronAPI.saveStore({ tabs, basePath, activeTab, context, envVars, defaultCommand, mcpServers });
    }
  }, [tabs, basePath, activeTab, context, envVars, defaultCommand, mcpServers, isLoaded]);

  useEffect(() => {
    const checkStatuses = async () => {
      if (tabs.length === 0) {
        setCollisions([]);
        return;
      }

      const activeTabs = tabs.filter(t => t.worktreePath);
      const modifiedFilesMap: Record<string, string[]> = {};
      
      for (const tab of activeTabs) {
        const res = await window.electronAPI.getModifiedFiles(tab.worktreePath!);
        if (res.success && res.files) {
          modifiedFilesMap[tab.id] = res.files;
        }
      }

      const allFiles = new Map<string, string[]>();
      for (const [tabId, files] of Object.entries(modifiedFilesMap)) {
        for (const file of files) {
           const existing = allFiles.get(file) || [];
           existing.push(tabId);
           allFiles.set(file, existing);
        }
      }

      const collidingFiles = [];
      const newCollisionState: Record<string, boolean> = {};
      const newDirtyState: Record<string, boolean> = {};

      for (const [file, tabIds] of Array.from(allFiles.entries())) {
        if (tabIds.length > 1) {
          collidingFiles.push(file);
          tabIds.forEach(id => newCollisionState[id] = true);
        }
      }

      for (const tabId of Object.keys(modifiedFilesMap)) {
         newDirtyState[tabId] = modifiedFilesMap[tabId].length > 0;
      }

      setCollisions(collidingFiles);
      
      setTaskStatuses(prev => {
         const next = { ...prev };
         tabs.forEach(tab => {
            if (!next[tab.id]) {
               next[tab.id] = { isReady: !!tab.worktreePath, isDirty: false, hasCollision: false, isBlocked: false };
            }
            next[tab.id].isReady = !!tab.worktreePath;
            next[tab.id].isDirty = newDirtyState[tab.id] || false;
            next[tab.id].hasCollision = newCollisionState[tab.id] || false;
         });
         return next;
      });
    };

    const intervalId = setInterval(checkStatuses, 3000);
    checkStatuses(); 
    return () => clearInterval(intervalId);
  }, [tabs]);

  const validatePath = async (path: string) => {
    if (!path) {
      setSourceStatus(null);
      return;
    }
    const result = await window.electronAPI.validateSource(path);
    setSourceStatus(result);
  };

  const handleSetBasePath = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBasePath(e.target.value);
    validatePath(e.target.value);
  };

  const handleBrowse = async () => {
    const selectedPath = await window.electronAPI.openDirectoryDialog();
    if (selectedPath) {
      setBasePath(selectedPath);
      validatePath(selectedPath);
    }
  };

  const handleNewTaskSubmit = async (taskName: string, agentCommand: string, prompt: string, capabilities: { autoMerge: boolean }) => {
    const id = Date.now().toString();
    const newTask: TaskTab = { 
      id, 
      name: taskName, 
      agent: agentCommand, 
      basePath,
      prompt,
      capabilities
    };
    
    setTabs([...tabs, newTask]);
    setActiveTab(id);

    try {
       const result = await window.electronAPI.createWorktree(basePath, taskName);
       if (result.success && result.worktreePath) {
           setTabs(prevTabs => prevTabs.map(t => 
             t.id === id ? { ...t, worktreePath: result.worktreePath } : t
           ));
       } else {
           alert("Git Worktree Setup Failed: " + result.error);
       }
    } catch (e: any) {
       alert("Error: " + e.message);
    }
  };

  const performCloseTask = async (id: string, action: 'merge' | 'delete', currentTabs = tabs) => {
    const tabToClose = currentTabs.find(t => t.id === id);
    if (!tabToClose || !tabToClose.worktreePath) return;

    try {
      let res;
      if (action === 'merge') {
        res = await window.electronAPI.mergeWorktree(tabToClose.basePath, tabToClose.name, tabToClose.worktreePath);
      } else {
        res = await window.electronAPI.removeWorktree(tabToClose.basePath, tabToClose.name, tabToClose.worktreePath, true);
      }

      if (res.success) {
        setTabs(prevTabs => prevTabs.filter(t => t.id !== id));
        if (activeTab === id) {
          setActiveTab(currentTabs.length > 1 ? currentTabs[0].id : null);
        }
      } else {
        alert(`Failed to ${action} worktree: ${res.error}`);
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleMergeClick = (id: string) => {
     setDiffTask(id);
     setDiffOpen(true);
  };

  const handleDeleteClick = (id: string) => {
     const confirmed = window.confirm(`Are you sure you want to force delete this worktree without merging?`);
     if (confirmed) performCloseTask(id, 'delete');
  };

  const handleConfirmMerge = () => {
     if (diffTask) performCloseTask(diffTask, 'merge');
  };

  const handleAgentApprove = () => {
    if (pendingApproval) {
      window.electronAPI.respondToAgent(pendingApproval.requestId, 200, { status: 'approved' });
      if (pendingApproval.action === 'merge') {
        performCloseTask(pendingApproval.taskId, 'merge');
      }
      setPendingApproval(null);
    }
  };

  const handleAgentReject = () => {
    if (pendingApproval) {
      window.electronAPI.respondToAgent(pendingApproval.requestId, 403, { error: 'Request denied by user' });
      setPendingApproval(null);
    }
  };

  const handleHandoverSubmit = (command: string, prompt: string) => {
    if (!activeTab) return;
    window.electronAPI.writePty(activeTab, '\x03');
    setTimeout(() => {
      const sanitizedPrompt = prompt.replace(/"/g, '\\"');
      window.electronAPI.writePty(activeTab, `clear && echo "Handover initiated..." && ${command} "${sanitizedPrompt}"\r`);
    }, 500);
    setTabs(tabs.map(t => t.id === activeTab ? { ...t, agent: command } : t));
  };

  return (
    <div className="flex h-screen w-full relative overflow-hidden bg-[#000000]">
      <Sidebar 
        tabs={tabs.map(t => ({id: t.id, name: t.name, agent: t.agent}))} 
        activeTab={activeTab} 
        statuses={taskStatuses}
        onSelectTab={setActiveTab} 
        onNewTask={() => {
           if (!basePath || !sourceStatus?.valid) {
             alert("Please select a valid base project path first.");
             return;
           }
           setIsNewTaskOpen(true);
        }} 
      />
      
      <main className="flex-1 flex flex-col h-full relative z-10 pt-2 pr-2 pb-2">
        {collisions.length > 0 && (
          <div className="absolute top-2 left-0 right-2 h-10 bg-[#1a0505] border border-red-900 rounded-lg flex items-center justify-center z-40 text-xs font-semibold text-red-400 shadow-sm">
            <AlertTriangle size={14} className="mr-2 text-red-500" />
            Collision Detected: Multiple agents modifying ({collisions.join(', ')}).
          </div>
        )}

        <div className={`app-panel rounded-xl h-14 flex items-center justify-between px-4 z-30 ${collisions.length > 0 ? 'mt-12' : ''}`}>
            <div className="flex items-center flex-1">
              {activeTab && tabs.find(t => t.id === activeTab) ? (
                <>
                  <div className="flex items-center space-x-3">
                    <h2 className="text-[13px] font-bold text-white tracking-wide">
                      {tabs.find(t => t.id === activeTab)?.name}
                    </h2>
                  </div>
                  <div className="ml-6 space-x-2 flex">
                    <button onClick={() => setIsHandoverOpen(true)} className="flex items-center text-[11px] font-medium btn-ghost px-2.5 py-1.5 rounded-md" title="Handover Task">
                      <ArrowRightLeft size={12} className="mr-1.5"/> Handover
                    </button>
                    <button onClick={() => handleMergeClick(activeTab)} className="flex items-center text-[11px] font-medium btn-ghost px-2.5 py-1.5 rounded-md text-emerald-400 hover:text-emerald-300" title="Review diff and merge">
                      <GitMerge size={12} className="mr-1.5"/> Merge
                    </button>
                    <button onClick={() => handleDeleteClick(activeTab)} className="flex items-center text-[11px] font-medium btn-ghost px-2.5 py-1.5 rounded-md text-red-400 hover:text-red-300" title="Force delete branch and worktree">
                      <Trash2 size={12} className="mr-1.5"/> Delete
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-[#525252] font-mono uppercase tracking-widest">System Ready</div>
              )}
            </div>

            <div className="flex items-center space-x-4">
                <div className="flex flex-col items-end">
                    <div className="flex items-center input-stealth rounded-md pl-3 pr-1 py-1">
                      <span className="text-[9px] text-[#525252] mr-2 uppercase tracking-[0.2em] font-bold">Workspace</span>
                      <input 
                        type="text" 
                        value={basePath} 
                        onChange={handleSetBasePath}
                        placeholder="/path/to/project"
                        className="bg-transparent text-[#e5e5e5] text-xs w-48 focus:outline-none font-mono placeholder-[#333333]" 
                      />
                      <button 
                        onClick={handleBrowse}
                        className="p-1 rounded hover:bg-[#262626] text-[#888888] hover:text-white transition-colors"
                        title="Browse"
                      >
                        <FolderOpen size={12} />
                      </button>
                    </div>
                </div>
                <button onClick={() => setIsSettingsOpen(true)} className="w-8 h-8 rounded-md btn-ghost flex items-center justify-center" title="Workspace Settings">
                  <Settings size={14} />
                </button>
            </div>
        </div>

        <div className="flex-1 mt-2 relative z-20 flex space-x-2 overflow-hidden">
          {activeTab ? (
            <>
                <div className="flex-1 relative h-full app-panel rounded-xl overflow-hidden">
                  {tabs.map(tab => (
                    <div key={tab.id} className={activeTab === tab.id ? 'h-full flex flex-col p-1 relative z-10 bg-[#000000]' : 'absolute inset-0 opacity-0 pointer-events-none -z-10 flex flex-col p-1'}>
                      {tab.worktreePath ? (
                        <Terminal 
                          taskId={tab.id} 
                          cwd={tab.worktreePath} 
                          agentCommand={tab.agent} 
                          context={context} 
                          envVars={envVars} 
                          prompt={tab.prompt}
                          capabilities={tab.capabilities}
                          mcpServers={mcpServers}
                          isBlocked={taskStatuses[tab.id]?.isBlocked}
                        />
                      ) : (
                        <div className="h-full w-full flex flex-col items-center justify-center font-mono">
                          <div className="mb-3 text-white text-[11px] uppercase tracking-widest">Initializing Environment</div>
                          <div className="text-[#525252] text-[10px]">{tab.name}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                <div className="w-64 flex-shrink-0 h-full hidden lg:block app-panel rounded-xl overflow-hidden">
                  <TodoPanel todos={taskTodos[activeTab] || []} />
                </div>
            </>
          ) : (
            <div className="flex-1 h-full app-panel rounded-xl flex items-center justify-center">
               <div className="text-center">
                 <div className="text-[#262626] mb-4 flex justify-center">
                    <TerminalSquare size={48} strokeWidth={1} />
                 </div>
               </div>
            </div>
          )}
        </div>
      </main>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        context={context} 
        setContext={setContext} 
        envVars={envVars} 
        setEnvVars={setEnvVars} 
        defaultCommand={defaultCommand}
        setDefaultCommand={setDefaultCommand}
        mcpServers={mcpServers}
        setMcpServers={setMcpServers}
        availableAgents={availableAgents}
      />

      {diffOpen && diffTask && (
        <DiffViewer 
          isOpen={diffOpen} 
          onClose={() => setDiffOpen(false)} 
          onConfirm={handleConfirmMerge} 
          worktreePath={tabs.find(t => t.id === diffTask)?.worktreePath || ''} 
        />
      )}

      <NewTaskModal 
        isOpen={isNewTaskOpen}
        onClose={() => setIsNewTaskOpen(false)}
        projectName={basePath.split('/').pop() || 'proj'}
        onSubmit={handleNewTaskSubmit}
        defaultCommand={defaultCommand}
        availableAgents={availableAgents}
      />

      <ApprovalModal 
        isOpen={!!pendingApproval}
        request={pendingApproval}
        taskName={tabs.find(t => t.id === pendingApproval?.taskId)?.name || 'unknown'}
        onApprove={handleAgentApprove}
        onReject={handleAgentReject}
      />

      <HandoverModal
        isOpen={isHandoverOpen}
        onClose={() => setIsHandoverOpen(false)}
        onSubmit={handleHandoverSubmit}
        defaultCommand={defaultCommand}
        availableAgents={availableAgents}
      />
    </div>
  );
}

export default App;