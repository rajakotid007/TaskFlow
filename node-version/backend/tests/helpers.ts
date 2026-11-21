import { pool } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { setScheduler } from '../src/services/scheduler.js';
import { createContributor } from '../src/services/contributors.js';
import { handleRoutingResult } from '../src/services/routing.js';
import { OPERATOR } from '../src/app.js';

/** In-memory scheduler: records delays and lets tests deliver results on demand. */
export class FakeScheduler {
  scheduled = new Map<number, number>();
  cancelled: number[] = [];
  async schedule(attemptId: number, delayMs: number) {
    this.scheduled.set(attemptId, delayMs);
  }
  async cancel(attemptId: number) {
    this.cancelled.push(attemptId);
    this.scheduled.delete(attemptId);
  }
}

export const scheduler = new FakeScheduler();
export const deliver = (attemptId: number) => handleRoutingResult(attemptId);
export const operator = OPERATOR;

export async function resetDb(): Promise<void> {
  await migrate();
  await pool.query(
    'TRUNCATE task_events, assignments, routing_attempts, tasks, contributor_expertise, contributors, expertise_areas RESTART IDENTITY CASCADE',
  );
  scheduler.scheduled.clear();
  scheduler.cancelled = [];
  setScheduler(scheduler);
}

/** Creates expertise areas and contributors; returns ids keyed by name. */
export async function seedFixture() {
  const areas = ['Python', 'Ruby', 'Security', 'QA'];
  const expertise: Record<string, number> = {};
  for (const name of areas) {
    const { rows } = await pool.query<{ id: number }>('INSERT INTO expertise_areas (name) VALUES ($1) RETURNING id', [name]);
    expertise[name] = rows[0].id;
  }
  const people: Record<string, number> = {};
  const specs: Array<[string, string[], ('available' | 'unavailable')?]> = [
    ['Ava', ['Python']],
    ['Mei', ['Python']],
    ['Ruby Dev', ['Ruby']],
    ['Offline Dev', ['Python'], 'unavailable'],
    ['Hannah', ['QA']],
  ];
  for (const [name, areasFor, availability] of specs) {
    people[name] = await createContributor({
      name,
      email: `${name.toLowerCase().replace(/\s/g, '.')}@test.dev`,
      availability,
      expertise_ids: areasFor.map((a) => expertise[a]),
    });
  }
  return { expertise, people };
}

export async function countRows(table: string, where = 'true'): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return rows[0].n;
}

export async function eventTypes(taskId: number): Promise<string[]> {
  const { rows } = await pool.query<{ event_type: string }>(
    'SELECT event_type FROM task_events WHERE task_id = $1 ORDER BY id',
    [taskId],
  );
  return rows.map((r) => r.event_type);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
