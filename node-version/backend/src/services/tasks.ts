// TaskCreationService and task field updates. Status changes go through
// TaskTransitionService / routing / assignment services, never directly from here.
import { withTransaction } from '../db/index.js';
import { conflict, unprocessable } from '../errors.js';
import { type Actor, recordEvent } from './audit.js';
import { lockTask, type TaskRow } from './taskTransition.js';
import { createAttemptInTx, type RoutingRequestResult } from './routing.js';
import { flushOutbox, type Outbox } from './outbox.js';
import type { SimulationOverride } from './simulation.js';

export type CreateTaskInput = {
  title: string;
  description: string;
  required_expertise_id: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  submit: boolean;
};

const EDITABLE = new Set(['draft', 'needs_intervention']);

export async function createTask(
  input: CreateTaskInput,
  actor: Actor,
  simulation?: SimulationOverride,
): Promise<{ task: TaskRow; routing?: RoutingRequestResult }> {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    const { rows: ex } = await c.query('SELECT 1 FROM expertise_areas WHERE id = $1', [input.required_expertise_id]);
    if (ex.length === 0) throw unprocessable('Unknown expertise area.');
    const { rows } = await c.query<TaskRow>(
      `INSERT INTO tasks (title, description, required_expertise_id, priority, due_date, status)
       VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`,
      [input.title, input.description, input.required_expertise_id, input.priority, input.due_date],
    );
    let task = rows[0];
    await recordEvent(
      c,
      {
        taskId: task.id,
        eventType: 'task_created',
        actor,
        previousState: null,
        newState: 'draft',
        explanation: `Task "${task.title}" created as a draft.`,
      },
      outbox,
    );
    if (!input.submit) return { task };
    const created = await createAttemptInTx(c, task, {
      action: 'submit_for_routing',
      actor,
      outbox,
      simulation,
      explanation: 'Task submitted for routing. Waiting for a contributor response.',
    });
    return { task: created.task, routing: { ...created, created: true } };
  });
  await flushOutbox(outbox);
  return result;
}

export async function updateTaskFields(
  taskId: number,
  patch: Partial<Pick<CreateTaskInput, 'title' | 'description' | 'required_expertise_id' | 'priority' | 'due_date'>>,
  expectedVersion: number | undefined,
  actor: Actor,
): Promise<TaskRow> {
  const outbox: Outbox = [];
  const result = await withTransaction(async (c) => {
    const task = await lockTask(c, taskId);
    if (expectedVersion !== undefined && expectedVersion !== task.version) {
      throw conflict('Task was modified by someone else.', { current_version: task.version });
    }
    if (!EDITABLE.has(task.status)) {
      throw conflict(`Task fields can be edited only in draft or needs-intervention states (task is "${task.status}").`);
    }
    const next = { ...task, ...patch };
    const { rows } = await c.query<TaskRow>(
      `UPDATE tasks SET title=$2, description=$3, required_expertise_id=$4, priority=$5, due_date=$6,
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [task.id, next.title, next.description, next.required_expertise_id, next.priority, next.due_date],
    );
    await recordEvent(
      c,
      {
        taskId: task.id,
        eventType: 'task_updated',
        actor,
        previousState: task.status,
        newState: task.status,
        explanation: 'Task details updated.',
        metadata: { fields: Object.keys(patch) },
      },
      outbox,
    );
    return rows[0];
  });
  await flushOutbox(outbox);
  return result;
}
