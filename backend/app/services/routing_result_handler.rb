# Applies a result from the routing engine — but only if the attempt it
# answers is still the task's live request. Anything else (operator assigned
# manually, restarted routing, cancelled) makes the result stale: it is
# recorded for history and otherwise ignored.
class RoutingResultHandler < ApplicationService
  Result = Data.define(:outcome, :task, :attempt, :assignment)

  def initialize(request_token:, contributor_id:, reason:)
    @request_token = request_token
    @contributor_id = contributor_id
    @reason = reason
  end

  def call
    task_id = RoutingAttempt.where(request_token: @request_token).pick(:task_id) or
      raise ActiveRecord::RecordNotFound, "No routing attempt for token #{@request_token}"

    with_locked_task(task_id) do |task|
      attempt = RoutingAttempt.lock.find_by!(request_token: @request_token)

      if attempt.pending?
        @contributor_id ? apply_match(task, attempt) : apply_no_match(task, attempt, @reason)
      elsif attempt.late_result? || attempt.completed_at.present?
        Result.new(outcome: :duplicate, task: task, attempt: attempt, assignment: nil)
      else
        record_stale(task, attempt)
      end
    end
  end

  private

  def apply_match(task, attempt)
    contributor = Contributor.lock.find(@contributor_id)
    if (why = ContributorEligibility.reason_ineligible(contributor, task, mode: :routing))
      return apply_no_match(task, attempt,
        "Engine proposed #{contributor.name}, who is no longer eligible: #{why}", contributor: contributor)
    end

    now = Time.current
    attempt.update!(status: "matched", outcome: "matched", completed_at: now,
      selected_contributor: contributor, outcome_reason: @reason)
    assignment = task.assignments.create!(
      contributor: contributor, routing_attempt: attempt, assignment_source: "routing",
      status: "offered", offered_at: now)
    previous = TaskTransitionService.transition!(task, to: "awaiting_acceptance")

    audit(task, event_type: "routing_matched", actor_type: "routing_engine", routing_attempt: attempt,
      contributor: contributor, previous_state: previous, new_state: task.status,
      message: "Routing request ##{attempt.attempt_number} returned after #{attempt.elapsed_seconds}s: #{@reason}",
      metadata: { response_seconds: attempt.elapsed_seconds })
    audit(task, event_type: "assignment_offered", actor_type: "system", assignment: assignment,
      contributor: contributor, routing_attempt: attempt,
      message: "Assignment offered to #{contributor.name}; awaiting their acceptance")

    Result.new(outcome: :matched, task: task, attempt: attempt, assignment: assignment)
  end

  def apply_no_match(task, attempt, reason, contributor: nil)
    attempt.update!(status: "no_match", outcome: "no_match", completed_at: Time.current, outcome_reason: reason)
    previous = TaskTransitionService.transition!(task, to: "assignment_failed", reason: "no_eligible_contributor")

    audit(task, event_type: "routing_no_match", actor_type: "routing_engine", routing_attempt: attempt,
      contributor: contributor, previous_state: previous, new_state: task.status,
      message: "Routing request ##{attempt.attempt_number} returned after #{attempt.elapsed_seconds}s with no assignment: #{reason}",
      metadata: { response_seconds: attempt.elapsed_seconds })

    Result.new(outcome: :no_match, task: task, attempt: attempt, assignment: nil)
  end

  def record_stale(task, attempt)
    now = Time.current
    late_outcome = @contributor_id ? "matched" : "no_match"
    attempt.update!(late_result_at: now, late_outcome: late_outcome, late_contributor_id: @contributor_id)
    proposed = @contributor_id && Contributor.find_by(id: @contributor_id)

    audit(task, event_type: "stale_result_ignored", actor_type: "system", routing_attempt: attempt,
      contributor: proposed, previous_state: task.status, new_state: task.status,
      message: "Late result for routing request ##{attempt.attempt_number} arrived " \
               "#{(now - attempt.started_at).round}s after it was sent" +
               (proposed ? " (proposed #{proposed.name})" : " (no match)") +
               ". Ignored: request was superseded (#{attempt.superseded_reason.to_s.humanize.downcase}). " \
               "Task remains #{task.status.humanize.downcase}.",
      metadata: { late_outcome: late_outcome, superseded_reason: attempt.superseded_reason })

    Result.new(outcome: :stale, task: task, attempt: attempt, assignment: nil)
  end
end
