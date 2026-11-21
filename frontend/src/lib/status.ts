import type { AssignmentStatus, Priority, RoutingStatus, TaskStatus } from '../api/types'

/**
 * Colour language (see README): blue = routing activity, green = successful
 * assignment, amber = waiting / attention, red = declined or failed,
 * gray = inactive or finished.
 */
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'violet'

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone; hint: string }> = {
  draft: { label: 'Draft', tone: 'gray', hint: 'Saved but not yet submitted for routing.' },
  routing_pending: {
    label: 'Routing pending',
    tone: 'blue',
    hint: 'A routing request is outstanding. No result has been received yet.',
  },
  awaiting_acceptance: {
    label: 'Awaiting acceptance',
    tone: 'amber',
    hint: 'The routing engine proposed a contributor who has not yet responded.',
  },
  assigned: { label: 'Assigned', tone: 'green', hint: 'A contributor owns this task.' },
  in_progress: { label: 'In progress', tone: 'green', hint: 'The assignee has started work.' },
  completed: { label: 'Completed', tone: 'gray', hint: 'Work is finished.' },
  declined: { label: 'Declined', tone: 'red', hint: 'The proposed contributor declined. Choose how to recover.' },
  assignment_failed: {
    label: 'Assignment failed',
    tone: 'red',
    hint: 'No assignment is in place. Retry routing or assign someone manually.',
  },
  cancelled: { label: 'Cancelled', tone: 'gray', hint: 'Cancelled by an operator.' },
}

export const STATUS_REASON: Record<string, string> = {
  contributor_declined: 'Contributor declined the offer',
  no_eligible_contributor: 'Routing found no eligible contributor',
  assignment_released: 'Assignment released before work began',
}

export const ROUTING_STATUS: Record<RoutingStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'blue' },
  matched: { label: 'Matched', tone: 'green' },
  no_match: { label: 'No match', tone: 'red' },
  superseded: { label: 'Superseded', tone: 'gray' },
}

export const ASSIGNMENT_STATUS: Record<AssignmentStatus, { label: string; tone: Tone }> = {
  offered: { label: 'Offered', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  withdrawn: { label: 'Withdrawn', tone: 'gray' },
  completed: { label: 'Completed', tone: 'gray' },
}

export const PRIORITY: Record<Priority, { label: string; tone: Tone; rank: number }> = {
  urgent: { label: 'Urgent', tone: 'red', rank: 4 },
  high: { label: 'High', tone: 'amber', rank: 3 },
  medium: { label: 'Medium', tone: 'blue', rank: 2 },
  low: { label: 'Low', tone: 'gray', rank: 1 },
}

export const EVENT_LABEL: Record<string, string> = {
  task_created: 'Task created',
  task_updated: 'Task updated',
  routing_requested: 'Routing requested',
  routing_superseded: 'Routing superseded',
  routing_matched: 'Routing matched',
  routing_no_match: 'No match',
  stale_result_ignored: 'Late result ignored',
  assignment_offered: 'Offer made',
  assignment_accepted: 'Offer accepted',
  assignment_declined: 'Offer declined',
  assignment_withdrawn: 'Assignment withdrawn',
  assignment_released: 'Assignment released',
  manual_assignment: 'Manual assignment',
  recovery_initiated: 'Recovery',
  work_started: 'Work started',
  task_completed: 'Completed',
  task_cancelled: 'Cancelled',
}

export const EVENT_TONE: Record<string, Tone> = {
  routing_requested: 'blue',
  routing_matched: 'blue',
  routing_superseded: 'gray',
  routing_no_match: 'red',
  stale_result_ignored: 'violet',
  assignment_offered: 'amber',
  assignment_accepted: 'green',
  assignment_declined: 'red',
  assignment_withdrawn: 'gray',
  assignment_released: 'red',
  manual_assignment: 'green',
  recovery_initiated: 'amber',
  work_started: 'green',
  task_completed: 'gray',
  task_cancelled: 'gray',
}

export const ACTOR_LABEL: Record<string, string> = {
  operator: 'Operator',
  routing_engine: 'Routing engine',
  contributor: 'Contributor',
  system: 'System',
}

export function humanize(value: string | null | undefined) {
  if (!value) return ''
  const s = value.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
