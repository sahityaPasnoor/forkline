import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Play, TerminalSquare, AlertTriangle, Send, Code, GitCommit, CheckCircle2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  taskId: string;
  cwd: string;
  agentCommand: string;
  context?: string;
  envVars?: string;
  prompt?: string;
  mcpServers?: string;
  capabilities?: { autoMerge: boolean };
  isBlocked?: boolean;
}

const Terminal: React.FC<TerminalProps> = ({ taskId, cwd, agentCommand, context, envVars, prompt, mcpServers, capabilities, isBlocked }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<XTerm | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const isInitialized = useRef(false);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (!terminalRef.current || isInitialized.current) return;
    
    // Check if the terminal container actually has dimensions before initializing xterm
    const rect = terminalRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
       // Component is mounted but not visible/sized yet, retry in a moment
       const timer = setTimeout(() => {
          // Trigger a re-render to check again
          setInputValue(prev => prev);
       }, 50);
       return () => clearTimeout(timer);
    }

    isInitialized.current = true;

    const term = new XTerm({
      theme: {
        background: '#000000',
        foreground: '#e5e5e5',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
        black: '#262626',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#ffffff',
      },
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.5,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    terminalInstance.current = term;
    fitAddonInstance.current = fitAddon;

    const customEnv: Record<string, string> = {
      MULTI_AGENT_IDE_URL: `http://localhost:34567/api/task/${taskId}`
    };
    
    if (envVars) {
      envVars.split('\n').forEach(line => {
        const [k, v] = line.split('=');
        if (k && v) customEnv[k.trim()] = v.trim();
      });
    }

    window.electronAPI.createPty(taskId, cwd, customEnv);

    term.onData(data => {
      window.electronAPI.writePty(taskId, data);
    });

    window.electronAPI.onPtyData(taskId, (data) => {
      term.write(data);
    });

    const handleResize = () => {
      fitAddon.fit();
      window.electronAPI.resizePty(taskId, term.cols, term.rows);
    };

    window.addEventListener('resize', handleResize);
    
    setTimeout(() => {
       if (context) {
          const sanitizedContext = context.replace(/\n/g, ' ').replace(/"/g, '\\"');
          window.electronAPI.writePty(taskId, `echo "Project Memory Context: ${sanitizedContext}" > .agent_memory.md\r`);
       }

       if (mcpServers && mcpServers.trim() !== '') {
          const b64 = btoa(mcpServers);
          window.electronAPI.writePty(taskId, `echo "${b64}" | base64 -d > mcp.json\r`);
       }

       const apiDoc = `IDE Capabilities API\n--------------------\nYou are running inside the Multi-Agent IDE.\nYou can interact with the IDE by sending POST requests to the local control server.\n\nBase URL: $MULTI_AGENT_IDE_URL\nCurrent Permissions:\n- Merge Request: ${capabilities?.autoMerge ? 'Auto-Approve' : 'Requires Human Approval'}\n\nEndpoints:\n1. POST $MULTI_AGENT_IDE_URL/merge\n2. POST $MULTI_AGENT_IDE_URL/todos\n3. POST $MULTI_AGENT_IDE_URL/message\n`;
       
       window.electronAPI.writePty(taskId, `echo -e "${apiDoc}" > .agent_api.md\r`);
       
       if (prompt) {
          const sanitizedPrompt = prompt.replace(/"/g, '\\"');
          window.electronAPI.writePty(taskId, `clear && echo -e "\\033[1;37m[Orchestrator]\\033[0m Bootstrapping task..." && ${agentCommand} "${sanitizedPrompt}"\r`);
       } else {
          window.electronAPI.writePty(taskId, `clear\r`);
       }

    }, 1000);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.electronAPI.removePtyDataListener(taskId);
      window.electronAPI.destroyPty(taskId);
      term.dispose();
      isInitialized.current = false;
    };
  }, [taskId, cwd, agentCommand, context, envVars, prompt, mcpServers, capabilities]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    window.electronAPI.writePty(taskId, `${inputValue}\r`);
    setInputValue('');
  };

  const executeMacro = (cmd: string) => {
    window.electronAPI.writePty(taskId, `${cmd}\r`);
  };

  const injectAgentCommand = (filePath: string) => {
    if (agentCommand.toLowerCase().includes('aider')) {
      window.electronAPI.writePty(taskId, `/add ${filePath}\r`);
    } else {
       setInputValue(prev => prev ? `${prev} ${filePath}` : `Please analyze this image: ${filePath}`);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const base64 = event.target?.result as string;
            const filename = `img_${Date.now()}.png`;
            const res = await window.electronAPI.saveImage(cwd, base64, filename);
            if (res.success && res.path) {
              injectAgentCommand(res.path);
            }
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  return (
    <div className="w-full h-full flex flex-col relative bg-[#000000] rounded-xl overflow-hidden">
      
      {/* Blocked State Overlay */}
      {isBlocked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#000000]/80 backdrop-blur-md transition-all duration-300">
          <div className="bg-[#0a0a0a] border border-[#333333] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <AlertTriangle size={32} className="text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-white mb-2 tracking-wide">Action Required</h2>
            <p className="text-xs text-[#a3a3a3] mb-6">The agent process has paused and is waiting for your input.</p>
            <div className="flex justify-center space-x-3">
              <button onClick={() => executeMacro('y')} className="flex-1 btn-primary py-2.5 rounded-lg text-sm">Approve (Y)</button>
              <button onClick={() => executeMacro('n')} className="flex-1 btn-ghost border border-[#262626] rounded-lg py-2.5 text-sm">Reject (N)</button>
            </div>
          </div>
        </div>
      )}

      {/* Terminal Viewport */}
      <div className="flex-1 relative overflow-hidden bg-[#000000]">
        <div ref={terminalRef} className="w-full h-full absolute inset-0" />
      </div>

      {/* Action Dock */}
      <div className="p-3 border-t border-[#1a1a1a] bg-[#050505] flex flex-col space-y-3 shrink-0 relative z-30">
        <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar">
          <button onClick={() => executeMacro('git status')} className="btn-ghost px-3 py-1.5 rounded text-[11px] font-mono flex items-center">
            <TerminalSquare size={12} className="mr-2 text-[#525252]" /> status
          </button>
          <button onClick={() => executeMacro('Please run the test suite and fix any errors that occur.')} className="btn-ghost px-3 py-1.5 rounded text-[11px] font-mono flex items-center">
            <Code size={12} className="mr-2 text-[#525252]" /> test & fix
          </button>
          <button onClick={() => executeMacro('Analyze all modified files. Generate a highly verbose and detailed git commit message that outlines every specific task and logic change. Then execute the commit and push.')} className="btn-ghost px-3 py-1.5 rounded text-[11px] font-mono flex items-center">
            <GitCommit size={12} className="mr-2 text-[#525252]" /> verbose commit
          </button>
          <div className="flex-1"></div>
          <button onClick={() => executeMacro('curl -X POST $MULTI_AGENT_IDE_URL/merge')} className="bg-[#121212] hover:bg-[#ffffff] text-white hover:text-black border border-[#333333] hover:border-transparent px-3 py-1.5 rounded text-[11px] font-mono transition-all flex items-center">
            <CheckCircle2 size={12} className="mr-2" /> request_merge
          </button>
        </div>

        <form onSubmit={handleSend} className="relative flex items-center">
          <div className="absolute left-3 text-[#525252]">
             <Play size={14} className="fill-current" />
          </div>
          <input 
            type="text" 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onPaste={handlePaste}
            placeholder="Send command or paste an image..."
            className="w-full input-stealth rounded-lg py-2.5 pl-9 pr-12 text-xs font-mono"
          />
          <button type="submit" className="absolute right-1.5 p-1.5 rounded hover:bg-[#262626] text-[#a3a3a3] hover:text-white transition-colors">
            <Send size={14} />
          </button>
        </form>
      </div>

    </div>
  );
};

export default Terminal;