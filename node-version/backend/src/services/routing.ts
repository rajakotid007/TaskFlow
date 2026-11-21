// RoutingRequestService (create + supersede attempts) and RoutingResultHandler
// (deliver or ignore a result). A routing result is applied only if the attempt is
// still the task's current pending attempt AND the task is still routing_pending.
// Otherwise it is recorded as a stale result and changes nothing else.
import type pg from 'pg';
import { withTransaction } from '../db/index.js';
import { type SimulationOverride, decideOutcome } from './simulation.js';
import { findEligibleContributor } from './matching.js';
import { lockTask, transition, type TaskRow } from './taskTransition.js';
import { recordEvent, type Actor, SYSTEM } from './audit.js';
import { flushOutbox, type Outbox } from './outbox.js';
import type { TaskAction } from '../domain/stateMachine.js';
import { AppError } from '../errors.js';

export type RoutingAttemptRow = {
  id: number;
  task_id: number;
  status: 'pending' | 'resolved' | 'no_match' | 'superseded';
  request_token: string;
  simulated_outcome: 'returns' | 'never';
  simulated_delay_ms: number | null;
  selected_contributor_id: number | null;
  started_at: Date;
  completed_at: Date | null;
  superseded_at: Date | null;
  late_result_at: Date | null;
};

/** Contributors who declined or failed this task are not offered it again. */
export async function excludedContributorIds(c: pg.PoolClient, taskId: number): Promise<number[]> {
  const { rows } = await c.query<{ contributor_id: number }>(
    `SELECT DISTINCT contributor_id FROM assignments
      WHERE task_id = $1 AND status IN ('declined', 'failed')`,
    [taskId],
  );
  return rows.map((r) => r.contributor_id);
}

/**
 * Creates a pending routing attempt, moves the task to routing_pending, and schedules
 * the result (unless the simulation decided the request will never return).
 * Must run inside a transaction that already holds the task lock.
 */
export async function createAttemptInTx(
  c: pg.PoolClient,
  task: TaskRow,
  o: {
    action: Extract<TaskAction, 'submit_for_routing' | 'reroute'>;
    actor: Actor;
    outbox: Outbox;
    eventType?: string;
    explanation?: string;
    simulation?: SimulationOverride;
  },
): Promise<{ task: TaskRow; attempt: RoutingAttemptRow }> {
  const sim = decideOutcome(o.simulation);
  const { rows } = await c.query<RoutingAttemptRow>(
    `INSERT INTO routing_attempts (task_id, simulated_outcome, simulated_delay_ms)
     VALUES ($1, $2, $3) RETURNING *`,
    [task.id, sim.outcome, sim.delayMs],
  );
  const attempt = rows[0];
  const updated = await transition(c, task, o.action, {
    actor: o.actor,
    eventType: o.eventType ?? 'routing_started',
    explanation:
      o.explanation ?? 'Routing request created. Waiting for a contributor response.',
    reason: null,
    routingAttemptId: attempt.id,
    currentAttemptId: attempt.id,
    outbox: o.outbox,
  });
  if (sim.outcome === 'returns' && sim.delayMs !== null) {
    o.outbox.push({
      kind: 'schedule',
      attemptId: attempt.id,
      taskId: task.id,
      delayMs: sim.delayMs,
      requestToken: attempt.request_token,
    });
  }
  return { task: updated, attempt };
}

/**
 * Marks the pending attempt (if any) as superseded and cancels its queued result.
 * The superseded attempt stays in history. Its late result, if one ever arrives, is ignored.
 */
export async function supersedePending(
  c: pg.PoolClient,
  task: TaskRow,
  actor: Actor,
  outbox: Outbox,
  reason: string,
): Promise<TaskRow> {
  if (task.current_routing_attempt_id === null) return task;
  const { rows } = await c.query<{ id: number }>(
    `UPDATE routing_attempts SET status = 'superseded', superseded_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING id`,
    [task.current_routing_attempt_id],
  );
  if (rows.length === 0) return task;
  outbox.push({ kind: 'cancel', attemptId: rows[0].id, taskId: task.id });
  await recordEvent(
    c,
    {
      taskId: task.id,
      eventType: 'routing_superseded',
      actor,
      routingAttemptId: rows[0].id,
      explanation: reason,
    },
    outbox,
  );
  const { rows: t } = await c.query<TaskRow>(
    'UPDATE tasks SET current_routing_attempt_id = NULL WHERE id = $1 RETURNING *',
    [task.id],
  );
  return t[0];
}

export type RoutingRequestResult = { task: TaskRow; attempt: RoutingAttemptRow; created: boolean };

/**
 * Starts routing for a task. Idempotent: if the task is already routing_pending, the
 * existing pending attempt is returned and nothing new is created.
 */
export async function requestRouting(
  taskId: number,
  opts: { actor: Actor; simulation?: SimulationOverride; expectedVersion?: number },
): Promise<RoutingRequestResult> {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    const task = await lockTask(c, taskId);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== task.version) {
      throw new AppError(409, 'version_conflict', 'Task was modified by someone else.', {
        current_version: task.version,
      });
    }
    if (task.status === 'routing_pending' && task.current_routing_attempt_id !== null) {
      const { rows } = await c.query<RoutingAttemptRow>('SELECT * FROM routing_attempts WHERE id = $1', [
        task.current_routing_attempt_id,
      ]);
      return { task, attempt: rows[0], created: false };
    }
    const created = await createAttemptInTx(c, task, {
      action: 'submit_for_routing',
      actor: opts.actor,
      outbox,
      simulation: opts.simulation,
    });
    return { ...created, created: true };
  });
  await flushOutbox(outbox);
  return result;
}

export type ResultOutcome = 'matched' | 'no_match' | 'ignored';

/**
 * Applies a routing result delivered by the worker. Safe to run more than once
 * for the same attempt. It only acts if the attempt is still current.
 */
export async function handleRoutingResult(attemptId: number, requestToken?: string): Promise<ResultOutcome> {
  const outbox: Outbox = [];
  const outcome = await withTransaction(async (c): Promise<ResultOutcome> => {
    const { rows: ref } = await c.query<{ task_id: number; request_token: string }>(
      'SELECT task_id, request_token FROM routing_attempts WHERE id = $1',
      [attemptId],
    );
    if (ref.length === 0) return 'ignored';
    // A job from an earlier data set can carry a reused attempt id. The token proves identity.
    if (requestToken !== undefined && ref[0].request_token !== requestToken) return 'ignored';
    const task = await lockTask(c, ref[0].task_id);
    const { rows } = await c.query<RoutingAttemptRow>(
      'SELECT * FROM routing_attempts WHERE id = $1 FOR UPDATE',
      [attemptId],
    );
    const attempt = rows[0];

    const current =
      attempt.status === 'pending' &&
      task.status === 'routing_pending' &&
      task.current_routing_attempt_id === attempt.id;

    if (!current) {
      // Stale: superseded by an operator action (or the task moved on). Record and stop.
      await c.query('UPDATE routing_attempts SET late_result_at = COALESCE(late_result_at, now()) WHERE id = $1', [
        attempt.id,
      ]);
      await recordEvent(
        c,
        {
          taskId: task.id,
          eventType: 'stale_result_ignored',
          actor: SYSTEM,
          routingAttemptId: attempt.id,
          explanation:
            'A routing result arrived after this request had been superseded. It was ignored and did not change the task.',
        },
        outbox,
      );
      return 'ignored';
    }

    const excluded = await excludedContributorIds(c, task.id);
    const candidate = await findEligibleContributor(c, task.required_expertise_id, excluded);

    if (!candidate) {
      await c.query(
        "UPDATE routing_attempts SET status = 'no_match', completed_at = now() WHERE id = $1",
        [attempt.id],
      );
      await transition(c, task, 'routing_no_match', {
        actor: SYSTEM,
        eventType: 'routing_no_match',
        explanation: 'Routing finished with no eligible contributor. Intervention is required.',
        reason: 'No eligible contributor has the required expertise with available capacity.',
        routingAttemptId: attempt.id,
        currentAttemptId: null,
        outbox,
      });
      return 'no_match';
    }

    await c.query(
      `UPDATE routing_attempts SET status = 'resolved', completed_at = now(),
              selected_contributor_id = $2 WHERE id = $1`,
      [attempt.id, candidate.id],
    );
    const { rows: asg } = await c.query<{ id: number }>(
      `INSERT INTO assignments (task_id, contributor_id, routing_attempt_id, assignment_source, status)
       VALUES ($1, $2, $3, 'routing', 'proposed') RETURNING id`,
      [task.id, candidate.id, attempt.id],
    );
    await transition(c, task, 'routing_returned', {
      actor: SYSTEM,
      eventType: 'routing_result_received',
      explanation: `Routing returned a matching contributor: ${candidate.name}.`,
      contributorId: candidate.id,
      routingAttemptId: attempt.id,
      currentAttemptId: null,
      outbox,
    });
    await recordEvent(
      c,
      {
        taskId: task.id,
        eventType: 'assignment_proposed',
        actor: SYSTEM,
        contributorId: candidate.id,
        routingAttemptId: attempt.id,
        explanation: `Assignment proposed to ${candidate.name}. Awaiting acceptance.`,
        metadata: { assignmentId: asg[0].id },
      },
      outbox,
    );
    return 'matched';
  });
  await flushOutbox(outbox);
  return outcome;
}
