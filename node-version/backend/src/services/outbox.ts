// Side effects that must happen only AFTER a database transaction commits:
// realtime broadcasts and queue operations. Services collect them inside the
// transaction and call flushOutbox() once it has committed. This prevents a
// rolled-back transaction from leaking events or scheduling a job for a
// routing attempt that does not exist.
import { getScheduler } from './scheduler.js';
import { publish, type RealtimeEvent } from '../realtime.js';
import { recordSystemEvent } from './audit.js';

export type OutboxItem =
  | { kind: 'broadcast'; event: RealtimeEvent }
  | { kind: 'schedule'; attemptId: number; taskId: number; delayMs: number; requestToken: string }
  | { kind: 'cancel'; attemptId: number; taskId: number };

export type Outbox = OutboxItem[];

export async function flushOutbox(outbox: Outbox): Promise<void> {
  for (const item of outbox) {
    if (item.kind === 'broadcast') {
      await publish(item.event);
      continue;
    }
    try {
      if (item.kind === 'schedule') {
        await getScheduler().schedule(item.attemptId, item.delayMs, item.requestToken);
      } else {
        await getScheduler().cancel(item.attemptId);
      }
    } catch (err) {
      // Queue failure must not corrupt task state. The attempt stays pending in the
      // database, is visible to the operator, and can be re-dispatched via reroute.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[outbox] ${item.kind} failed for attempt ${item.attemptId}: ${message}`);
      if (item.kind === 'schedule') {
        await recordSystemEvent(item.taskId, 'routing_dispatch_failed', {
          routingAttemptId: item.attemptId,
          explanation: 'The routing job could not be queued. The request remains pending; reroute to retry.',
          metadata: { error: message },
        });
      }
    }
  }
}
