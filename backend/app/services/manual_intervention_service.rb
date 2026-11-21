# Operator assigns a contributor directly. Works while routing is pending
# (the outstanding request is superseded), while an offer is open (the offer
# is withdrawn), after a decline or failure, from draft, or to reassign before
# work starts. The resulting assignment is accepted immediately.
class ManualInterventionService < ApplicationService
  Result = Data.define(:task, :assignment, :changed)

  ALLOWED_FROM = %w[draft routing_pending awaiting_acceptance assigned declined assignment_failed].freeze

  def initialize(task_id:, contributor_id:, expected_version: nil, note: nil)
    @task_id = task_id
    @contributor_id = contributor_id
    @expected_version = expected_version
    @note = note.to_s.strip.presence
  end

  def call
    with_locked_task(@task_id) do |task|
      current = task.assignments.active.first
      if task.assigned? && current&.accepted? && current.contributor_id == @contributor_id.to_i
        next Result.new(task: task, assignment: current, changed: false)
      end

      check_version!(task, @expected_version)
      unless ALLOWED_FROM.include?(task.status)
        raise Errors::InvalidTransition.new(from: task.status, to: "assigned", action: "assign manually")
      end

      contributor = Contributor.lock.find(@contributor_id)
      if (why = ContributorEligibility.reason_ineligible(contributor, task, mode: :manual))
        raise Errors::NotEligible.new(contributor, why)
      end

      previous = task.status
      explanation = "operator manually assigned #{contributor.name}"
      supersede_pending_attempt!(task, reason: "manual_assignment", explanation: explanation)
      withdraw_active_assignment!(task, reason: "manual_reassignment", explanation: explanation)

      now = Time.current
      assignment = task.assignments.create!(contributor: contributor, assignment_source: "manual",
        status: "accepted", offered_at: now, accepted_at: now)
      TaskTransitionService.transition!(task, to: "assigned", action: "assign manually")

      audit(task, event_type: "manual_assignment", assignment: assignment, contributor: contributor,
        previous_state: previous, new_state: task.status,
        message: "Operator manually assigned #{contributor.name} while task was #{previous.humanize.downcase}" +
                 (@note ? ". Note: #{@note}" : ""),
        metadata: { note: @note }.compact)

      Result.new(task: task, assignment: assignment, changed: true)
    end
  end
end
