// Read side: builds API responses. Never exposes simulated_outcome or simulated_delay_ms.
import { pool } from '../db/index.js';
import { notFound } from '../errors.js';

export const secondsSince = (d: Date | null | undefined): number | null =>
  d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000)) : null;

type TaskJoinRow = {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  status_reason: string | null;
  due_date: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  expertise_id: number;
  expertise_name: string;
  current_routing_attempt_id: number | null;
  attempt_status: string | null;
  attempt_started_at: Date | null;
  assignment_id: number | null;
  assignment_status: string | null;
  assignment_source: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
};

const TASK_SELECT = `
  SELECT t.id, t.title, t.description, t.priority, t.status, t.status_reason, t.due_date,
         t.version, t.created_at, t.updated_at, t.current_routing_attempt_id,
         e.id AS expertise_id, e.name AS expertise_name,
         r.status AS attempt_status, r.started_at AS attempt_started_at,
         a.id AS assignment_id, a.status AS assignment_status, a.assignment_source,
         c.id AS assignee_id, c.name AS assignee_name
    FROM tasks t
    JOIN expertise_areas e ON e.id = t.required_expertise_id
    LEFT JOIN routing_attempts r ON r.id = t.current_routing_attempt_id
    LEFT JOIN assignments a ON a.task_id = t.id AND a.status IN ('proposed','accepted')
    LEFT JOIN contributors c ON c.id = a.contributor_id`;

export function serializeTask(r: TaskJoinRow) {
  const pending = r.status === 'routing_pending' && r.current_routing_attempt_id !== null;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    status_reason: r.status_reason,
    due_date: r.due_date,
    version: r.version,
    expertise: { id: r.expertise_id, name: r.expertise_name },
    created_at: r.created_at,
    updated_at: r.updated_at,
    // Routing state the operator may see. Deliberately does not say whether a
    // pending request will ever return.
    routing: {
      state: pending ? 'pending' : 'idle',
      attempt_id: pending ? r.current_routing_attempt_id : null,
      pending_seconds: pending ? secondsSince(r.attempt_started_at) : null,
    },
    current_assignment:
      r.assignment_id === null
        ? null
        : {
            id: r.assignment_id,
            status: r.assignment_status,
            source: r.assignment_source,
            contributor: { id: r.assignee_id, name: r.assignee_name },
          },
  };
}

export async function listTasks(q: {
  search?: string;
  status?: string[];
  priority?: string;
  expertiseId?: number;
  routing?: 'pending';
  page: number;
  perPage: number;
}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search) {
    params.push(`%${q.search}%`);
    where.push(`t.title ILIKE $${params.length}`);
  }
  if (q.status?.length) {
    params.push(q.status);
    where.push(`t.status = ANY($${params.length}::text[])`);
  }
  if (q.priority) {
    params.push(q.priority);
    where.push(`t.priority = $${params.length}`);
  }
  if (q.expertiseId) {
    params.push(q.expertiseId);
    where.push(`t.required_expertise_id = $${params.length}`);
  }
  if (q.routing === 'pending') where.push(`t.status = 'routing_pending'`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows: count } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks t ${whereSql}`, params);
  params.push(q.perPage, (q.page - 1) * q.perPage);
  const { rows } = await pool.query<TaskJoinRow>(
    `${TASK_SELECT} ${whereSql} ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    data: rows.map(serializeTask),
    meta: { page: q.page, per_page: q.perPage, total: count[0].n, total_pages: Math.max(1, Math.ceil(count[0].n / q.perPage)) },
  };
}

export async function getTask(id: number) {
  const { rows } = await pool.query<TaskJoinRow>(`${TASK_SELECT} WHERE t.id = $1`, [id]);
  if (rows.length === 0) throw notFound('Task');
  const [attempts, assignments, events] = await Promise.all([
    pool.query(
      `SELECT r.id, r.status, r.started_at, r.completed_at, r.superseded_at, r.late_result_at,
              r.selected_contributor_id, c.name AS selected_contributor_name
         FROM routing_attempts r LEFT JOIN contributors c ON c.id = r.selected_contributor_id
        WHERE r.task_id = $1 ORDER BY r.id DESC`,
      [id],
    ),
    pool.query(
      `SELECT a.id, a.status, a.assignment_source, a.reason, a.offered_at, a.accepted_at,
              a.declined_at, a.ended_at, a.routing_attempt_id, c.id AS contributor_id, c.name AS contributor_name
         FROM assignments a JOIN contributors c ON c.id = a.contributor_id
        WHERE a.task_id = $1 ORDER BY a.id DESC`,
      [id],
    ),
    pool.query(
      `SELECT id, event_type, actor_type, actor_id, previous_state, new_state, contributor_id,
              routing_attempt_id, explanation, created_at
         FROM task_events WHERE task_id = $1 ORDER BY id ASC`,
      [id],
    ),
  ]);
  const attemptRows = attempts.rows.map((a) => ({
    id: a.id,
    status: a.status,
    started_at: a.started_at,
    completed_at: a.completed_at,
    superseded_at: a.superseded_at,
    late_result_at: a.late_result_at,
    pending_seconds: a.status === 'pending' ? secondsSince(a.started_at) : null,
    selected_contributor: a.selected_contributor_id ? { id: a.selected_contributor_id, name: a.selected_contributor_name } : null,
  }));
  return {
    ...serializeTask(rows[0]),
    attempts: attemptRows,
    assignments: assignments.rows.map((a) => ({
      id: a.id,
      status: a.status,
      source: a.assignment_source,
      reason: a.reason,
      routing_attempt_id: a.routing_attempt_id,
      contributor: { id: a.contributor_id, name: a.contributor_name },
      offered_at: a.offered_at,
      accepted_at: a.accepted_at,
      declined_at: a.declined_at,
      ended_at: a.ended_at,
    })),
    history: events.rows,
  };
}

export async function listEvents(q: { taskId?: number; eventType?: string; page: number; perPage: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.taskId) {
    params.push(q.taskId);
    where.push(`e.task_id = $${params.length}`);
  }
  if (q.eventType) {
    params.push(q.eventType);
    where.push(`e.event_type = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows: count } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM task_events e ${whereSql}`, params);
  params.push(q.perPage, (q.page - 1) * q.perPage);
  const { rows } = await pool.query(
    `SELECT e.id, e.task_id, t.title AS task_title, e.event_type, e.actor_type, e.actor_id,
            e.previous_state, e.new_state, e.contributor_id, c.name AS contributor_name,
            e.routing_attempt_id, e.explanation, e.created_at
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       LEFT JOIN contributors c ON c.id = e.contributor_id
       ${whereSql}
      ORDER BY e.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    data: rows,
    meta: { page: q.page, per_page: q.perPage, total: count[0].n, total_pages: Math.max(1, Math.ceil(count[0].n / q.perPage)) },
  };
}

export async function taskHistory(taskId: number, eventType: string | undefined) {
  await ensureTask(taskId);
  const params: unknown[] = [taskId];
  let extra = '';
  if (eventType) {
    params.push(eventType);
    extra = `AND event_type = $2`;
  }
  const { rows } = await pool.query(
    `SELECT id, event_type, actor_type, actor_id, previous_state, new_state, contributor_id,
            routing_attempt_id, explanation, metadata, created_at
       FROM task_events WHERE task_id = $1 ${extra} ORDER BY id ASC`,
    params,
  );
  return rows;
}

async function ensureTask(id: number): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM tasks WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Task');
}

export async function dashboardSummary() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM tasks) AS total_tasks,
      (SELECT count(*)::int FROM tasks WHERE status = 'routing_pending') AS awaiting_routing,
      (SELECT count(*)::int FROM tasks WHERE status = 'awaiting_acceptance') AS awaiting_acceptance,
      (SELECT count(*)::int FROM assignments WHERE status IN ('proposed','accepted')) AS active_assignments,
      (SELECT count(*)::int FROM routing_attempts WHERE status = 'pending') AS unresolved_routing_requests,
      (SELECT count(*)::int FROM tasks WHERE status = 'needs_intervention') AS requiring_intervention,
      (SELECT count(*)::int FROM tasks WHERE status IN ('declined','assignment_failed')) AS declined_or_failed,
      (SELECT count(*)::int FROM tasks WHERE status = 'completed') AS completed
  `);
  const { rows: byPriority } = await pool.query(
    `SELECT priority, count(*)::int AS count FROM tasks
      WHERE status NOT IN ('completed','cancelled') GROUP BY priority`,
  );
  const { rows: oldestPending } = await pool.query(
    `SELECT t.id, t.title, t.priority, r.started_at
       FROM routing_attempts r JOIN tasks t ON t.id = r.task_id
      WHERE r.status = 'pending' ORDER BY r.started_at ASC LIMIT 5`,
  );
  const { rows: activity } = await pool.query(
    `SELECT e.id, e.task_id, t.title AS task_title, e.event_type, e.explanation, e.created_at
       FROM task_events e JOIN tasks t ON t.id = e.task_id ORDER BY e.id DESC LIMIT 12`,
  );
  return {
    counts: rows[0],
    open_by_priority: Object.fromEntries(byPriority.map((r) => [r.priority, r.count])),
    unresolved_requests: oldestPending.map((r) => ({
      task_id: r.id,
      title: r.title,
      priority: r.priority,
      pending_seconds: secondsSince(r.started_at),
    })),
    activity,
  };
}

export async function listAttempts(q: { status?: string; page: number; perPage: number }) {
  const params: unknown[] = [];
  let where = '';
  if (q.status) {
    params.push(q.status);
    where = `WHERE r.status = $1`;
  }
  const { rows: count } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM routing_attempts r ${where}`, params);
  params.push(q.perPage, (q.page - 1) * q.perPage);
  const { rows } = await pool.query(
    `SELECT r.id, r.task_id, t.title AS task_title, t.priority, r.status, r.started_at, r.completed_at,
            r.superseded_at, r.late_result_at, c.name AS selected_contributor_name
       FROM routing_attempts r
       JOIN tasks t ON t.id = r.task_id
       LEFT JOIN contributors c ON c.id = r.selected_contributor_id
       ${where}
      ORDER BY r.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    data: rows.map((r) => ({ ...r, pending_seconds: r.status === 'pending' ? secondsSince(r.started_at) : null })),
    meta: { page: q.page, per_page: q.perPage, total: count[0].n, total_pages: Math.max(1, Math.ceil(count[0].n / q.perPage)) },
  };
}

export async function getAttempt(id: number) {
  const { rows } = await pool.query(
    `SELECT r.id, r.task_id, t.title AS task_title, r.status, r.started_at, r.completed_at,
            r.superseded_at, r.late_result_at, c.id AS selected_contributor_id, c.name AS selected_contributor_name
       FROM routing_attempts r JOIN tasks t ON t.id = r.task_id
       LEFT JOIN contributors c ON c.id = r.selected_contributor_id
      WHERE r.id = $1`,
    [id],
  );
  if (rows.length === 0) throw notFound('Routing attempt');
  const r = rows[0];
  return { ...r, pending_seconds: r.status === 'pending' ? secondsSince(r.started_at) : null };
}

export async function listContributors() {
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.email, c.availability, c.max_active_assignments,
           COALESCE(array_agg(e.name ORDER BY e.name) FILTER (WHERE e.id IS NOT NULL), '{}') AS expertise,
           (SELECT count(*)::int FROM assignments a WHERE a.contributor_id = c.id AND a.status IN ('proposed','accepted')) AS active_assignment_count
      FROM contributors c
      LEFT JOIN contributor_expertise ce ON ce.contributor_id = c.id
      LEFT JOIN expertise_areas e ON e.id = ce.expertise_area_id
     GROUP BY c.id ORDER BY c.name`);
  const { rows: tasks } = await pool.query(
    `SELECT a.contributor_id, t.id AS task_id, t.title, t.status, a.status AS assignment_status
       FROM assignments a JOIN tasks t ON t.id = a.task_id
      WHERE a.status IN ('proposed','accepted') ORDER BY a.id DESC`,
  );
  return rows.map((c) => ({
    ...c,
    assigned_tasks: tasks.filter((t) => t.contributor_id === c.id).map((t) => ({
      task_id: t.task_id, title: t.title, task_status: t.status, assignment_status: t.assignment_status,
    })),
  }));
}

export async function getContributor(id: number) {
  const all = await listContributors();
  const found = all.find((c) => c.id === id);
  if (!found) throw notFound('Contributor');
  return found;
}

export async function listExpertiseAreas() {
  const { rows } = await pool.query('SELECT id, name FROM expertise_areas ORDER BY name');
  return rows;
}
