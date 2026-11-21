import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../src/db/index.js';
import { requestRouting, handleRoutingResult } from '../src/services/routing.js';
import { createTask } from '../src/services/tasks.js';
import { acceptAssignment, declineAssignment, intervene, recover, advanceWork } from '../src/services/assignments.js';
import { AppError } from '../src/errors.js';
import { closeRealtime } from '../src/realtime.js';
import { deliver, operator, resetDb, scheduler, seedFixture, eventTypes, countRows, closeDb } from './helpers.js';

const actor = operator;
let fx: Awaited<ReturnType<typeof seedFixture>>;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});
afterAll(async () => {
  await closeRealtime();
  await closeDb();
});

const newTask = (area: keyof Awaited<ReturnType<typeof seedFixture>>['expertise'] = 'Python', simulation?: 'success' | 'never' | 'delayed') =>
  createTask(
    { title: `Task ${Math.random()}`, description: '', required_expertise_id: fx.expertise[area], priority: 'high', due_date: null, submit: true },
    actor,
    simulation,
  ).then((r) => r.routing!);

describe('routine assignment (use case 1)', () => {
  it('routes, proposes, accepts, and records the full history', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    expect(task.status).toBe('routing_pending');
    expect(scheduler.scheduled.get(attempt.id)).toBe(5_000);

    expect(await deliver(attempt.id)).toBe('matched');
    const { rows: asg } = await pool.query('SELECT id, contributor_id, status FROM assignments WHERE task_id=$1', [task.id]);
    expect(asg).toHaveLength(1);
    expect(asg[0].status).toBe('proposed');

    const accepted = await acceptAssignment(asg[0].id);
    expect(accepted.task.status).toBe('assigned');
    expect(accepted.assignment.status).toBe('accepted');

    expect(await eventTypes(task.id)).toEqual([
      'task_created',
      'routing_started',
      'routing_result_received',
      'assignment_proposed',
      'assignment_accepted',
    ]);
  });

  it('selects the least-loaded eligible contributor with a deterministic tie-break', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    await deliver(attempt.id);
    const { rows } = await pool.query('SELECT contributor_id FROM assignments WHERE task_id=$1', [task.id]);
    expect(rows[0].contributor_id).toBe(fx.people['Ava']);
  });
});

describe('never-returning routing (use case 2)', () => {
  it('keeps the request pending, schedules nothing, and never declares failure', async () => {
    const { task, attempt } = await newTask('Python', 'never');
    expect(scheduler.scheduled.has(attempt.id)).toBe(false);
    const { rows } = await pool.query('SELECT status FROM routing_attempts WHERE id=$1', [attempt.id]);
    expect(rows[0].status).toBe('pending');
    const { rows: t } = await pool.query('SELECT status FROM tasks WHERE id=$1', [task.id]);
    expect(t[0].status).toBe('routing_pending');
    expect(await countRows('assignments', `task_id=${task.id}`)).toBe(0);
  });

  it('never exposes the predetermined simulation outcome through the read model', async () => {
    const { readModelJson } = await import('./readModelJson.js');
    const { task } = await newTask('Python', 'never');
    const json = await readModelJson(task.id);
    expect(json).not.toMatch(/simulated/);
    expect(json).not.toMatch(/never/);
  });
});

describe('idempotency and concurrency', () => {
  it('returns the existing pending attempt for a duplicate routing submission', async () => {
    const { task } = await newTask('Python', 'success');
    const again = await requestRouting(task.id, { actor });
    expect(again.created).toBe(false);
    expect(await countRows('routing_attempts', `task_id=${task.id}`)).toBe(1);
  });

  it('creates exactly one pending attempt under concurrent submissions', async () => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO tasks (title, description, required_expertise_id, priority, status)
       VALUES ('Race', '', $1, 'medium', 'draft') RETURNING id`,
      [fx.expertise['Python']],
    );
    const id = rows[0].id;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => requestRouting(id, { actor, simulation: 'never' })),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await countRows('routing_attempts', `task_id=${id}`)).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled' && r.value.created).length).toBe(1);
  });

  it('lets only one of two concurrent accepts win; the other is idempotent', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    await deliver(attempt.id);
    const { rows } = await pool.query('SELECT id FROM assignments WHERE task_id=$1', [task.id]);
    const results = await Promise.allSettled([acceptAssignment(rows[0].id), acceptAssignment(rows[0].id)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const idempotent = results.filter((r) => r.status === 'fulfilled' && r.value.idempotent).length;
    expect(idempotent).toBe(1);
    expect(await countRows('assignments', `task_id=${task.id} AND status='accepted'`)).toBe(1);
  });

  it('routes several tasks concurrently without cross-talk', async () => {
    const routed = await Promise.all([newTask('Python', 'success'), newTask('Ruby', 'success'), newTask('QA', 'success')]);
    const outcomes = await Promise.all(routed.map((r) => deliver(r.attempt.id)));
    expect(outcomes).toEqual(['matched', 'matched', 'matched']);
  });
});

describe('manual intervention and stale results (use case 3)', () => {
  it('supersedes the pending request, keeps the manual assignment, and ignores the late result', async () => {
    const { task, attempt } = await newTask('Python', 'delayed');
    expect(scheduler.scheduled.get(attempt.id)).toBe(20_000);

    const t = await intervene(task.id, { action: 'assign', contributorId: fx.people['Mei'], reason: 'Client asked for Mei' }, actor);
    expect(t.status).toBe('awaiting_acceptance');
    expect(scheduler.cancelled).toContain(attempt.id);

    const { rows: a } = await pool.query("SELECT status FROM routing_attempts WHERE id=$1", [attempt.id]);
    expect(a[0].status).toBe('superseded');

    const outcome = await deliver(attempt.id);
    expect(outcome).toBe('ignored');

    const { rows: active } = await pool.query(
      "SELECT contributor_id, assignment_source FROM assignments WHERE task_id=$1 AND status IN ('proposed','accepted')",
      [task.id],
    );
    expect(active).toEqual([{ contributor_id: fx.people['Mei'], assignment_source: 'manual' }]);
    expect(await eventTypes(task.id)).toContain('stale_result_ignored');
    const { rows: late } = await pool.query('SELECT late_result_at FROM routing_attempts WHERE id=$1', [attempt.id]);
    expect(late[0].late_result_at).not.toBeNull();
  });

  it('rejects manual assignment of an unavailable or non-matching contributor', async () => {
    const { task } = await newTask('Python', 'never');
    await expect(intervene(task.id, { action: 'assign', contributorId: fx.people['Offline Dev'] }, actor)).rejects.toMatchObject({ status: 422 });
    await expect(intervene(task.id, { action: 'assign', contributorId: fx.people['Ruby Dev'] }, actor)).rejects.toMatchObject({ status: 422 });
  });
});

describe('decline and recovery (use case 4)', () => {
  it('excludes the declining contributor when routing is reopened', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    await deliver(attempt.id);
    const { rows } = await pool.query('SELECT id, contributor_id FROM assignments WHERE task_id=$1', [task.id]);
    expect(rows[0].contributor_id).toBe(fx.people['Ava']);

    const declined = await declineAssignment(rows[0].id, 'Out of office');
    expect(declined.task.status).toBe('declined');

    const r = await recover(task.id, { action: 'retry_routing', simulation: 'success' }, actor);
    expect(r.routing).toBeDefined();
    expect(await deliver(r.routing!.attempt.id)).toBe('matched');
    const { rows: next } = await pool.query(
      "SELECT contributor_id FROM assignments WHERE task_id=$1 AND status IN ('proposed','accepted')",
      [task.id],
    );
    expect(next[0].contributor_id).toBe(fx.people['Mei']);
    // History keeps the declined assignment.
    expect(await countRows('assignments', `task_id=${task.id} AND status='declined'`)).toBe(1);
  });

  it('lets the operator choose a different contributor during recovery', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    await deliver(attempt.id);
    const { rows } = await pool.query('SELECT id FROM assignments WHERE task_id=$1', [task.id]);
    await declineAssignment(rows[0].id, 'Blocked');
    const r = await recover(task.id, { action: 'choose_contributor', contributorId: fx.people['Mei'] }, actor);
    expect(r.task.status).toBe('awaiting_acceptance');
  });

  it('refuses recovery when the task is not declined or failed', async () => {
    const { task } = await newTask('Python', 'never');
    await expect(recover(task.id, { action: 'retry_routing' }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to accept an assignment after it was declined', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    await deliver(attempt.id);
    const { rows } = await pool.query('SELECT id FROM assignments WHERE task_id=$1', [task.id]);
    await declineAssignment(rows[0].id, 'No');
    await expect(acceptAssignment(rows[0].id)).rejects.toBeInstanceOf(AppError);
  });
});

describe('no suitable contributor', () => {
  it('moves the task to needs_intervention and explains why', async () => {
    const { task, attempt } = await newTask('Security', 'success');
    expect(await deliver(attempt.id)).toBe('no_match');
    const { rows } = await pool.query('SELECT status, status_reason FROM tasks WHERE id=$1', [task.id]);
    expect(rows[0].status).toBe('needs_intervention');
    expect(rows[0].status_reason).toMatch(/no eligible contributor/i);
  });
});

describe('invariants', () => {
  it('database rejects a second active assignment for the same task', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    await deliver(attempt.id);
    await expect(
      pool.query(
        `INSERT INTO assignments (task_id, contributor_id, assignment_source, status)
         VALUES ($1, $2, 'manual', 'proposed')`,
        [task.id, fx.people['Mei']],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps history after a task is completed', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    await deliver(attempt.id);
    const { rows } = await pool.query('SELECT id FROM assignments WHERE task_id=$1', [task.id]);
    await acceptAssignment(rows[0].id);
    await advanceWork(task.id, 'in_progress', actor);
    await advanceWork(task.id, 'completed', actor);
    expect(await eventTypes(task.id)).toEqual(
      expect.arrayContaining(['task_started', 'task_completed']),
    );
  });

  it('rejects invalid transitions with 409', async () => {
    const { task } = await newTask('Python', 'never');
    await intervene(task.id, { action: 'cancel' }, actor);
    await expect(intervene(task.id, { action: 'cancel' }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(advanceWork(task.id, 'completed', actor)).rejects.toMatchObject({ status: 409 });
  });

  it('withTransaction rolls back on error (no partial writes)', async () => {
    const before = await countRows('tasks');
    await expect(
      withTransaction(async (c) => {
        await c.query("INSERT INTO tasks (title, description, required_expertise_id, priority) VALUES ('x','',$1,'low')", [fx.expertise['Python']]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await countRows('tasks')).toBe(before);
  });
});

describe('job identity', () => {
  it('ignores a delivery whose request token does not match the attempt (reused ids after reset)', async () => {
    const { task, attempt } = await newTask('Python', 'success');
    const outcome = await handleRoutingResult(attempt.id, 'not-this-attempt');
    expect(outcome).toBe('ignored');
    const { rows } = await pool.query('SELECT status FROM tasks WHERE id = $1', [task.id]);
    expect(rows[0].status).toBe('routing_pending');
    expect(await countRows('assignments', `task_id=${task.id}`)).toBe(0);
  });
});
