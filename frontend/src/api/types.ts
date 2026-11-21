export type TaskStatus =
  | 'draft'
  | 'routing_pending'
  | 'awaiting_acceptance'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'assignment_failed'
  | 'cancelled'

export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type RoutingStatus = 'pending' | 'matched' | 'no_match' | 'superseded'
export type AssignmentStatus = 'offered' | 'accepted' | 'declined' | 'withdrawn' | 'completed'

export type TaskAction =
  | 'submit_routing'
  | 'retry_routing'
  | 'restart_routing'
  | 'assign_manually'
  | 'accept_offer'
  | 'decline_offer'
  | 'release'
  | 'start_work'
  | 'complete'
  | 'cancel'
  | 'edit'

export interface Ref {
  id: number
  name: string
}

export interface ExpertiseArea extends Ref {
  contributor_count: number
}

export interface RoutingSummary {
  attempt_id: number
  attempt_number: number
  status: RoutingStatus
  started_at: string
  elapsed_seconds: number
  beyond_expected_window: boolean
}

export interface Task {
  id: number
  title: string
  description: string | null
  priority: Priority
  status: TaskStatus
  status_reason: string | null
  due_date: string | null
  version: number
  created_at: string
  updated_at: string
  required_expertise: Ref
  current_assignment: {
    id: number
    status: AssignmentStatus
    source: 'routing' | 'manual'
    offered_at?: string | null
    /** An offer unanswered for longer than the response window. */
    overdue?: boolean
    contributor: Ref & { available?: boolean }
  } | null
  routing: RoutingSummary | null
  routing_attempt_count: number
  needs_intervention: boolean
  available_actions: TaskAction[]
}

export interface RoutingAttempt {
  id: number
  task_id: number
  attempt_number: number
  status: RoutingStatus
  trigger: 'submit' | 'retry' | 'restart'
  started_at: string
  completed_at: string | null
  elapsed_seconds: number
  beyond_expected_window: boolean
  outcome: 'matched' | 'no_match' | null
  outcome_reason: string | null
  selected_contributor: Ref | null
  superseded_at: string | null
  superseded_reason: string | null
  late_result_at: string | null
  late_outcome: 'matched' | 'no_match' | null
  late_contributor: Ref | null
  task?: { id: number; title: string; status: TaskStatus; priority: Priority; required_expertise: string }
}

export interface Assignment {
  id: number
  task_id: number
  contributor: Ref
  routing_attempt_id: number | null
  source: 'routing' | 'manual'
  status: AssignmentStatus
  offered_at: string | null
  accepted_at: string | null
  declined_at: string | null
  ended_at: string | null
  decline_reason: string | null
  end_reason: string | null
}

export interface TaskDetail extends Task {
  routing_attempts: RoutingAttempt[]
  assignments: Assignment[]
  expected_window_seconds: number
  offer_response_window_seconds?: number
  /** Required expertise can only change in draft, declined or assignment failed. */
  expertise_editable?: boolean
}

export type ActorType = 'operator' | 'routing_engine' | 'contributor' | 'system'

export interface TaskEvent {
  id: number
  task: { id: number; title: string }
  event_type: string
  actor_type: ActorType
  previous_state: string | null
  new_state: string | null
  message: string
  metadata: Record<string, unknown>
  contributor: Ref | null
  routing_attempt_id: number | null
  assignment_id: number | null
  created_at: string
}

export interface Contributor {
  id: number
  name: string
  email: string
  availability: 'available' | 'unavailable'
  max_active_assignments: number
  expertise_areas: Ref[]
  active_assignment_count: number
  active_assignments: {
    id: number
    status: AssignmentStatus
    task: { id: number; title: string; status: TaskStatus; priority: Priority }
  }[]
  created_at: string
}

export interface EligibleContributor extends Contributor {
  eligible: boolean
  ineligible_reason: string | null
  previously_declined: boolean
  previously_released?: boolean
}

export interface PageMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface Paged<T> {
  data: T[]
  meta: PageMeta & Record<string, unknown>
}

export interface DashboardSummary {
  generated_at: string
  expected_window_seconds: number
  totals: {
    tasks: number
    draft: number
    routing_pending: number
    unresolved_routing: number
    awaiting_acceptance: number
    active_assignments: number
    needs_intervention: number
    declined_or_failed: number
    completed: number
    cancelled: number
  }
  by_status: Partial<Record<TaskStatus, number>>
  open_by_priority: Partial<Record<Priority, number>>
  open_by_expertise: Record<string, number>
  routing_outcomes: {
    pending: number
    matched: number
    no_match: number
    superseded: number
    late_results_ignored: number
  }
  attention: Task[]
  recent_events: TaskEvent[]
}

export interface SimulationAttempt extends RoutingAttempt {
  simulated_behavior: 'respond' | 'never_return'
  simulated_delay_seconds: number | null
  simulation_source: 'random' | 'forced'
}

export interface SimulationStatus {
  enabled: boolean
  never_return_probability: number
  delay_range_seconds: [number, number]
}

export interface SimulationOverride {
  behavior: 'respond' | 'never_return'
  delay_seconds?: number
}
