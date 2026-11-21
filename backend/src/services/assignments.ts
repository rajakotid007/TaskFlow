// AssignmentService (contributor accept/decline), ManualInterventionService
// (operator actions during routing or after a problem) and AssignmentRecoveryService.
// Every mutating path: lock the task row first, validate state, then write.
import type pg from 'pg';
import { withTransaction } from '../db/index.js';
import { conflict, notFound, unprocessable, AppError } from '../errors.js';
import { hasExpertise } from './matching.js';
import { lockTask, transition, type TaskRow } from './taskTransition.js';
import { recordEvent, type Actor } from './audit.js';
import { flushOutbox, type Outbox } from './outbox.js';
import { supersedePending, createAttemptInTx, excludedContributorIds, type RoutingRequestResult } from './routing.js';
import { RECOVERABLE, type TaskStatus } from '../domain/stateMachine.js';
import type { SimulationOverride } from './simulation.js';

export type AssignmentRow = {
  id: number;
  task_id: number;
  contributor_id: number;
  routing_attempt_id: number | null;
  assignment_source: 'routing' | 'manual';
  status: 'proposed' | 'accepted' | 'declined' | 'failed' | 'released' | 'completed';
  reason: string | null;
  offered_at: Date;
  accepted_at: Date | null;
  declined_at: Date | null;
  ended_at: Date | null;
};

/** Locks the assignment's task and then the assignment row, in that order. */
async function lockAssignment(c: pg.PoolClient, assignmentId: number): Promise<{ task: TaskRow; asg: AssignmentRow }> {
  const { rows: ref } = await c.query<{ task_id: number }>('SELECT task_id FROM assignments WHERE id = $1', [assignmentId]);
  if (ref.length === 0) throw notFound('Assignment');
  const task = await lockTask(c, ref[0].task_id);
  const { rows } = await c.query<AssignmentRow>('SELECT * FROM assignments WHERE id = $1 FOR UPDATE', [assignmentId]);
  return { task, asg: rows[0] };
}

async function contributorName(c: pg.PoolClient, id: number): Promise<string> {
  const { rows } = await c.query<{ name: string }>('SELECT name FROM contributors WHERE id = $1', [id]);
  return rows[0]?.name ?? `contributor ${id}`;
}

/** Ends the currently active assignment (proposed or accepted), if one exists. */
async function releaseActive(c: pg.PoolClient, taskId: number, status: 'released' | 'failed' | 'completed', reason: string): Promise<AssignmentRow | null> {
  const { rows } = await c.query<AssignmentRow>(
    `UPDATE assignments SET status = $2, ended_at = now(), reason = $3, updated_at = now()
      WHERE task_id = $1 AND status IN ('proposed', 'accepted') RETURNING *`,
    [taskId, status, reason],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- contributor actions

/** Contributor accepts. Idempotent: accepting an already-accepted assignment returns it. */
export async function acceptAssignment(assignmentId: number, contributorId?: number) {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    const { task, asg } = await lockAssignment(c, assignmentId);
    if (contributorId !== undefined && asg.contributor_id !== contributorId) {
      throw new AppError(403, 'forbidden', 'This assignment belongs to a different contributor.');
    }
    if (asg.status === 'accepted') return { task, assignment: asg, idempotent: true };
    if (asg.status !== 'proposed') {
      throw conflict(`This assignment is no longer awaiting acceptance (status: ${asg.status}).`);
    }
    const { rows } = await c.query<AssignmentRow>(
      `UPDATE assignments SET status = 'accepted', accepted_at = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [asg.id],
    );
    const name = await contributorName(c, asg.contributor_id);
    const updated = await transition(c, task, 'accept', {
      actor: { type: 'contributor', id: String(asg.contributor_id) },
      eventType: 'assignment_accepted',
      explanation: `${name} accepted the assignment. The task is now assigned.`,
      contributorId: asg.contributor_id,
      outbox,
    });
    return { task: updated, assignment: rows[0], idempotent: false };
  });
  await flushOutbox(outbox);
  return result;
}

/** Contributor declines an offered assignment. Idempotent for repeated declines. */
export async function declineAssignment(assignmentId: number, reason: string, contributorId?: number) {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    const { task, asg } = await lockAssignment(c, assignmentId);
    if (contributorId !== undefined && asg.contributor_id !== contributorId) {
      throw new AppError(403, 'forbidden', 'This assignment belongs to a different contributor.');
    }
    if (asg.status === 'declined') return { task, assignment: asg, idempotent: true };
    if (asg.status !== 'proposed') {
      throw conflict(`Only an offered assignment can be declined (status: ${asg.status}).`);
    }
    const { rows } = await c.query<AssignmentRow>(
      `UPDATE assignments SET status = 'declined', declined_at = now(), reason = $2, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [asg.id, reason],
    );
    const name = await contributorName(c, asg.contributor_id);
    const updated = await transition(c, task, 'decline', {
      actor: { type: 'contributor', id: String(asg.contributor_id) },
      eventType: 'assignment_declined',
      explanation: `${name} declined the assignment: ${reason}`,
      reason,
      contributorId: asg.contributor_id,
      outbox,
    });
    return { task: updated, assignment: rows[0], idempotent: false };
  });
  await flushOutbox(outbox);
  return result;
}

// ---------------------------------------------------------------- operator actions

/** Manually assigns a contributor. Supersedes any pending routing request. */
async function assignManuallyInTx(
  c: pg.PoolClient,
  task: TaskRow,
  contributorId: number,
  actor: Actor,
  outbox: Outbox,
  note: string,
): Promise<TaskRow> {
  const { rows: cr } = await c.query<{ id: number; name: string; availability: string }>(
    'SELECT id, name, availability FROM contributors WHERE id = $1',
    [contributorId],
  );
  if (cr.length === 0) throw notFound('Contributor');
  if (cr[0].availability === 'unavailable') {
    throw unprocessable(`${cr[0].name} is currently unavailable.`);
  }
  if (!(await hasExpertise(c, contributorId, task.required_expertise_id))) {
    throw unprocessable(`${cr[0].name} does not have the expertise this task requires.`);
  }
  let current = await supersedePending(c, task, actor, outbox, 'Pending routing request superseded by a manual decision.');
  await releaseActive(c, current.id, 'released', 'Replaced by a manual assignment.');
  await c.query(
    `INSERT INTO assignments (task_id, contributor_id, assignment_source, status)
     VALUES ($1, $2, 'manual', 'proposed')`,
    [current.id, contributorId],
  );
  current = await transition(c, current, 'manual_assign', {
    actor,
    eventType: 'manual_intervention',
    explanation: `${note} ${cr[0].name} was assigned manually and must accept.`,
    contributorId,
    currentAttemptId: null,
    outbox,
  });
  return current;
}

export type InterveneInput = {
  action: 'assign' | 'reroute' | 'fail_assignment' | 'cancel';
  contributorId?: number;
  reason?: string;
  simulation?: SimulationOverride;
  expectedVersion?: number;
};

/** ManualInterventionService: operator actions available while routing is pending or after a problem. */
export async function intervene(taskId: number, input: InterveneInput, actor: Actor): Promise<TaskRow> {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    let task = await lockTask(c, taskId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== task.version) {
      throw new AppError(409, 'version_conflict', 'Task was modified by someone else.', { current_version: task.version });
    }
    const reason = input.reason?.trim() || undefined;

    switch (input.action) {
      case 'assign': {
        if (input.contributorId === undefined) throw unprocessable('contributor_id is required to assign.');
        task = await assignManuallyInTx(c, task, input.contributorId, actor, outbox, reason ? `Operator note: ${reason}.` : 'Operator intervention.');
        return task;
      }
      case 'reroute': {
        task = await supersedePending(c, task, actor, outbox, 'Superseded by an operator restarting routing.');
        await releaseActive(c, task.id, 'released', 'Released when the operator restarted routing.');
        // reroute covers routing_pending and awaiting_acceptance; needs_intervention re-submits.
        const { task: t } = await createAttemptInTx(c, task, {
          action: task.status === 'needs_intervention' ? 'submit_for_routing' : 'reroute',
          actor,
          outbox,
          eventType: 'manual_intervention',
          explanation: 'Operator restarted routing. A new routing request was created.',
          simulation: input.simulation,
        });
        return t;
      }
      case 'fail_assignment': {
        task = await supersedePending(c, task, actor, outbox, 'Superseded because the assignment was marked failed.');
        const failed = await releaseActive(c, task.id, 'failed', reason ?? 'Marked failed by operator.');
        if (failed) {
          await c.query("UPDATE assignments SET status = 'failed', ended_at = now() WHERE id = $1", [failed.id]);
        }
        return transition(c, task, 'fail_assignment', {
          actor,
          eventType: 'assignment_failed',
          explanation: `Assignment marked failed before work began. ${reason ?? ''}`.trim(),
          reason: reason ?? 'Marked failed by operator.',
          contributorId: failed?.contributor_id ?? null,
          currentAttemptId: null,
          outbox,
        });
      }
      case 'cancel': {
        task = await supersedePending(c, task, actor, outbox, 'Superseded because the task was cancelled.');
        await releaseActive(c, task.id, 'released', 'Released because the task was cancelled.');
        return transition(c, task, 'cancel', {
          actor,
          eventType: 'task_cancelled',
          explanation: reason ? `Task cancelled: ${reason}` : 'Task cancelled by operator.',
          reason: reason ?? null,
          currentAttemptId: null,
          outbox,
        });
      }
    }
  });
  await flushOutbox(outbox);
  return result;
}

/** Starts or completes work on an assigned task. */
export async function advanceWork(taskId: number, to: 'in_progress' | 'completed', actor: Actor): Promise<TaskRow> {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    const task = await lockTask(c, taskId);
    if (to === 'in_progress') {
      return transition(c, task, 'start', {
        actor,
        eventType: 'task_started',
        explanation: 'Work started on the assigned task.',
        outbox,
      });
    }
    const ended = await releaseActive(c, task.id, 'completed', 'Task completed.');
    return transition(c, task, 'complete', {
      actor,
      eventType: 'task_completed',
      explanation: 'Work completed. The assignment has ended.',
      contributorId: ended?.contributor_id ?? null,
      outbox,
    });
  });
  await flushOutbox(outbox);
  return result;
}

// ---------------------------------------------------------------- recovery

export type RecoverInput = {
  action: 'retry_routing' | 'choose_contributor';
  contributorId?: number;
  reason?: string;
  simulation?: SimulationOverride;
};

/**
 * AssignmentRecoveryService: reopen a declined or failed task. Complete assignment history
 * is preserved; the previous contributor is excluded from automatic routing again.
 */
export async function recover(taskId: number, input: RecoverInput, actor: Actor): Promise<{ task: TaskRow; routing?: RoutingRequestResult }> {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    const task = await lockTask(c, taskId);
    if (!RECOVERABLE.has(task.status as TaskStatus)) {
      throw conflict(`Recovery is available only for declined or failed assignments (task is "${task.status}").`);
    }
    const { rows: prev } = await c.query<{ reason: string | null; contributor_id: number }>(
      `SELECT reason, contributor_id FROM assignments
        WHERE task_id = $1 AND status IN ('declined','failed') ORDER BY id DESC LIMIT 1`,
      [task.id],
    );
    const previousReason = prev[0]?.reason ?? 'No reason recorded.';
    await recordEvent(
      c,
      {
        taskId: task.id,
        eventType: 'recovery_initiated',
        actor,
        previousState: task.status,
        contributorId: prev[0]?.contributor_id ?? null,
        explanation: `Recovery started. Previous reason: ${previousReason}${input.reason ? ` Operator note: ${input.reason}` : ''}`,
      },
      outbox,
    );

    if (input.action === 'retry_routing') {
      const excluded = await excludedContributorIds(c, task.id);
      const created = await createAttemptInTx(c, task, {
        action: 'submit_for_routing',
        actor,
        outbox,
        explanation: `Routing reopened after recovery. Previously declined or failed contributors excluded: ${excluded.length}.`,
        simulation: input.simulation,
      });
      return { task: created.task, routing: { task: created.task, attempt: created.attempt, created: true } };
    }

    if (input.contributorId === undefined) throw unprocessable('contributor_id is required to choose a contributor.');
    const assigned = await assignManuallyInTx(c, task, input.contributorId, actor, outbox, 'Recovery: operator chose a contributor.');
    return { task: assigned };
  });
  await flushOutbox(outbox);
  return result;
}
