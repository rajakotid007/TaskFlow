import pg from 'pg';
import { config } from '../config.js';

export type Db = pg.Pool | pg.PoolClient;

// Parse bigint (int8) and bigint[] into JS numbers. IDs stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1016 as unknown as Parameters<typeof pg.types.setTypeParser>[0], (v) => (v === '{}' ? [] : v.slice(1, -1).split(',').map(Number)));
// DATE values stay as 'YYYY-MM-DD' strings rather than timezone-shifted Date objects.
pg.types.setTypeParser(1082 as unknown as Parameters<typeof pg.types.setTypeParser>[0], (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

pool.on('error', (err) => {
  // Idle client errors (e.g. server restart) must not crash the process.
  console.error('[db] idle client error', err.message);
});

/** Runs fn inside a transaction. Rolls back on any thrown error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
