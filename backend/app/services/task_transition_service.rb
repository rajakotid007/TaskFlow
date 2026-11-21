# The task state machine. All task status changes go through here; callers
# must already hold the task row lock (see ApplicationService#with_locked_task).
class TaskTransitionService
  ALLOWED = {
    "draft" => %w[routing_pending assigned cancelled],
    "routing_pending" => %w[routing_pending awaiting_acceptance assignment_failed assigned cancelled],
    "awaiting_acceptance" => %w[routing_pending assigned declined cancelled],
    "assigned" => %w[assigned in_progress assignment_failed cancelled],
    "in_progress" => %w[completed cancelled],
    "declined" => %w[routing_pending assigned cancelled],
    "assignment_failed" => %w[routing_pending assigned cancelled],
    "completed" => [],
    "cancelled" => []
  }.freeze

  def self.allowed?(from, to)
    ALLOWED.fetch(from.to_s, []).include?(to.to_s)
  end

  # Returns the previous status. Bumps tasks.version so operators acting on a
  # stale view get a 409 instead of silently overriding a newer decision.
  def self.transition!(task, to:, reason: nil, action: nil)
    from = task.status
    raise Errors::InvalidTransition.new(from: from, to: to, action: action) unless allowed?(from, to)

    task.status = to.to_s
    task.status_reason = reason
    task.version += 1
    task.save!
    from
  end
end
