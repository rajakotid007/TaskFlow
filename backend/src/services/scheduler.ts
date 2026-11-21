// Routing scheduler abstraction. Production uses BullMQ (Redis-backed, delayed
// jobs). Tests inject an in-memory scheduler so they never wait for real delays.
export interface RoutingScheduler {
  /**
   * Schedule delivery of a routing result after delayMs. The request token (a UUID unique per
   * attempt, never reused) identifies the job, so IDs reused after a reset cannot collide.
   */
  schedule(attemptId: number, delayMs: number, requestToken: string): Promise<void>;
  /**
   * Called when an attempt is superseded. Implementations may drop the queued result, but the
   * production scheduler keeps it so the late response is observed and recorded as ignored.
   */
  cancel(attemptId: number): Promise<void>;
}

let current: RoutingScheduler | null = null;

export function setScheduler(s: RoutingScheduler | null): void {
  current = s;
}

export function getScheduler(): RoutingScheduler {
  if (!current) throw new Error('No routing scheduler configured. Call setScheduler() at startup.');
  return current;
}
