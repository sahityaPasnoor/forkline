import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft } from 'lucide-react';

interface HandoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (agentCommand: string, prompt: string) => void;
  defaultCommand: string;
  availableAgents: {name: string, command: string, version: string}[];
}

const HandoverModal: React.FC<HandoverModalProps> = ({ isOpen, onClose, onSubmit, defaultCommand, availableAgents }) => {
  const [command, setCommand] = useState(defaultCommand);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (isOpen) {
      const validCommand = availableAgents.some(a => a.command === defaultCommand) 
        ? defaultCommand 
        : (availableAgents[0]?.command || 'claude');
      setCommand(validCommand);
    }
  }, [isOpen, defaultCommand, availableAgents]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(command, prompt);
    setPrompt('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="app-panel rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-[#1a1a1a]">
        <div className="flex justify-between items-center p-4 border-b border-[#1a1a1a] bg-[#050505]">
          <div className="flex items-center space-x-2">
             <ArrowRightLeft className="text-[#a3a3a3]" size={16} />
             <h2 className="text-sm font-bold text-[#e5e5e5] uppercase tracking-widest">Agent Handover</h2>
          </div>
          <button onClick={onClose} className="text-[#525252] hover:text-white transition-colors"><X size={18} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-5 bg-[#000000]">
          <p className="text-xs text-[#888888] mb-2 leading-relaxed">Switch agent in the same worktree. Current session receives `SIGINT` first.</p>
          <div>
            <label className="block text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">New Agent</label>
            <select 
              value={command}
              onChange={e => setCommand(e.target.value)}
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
            <label className="block text-[10px] font-bold text-[#525252] uppercase tracking-[0.2em] mb-2">Instruction</label>
            <textarea 
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Continue the task and state what to do next."
              className="w-full h-24 input-stealth rounded p-3 text-xs"
              required
            />
          </div>

          <div className="pt-2 flex justify-end space-x-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold btn-ghost rounded">Cancel</button>
            <button type="submit" className="px-5 py-2 btn-primary rounded text-xs uppercase tracking-wider flex items-center">
              Handover
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default HandoverModal;
