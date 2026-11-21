import type { Priority, TaskStatus } from '../api/types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: 'Draft',
  routing_pending: 'Routing pending',
  awaiting_acceptance: 'Awaiting acceptance',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  assignment_failed: 'Assignment failed',
  needs_intervention: 'Needs intervention',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export const EVENT_LABEL: Record<string, string> = {
  task_created: 'Task created',
  task_updated: 'Task updated',
  routing_started: 'Routing started',
  routing_result_received: 'Routing result received',
  routing_no_match: 'No eligible contributor',
  routing_superseded: 'Routing request superseded',
  routing_dispatch_failed: 'Routing dispatch failed',
  assignment_proposed: 'Assignment proposed',
  assignment_accepted: 'Assignment accepted',
  assignment_declined: 'Assignment declined',
  assignment_failed: 'Assignment failed',
  manual_intervention: 'Manual intervention',
  recovery_initiated: 'Recovery initiated',
  stale_result_ignored: 'Stale result ignored',
  task_started: 'Work started',
  task_completed: 'Task completed',
  task_cancelled: 'Task cancelled',
};

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return '—';
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export const isOpenStatus = (s: TaskStatus) => s !== 'completed' && s !== 'cancelled';
