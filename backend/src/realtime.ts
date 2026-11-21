// Realtime fan-out. Services publish events to Redis; the API process subscribes
// and forwards them to connected WebSocket clients (Action Cable equivalent).
// Events are deliberately sanitized: never include a predetermined simulation outcome.
import { Redis } from 'ioredis';
import { config, REDIS_CHANNEL } from './config.js';

export type RealtimeEvent = {
  type: string; // e.g. routing_started, assignment_proposed, stale_result_ignored
  taskId: number | null;
  payload?: Record<string, unknown>;
  at: string;
};

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000 });
    publisher.on('error', (err) => console.error('[realtime] redis publisher error', err.message));
  }
  return publisher;
}

export async function publish(event: Omit<RealtimeEvent, 'at'> & { at?: string }): Promise<void> {
  const full: RealtimeEvent = { ...event, at: event.at ?? new Date().toISOString() };
  // Skip while the connection is not ready: clients recover via polling and the database.
  if (getPublisher().status !== 'ready') return;
  try {
    await getPublisher().publish(REDIS_CHANNEL, JSON.stringify(full));
  } catch (err) {
    // Realtime is a convenience. The database is the source of truth and the
    // UI falls back to polling, so a publish failure is logged, not thrown.
    console.error('[realtime] publish failed', err instanceof Error ? err.message : err);
  }
}

export function createSubscriber(onEvent: (e: RealtimeEvent) => void): Redis {
  const sub = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  sub.on('error', (err) => console.error('[realtime] redis subscriber error', err.message));
  void sub.subscribe(REDIS_CHANNEL);
  sub.on('message', (_channel, message) => {
    try {
      onEvent(JSON.parse(message) as RealtimeEvent);
    } catch {
      /* ignore malformed */
    }
  });
  return sub;
}

export async function closeRealtime(): Promise<void> {
  await publisher?.quit().catch(() => undefined);
  publisher = null;
}
