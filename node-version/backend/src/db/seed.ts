// Development seed. Resets demo data, then drives the REAL services (not raw SQL) so every
// task carries genuine routing and assignment history. Routing results are delivered
// synchronously here by calling the result handler directly, so seeding takes seconds.
import { pool } from './index.js';
import { migrate } from './migrate.js';
import { createContributor } from '../services/contributors.js';
import { createTask } from '../services/tasks.js';
import { handleRoutingResult } from '../services/routing.js';
import { acceptAssignment, declineAssignment, intervene, advanceWork, recover } from '../services/assignments.js';
import { setScheduler } from '../services/scheduler.js';
import { OPERATOR } from '../app.js';
import { config } from '../config.js';
import { closeRealtime } from '../realtime.js';

if (config.env === 'production') {
  console.error('Refusing to seed in production.');
  process.exit(1);
}

const EXPERTISE = ['Ruby', 'Java', 'Python', 'React', 'TypeScript', 'DevOps', 'AI/ML', 'Database Engineering', 'QA', 'Security'];

const CONTRIBUTORS: Array<{ name: string; email: string; areas: string[]; availability?: 'available' | 'limited' | 'unavailable'; capacity?: number }> = [
  { name: 'Ava Chen', email: 'ava.chen@taskflow.dev', areas: ['Python', 'AI/ML'] },
  { name: 'Marcus Lee', email: 'marcus.lee@taskflow.dev', areas: ['Java', 'DevOps'] },
  { name: 'Priya Raman', email: 'priya.raman@taskflow.dev', areas: ['Ruby', 'Database Engineering'] },
  { name: 'Diego Alvarez', email: 'diego.alvarez@taskflow.dev', areas: ['React', 'TypeScript'] },
  { name: 'Hannah Kim', email: 'hannah.kim@taskflow.dev', areas: ['QA', 'TypeScript'] },
  { name: 'Samuel Okafor', email: 'samuel.okafor@taskflow.dev', areas: ['DevOps', 'Python'] },
  { name: 'Mei Tanaka', email: 'mei.tanaka@taskflow.dev', areas: ['AI/ML', 'Database Engineering'] },
  { name: 'Jonas Berg', email: 'jonas.berg@taskflow.dev', areas: ['Ruby', 'TypeScript'], availability: 'limited' },
  { name: 'Fatima Noor', email: 'fatima.noor@taskflow.dev', areas: ['Java', 'QA'] },
  { name: 'Liam O\'Connor', email: 'liam.oconnor@taskflow.dev', areas: ['React', 'QA'] },
  { name: 'Rohan Mehta', email: 'rohan.mehta@taskflow.dev', areas: ['Python', 'Ruby'], availability: 'unavailable' },
  { name: 'Chloe Dubois', email: 'chloe.dubois@taskflow.dev', areas: ['Database Engineering', 'DevOps'], capacity: 2 },
];

type Scenario =
  | 'draft' | 'awaiting' | 'assigned' | 'in_progress' | 'completed' | 'pending_never'
  | 'declined' | 'recovered' | 'no_match' | 'failed' | 'manual_late' | 'cancelled';

// 20 tasks covering every status and the required demonstration scenarios.
const PLAN: Array<{ title: string; area: string; priority: 'low' | 'medium' | 'high' | 'urgent'; due?: string; scenario: Scenario }> = [
  { title: 'Draft: onboarding API docs', area: 'Ruby', priority: 'low', scenario: 'draft' },
  { title: 'Draft: dashboard empty-state copy', area: 'React', priority: 'low', due: '2026-12-15', scenario: 'draft' },
  { title: 'Review payment webhook retries', area: 'Python', priority: 'high', due: '2026-11-30', scenario: 'awaiting' },
  { title: 'Upgrade TypeScript build pipeline', area: 'TypeScript', priority: 'medium', scenario: 'awaiting' },
  { title: 'Index slow reporting query', area: 'Database Engineering', priority: 'urgent', due: '2026-11-22', scenario: 'awaiting' },
  { title: 'Migrate CI runners to ARM', area: 'DevOps', priority: 'medium', scenario: 'assigned' },
  { title: 'Fine-tune support ticket classifier', area: 'AI/ML', priority: 'high', due: '2026-12-05', scenario: 'assigned' },
  { title: 'Refactor billing service to Java 21', area: 'Java', priority: 'medium', scenario: 'in_progress' },
  { title: 'Accessibility audit of settings page', area: 'QA', priority: 'high', scenario: 'in_progress' },
  { title: 'Add rate limiting to public API', area: 'Ruby', priority: 'urgent', due: '2026-11-25', scenario: 'completed' },
  { title: 'Evaluate embedding model latency', area: 'AI/ML', priority: 'low', scenario: 'completed' },
  { title: 'Investigate intermittent Redis timeouts', area: 'DevOps', priority: 'urgent', scenario: 'pending_never' },
  { title: 'Port data export to Python workers', area: 'Python', priority: 'medium', scenario: 'pending_never' },
  { title: 'Rewrite search filters in TypeScript', area: 'TypeScript', priority: 'high', scenario: 'pending_never' },
  { title: 'Replica lag alerting thresholds', area: 'Database Engineering', priority: 'medium', scenario: 'declined' },
  { title: 'Checkout form keyboard navigation', area: 'React', priority: 'medium', scenario: 'recovered' },
  { title: 'Penetration test remediation plan', area: 'Security', priority: 'urgent', scenario: 'no_match' },
  { title: 'Container image hardening', area: 'DevOps', priority: 'high', scenario: 'failed' },
  { title: 'End-to-end regression suite for checkout', area: 'QA', priority: 'high', scenario: 'manual_late' },
  { title: 'Retire legacy Java reporting job', area: 'Java', priority: 'low', scenario: 'cancelled' },
];

async function reset(): Promise<void> {
  await pool.query(
    'TRUNCATE task_events, assignments, routing_attempts, tasks, contributor_expertise, contributors, expertise_areas RESTART IDENTITY CASCADE',
  );
}

async function main(): Promise<void> {
  await migrate();
  // Seeding delivers results synchronously, so no queued jobs are needed.
  setScheduler({ schedule: async () => undefined, cancel: async () => undefined });
  await reset();

  const expertiseIds: Record<string, number> = {};
  for (const name of EXPERTISE) {
    const { rows } = await pool.query<{ id: number }>('INSERT INTO expertise_areas (name) VALUES ($1) RETURNING id', [name]);
    expertiseIds[name] = rows[0].id;
  }
  for (const c of CONTRIBUTORS) {
    await createContributor({
      name: c.name,
      email: c.email,
      availability: c.availability,
      max_active_assignments: c.capacity,
      expertise_ids: c.areas.map((a) => expertiseIds[a]),
    });
  }

  const counts: Record<string, number> = {};
  for (const item of PLAN) {
    console.log(`[seed] ${item.scenario}: ${item.title}`);
    const task = (
      await createTask(
        {
          title: item.title,
          description: `Seeded demonstration task (${item.scenario.replace(/_/g, ' ')}).`,
          required_expertise_id: expertiseIds[item.area],
          priority: item.priority,
          due_date: item.due ?? null,
          submit: item.scenario !== 'draft' && item.scenario !== 'cancelled',
        },
        OPERATOR,
        item.scenario === 'pending_never' || item.scenario === 'manual_late' ? 'never' : 'success',
      )
    ).task;
    const routing = item.scenario === 'draft' || item.scenario === 'cancelled' ? null : await latestAttempt(task.id);

    switch (item.scenario) {
      case 'draft':
        break;
      case 'cancelled':
        await intervene(task.id, { action: 'cancel', reason: 'Superseded by the Java 21 billing refactor.' }, OPERATOR);
        break;
      case 'pending_never':
        break; // stays pending: never returns
      case 'awaiting':
        await handleRoutingResult(routing!);
        break;
      case 'assigned':
      case 'in_progress':
      case 'completed': {
        await handleRoutingResult(routing!);
        const a = await currentAssignment(task.id);
        await acceptAssignment(a);
        if (item.scenario !== 'assigned') await advanceWork(task.id, 'in_progress', OPERATOR);
        if (item.scenario === 'completed') await advanceWork(task.id, 'completed', OPERATOR);
        break;
      }
      case 'declined': {
        await handleRoutingResult(routing!);
        await declineAssignment(await currentAssignment(task.id), 'Currently at capacity on another client engagement.');
        break;
      }
      case 'recovered': {
        await handleRoutingResult(routing!);
        await declineAssignment(await currentAssignment(task.id), 'Out of office until next week.');
        const r = await recover(task.id, { action: 'retry_routing', simulation: 'success' }, OPERATOR);
        if (r.routing) await handleRoutingResult(r.routing.attempt.id);
        break;
      }
      case 'no_match':
        await handleRoutingResult(routing!);
        break;
      case 'failed': {
        await handleRoutingResult(routing!);
        await acceptAssignment(await currentAssignment(task.id));
        await intervene(task.id, { action: 'fail_assignment', reason: 'Base image lacks the required scanner; blocked before work began.' }, OPERATOR);
        break;
      }
      case 'manual_late': {
        const pick = await contributorIdByName('Hannah Kim');
        await intervene(task.id, { action: 'assign', contributorId: pick, reason: 'Urgent QA coverage for the checkout release.' }, OPERATOR);
        // The original routing result arrives late. It must be ignored.
        await handleRoutingResult(routing!);
        break;
      }
    }
    counts[item.scenario] = (counts[item.scenario] ?? 0) + 1;
  }

  const { rows } = await pool.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM tasks GROUP BY status ORDER BY status');
  console.log('Seeded:', { contributors: CONTRIBUTORS.length, expertise_areas: EXPERTISE.length, tasks: PLAN.length });
  console.log('Task statuses:', Object.fromEntries(rows.map((r) => [r.status, r.n])));
  console.log('Scenarios:', counts);
}

async function latestAttempt(taskId: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM routing_attempts WHERE task_id = $1 ORDER BY id DESC LIMIT 1`,
    [taskId],
  );
  return rows[0].id;
}

async function currentAssignment(taskId: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM assignments WHERE task_id = $1 AND status IN ('proposed','accepted') ORDER BY id DESC LIMIT 1`,
    [taskId],
  );
  return rows[0].id;
}

async function contributorIdByName(name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM contributors WHERE name = $1', [name]);
  return rows[0].id;
}

main()
  .then(async () => {
    await closeRealtime();
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await closeRealtime();
    await pool.end();
    process.exit(1);
  });
