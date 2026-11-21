// Routing worker process. Delivers delayed routing results from Redis/BullMQ.
// Persistent state lives in PostgreSQL, so restarting this process loses nothing:
// delayed jobs remain in Redis and stale results are ignored by the handler.
import { startRoutingWorker } from './queue.js';
import { handleRoutingResult } from './services/routing.js';
import { pool } from './db/index.js';
import { closeRealtime } from './realtime.js';

const worker = startRoutingWorker(async (attemptId, requestToken) => {
  const outcome = await handleRoutingResult(attemptId, requestToken);
  console.log(`[worker] routing attempt ${attemptId}: ${outcome}`);
  return outcome;
});

worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed: ${err.message}`));
console.log('TaskFlow routing worker started.');

const shutdown = async () => {
  await worker.close();
  await closeRealtime();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
