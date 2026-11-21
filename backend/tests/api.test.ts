import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { closeRealtime } from '../src/realtime.js';
import { resetDb, seedFixture, closeDb, scheduler } from './helpers.js';

let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof seedFixture>>;

beforeAll(() => {
  app = buildApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});
afterAll(async () => {
  await app.close();
  await closeRealtime();
  await closeDb();
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never });

describe('task API validation', () => {
  it('rejects a task with no title with a field-level 422', async () => {
    const res = await call('POST', '/api/v1/tasks', { title: '  ', priority: 'low', required_expertise_id: fx.expertise['Python'] });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toMatch(/title/i);
  });

  it('rejects an unknown priority and a malformed due date', async () => {
    const res = await call('POST', '/api/v1/tasks', {
      title: 'T', priority: 'extreme', required_expertise_id: fx.expertise['Python'],
    });
    expect(res.statusCode).toBe(422);
    const res2 = await call('POST', '/api/v1/tasks', {
      title: 'T', priority: 'low', required_expertise_id: fx.expertise['Python'], due_date: '11/20/2026',
    });
    expect(res2.statusCode).toBe(422);
  });

  it('creates a draft without routing when submit is false', async () => {
    const res = await call('POST', '/api/v1/tasks', {
      title: 'Draft task', priority: 'low', required_expertise_id: fx.expertise['Python'], submit: false,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('draft');
    expect(res.json().routing.state).toBe('idle');
  });

  it('submits for routing and reports pending without exposing the simulation outcome', async () => {
    const res = await call('POST', '/api/v1/tasks', {
      title: 'Routed', priority: 'urgent', required_expertise_id: fx.expertise['Python'], submit: true, simulation: 'never',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('routing_pending');
    expect(body.routing.state).toBe('pending');
    expect(body.routing.pending_seconds).toBeGreaterThanOrEqual(0);
    expect(res.body).not.toMatch(/simulated/);
  });

  it('returns 404 for unknown tasks and bad ids for non-numeric paths', async () => {
    expect((await call('GET', '/api/v1/tasks/999999')).statusCode).toBe(404);
    expect((await call('GET', '/api/v1/tasks/abc')).statusCode).toBe(400);
  });
});

describe('task listing', () => {
  it('filters by status and searches by title with pagination metadata', async () => {
    await call('POST', '/api/v1/tasks', { title: 'Alpha deploy', priority: 'low', required_expertise_id: fx.expertise['Python'] });
    await call('POST', '/api/v1/tasks', { title: 'Beta cleanup', priority: 'low', required_expertise_id: fx.expertise['Ruby'] });
    const all = await call('GET', '/api/v1/tasks?per_page=1');
    expect(all.json().meta).toMatchObject({ total: 2, per_page: 1, total_pages: 2 });
    const searched = await call('GET', '/api/v1/tasks?search=alpha');
    expect(searched.json().data.map((t: { title: string }) => t.title)).toEqual(['Alpha deploy']);
    const drafts = await call('GET', '/api/v1/tasks?status=draft');
    expect(drafts.json().meta.total).toBe(2);
  });
});

describe('routing and recovery over HTTP', () => {
  it('routes, lets a contributor accept, and shows the history', async () => {
    const created = await call('POST', '/api/v1/tasks', {
      title: 'Flow', priority: 'high', required_expertise_id: fx.expertise['Python'], submit: true, simulation: 'success',
    });
    const taskId = created.json().id;
    const attemptId = created.json().routing.attempt_id;
    const { deliver } = await import('./helpers.js');
    await deliver(attemptId);

    const detail = (await call('GET', `/api/v1/tasks/${taskId}`)).json();
    expect(detail.status).toBe('awaiting_acceptance');
    const assignmentId = detail.assignments[0].id;

    const accepted = await call('POST', `/api/v1/assignments/${assignmentId}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().task.status).toBe('assigned');

    const again = await call('POST', `/api/v1/assignments/${assignmentId}/accept`);
    expect(again.json().idempotent).toBe(true);

    const history = (await call('GET', `/api/v1/tasks/${taskId}/history`)).json().data;
    expect(history.map((h: { event_type: string }) => h.event_type)).toContain('assignment_accepted');
  });

  it('requires a decline reason and reports invalid intervention as 409', async () => {
    const created = await call('POST', '/api/v1/tasks', {
      title: 'Needs reason', priority: 'low', required_expertise_id: fx.expertise['Python'], submit: true, simulation: 'never',
    });
    const id = created.json().id;
    const bad = await call('POST', `/api/v1/tasks/${id}/intervene`, { action: 'assign' });
    expect(bad.statusCode).toBe(422);
    await call('POST', `/api/v1/tasks/${id}/intervene`, { action: 'cancel' });
    const conflict = await call('POST', `/api/v1/tasks/${id}/intervene`, { action: 'assign', contributor_id: fx.people['Ava'] });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('invalid_transition');
  });

  it('refuses simulation controls when they are disabled', async () => {
    const { config } = await import('../src/config.js');
    const original = config.simulationControls;
    (config as { simulationControls: boolean }).simulationControls = false;
    try {
      const res = await call('POST', '/api/v1/tasks', {
        title: 'Forced', priority: 'low', required_expertise_id: fx.expertise['Python'], simulation: 'never',
      });
      expect(res.statusCode).toBe(403);
    } finally {
      (config as { simulationControls: boolean }).simulationControls = original;
    }
  });
});

describe('contributors and dashboard', () => {
  it('creates a contributor with expertise and lists active counts', async () => {
    const res = await call('POST', '/api/v1/contributors', {
      name: 'New Person', email: 'new@test.dev', expertise_ids: [fx.expertise['QA']],
    });
    expect(res.statusCode).toBe(201);
    const list = (await call('GET', '/api/v1/contributors')).json().data;
    expect(list.find((c: { name: string }) => c.name === 'New Person').expertise).toEqual(['QA']);
  });

  it('returns dashboard counts drawn from the database', async () => {
    await call('POST', '/api/v1/tasks', { title: 'D1', priority: 'low', required_expertise_id: fx.expertise['Python'], submit: true, simulation: 'never' });
    await call('POST', '/api/v1/tasks', { title: 'D2', priority: 'low', required_expertise_id: fx.expertise['Python'] });
    const s = (await call('GET', '/api/v1/dashboard/summary')).json();
    expect(s.counts.total_tasks).toBe(2);
    expect(s.counts.awaiting_routing).toBe(1);
    expect(s.counts.unresolved_routing_requests).toBe(1);
  });

  it('health endpoint reports the database', async () => {
    const res = await call('GET', '/api/v1/health');
    expect(res.json()).toEqual({ status: 'ok', database: 'up' });
    expect(scheduler).toBeDefined();
  });
});
