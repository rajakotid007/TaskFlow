# Operator-facing view of a routing attempt. Deliberately omits the
# simulated_* columns: the operator must not be able to tell a slow request
# from one that will never return.
module RoutingAttemptSerializer
  module_function

  def call(attempt, now: Time.current, include_task: false)
    json = {
      id: attempt.id,
      task_id: attempt.task_id,
      attempt_number: attempt.attempt_number,
      status: attempt.status,
      trigger: attempt.trigger,
      started_at: attempt.started_at,
      completed_at: attempt.completed_at,
      elapsed_seconds: attempt.elapsed_seconds(now),
      beyond_expected_window: attempt.beyond_expected_window?(now),
      outcome: attempt.outcome,
      outcome_reason: attempt.outcome_reason,
      selected_contributor: contributor_ref(attempt.selected_contributor),
      superseded_at: attempt.superseded_at,
      superseded_reason: attempt.superseded_reason,
      late_result_at: attempt.late_result_at,
      late_outcome: attempt.late_outcome,
      late_contributor: contributor_ref(attempt.late_contributor)
    }
    if include_task
      json[:task] = { id: attempt.task.id, title: attempt.task.title, status: attempt.task.status,
                      priority: attempt.task.priority, required_expertise: attempt.task.required_expertise.name }
    end
    json
  end

  def contributor_ref(contributor)
    contributor && { id: contributor.id, name: contributor.name }
  end
end
