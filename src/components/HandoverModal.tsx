import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft } from 'lucide-react';
import { defaultHandoverModeForCommand } from '../lib/handoverAdapters';
import type { HandoverMode } from '../models/orchestrator';

interface HandoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (agentCommand: string, prompt: string, mode: HandoverMode) => void | Promise<void>;
  defaultCommand: string;
  availableAgents: {name: string, command: string, version: string}[];
  currentAgent?: string;
  taskName?: string;
  handoverPreview?: string;
}

const HandoverModal: React.FC<HandoverModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultCommand,
  availableAgents,
  currentAgent,
  taskName,
  handoverPreview
}) => {
  const [command, setCommand] = useState(defaultCommand);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<HandoverMode>('clean');

  useEffect(() => {
    if (isOpen) {
      const validCommand = availableAgents.some(a => a.command === defaultCommand) 
        ? defaultCommand 
        : (availableAgents[0]?.command || 'claude');
      setCommand(validCommand);
      setMode(defaultHandoverModeForCommand(validCommand));
    }
  }, [isOpen, defaultCommand, availableAgents]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSubmit(command, prompt, mode);
    setPrompt('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-xl overflow-hidden border border-[#1a1a1a] max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-[#1a1a1a] bg-[#050505]">
          <div className="flex items-center space-x-2">
             <ArrowRightLeft className="text-[#a3a3a3]" size={16} />
             <h2 className="text-sm font-bold text-[#e5e5e5] uppercase tracking-widest">Agent Handover</h2>
          </div>
          <button onClick={onClose} className="btn-ghost btn-icon rounded-md"><X size={18} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-5 bg-[#000000] overflow-y-auto">
          <p className="text-xs text-[#888888] mb-2 leading-relaxed">
            Use handover when the current model is stuck or when you need a different model specialty. The new agent continues in the same worktree with an auto-generated context packet.
          </p>
          <div className="rounded border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-[11px] font-mono text-[#d4d4d8]">
            <div>Task: <span className="text-white">{taskName || 'unknown-task'}</span></div>
            <div>Current agent: <span className="text-white">{currentAgent || 'unknown'}</span></div>
            <div>Context packet: <span className="text-white">branch + modified files + todos + blocked state + usage + objective</span></div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">New Agent</label>
            <select 
              value={command}
              onChange={e => {
                const next = e.target.value;
                setCommand(next);
                setMode(defaultHandoverModeForCommand(next));
              }}
              className="w-full input-stealth rounded py-2 px-3 text-xs font-mono appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23525252%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
            >
              {availableAgents.map(agent => (
                <option key={agent.command} value={agent.command}>
                  {agent.name} {agent.version !== 'unknown' ? `(${agent.version})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">Execution Mode</label>
            <div className="grid gap-2 text-xs">
              <button
                type="button"
                onClick={() => setMode('clean')}
                className={`btn-ghost w-full text-left rounded px-3 py-2 ${
                  mode === 'clean'
                    ? 'border-[var(--input-border-focus)] bg-[var(--panel-strong)] text-[var(--text-primary)]'
                    : 'bg-[#0a0a0a]'
                }`}
              >
                <div className="font-semibold">Clean handover (recommended)</div>
                <div className="text-[11px] mt-1 opacity-80">Restarts the PTY session before launching the next agent. Most reliable when switching providers/TUIs.</div>
              </button>
              <button
                type="button"
                onClick={() => setMode('in_place')}
                className={`btn-ghost w-full text-left rounded px-3 py-2 ${
                  mode === 'in_place'
                    ? 'border-[var(--input-border-focus)] bg-[var(--panel-strong)] text-[var(--text-primary)]'
                    : 'bg-[#0a0a0a]'
                }`}
              >
                <div className="font-semibold">In-place handover</div>
                <div className="text-[11px] mt-1 opacity-80">Keeps the current PTY and interrupts with Ctrl+C before relaunch. Faster, but can inherit terminal state.</div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">Instruction</label>
            <textarea 
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Add any operator instructions for the next agent (these are appended to the handover packet)."
              className="w-full h-24 input-stealth rounded p-3 text-xs"
              required
            />
            {handoverPreview && (
              <div className="mt-2 text-[10px] text-[#737373] font-mono truncate" title={handoverPreview}>
                Preview: {handoverPreview}
              </div>
            )}
          </div>

          <div className="pt-2 flex justify-end space-x-3">
            <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-xs font-bold rounded">Cancel</button>
            <button type="submit" className="btn-primary px-5 py-2 rounded text-xs uppercase tracking-wider">
              Handover
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default HandoverModal;
