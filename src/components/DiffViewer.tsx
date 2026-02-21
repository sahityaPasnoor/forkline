import React, { useEffect, useState } from 'react';
import { X, GitMerge } from 'lucide-react';

interface DiffViewerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  worktreePath: string;
}

const DiffViewer: React.FC<DiffViewerProps> = ({ isOpen, onClose, onConfirm, worktreePath }) => {
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      window.electronAPI.getDiff(worktreePath).then((res) => {
        if (res.success && res.diff) {
          setDiff(res.diff);
        } else {
          setDiff('No changes detected, or an error occurred.');
        }
        setLoading(false);
      });
    }
  }, [isOpen, worktreePath]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8">
      <div className="bg-[#0d1117] border border-gray-700 rounded-lg shadow-2xl w-full max-w-5xl flex flex-col h-full">
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-gray-200">Pre-Merge Code Review</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={20} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 bg-[#010409]">
          {loading ? (
            <div className="text-gray-500 text-center mt-10 animate-pulse">Generating Diff...</div>
          ) : (
            <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap">
              {diff || "No changes to merge."}
            </pre>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 flex justify-end space-x-3 bg-gray-900">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={() => { onClose(); onConfirm(); }} className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded flex items-center">
            <GitMerge size={16} className="mr-2" /> Approve & Merge
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;