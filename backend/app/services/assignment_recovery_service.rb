# Recovery actions for tasks whose assignment did not work out.
#
#   retry_routing — declined / assignment_failed → new routing request
#                   (contributors who declined this task are excluded)
#   release       — assigned (work not started) → assignment_failed, freeing
#                   the contributor; the task can then be re-routed or
#                   assigned manually
#
# Choosing a specific contributor is ManualInterventionService.
class AssignmentRecoveryService < ApplicationService
  ACTIONS = %w[retry_routing release].freeze

  def initialize(task_id:, action:, expected_version: nil, reason: nil, simulation: nil)
    @task_id = task_id
    @action = action.to_s
    @expected_version = expected_version
    @reason = reason.to_s.strip.presence
    @simulation = simulation
    raise Errors::BadRequest, "recovery action must be one of #{ACTIONS.join(', ')}" unless ACTIONS.include?(@action)
  end

  def call
    case @action
    when "retry_routing"
      RoutingRequestService.call(task_id: @task_id, mode: :retry, expected_version: @expected_version,
        simulation: @simulation).task
    when "release"
      release
    end
  end

  private

  def release
    with_locked_task(@task_id) do |task|
      next task if task.assignment_failed? && task.status_reason == "assignment_released"

      check_version!(task, @expected_version)
      raise Errors::InvalidTransition.new(from: task.status, action: "release the assignment") unless task.assigned?

      reason = @reason || "Assignment could not proceed"
      assignment = withdraw_active_assignment!(task, reason: "released",
        explanation: reason, event_type: "assignment_released")
      previous = TaskTransitionService.transition!(task, to: "assignment_failed", reason: "assignment_released")
      audit(task, event_type: "recovery_initiated", assignment: assignment, previous_state: previous,
        new_state: task.status,
        message: "Assignment released before work began (#{reason}). Task needs re-routing or manual assignment.",
        metadata: { reason: reason })
      task
    end
  end
end
