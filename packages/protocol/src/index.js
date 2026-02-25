const Events = {
  TASK_UPDATED: 'task.updated',
  PTY_DATA: 'pty.data',
  PTY_MODE: 'pty.mode',
  APPROVAL_REQUIRED: 'approval.required',
  APPROVAL_RESOLVED: 'approval.resolved'
};

const Routes = {
  HEALTH: '/v1/health',
  VERSION: '/v1/version',
  EVENTS: '/v1/events',
  GIT_VALIDATE: '/v1/git/validate',
  GIT_WORKTREE_CREATE: '/v1/git/worktree/create',
  GIT_WORKTREE_LIST: '/v1/git/worktree/list',
  GIT_BRANCH_LIST: '/v1/git/branches/list',
  GIT_WORKTREE_REMOVE: '/v1/git/worktree/remove',
  GIT_WORKTREE_MERGE: '/v1/git/worktree/merge',
  PTY_CREATE: '/v1/pty/create',
  PTY_ATTACH: '/v1/pty/attach',
  PTY_DETACH: '/v1/pty/detach',
  PTY_WRITE: '/v1/pty/write',
  PTY_RESIZE: '/v1/pty/resize',
  PTY_DESTROY: '/v1/pty/destroy',
  PTY_SESSIONS: '/v1/pty/sessions'
};

const { detectAgentCapabilities, resolveQuickActionPlan } = require('./quick-actions');
const {
  PTY_MODES,
  PTY_MODE_CONFIDENCE,
  SUPPORTED_PROVIDERS,
  detectProviderFromCommand,
  buildAgentWrapperCommand,
  parseForklineMarkers,
  PtySessionStateMachine
} = require('./pty-state-machine');

module.exports = {
  Events,
  Routes,
  detectAgentCapabilities,
  resolveQuickActionPlan,
  PTY_MODES,
  PTY_MODE_CONFIDENCE,
  SUPPORTED_PROVIDERS,
  detectProviderFromCommand,
  buildAgentWrapperCommand,
  parseForklineMarkers,
  PtySessionStateMachine
};
