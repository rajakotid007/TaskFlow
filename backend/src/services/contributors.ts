// Contributor create/update. Expertise links are written in the same transaction as the contributor.
import { withTransaction } from '../db/index.js';
import { notFound, unprocessable } from '../errors.js';

export type ContributorInput = {
  name: string;
  email: string;
  availability?: 'available' | 'limited' | 'unavailable';
  max_active_assignments?: number;
  expertise_ids: number[];
};

async function assertExpertise(c: import('pg').PoolClient, ids: number[]): Promise<void> {
  if (ids.length === 0) throw unprocessable('A contributor needs at least one expertise area.');
  const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM expertise_areas WHERE id = ANY($1::bigint[])', [ids]);
  if (rows[0].n !== new Set(ids).size) throw unprocessable('One or more expertise areas do not exist.');
}

export async function createContributor(input: ContributorInput): Promise<number> {
  return withTransaction(async (c) => {
    await assertExpertise(c, input.expertise_ids);
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO contributors (name, email, availability, max_active_assignments)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.name, input.email, input.availability ?? 'available', input.max_active_assignments ?? 3],
    );
    for (const area of new Set(input.expertise_ids)) {
      await c.query('INSERT INTO contributor_expertise (contributor_id, expertise_area_id) VALUES ($1,$2)', [rows[0].id, area]);
    }
    return rows[0].id;
  });
}

export async function updateContributor(id: number, input: Partial<ContributorInput>): Promise<void> {
  await withTransaction(async (c) => {
    const { rowCount } = await c.query('SELECT 1 FROM contributors WHERE id = $1 FOR UPDATE', [id]);
    if (!rowCount) throw notFound('Contributor');
    await c.query(
      `UPDATE contributors SET
         name = COALESCE($2, name),
         email = COALESCE($3, email),
         availability = COALESCE($4, availability),
         max_active_assignments = COALESCE($5, max_active_assignments),
         updated_at = now()
       WHERE id = $1`,
      [id, input.name ?? null, input.email ?? null, input.availability ?? null, input.max_active_assignments ?? null],
    );
    if (input.expertise_ids) {
      await assertExpertise(c, input.expertise_ids);
      await c.query('DELETE FROM contributor_expertise WHERE contributor_id = $1', [id]);
      for (const area of new Set(input.expertise_ids)) {
        await c.query('INSERT INTO contributor_expertise (contributor_id, expertise_area_id) VALUES ($1,$2)', [id, area]);
      }
    }
  });
}
