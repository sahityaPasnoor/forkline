import React from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';

interface ApprovalModalProps {
  isOpen: boolean;
  request: { requestId: string, taskId: string, action: string, payload: any } | null;
  taskName: string;
  projectPath?: string;
  queueCount?: number;
  onApprove: () => void;
  onReject: () => void;
}

const ApprovalModal: React.FC<ApprovalModalProps> = ({ isOpen, request, taskName, projectPath, queueCount, onApprove, onReject }) => {
  if (!isOpen || !request) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="app-panel border border-amber-700 rounded-lg shadow-2xl shadow-amber-900/20 w-full max-w-md overflow-hidden">
        <div className="flex items-center p-4 border-b border-[var(--panel-border)] bg-amber-950/30">
          <ShieldAlert className="text-amber-500 mr-3" size={24} />
          <h2 className="text-lg font-bold text-amber-500">Agent Action Requires Approval</h2>
        </div>
        
        <div className="p-6 bg-[var(--panel-subtle)]">
          <p className="text-sm text-[var(--text-primary)] mb-4">
            Agent on <span className="font-mono text-amber-400">{taskName}</span> requested a restricted action.
          </p>
          {projectPath && (
            <p className="text-xs text-[var(--text-secondary)] mb-4 font-mono break-all">
              Project: <span className="text-[var(--text-primary)]">{projectPath}</span>
            </p>
          )}
          
          <div className="bg-[var(--bg)] border border-[var(--panel-border)] rounded p-4 mb-4 font-mono text-xs">
            <div className="text-[var(--text-tertiary)] uppercase tracking-widest mb-1">Action Requested</div>
            <div className="text-blue-400 text-sm mb-3 font-bold">{request.action.toUpperCase()}</div>
            
            {request.payload && Object.keys(request.payload).length > 0 && (
              <details>
                <summary className="text-[var(--text-secondary)] uppercase tracking-widest cursor-pointer">payload</summary>
                <pre className="text-[var(--text-primary)] whitespace-pre-wrap mt-2">
                  {JSON.stringify(request.payload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>

        <div className="p-4 flex justify-end space-x-3 border-t border-[var(--panel-border)]">
          {typeof queueCount === 'number' && queueCount > 1 && (
            <div className="mr-auto text-[11px] text-[var(--text-secondary)] font-mono self-center">
              queue: {queueCount - 1} more pending
            </div>
          )}
          <button onClick={onReject} className="btn-danger px-4 py-2 text-sm font-medium rounded">
            <X size={16} className="mr-2" /> Deny Request
          </button>
          <button onClick={onApprove} className="btn-warning px-5 py-2 text-sm font-bold rounded shadow-lg shadow-amber-900/20">
            <Check size={16} className="mr-2" /> Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApprovalModal;
