// TaskTransitionService: the single path that changes tasks.status.
// It (1) validates the transition against the state machine, (2) updates the row
// guarded by both the expected status AND version (optimistic check inside the
// row lock), and (3) writes the audit event in the same transaction.
import type pg from 'pg';
import { assertTransition, type TaskAction, type TaskStatus } from '../domain/stateMachine.js';
import { conflict, notFound } from '../errors.js';
import { recordEvent, type Actor } from './audit.js';
import type { Outbox } from './outbox.js';

export type TaskRow = {
  id: number;
  title: string;
  description: string;
  required_expertise_id: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: TaskStatus;
  status_reason: string | null;
  due_date: string | null;
  version: number;
  current_routing_attempt_id: number | null;
  created_at: Date;
  updated_at: Date;
};

/** Locks the task row for the rest of the transaction. Every mutating path locks the task first. */
export async function lockTask(c: pg.PoolClient, taskId: number): Promise<TaskRow> {
  const { rows } = await c.query<TaskRow>('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
  if (!rows[0]) throw notFound('Task');
  return rows[0];
}

export type TransitionOptions = {
  actor: Actor;
  eventType: string;
  explanation: string;
  outbox: Outbox;
  reason?: string | null;
  contributorId?: number | null;
  routingAttemptId?: number | null;
  /** Pointer to the current pending routing attempt. Omit to leave it unchanged. */
  currentAttemptId?: number | null;
  metadata?: Record<string, unknown>;
};

export async function transition(
  c: pg.PoolClient,
  task: TaskRow,
  action: TaskAction,
  o: TransitionOptions,
): Promise<TaskRow> {
  const to = assertTransition(action, task.status);
  const pointer = o.currentAttemptId === undefined ? task.current_routing_attempt_id : o.currentAttemptId;
  const { rows } = await c.query<TaskRow>(
    `UPDATE tasks
        SET status = $2, status_reason = $3, current_routing_attempt_id = $4,
            version = version + 1, updated_at = now()
      WHERE id = $1 AND status = $5 AND version = $6
      RETURNING *`,
    [task.id, to, o.reason ?? null, pointer, task.status, task.version],
  );
  if (!rows[0]) {
    throw conflict('The task changed while this action was running. Reload it and try again.');
  }
  await recordEvent(
    c,
    {
      taskId: task.id,
      eventType: o.eventType,
      actor: o.actor,
      previousState: task.status,
      newState: to,
      contributorId: o.contributorId ?? null,
      routingAttemptId: o.routingAttemptId ?? null,
      explanation: o.explanation,
      metadata: o.metadata,
    },
    o.outbox,
  );
  return rows[0];
}
