// AuditEventService: every important transition writes a row to task_events in the
// SAME transaction as the change it describes, so history can never disagree with state.
import type pg from 'pg';
import { pool } from '../db/index.js';
import type { RealtimeEvent } from '../realtime.js';
import type { Outbox } from './outbox.js';

export type Actor = { type: 'operator' | 'contributor' | 'system'; id?: string | null };
export const SYSTEM: Actor = { type: 'system', id: null };

export type EventInput = {
  taskId: number;
  eventType: string;
  actor: Actor;
  previousState?: string | null;
  newState?: string | null;
  contributorId?: number | null;
  routingAttemptId?: number | null;
  explanation: string;
  metadata?: Record<string, unknown>;
  /** Also broadcast this event to realtime clients once the transaction commits. */
  broadcast?: boolean;
};

export async function recordEvent(client: pg.PoolClient, input: EventInput, outbox?: Outbox): Promise<void> {
  const row = await client.query<{ created_at: Date }>(
    `INSERT INTO task_events
       (task_id, event_type, actor_type, actor_id, previous_state, new_state,
        contributor_id, routing_attempt_id, explanation, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING created_at`,
    [
      input.taskId,
      input.eventType,
      input.actor.type,
      input.actor.id ?? null,
      input.previousState ?? null,
      input.newState ?? null,
      input.contributorId ?? null,
      input.routingAttemptId ?? null,
      input.explanation,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  if (input.broadcast !== false && outbox) {
    outbox.push({
      kind: 'broadcast',
      event: {
        type: input.eventType,
        taskId: input.taskId,
        payload: {
          previousState: input.previousState ?? null,
          newState: input.newState ?? null,
          contributorId: input.contributorId ?? null,
          routingAttemptId: input.routingAttemptId ?? null,
          explanation: input.explanation,
        },
        at: row.rows[0].created_at.toISOString(),
      } satisfies RealtimeEvent,
    });
  }
}

/** For background-triggered events that run outside an existing transaction. */
export async function recordSystemEvent(
  taskId: number,
  eventType: string,
  opts: { routingAttemptId?: number; explanation: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const client = await pool.connect();
  try {
    await recordEvent(client, {
      taskId,
      eventType,
      actor: SYSTEM,
      routingAttemptId: opts.routingAttemptId ?? null,
      explanation: opts.explanation,
      metadata: opts.metadata,
      broadcast: false,
    });
  } finally {
    client.release();
  }
}
