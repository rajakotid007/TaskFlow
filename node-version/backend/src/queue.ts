// BullMQ-backed routing scheduler. Each routing result is a DELAYED job keyed by attempt id,
// so a cancellation (manual intervention) can remove it. A missed or late job is still
// harmless: the result handler re-checks validity before applying anything.
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { config, ROUTING_QUEUE } from './config.js';
import type { RoutingScheduler } from './services/scheduler.js';

export const redisConnectionOptions = { maxRetriesPerRequest: null };

let queue: Queue | null = null;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(ROUTING_QUEUE, {
      connection: new Redis(config.redisUrl, redisConnectionOptions),
      defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500, attempts: 1 },
    });
  }
  return queue;
}

export const bullScheduler: RoutingScheduler = {
  async schedule(attemptId, delayMs, requestToken) {
    await getQueue().add(
      'routing-result',
      { attemptId, requestToken },
      { jobId: `attempt-${attemptId}-${requestToken}`, delay: delayMs },
    );
  },
  async cancel() {
    // Deliberately a no-op. A superseded request's result is still delivered later and the
    // handler records it as "stale result ignored" (Use Case 3). Removing the job would hide
    // that late response from the audit history. Correctness does not depend on this call.
  },
};

export function startRoutingWorker(handler: (attemptId: number, requestToken: string) => Promise<unknown>): Worker {
  return new Worker(
    ROUTING_QUEUE,
    async (job: Job<{ attemptId: number; requestToken: string }>) => handler(job.data.attemptId, job.data.requestToken),
    { connection: new Redis(config.redisUrl, redisConnectionOptions), concurrency: 10 },
  );
}
