import React from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';

export interface Todo {
  id: string | number;
  title: string;
  status: 'pending' | 'in_progress' | 'done';
}

interface TodoPanelProps {
  todos: Todo[];
}

const TodoPanel: React.FC<TodoPanelProps> = ({ todos }) => {
  if (!todos || todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Clock size={24} className="text-[#333333] mb-3" />
        <h3 className="text-[11px] font-bold text-[#888888] mb-1 uppercase tracking-[0.15em]">Execution Plan</h3>
        <p className="text-[10px] text-[#525252]">Awaiting agent payload.</p>
      </div>
    );
  }

  const completed = todos.filter(t => t.status === 'done').length;
  const progress = Math.round((completed / todos.length) * 100);

  return (
    <div className="flex flex-col h-full bg-[#050505] overflow-hidden">
      <div className="p-4 border-b border-[#1a1a1a]">
        <h2 className="text-[11px] font-bold text-white mb-3 uppercase tracking-[0.15em] flex items-center">
          Plan
        </h2>
        
        <div className="w-full bg-[#1a1a1a] h-1 mb-2 rounded-full overflow-hidden">
          <div className="bg-white h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
        </div>
        <div className="flex justify-between text-[9px] text-[#888888] font-mono">
          <span>{progress}%</span>
          <span>{completed}/{todos.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {todos.map((todo, idx) => (
          <div 
            key={todo.id || idx} 
            className={`flex items-start p-2.5 rounded-lg border ${
              todo.status === 'done' ? 'bg-[#0a0a0a] border-transparent opacity-50' : 
              todo.status === 'in_progress' ? 'bg-[#121212] border-[#333333]' : 
              'bg-transparent border-[#1a1a1a]'
            }`}
          >
            <div className="mt-0.5 mr-3 flex-shrink-0">
              {todo.status === 'done' ? (
                <CheckCircle2 size={14} className="text-white" />
              ) : todo.status === 'in_progress' ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-[#333333] border-t-white animate-spin"></div>
              ) : (
                <Circle size={14} className="text-[#333333]" />
              )}
            </div>
            <div className={`flex-1 text-[12px] leading-tight ${todo.status === 'done' ? 'text-[#525252] line-through' : 'text-[#e5e5e5]'}`}>
              {todo.title}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TodoPanel;