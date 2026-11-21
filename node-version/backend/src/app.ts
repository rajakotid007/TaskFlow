// HTTP API (versioned under /api/v1). Controllers stay thin: validate with zod,
// call a service, serialize. All business rules live in src/services.
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z, ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './errors.js';
import { pool } from './db/index.js';
import * as read from './services/readModels.js';
import { createTask, updateTaskFields } from './services/tasks.js';
import { requestRouting } from './services/routing.js';
import { acceptAssignment, declineAssignment, intervene, advanceWork, recover } from './services/assignments.js';
import { createContributor, updateContributor } from './services/contributors.js';
import type { Actor } from './services/audit.js';
import type { SimulationOverride } from './services/simulation.js';

export const OPERATOR: Actor = { type: 'operator', id: 'operator' };

const PRIORITY = z.enum(['low', 'medium', 'high', 'urgent']);
const SIM = z.enum(['success', 'delayed', 'never']).optional();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').nullable().optional();

const taskCreate = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200, 'Title must be 200 characters or fewer.'),
  description: z.string().max(5000).default(''),
  required_expertise_id: z.number().int().positive('Choose a required expertise.'),
  priority: PRIORITY,
  due_date: dateStr,
  submit: z.boolean().default(false),
  simulation: SIM,
});

const taskPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  required_expertise_id: z.number().int().positive().optional(),
  priority: PRIORITY.optional(),
  due_date: dateStr,
  status: z.enum(['in_progress', 'completed']).optional(),
  expected_version: z.number().int().optional(),
});

const routeBody = z.object({ expected_version: z.number().int().optional(), simulation: SIM });

const interveneBody = z
  .object({
    action: z.enum(['assign', 'reroute', 'fail_assignment', 'cancel']),
    contributor_id: z.number().int().positive().optional(),
    reason: z.string().trim().max(500).optional(),
    expected_version: z.number().int().optional(),
    simulation: SIM,
  })
  .refine((b) => b.action !== 'assign' || b.contributor_id !== undefined, {
    message: 'contributor_id is required for assign.',
    path: ['contributor_id'],
  });

const recoverBody = z
  .object({
    action: z.enum(['retry_routing', 'choose_contributor']),
    contributor_id: z.number().int().positive().optional(),
    reason: z.string().trim().max(500).optional(),
    simulation: SIM,
  })
  .refine((b) => b.action !== 'choose_contributor' || b.contributor_id !== undefined, {
    message: 'contributor_id is required to choose a contributor.',
    path: ['contributor_id'],
  });

const contributorBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  availability: z.enum(['available', 'limited', 'unavailable']).optional(),
  max_active_assignments: z.number().int().min(0).max(50).optional(),
  expertise_ids: z.array(z.number().int().positive()).min(1, 'Choose at least one expertise area.'),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(422, 'validation_failed', r.error.issues[0].message, {
      fields: r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

/** Simulation controls are development-only. Rejects them when disabled. */
function simulationOverride(v: SimulationOverride | undefined): SimulationOverride | undefined {
  if (v === undefined) return undefined;
  if (!config.simulationControls) {
    throw new AppError(403, 'simulation_disabled', 'Simulation controls are disabled in this environment.');
  }
  return v;
}

const idParam = (raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, 'bad_id', 'Identifier must be a positive integer.');
  return n;
};

const toTaskShape = (task: { id: number }) => read.getTask(task.id);

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  app.register(cors, { origin: config.corsOrigin, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    }
    if (err instanceof ZodError) {
      return reply.status(422).send({ error: { code: 'validation_failed', message: err.issues[0]?.message ?? 'Invalid input.', details: null } });
    }
    const code = (err as { code?: string }).code ?? '';
    if (code === 'ECONNREFUSED' || code.startsWith('08') || code === '57P01') {
      return reply.status(503).send({ error: { code: 'database_unavailable', message: 'The database is unavailable. Try again shortly.', details: null } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'bad_request', message: (err as Error).message, details: null } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong. The error has been logged.', details: null } });
  });

  app.get('/api/v1/health', async () => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  });

  app.get('/api/v1/expertise-areas', async () => ({ data: await read.listExpertiseAreas() }));

  // ------------------------------------------------------------ tasks
  app.get('/api/v1/tasks', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const p = pageQuery.parse({ page: q.page, per_page: q.per_page });
    const statusList = q.status ? q.status.split(',').filter(Boolean) : undefined;
    return read.listTasks({
      search: q.search?.trim() || undefined,
      status: statusList,
      priority: q.priority || undefined,
      expertiseId: q.expertise_id ? Number(q.expertise_id) : undefined,
      routing: q.routing === 'pending' ? 'pending' : undefined,
      page: p.page,
      perPage: p.per_page,
    });
  });

  app.post('/api/v1/tasks', async (req, reply) => {
    const body = parse(taskCreate, req.body);
    const sim = simulationOverride(body.simulation);
    const { task } = await createTask(
      { title: body.title, description: body.description, required_expertise_id: body.required_expertise_id, priority: body.priority, due_date: body.due_date ?? null, submit: body.submit },
      OPERATOR,
      sim,
    );
    return reply.status(201).send(await toTaskShape(task));
  });

  app.get('/api/v1/tasks/:id', async (req) => read.getTask(idParam((req.params as { id: string }).id)));

  app.patch('/api/v1/tasks/:id', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const body = parse(taskPatch, req.body);
    if (body.status === 'in_progress' || body.status === 'completed') {
      await advanceWork(id, body.status, OPERATOR);
    }
    const { status: _s, expected_version, ...fields } = body;
    const definedFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (Object.keys(definedFields).length > 0) {
      await updateTaskFields(id, definedFields as never, expected_version, OPERATOR);
    }
    return read.getTask(id);
  });

  app.post('/api/v1/tasks/:id/route', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const body = parse(routeBody, req.body ?? {});
    const result = await requestRouting(id, {
      actor: OPERATOR,
      simulation: simulationOverride(body.simulation),
      expectedVersion: body.expected_version,
    });
    return { created: result.created, attempt_id: result.attempt.id, task: await read.getTask(id) };
  });

  app.post('/api/v1/tasks/:id/intervene', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const body = parse(interveneBody, req.body);
    await intervene(
      id,
      {
        action: body.action,
        contributorId: body.contributor_id,
        reason: body.reason,
        simulation: simulationOverride(body.simulation),
        expectedVersion: body.expected_version,
      },
      OPERATOR,
    );
    return read.getTask(id);
  });

  app.post('/api/v1/tasks/:id/recover', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const body = parse(recoverBody, req.body);
    await recover(
      id,
      { action: body.action, contributorId: body.contributor_id, reason: body.reason, simulation: simulationOverride(body.simulation) },
      OPERATOR,
    );
    return read.getTask(id);
  });

  app.get('/api/v1/tasks/:id/history', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const q = req.query as { event_type?: string };
    return { data: await read.taskHistory(id, q.event_type) };
  });

  // ------------------------------------------------------------ assignments (contributor actions)
  app.post('/api/v1/assignments/:id/accept', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const { assignment, task, idempotent } = await acceptAssignment(id);
    return { idempotent, assignment_id: assignment.id, task: await read.getTask(task.id) };
  });

  app.post('/api/v1/assignments/:id/decline', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const body = parse(z.object({ reason: z.string().trim().min(1, 'A decline reason is required.').max(500) }), req.body);
    const { assignment, task, idempotent } = await declineAssignment(id, body.reason);
    return { idempotent, assignment_id: assignment.id, task: await read.getTask(task.id) };
  });

  // ------------------------------------------------------------ contributors
  app.get('/api/v1/contributors', async () => ({ data: await read.listContributors() }));
  app.post('/api/v1/contributors', async (req, reply) => {
    const body = parse(contributorBody, req.body);
    const id = await createContributor({
      name: body.name,
      email: body.email,
      availability: body.availability,
      max_active_assignments: body.max_active_assignments,
      expertise_ids: body.expertise_ids,
    });
    return reply.status(201).send(await read.getContributor(id));
  });
  app.get('/api/v1/contributors/:id', async (req) => read.getContributor(idParam((req.params as { id: string }).id)));
  app.patch('/api/v1/contributors/:id', async (req) => {
    const id = idParam((req.params as { id: string }).id);
    const body = parse(contributorBody.partial(), req.body);
    await updateContributor(id, body);
    return read.getContributor(id);
  });

  // ------------------------------------------------------------ routing + dashboard + events
  app.get('/api/v1/routing-attempts', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const p = pageQuery.parse({ page: q.page, per_page: q.per_page });
    return read.listAttempts({ status: q.status || undefined, page: p.page, perPage: p.per_page });
  });
  app.get('/api/v1/routing-attempts/:id', async (req) => read.getAttempt(idParam((req.params as { id: string }).id)));

  app.get('/api/v1/dashboard/summary', async () => read.dashboardSummary());

  app.get('/api/v1/events', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const p = pageQuery.parse({ page: q.page, per_page: q.per_page });
    return read.listEvents({
      taskId: q.task_id ? idParam(q.task_id) : undefined,
      eventType: q.event_type || undefined,
      page: p.page,
      perPage: p.per_page,
    });
  });

  app.get('/api/v1/simulation/status', async () => ({ controls_enabled: config.simulationControls }));

  return app;
}
