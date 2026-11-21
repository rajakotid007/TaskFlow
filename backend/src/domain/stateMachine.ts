import { AppError } from '../errors.js';

// Explicit task state machine. This is the ONLY place that decides whether a
// task transition is legal. Services call assertTransition() before writing.
//
// Task status (what the operator sees) is separate from:
//   - routing attempt status (routing_attempts.status)
//   - assignment status (assignments.status)

export const TASK_STATUSES = [
  'draft',
  'routing_pending',
  'awaiting_acceptance',
  'assigned',
  'in_progress',
  'completed',
  'declined',
  'assignment_failed',
  'needs_intervention',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Actions are the named reasons a task may move; each maps to one edge set below. */
export type TaskAction =
  | 'submit_for_routing' // draft | needs_intervention | declined | assignment_failed -> routing_pending
  | 'routing_returned' // routing_pending -> awaiting_acceptance (contributor matched)
  | 'routing_no_match' // routing_pending -> needs_intervention
  | 'manual_assign' // routing_pending | needs_intervention | declined | assignment_failed | awaiting_acceptance -> awaiting_acceptance
  | 'reroute' // awaiting_acceptance | routing_pending -> routing_pending
  | 'accept' // awaiting_acceptance -> assigned
  | 'decline' // awaiting_acceptance -> declined
  | 'fail_assignment' // awaiting_acceptance | assigned -> assignment_failed
  | 'start' // assigned -> in_progress
  | 'complete' // in_progress -> completed
  | 'cancel'; // any non-terminal -> cancelled

const T = (from: TaskStatus[], to: TaskStatus): Array<[TaskStatus, TaskStatus]> =>
  from.map((f) => [f, to]);

/** Edges keyed by action. Every legal (from, to) pair is listed explicitly. */
const EDGES: Record<Exclude<TaskAction, 'cancel'>, Array<[TaskStatus, TaskStatus]>> = {
  submit_for_routing: T(['draft', 'needs_intervention', 'declined', 'assignment_failed'], 'routing_pending'),
  routing_returned: T(['routing_pending'], 'awaiting_acceptance'),
  routing_no_match: T(['routing_pending'], 'needs_intervention'),
  manual_assign: T(
    ['routing_pending', 'needs_intervention', 'declined', 'assignment_failed', 'awaiting_acceptance'],
    'awaiting_acceptance',
  ),
  reroute: T(['awaiting_acceptance', 'routing_pending'], 'routing_pending'),
  accept: T(['awaiting_acceptance'], 'assigned'),
  decline: T(['awaiting_acceptance'], 'declined'),
  fail_assignment: T(['awaiting_acceptance', 'assigned'], 'assignment_failed'),
  start: T(['assigned'], 'in_progress'),
  complete: T(['in_progress'], 'completed'),
};

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'cancelled']);

/** Surfaces as HTTP 409 with code "invalid_transition". */
export class InvalidTransitionError extends AppError {
  constructor(
    readonly action: string,
    readonly from: TaskStatus,
  ) {
    super(409, 'invalid_transition', `Cannot ${action.replace(/_/g, ' ')} a task that is "${from.replace(/_/g, ' ')}".`);
  }
}

export function canTransition(action: TaskAction, from: TaskStatus): TaskStatus | null {
  if (action === 'cancel') return TERMINAL.has(from) ? null : 'cancelled';
  const edges = EDGES[action as keyof typeof EDGES];
  if (!edges) return null;
  const edge = edges.find(([f]) => f === from);
  return edge ? edge[1] : null;
}

/** Returns the target status, or throws InvalidTransitionError. */
export function assertTransition(action: TaskAction, from: TaskStatus): TaskStatus {
  const to = canTransition(action, from);
  if (!to) throw new InvalidTransitionError(action, from);
  return to;
}

/** Statuses from which the operator may run a recovery action. */
export const RECOVERABLE: ReadonlySet<TaskStatus> = new Set(['declined', 'assignment_failed']);
