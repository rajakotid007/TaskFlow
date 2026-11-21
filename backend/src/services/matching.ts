// ExpertiseMatchingService. Deliberately simple, documented in ASSUMPTIONS.md:
//   1. Contributor must hold the task's required expertise area.
//   2. Availability must not be 'unavailable'.
//   3. Active assignment count (proposed + accepted) must be below the contributor's capacity.
//   4. Contributors who declined or failed this task are excluded.
//   5. Least-loaded first, then lowest id (deterministic tie-break).
// Candidate contributor rows are locked FOR UPDATE so two concurrent routing
// results cannot both take the last slot of one contributor.
import type pg from 'pg';

export type Candidate = { id: number; name: string };

export async function findEligibleContributor(
  client: pg.PoolClient,
  expertiseAreaId: number,
  excludedIds: number[],
): Promise<Candidate | null> {
  const { rows } = await client.query<Candidate>(
    `SELECT c.id, c.name
       FROM contributors c
       JOIN contributor_expertise ce ON ce.contributor_id = c.id
      WHERE ce.expertise_area_id = $1
        AND c.availability <> 'unavailable'
        AND NOT (c.id = ANY($2::bigint[]))
        AND (
          SELECT count(*) FROM assignments a
           WHERE a.contributor_id = c.id AND a.status IN ('proposed','accepted')
        ) < c.max_active_assignments
      ORDER BY (
          SELECT count(*) FROM assignments a
           WHERE a.contributor_id = c.id AND a.status IN ('proposed','accepted')
        ) ASC, c.id ASC
      LIMIT 1
      FOR UPDATE OF c`,
    [expertiseAreaId, excludedIds],
  );
  return rows[0] ?? null;
}

/** True when a contributor holds the expertise (used to validate manual assignment). */
export async function hasExpertise(
  client: pg.PoolClient,
  contributorId: number,
  expertiseAreaId: number,
): Promise<boolean> {
  const { rowCount } = await client.query(
    'SELECT 1 FROM contributor_expertise WHERE contributor_id=$1 AND expertise_area_id=$2',
    [contributorId, expertiseAreaId],
  );
  return (rowCount ?? 0) > 0;
}
