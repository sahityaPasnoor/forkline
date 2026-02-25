const crypto = require('node:crypto');

const DEFAULT_PORT_BASE = 4100;
const DEFAULT_PORT_SPAN = 4000;

class ResourceAllocator {
  constructor(options = {}) {
    const configuredBase = Number.parseInt(String(options.portBase ?? process.env.FORKLINE_PORT_BASE ?? ''), 10);
    const configuredSpan = Number.parseInt(String(options.portSpan ?? process.env.FORKLINE_PORT_SPAN ?? ''), 10);
    this.portBase = Number.isFinite(configuredBase) && configuredBase > 1024 ? configuredBase : DEFAULT_PORT_BASE;
    this.portSpan = Number.isFinite(configuredSpan) && configuredSpan > 100 ? configuredSpan : DEFAULT_PORT_SPAN;
    this.taskAssignments = new Map();
    this.portsInUse = new Set();
  }

  nextAvailablePort() {
    for (let offset = 0; offset < this.portSpan; offset += 1) {
      const candidate = this.portBase + offset;
      if (this.portsInUse.has(candidate)) continue;
      this.portsInUse.add(candidate);
      return candidate;
    }
    return null;
  }

  allocate(taskId) {
    const existing = this.taskAssignments.get(taskId);
    if (existing) return existing;

    const port = this.nextAvailablePort();
    if (!port) return null;

    const sessionId = crypto.randomUUID();
    const assignment = {
      taskId,
      sessionId,
      port,
      aspNetCoreUrls: `http://127.0.0.1:${port}`,
      host: '127.0.0.1',
      assignedAt: Date.now()
    };
    this.taskAssignments.set(taskId, assignment);
    return assignment;
  }

  release(taskId) {
    const existing = this.taskAssignments.get(taskId);
    if (!existing) return;
    this.portsInUse.delete(existing.port);
    this.taskAssignments.delete(taskId);
  }

  listAssignments() {
    return Array.from(this.taskAssignments.values()).map((assignment) => ({
      taskId: assignment.taskId,
      sessionId: assignment.sessionId,
      port: assignment.port,
      host: assignment.host
    }));
  }
}

module.exports = { ResourceAllocator };
