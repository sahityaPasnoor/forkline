import fs from 'fs';
import path from 'path';

type SqlPrimitive = string | number | null;

interface SqlStatement {
  bind: (params?: SqlPrimitive[] | Record<string, SqlPrimitive>) => boolean;
  step: () => boolean;
  getAsObject: (params?: SqlPrimitive[] | Record<string, SqlPrimitive>) => Record<string, unknown>;
  free: () => void;
}

interface SqlDatabase {
  run: (sql: string, params?: SqlPrimitive[] | Record<string, SqlPrimitive>) => void;
  prepare: (sql: string) => SqlStatement;
  export: () => Uint8Array;
  close: () => void;
}

interface SqlModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

const initSqlJs = require('sql.js') as (config: { locateFile: (file: string) => string }) => Promise<SqlModule>;

export interface FleetTaskPayload {
  taskId: string;
  runtimeTaskId?: string;
  basePath: string;
  worktreePath?: string;
  name: string;
  agent: string;
  prompt?: string;
  parentTaskId?: string;
  status?: string;
  isReady?: boolean;
  isDirty?: boolean;
  hasCollision?: boolean;
  isBlocked?: boolean;
  blockedReason?: string;
  usage?: {
    contextTokens?: number;
    contextWindow?: number;
    totalTokens?: number;
    percentUsed?: number;
  };
}

export interface FleetListTasksOptions {
  scope?: 'active' | 'closed' | 'archived' | 'all';
  projectPath?: string;
  search?: string;
  limit?: number;
}

const toInt = (value?: boolean) => (value ? 1 : 0);
const toNumber = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const TRANSCRIPT_ROW_LIMIT_PER_TASK = 5000;
const TRANSCRIPT_CONTENT_LIMIT = 4000;

export class FleetStore {
  private db: SqlDatabase | null = null;
  private dbFilePath: string;
  private persistTimer: NodeJS.Timeout | null = null;
  private runtimeTaskToCanonicalTask = new Map<string, string>();
  private runtimeTaskToSession = new Map<string, number>();
  private lastActivityFlushAt = new Map<string, number>();

  constructor(dbFilePath: string) {
    this.dbFilePath = dbFilePath;
  }

  public async init() {
    if (this.db) return;

    const sql = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`)
    });

    const initialBytes = fs.existsSync(this.dbFilePath)
      ? new Uint8Array(fs.readFileSync(this.dbFilePath))
      : undefined;

    this.db = new sql.Database(initialBytes);
    this.migrate();
    this.persistNow();
  }

  public close() {
    if (!this.db) return;
    this.persistNow();
    this.db.close();
    this.db = null;
  }

  public trackTask(payload: FleetTaskPayload) {
    const db = this.requireDb();
    const now = Date.now();
    const canonicalTaskId = payload.taskId.trim();
    const runtimeTaskId = (payload.runtimeTaskId || canonicalTaskId).trim();
    const basePath = payload.basePath.trim();
    if (!canonicalTaskId || !basePath) return;

    this.runtimeTaskToCanonicalTask.set(runtimeTaskId, canonicalTaskId);
    this.ensureProject(basePath, now);

    const existing = this.queryOne('SELECT task_id, created_at, closed_at, archived FROM tasks WHERE task_id = ?', [canonicalTaskId]);
    const createdAt = toNumber(existing?.created_at, now);
    const shouldReopen = existing && existing.closed_at != null;
    const persistedClosedAt = typeof existing?.closed_at === 'number' ? existing.closed_at : null;

    const derivedStatus = payload.status
      || (payload.isBlocked ? 'blocked' : 'running');

    const contextTokens = payload.usage?.contextTokens;
    const contextWindow = payload.usage?.contextWindow;
    const totalTokens = payload.usage?.totalTokens;
    const percentUsed = payload.usage?.percentUsed;

    if (existing) {
      db.run(
        `UPDATE tasks
         SET runtime_task_id = ?,
             base_path = ?,
             worktree_path = ?,
             task_name = ?,
             agent = ?,
             prompt = ?,
             parent_task_id = ?,
             status = ?,
             is_ready = ?,
             is_dirty = ?,
             has_collision = ?,
             is_blocked = ?,
             blocked_reason = ?,
             context_tokens = ?,
             context_window = ?,
             total_tokens = ?,
             percent_used = ?,
             updated_at = ?,
             closed_at = ?,
             close_action = ?,
             archived = ?,
             last_activity_at = COALESCE(last_activity_at, ?)
         WHERE task_id = ?`,
        [
          runtimeTaskId,
          basePath,
          payload.worktreePath || null,
          payload.name,
          payload.agent,
          payload.prompt || null,
          payload.parentTaskId || null,
          derivedStatus,
          toInt(payload.isReady),
          toInt(payload.isDirty),
          toInt(payload.hasCollision),
          toInt(payload.isBlocked),
          payload.blockedReason || null,
          typeof contextTokens === 'number' ? contextTokens : null,
          typeof contextWindow === 'number' ? contextWindow : null,
          typeof totalTokens === 'number' ? totalTokens : null,
          typeof percentUsed === 'number' ? percentUsed : null,
          now,
          shouldReopen ? null : persistedClosedAt,
          shouldReopen ? null : null,
          shouldReopen ? 0 : toNumber(existing.archived, 0),
          now,
          canonicalTaskId
        ]
      );
    } else {
      db.run(
        `INSERT INTO tasks (
           task_id, runtime_task_id, base_path, worktree_path, task_name, agent, prompt, parent_task_id,
           status, is_ready, is_dirty, has_collision, is_blocked, blocked_reason,
           context_tokens, context_window, total_tokens, percent_used,
           created_at, updated_at, last_activity_at, archived
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          canonicalTaskId,
          runtimeTaskId,
          basePath,
          payload.worktreePath || null,
          payload.name,
          payload.agent,
          payload.prompt || null,
          payload.parentTaskId || null,
          derivedStatus,
          toInt(payload.isReady),
          toInt(payload.isDirty),
          toInt(payload.hasCollision),
          toInt(payload.isBlocked),
          payload.blockedReason || null,
          typeof contextTokens === 'number' ? contextTokens : null,
          typeof contextWindow === 'number' ? contextWindow : null,
          typeof totalTokens === 'number' ? totalTokens : null,
          typeof percentUsed === 'number' ? percentUsed : null,
          createdAt,
          now,
          now
        ]
      );
      this.recordEventInternal(canonicalTaskId, 'task_tracked', { basePath, worktreePath: payload.worktreePath || null, agent: payload.agent }, now);
    }

    this.schedulePersist();
  }

  public markTaskClosed(taskId: string, closeAction: string) {
    const canonicalTaskId = this.resolveTaskId(taskId);
    if (!canonicalTaskId) return;
    const db = this.requireDb();
    const now = Date.now();

    db.run(
      `UPDATE tasks
       SET status = 'closed',
           closed_at = ?,
           close_action = ?,
           archived = 0,
           updated_at = ?,
           is_blocked = 0,
           blocked_reason = NULL
       WHERE task_id = ?`,
      [now, closeAction, now, canonicalTaskId]
    );
    db.run(
      `UPDATE task_sessions
       SET ended_at = COALESCE(ended_at, ?),
           status = CASE WHEN status = 'running' THEN 'closed_by_user' ELSE status END
       WHERE task_id = ?`,
      [now, canonicalTaskId]
    );

    this.recordEventInternal(canonicalTaskId, 'task_closed', { closeAction }, now);
    this.schedulePersist();
  }

  public setTaskArchived(taskId: string, archived: boolean) {
    const canonicalTaskId = this.resolveTaskId(taskId);
    if (!canonicalTaskId) return;
    const db = this.requireDb();
    const now = Date.now();

    db.run(
      `UPDATE tasks
       SET archived = ?, updated_at = ?
       WHERE task_id = ?`,
      [archived ? 1 : 0, now, canonicalTaskId]
    );
    this.recordEventInternal(canonicalTaskId, archived ? 'task_archived' : 'task_unarchived', {}, now);
    this.schedulePersist();
  }

  public recordTaskEvent(taskId: string, eventType: string, payload: Record<string, unknown> = {}) {
    const canonicalTaskId = this.resolveTaskId(taskId);
    if (!canonicalTaskId) return;
    const now = Date.now();
    this.recordEventInternal(canonicalTaskId, eventType, payload, now);
    if (eventType.startsWith('approval_') || eventType.startsWith('agent_') || eventType === 'blocked_prompt_response') {
      this.appendTranscript(
        canonicalTaskId,
        'agent',
        JSON.stringify({ eventType, payload: payload || {}, createdAt: now })
      );
    }
    this.schedulePersist();
  }

  public onPtySessionStarted(runtimeTaskId: string, cwd: string) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId) || runtimeTaskId;
    const db = this.requireDb();
    const now = Date.now();

    this.ensureTaskRowForRuntime(canonicalTaskId, runtimeTaskId, cwd, now);
    db.run(
      `INSERT INTO task_sessions (
         task_id, runtime_task_id, cwd, started_at, last_activity_at, status
       ) VALUES (?, ?, ?, ?, ?, 'running')`,
      [canonicalTaskId, runtimeTaskId, cwd || null, now, now]
    );

    const row = this.queryOne('SELECT last_insert_rowid() AS id');
    const sessionId = toNumber(row?.id, 0);
    if (sessionId > 0) {
      this.runtimeTaskToSession.set(runtimeTaskId, sessionId);
    }

    db.run(
      `UPDATE tasks
       SET status = 'running', updated_at = ?, last_activity_at = ?, runtime_task_id = ?
       WHERE task_id = ?`,
      [now, now, runtimeTaskId, canonicalTaskId]
    );
    this.recordEventInternal(canonicalTaskId, 'session_started', { runtimeTaskId, cwd }, now);
    this.schedulePersist();
  }

  public onPtySessionActivity(runtimeTaskId: string) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId);
    if (!canonicalTaskId) return;
    const now = Date.now();
    const last = this.lastActivityFlushAt.get(runtimeTaskId) || 0;
    if (now - last < 2000) return;
    this.lastActivityFlushAt.set(runtimeTaskId, now);

    const db = this.requireDb();
    const sessionId = this.runtimeTaskToSession.get(runtimeTaskId);
    if (sessionId) {
      db.run('UPDATE task_sessions SET last_activity_at = ? WHERE id = ?', [now, sessionId]);
    } else {
      db.run(
        `UPDATE task_sessions
         SET last_activity_at = ?
         WHERE id = (
           SELECT id FROM task_sessions
           WHERE runtime_task_id = ? AND ended_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
         )`,
        [now, runtimeTaskId]
      );
    }
    db.run(
      `UPDATE tasks
       SET last_activity_at = ?, updated_at = ?, status = CASE WHEN closed_at IS NULL THEN 'running' ELSE status END
       WHERE task_id = ?`,
      [now, now, canonicalTaskId]
    );
    this.schedulePersist();
  }

  public onPtySessionData(runtimeTaskId: string, data: string) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId);
    if (!canonicalTaskId || typeof data !== 'string' || !data.trim()) return;
    this.appendTranscript(canonicalTaskId, 'pty_out', data);
  }

  public onPtySessionInput(runtimeTaskId: string, data: string) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId);
    if (!canonicalTaskId || typeof data !== 'string' || !data.trim()) return;
    this.appendTranscript(canonicalTaskId, 'pty_in', data);
  }

  public onPtySessionBlocked(runtimeTaskId: string, isBlocked: boolean, reason?: string) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId);
    if (!canonicalTaskId) return;
    const db = this.requireDb();
    const now = Date.now();

    db.run(
      `UPDATE tasks
       SET is_blocked = ?,
           blocked_reason = ?,
           status = CASE
             WHEN closed_at IS NOT NULL THEN status
             WHEN ? = 1 THEN 'blocked'
             ELSE 'running'
           END,
           updated_at = ?
       WHERE task_id = ?`,
      [isBlocked ? 1 : 0, isBlocked ? (reason || null) : null, isBlocked ? 1 : 0, now, canonicalTaskId]
    );
    this.recordEventInternal(canonicalTaskId, isBlocked ? 'blocked' : 'unblocked', { reason: reason || null }, now);
    this.schedulePersist();
  }

  public onPtySessionMode(
    runtimeTaskId: string,
    mode: string,
    modeSeq: number,
    confidence?: string,
    source?: string,
    provider?: string,
    isBlocked?: boolean,
    blockedReason?: string
  ) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId);
    if (!canonicalTaskId) return;
    const now = Date.now();
    this.recordEventInternal(canonicalTaskId, 'pty_mode', {
      runtimeTaskId,
      mode: mode || 'unknown',
      modeSeq: Number.isFinite(modeSeq) ? modeSeq : 0,
      confidence: confidence || null,
      source: source || null,
      provider: provider || null,
      isBlocked: !!isBlocked,
      blockedReason: blockedReason || null
    }, now);
    this.schedulePersist();
  }

  public onPtySessionExited(runtimeTaskId: string, exitCode: number | null, signal?: number) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId);
    if (!canonicalTaskId) return;
    const db = this.requireDb();
    const now = Date.now();

    const sessionId = this.runtimeTaskToSession.get(runtimeTaskId);
    if (sessionId) {
      db.run(
        `UPDATE task_sessions
         SET ended_at = ?, exit_code = ?, signal = ?, status = 'exited', last_activity_at = ?
         WHERE id = ?`,
        [now, exitCode ?? null, signal ?? null, now, sessionId]
      );
      this.runtimeTaskToSession.delete(runtimeTaskId);
    } else {
      db.run(
        `UPDATE task_sessions
         SET ended_at = COALESCE(ended_at, ?),
             exit_code = ?,
             signal = ?,
             status = CASE WHEN status = 'running' THEN 'exited' ELSE status END,
             last_activity_at = ?
         WHERE runtime_task_id = ?`,
        [now, exitCode ?? null, signal ?? null, now, runtimeTaskId]
      );
    }

    db.run(
      `UPDATE tasks
       SET status = CASE WHEN closed_at IS NULL THEN 'exited' ELSE status END,
           is_blocked = 0,
           blocked_reason = NULL,
           last_exit_code = ?,
           last_exit_signal = ?,
           updated_at = ?,
           last_activity_at = ?
       WHERE task_id = ?`,
      [exitCode ?? null, signal ?? null, now, now, canonicalTaskId]
    );

    this.recordEventInternal(canonicalTaskId, 'session_exited', { runtimeTaskId, exitCode, signal: signal ?? null }, now);
    this.schedulePersist();
  }

  public onPtySessionDestroyed(runtimeTaskId: string) {
    const canonicalTaskId = this.resolveTaskId(runtimeTaskId);
    if (!canonicalTaskId) return;
    const now = Date.now();
    const db = this.requireDb();

    const sessionId = this.runtimeTaskToSession.get(runtimeTaskId);
    if (sessionId) {
      db.run(
        `UPDATE task_sessions
         SET ended_at = COALESCE(ended_at, ?),
             status = CASE WHEN status = 'running' THEN 'destroyed' ELSE status END
         WHERE id = ?`,
        [now, sessionId]
      );
      this.runtimeTaskToSession.delete(runtimeTaskId);
    }

    db.run(
      `UPDATE tasks
       SET status = CASE WHEN closed_at IS NULL THEN 'destroyed' ELSE status END,
           updated_at = ?
       WHERE task_id = ?`,
      [now, canonicalTaskId]
    );
    this.recordEventInternal(canonicalTaskId, 'session_destroyed', { runtimeTaskId }, now);
    this.schedulePersist();
  }

  public listOverview() {
    const row = this.queryOne(
      `SELECT
         COUNT(*) AS totalTasks,
         SUM(CASE WHEN archived = 0 AND closed_at IS NULL THEN 1 ELSE 0 END) AS activeTasks,
         SUM(CASE WHEN archived = 0 AND closed_at IS NOT NULL THEN 1 ELSE 0 END) AS closedTasks,
         SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) AS archivedTasks,
         SUM(CASE WHEN is_blocked = 1 AND archived = 0 AND closed_at IS NULL THEN 1 ELSE 0 END) AS blockedTasks,
         SUM(CASE WHEN has_collision = 1 AND archived = 0 AND closed_at IS NULL THEN 1 ELSE 0 END) AS collidingTasks,
         SUM(CASE WHEN is_dirty = 1 AND archived = 0 AND closed_at IS NULL THEN 1 ELSE 0 END) AS dirtyTasks
       FROM tasks`
    );
    const projectCountRow = this.queryOne('SELECT COUNT(*) AS projectCount FROM projects');
    return {
      totalTasks: toNumber(row?.totalTasks, 0),
      activeTasks: toNumber(row?.activeTasks, 0),
      closedTasks: toNumber(row?.closedTasks, 0),
      archivedTasks: toNumber(row?.archivedTasks, 0),
      blockedTasks: toNumber(row?.blockedTasks, 0),
      collidingTasks: toNumber(row?.collidingTasks, 0),
      dirtyTasks: toNumber(row?.dirtyTasks, 0),
      projectCount: toNumber(projectCountRow?.projectCount, 0)
    };
  }

  public listProjects() {
    return this.queryAll(
      `SELECT
         p.base_path AS basePath,
         p.name AS name,
         p.updated_at AS updatedAt,
         COUNT(t.task_id) AS totalTasks,
         SUM(CASE WHEN t.archived = 0 AND t.closed_at IS NULL THEN 1 ELSE 0 END) AS activeTasks,
         SUM(CASE WHEN t.archived = 0 AND t.closed_at IS NOT NULL THEN 1 ELSE 0 END) AS closedTasks,
         SUM(CASE WHEN t.archived = 1 THEN 1 ELSE 0 END) AS archivedTasks
       FROM projects p
       LEFT JOIN tasks t ON t.base_path = p.base_path
       GROUP BY p.base_path, p.name, p.updated_at
       ORDER BY p.updated_at DESC`
    ).map((row) => ({
      basePath: String(row.basePath || ''),
      name: String(row.name || ''),
      updatedAt: toNumber(row.updatedAt, 0),
      totalTasks: toNumber(row.totalTasks, 0),
      activeTasks: toNumber(row.activeTasks, 0),
      closedTasks: toNumber(row.closedTasks, 0),
      archivedTasks: toNumber(row.archivedTasks, 0)
    }));
  }

  public removeProject(basePath: string) {
    const normalizedBasePath = String(basePath || '').trim();
    if (!normalizedBasePath) {
      return { removedProject: false, removedTasks: 0 };
    }

    const db = this.requireDb();
    const existingProject = this.queryOne('SELECT base_path AS basePath FROM projects WHERE base_path = ?', [normalizedBasePath]);
    const taskRows = this.queryAll(
      'SELECT task_id AS taskId FROM tasks WHERE base_path = ?',
      [normalizedBasePath]
    );
    const taskIds = Array.from(new Set(taskRows
      .map((row) => (typeof row.taskId === 'string' ? row.taskId.trim() : ''))
      .filter(Boolean)));

    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => '?').join(', ');
      db.run(`DELETE FROM task_transcript WHERE task_id IN (${placeholders})`, taskIds);
      db.run(`DELETE FROM task_events WHERE task_id IN (${placeholders})`, taskIds);
      db.run(`DELETE FROM task_sessions WHERE task_id IN (${placeholders})`, taskIds);
      db.run(`DELETE FROM tasks WHERE task_id IN (${placeholders})`, taskIds);

      const removedTaskSet = new Set(taskIds);
      for (const [runtimeTaskId, canonicalTaskId] of this.runtimeTaskToCanonicalTask.entries()) {
        if (!removedTaskSet.has(runtimeTaskId) && !removedTaskSet.has(canonicalTaskId)) continue;
        this.runtimeTaskToCanonicalTask.delete(runtimeTaskId);
        this.runtimeTaskToSession.delete(runtimeTaskId);
        this.lastActivityFlushAt.delete(runtimeTaskId);
      }
    }

    db.run('DELETE FROM projects WHERE base_path = ?', [normalizedBasePath]);
    this.schedulePersist();
    return { removedProject: !!existingProject, removedTasks: taskIds.length };
  }

  public listTasks(options: FleetListTasksOptions = {}) {
    const params: SqlPrimitive[] = [];
    const where: string[] = [];

    if (options.scope === 'active') where.push('t.archived = 0 AND t.closed_at IS NULL');
    if (options.scope === 'closed') where.push('t.archived = 0 AND t.closed_at IS NOT NULL');
    if (options.scope === 'archived') where.push('t.archived = 1');

    if (options.projectPath) {
      where.push('t.base_path = ?');
      params.push(options.projectPath);
    }

    if (options.search) {
      const like = `%${options.search.toLowerCase()}%`;
      where.push('(LOWER(t.task_name) LIKE ? OR LOWER(t.agent) LIKE ? OR LOWER(COALESCE(t.worktree_path, \'\')) LIKE ?)');
      params.push(like, like, like);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.max(10, Math.min(2000, options.limit || 500));
    params.push(limit);

    return this.queryAll(
      `SELECT
         t.task_id AS taskId,
         t.runtime_task_id AS runtimeTaskId,
         t.base_path AS basePath,
         t.worktree_path AS worktreePath,
         t.task_name AS name,
         t.agent AS agent,
         t.prompt AS prompt,
         t.parent_task_id AS parentTaskId,
         t.status AS status,
         t.is_ready AS isReady,
         t.is_dirty AS isDirty,
         t.has_collision AS hasCollision,
         t.is_blocked AS isBlocked,
         t.blocked_reason AS blockedReason,
         t.context_tokens AS contextTokens,
         t.context_window AS contextWindow,
         t.total_tokens AS totalTokens,
         t.percent_used AS percentUsed,
         t.created_at AS createdAt,
         t.updated_at AS updatedAt,
         t.last_activity_at AS lastActivityAt,
         t.closed_at AS closedAt,
         t.close_action AS closeAction,
         t.archived AS archived,
         t.last_exit_code AS lastExitCode,
         t.last_exit_signal AS lastExitSignal,
         (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.task_id) AS eventCount,
         (SELECT COUNT(*) FROM task_sessions s WHERE s.task_id = t.task_id) AS sessionCount
       FROM tasks t
       ${whereSql}
       ORDER BY t.updated_at DESC
       LIMIT ?`,
      params
    ).map((row) => ({
      taskId: String(row.taskId || ''),
      runtimeTaskId: row.runtimeTaskId ? String(row.runtimeTaskId) : undefined,
      basePath: String(row.basePath || ''),
      worktreePath: row.worktreePath ? String(row.worktreePath) : undefined,
      name: String(row.name || ''),
      agent: String(row.agent || ''),
      prompt: row.prompt ? String(row.prompt) : undefined,
      parentTaskId: row.parentTaskId ? String(row.parentTaskId) : undefined,
      status: String(row.status || 'unknown'),
      isReady: toNumber(row.isReady, 0) === 1,
      isDirty: toNumber(row.isDirty, 0) === 1,
      hasCollision: toNumber(row.hasCollision, 0) === 1,
      isBlocked: toNumber(row.isBlocked, 0) === 1,
      blockedReason: row.blockedReason ? String(row.blockedReason) : undefined,
      contextTokens: typeof row.contextTokens === 'number' ? row.contextTokens : undefined,
      contextWindow: typeof row.contextWindow === 'number' ? row.contextWindow : undefined,
      totalTokens: typeof row.totalTokens === 'number' ? row.totalTokens : undefined,
      percentUsed: typeof row.percentUsed === 'number' ? row.percentUsed : undefined,
      createdAt: toNumber(row.createdAt, 0),
      updatedAt: toNumber(row.updatedAt, 0),
      lastActivityAt: typeof row.lastActivityAt === 'number' ? row.lastActivityAt : undefined,
      closedAt: typeof row.closedAt === 'number' ? row.closedAt : undefined,
      closeAction: row.closeAction ? String(row.closeAction) : undefined,
      archived: toNumber(row.archived, 0) === 1,
      lastExitCode: typeof row.lastExitCode === 'number' ? row.lastExitCode : undefined,
      lastExitSignal: typeof row.lastExitSignal === 'number' ? row.lastExitSignal : undefined,
      eventCount: toNumber(row.eventCount, 0),
      sessionCount: toNumber(row.sessionCount, 0)
    }));
  }

  public getTaskTimeline(taskId: string) {
    const canonicalTaskId = this.resolveTaskId(taskId) || taskId;
    const task = this.queryOne(
      `SELECT
         task_id AS taskId,
         base_path AS basePath,
         worktree_path AS worktreePath,
         task_name AS name,
         agent AS agent,
         status AS status,
         created_at AS createdAt,
         updated_at AS updatedAt,
         closed_at AS closedAt,
         close_action AS closeAction,
         archived AS archived
       FROM tasks
       WHERE task_id = ?`,
      [canonicalTaskId]
    );

    const sessions = this.queryAll(
      `SELECT
         id, runtime_task_id AS runtimeTaskId, cwd, started_at AS startedAt, last_activity_at AS lastActivityAt,
         ended_at AS endedAt, exit_code AS exitCode, signal, status
       FROM task_sessions
       WHERE task_id = ?
       ORDER BY started_at DESC
       LIMIT 200`,
      [canonicalTaskId]
    ).map((row) => ({
      id: toNumber(row.id, 0),
      runtimeTaskId: row.runtimeTaskId ? String(row.runtimeTaskId) : '',
      cwd: row.cwd ? String(row.cwd) : '',
      startedAt: toNumber(row.startedAt, 0),
      lastActivityAt: toNumber(row.lastActivityAt, 0),
      endedAt: typeof row.endedAt === 'number' ? row.endedAt : undefined,
      exitCode: typeof row.exitCode === 'number' ? row.exitCode : undefined,
      signal: typeof row.signal === 'number' ? row.signal : undefined,
      status: String(row.status || 'unknown')
    }));

    const events = this.queryAll(
      `SELECT id, event_type AS eventType, payload_json AS payloadJson, created_at AS createdAt
       FROM task_events
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT 500`,
      [canonicalTaskId]
    ).map((row) => {
      let payload: Record<string, unknown> | null = null;
      if (typeof row.payloadJson === 'string' && row.payloadJson.length > 0) {
        try {
          payload = JSON.parse(row.payloadJson);
        } catch {
          payload = { raw: row.payloadJson };
        }
      }
      return {
        id: toNumber(row.id, 0),
        eventType: String(row.eventType || 'event'),
        payload,
        createdAt: toNumber(row.createdAt, 0)
      };
    });

    const transcript = this.queryAll(
      `SELECT id, stream, content, created_at AS createdAt
       FROM task_transcript
       WHERE task_id = ?
       ORDER BY id ASC
       LIMIT 2000`,
      [canonicalTaskId]
    ).map((row) => ({
      id: toNumber(row.id, 0),
      stream: String(row.stream || 'pty_out') as 'pty_in' | 'pty_out' | 'agent',
      content: typeof row.content === 'string' ? row.content : '',
      createdAt: toNumber(row.createdAt, 0)
    }));

    return {
      task: task
        ? {
            taskId: String(task.taskId || ''),
            basePath: String(task.basePath || ''),
            worktreePath: task.worktreePath ? String(task.worktreePath) : undefined,
            name: String(task.name || ''),
            agent: String(task.agent || ''),
            status: String(task.status || 'unknown'),
            createdAt: toNumber(task.createdAt, 0),
            updatedAt: toNumber(task.updatedAt, 0),
            closedAt: typeof task.closedAt === 'number' ? task.closedAt : undefined,
            closeAction: task.closeAction ? String(task.closeAction) : undefined,
            archived: toNumber(task.archived, 0) === 1
          }
        : null,
      sessions,
      events,
      transcript
    };
  }

  private requireDb() {
    if (!this.db) {
      throw new Error('FleetStore is not initialized');
    }
    return this.db;
  }

  private resolveTaskId(runtimeTaskId: string) {
    const trimmed = runtimeTaskId.trim();
    if (!trimmed) return null;
    return this.runtimeTaskToCanonicalTask.get(trimmed) || trimmed;
  }

  private ensureProject(basePath: string, now: number) {
    const db = this.requireDb();
    const existing = this.queryOne('SELECT base_path FROM projects WHERE base_path = ?', [basePath]);
    if (existing) {
      db.run('UPDATE projects SET updated_at = ? WHERE base_path = ?', [now, basePath]);
      return;
    }
    db.run(
      'INSERT INTO projects (base_path, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [basePath, path.basename(basePath) || basePath, now, now]
    );
  }

  private ensureTaskRowForRuntime(taskId: string, runtimeTaskId: string, cwd: string, now: number) {
    const existing = this.queryOne('SELECT task_id FROM tasks WHERE task_id = ?', [taskId]);
    if (existing) return;
    const basePath = cwd || process.cwd();
    this.ensureProject(basePath, now);
    this.requireDb().run(
      `INSERT INTO tasks (
         task_id, runtime_task_id, base_path, worktree_path, task_name, agent, status,
         is_ready, is_dirty, has_collision, is_blocked, created_at, updated_at, last_activity_at, archived
       ) VALUES (?, ?, ?, ?, ?, ?, 'running', 1, 0, 0, 0, ?, ?, ?, 0)`,
      [taskId, runtimeTaskId, basePath, cwd || null, path.basename(cwd || taskId) || taskId, 'unknown', now, now, now]
    );
    this.recordEventInternal(taskId, 'task_bootstrapped_from_runtime', { cwd }, now);
  }

  private recordEventInternal(taskId: string, eventType: string, payload: Record<string, unknown>, now: number) {
    this.requireDb().run(
      'INSERT INTO task_events (task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)',
      [taskId, eventType, JSON.stringify(payload || {}), now]
    );
  }

  private appendTranscript(taskId: string, stream: 'pty_in' | 'pty_out' | 'agent', content: string) {
    const db = this.requireDb();
    const now = Date.now();
    const normalizedContent = content.slice(0, TRANSCRIPT_CONTENT_LIMIT);
    db.run(
      'INSERT INTO task_transcript (task_id, stream, content, created_at) VALUES (?, ?, ?, ?)',
      [taskId, stream, normalizedContent, now]
    );
    db.run(
      `DELETE FROM task_transcript
       WHERE task_id = ?
         AND id NOT IN (
           SELECT id FROM task_transcript
           WHERE task_id = ?
           ORDER BY id DESC
           LIMIT ?
         )`,
      [taskId, taskId, TRANSCRIPT_ROW_LIMIT_PER_TASK]
    );
    this.schedulePersist();
  }

  private queryOne(sql: string, params: SqlPrimitive[] = []) {
    const rows = this.queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  private queryAll(sql: string, params: SqlPrimitive[] = []) {
    const db = this.requireDb();
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Array<Record<string, unknown>> = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private migrate() {
    const db = this.requireDb();
    db.run(
      `CREATE TABLE IF NOT EXISTS projects (
         base_path TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS tasks (
         task_id TEXT PRIMARY KEY,
         runtime_task_id TEXT,
         base_path TEXT NOT NULL,
         worktree_path TEXT,
         task_name TEXT NOT NULL,
         agent TEXT NOT NULL,
         prompt TEXT,
         parent_task_id TEXT,
         status TEXT NOT NULL DEFAULT 'open',
         is_ready INTEGER NOT NULL DEFAULT 0,
         is_dirty INTEGER NOT NULL DEFAULT 0,
         has_collision INTEGER NOT NULL DEFAULT 0,
         is_blocked INTEGER NOT NULL DEFAULT 0,
         blocked_reason TEXT,
         context_tokens INTEGER,
         context_window INTEGER,
         total_tokens INTEGER,
         percent_used REAL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         last_activity_at INTEGER,
         closed_at INTEGER,
         close_action TEXT,
         archived INTEGER NOT NULL DEFAULT 0,
         last_exit_code INTEGER,
         last_exit_signal INTEGER
       )`
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS task_sessions (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         task_id TEXT NOT NULL,
         runtime_task_id TEXT,
         cwd TEXT,
         started_at INTEGER NOT NULL,
         last_activity_at INTEGER NOT NULL,
         ended_at INTEGER,
         exit_code INTEGER,
         signal INTEGER,
         status TEXT NOT NULL
       )`
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS task_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         task_id TEXT NOT NULL,
         event_type TEXT NOT NULL,
         payload_json TEXT,
         created_at INTEGER NOT NULL
       )`
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS task_transcript (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         task_id TEXT NOT NULL,
         stream TEXT NOT NULL,
         content TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`
    );
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_base_path ON tasks(base_path)');
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_archived_closed ON tasks(archived, closed_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_task_sessions_task_id ON task_sessions(task_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_task_sessions_runtime_task_id ON task_sessions(runtime_task_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_task_events_task_id_created_at ON task_events(task_id, created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_task_transcript_task_id_id ON task_transcript(task_id, id DESC)');
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 120);
  }

  private persistNow() {
    if (!this.db) return;
    const bytes = this.db.export();
    fs.mkdirSync(path.dirname(this.dbFilePath), { recursive: true });
    fs.writeFileSync(this.dbFilePath, Buffer.from(bytes));
  }
}
