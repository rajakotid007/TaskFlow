export type TaskStatus =
  | 'draft' | 'routing_pending' | 'awaiting_acceptance' | 'assigned' | 'in_progress' | 'completed'
  | 'declined' | 'assignment_failed' | 'needs_intervention' | 'cancelled';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type Task = {
  id: number;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  status_reason: string | null;
  due_date: string | null;
  version: number;
  expertise: { id: number; name: string };
  created_at: string;
  updated_at: string;
  routing: { state: 'pending' | 'idle'; attempt_id: number | null; pending_seconds: number | null };
  current_assignment: {
    id: number;
    status: string;
    source: 'routing' | 'manual';
    contributor: { id: number; name: string };
  } | null;
};

export type Attempt = {
  id: number;
  status: 'pending' | 'resolved' | 'no_match' | 'superseded';
  started_at: string;
  completed_at: string | null;
  superseded_at: string | null;
  late_result_at: string | null;
  pending_seconds: number | null;
  selected_contributor: { id: number; name: string } | null;
};

export type Assignment = {
  id: number;
  status: 'proposed' | 'accepted' | 'declined' | 'failed' | 'released' | 'completed';
  source: 'routing' | 'manual';
  reason: string | null;
  routing_attempt_id: number | null;
  contributor: { id: number; name: string };
  offered_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  ended_at: string | null;
};

export type HistoryEvent = {
  id: number;
  event_type: string;
  actor_type: 'operator' | 'contributor' | 'system';
  actor_id: string | null;
  previous_state: string | null;
  new_state: string | null;
  contributor_id: number | null;
  routing_attempt_id: number | null;
  explanation: string;
  created_at: string;
};

export type TaskDetail = Task & { attempts: Attempt[]; assignments: Assignment[]; history: HistoryEvent[] };

export type Page<T> = { data: T[]; meta: { page: number; per_page: number; total: number; total_pages: number } };

export type Contributor = {
  id: number;
  name: string;
  email: string;
  availability: 'available' | 'limited' | 'unavailable';
  max_active_assignments: number;
  expertise: string[];
  active_assignment_count: number;
  assigned_tasks: Array<{ task_id: number; title: string; task_status: TaskStatus; assignment_status: string }>;
};

export type Expertise = { id: number; name: string };

export type DashboardSummary = {
  counts: {
    total_tasks: number;
    awaiting_routing: number;
    awaiting_acceptance: number;
    active_assignments: number;
    unresolved_routing_requests: number;
    requiring_intervention: number;
    declined_or_failed: number;
    completed: number;
  };
  open_by_priority: Partial<Record<Priority, number>>;
  unresolved_requests: Array<{ task_id: number; title: string; priority: Priority; pending_seconds: number }>;
  activity: Array<{ id: number; task_id: number; task_title: string; event_type: string; explanation: string; created_at: string }>;
};

export type EventRow = {
  id: number;
  task_id: number;
  task_title: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  previous_state: string | null;
  new_state: string | null;
  contributor_name: string | null;
  routing_attempt_id: number | null;
  explanation: string;
  created_at: string;
};

export type RoutingAttemptRow = {
  id: number;
  task_id: number;
  task_title: string;
  priority: Priority;
  status: Attempt['status'];
  started_at: string;
  completed_at: string | null;
  superseded_at: string | null;
  late_result_at: string | null;
  pending_seconds: number | null;
  selected_contributor_name: string | null;
};
