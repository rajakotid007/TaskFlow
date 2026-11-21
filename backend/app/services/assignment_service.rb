# Contributor responses to a routing offer. Both are idempotent: repeating
# the same response returns the current state without new side effects.
class AssignmentService < ApplicationService
  Result = Data.define(:assignment, :task, :changed)

  def self.accept(assignment_id:) = new(assignment_id: assignment_id).accept
  def self.decline(assignment_id:, reason: nil) = new(assignment_id: assignment_id, reason: reason).decline

  def initialize(assignment_id:, reason: nil)
    @assignment_id = assignment_id
    @reason = reason.to_s.strip.presence
  end

  def accept
    respond(target: "accepted") do |task, assignment, now|
      contributor = assignment.contributor
      unless contributor.available?
        raise Errors::NotEligible.new(contributor,
          "they are marked unavailable. Update their availability first, or assign someone else")
      end
      unless contributor.has_expertise?(task.required_expertise_id)
        raise Errors::NotEligible.new(contributor, "they no longer have #{task.required_expertise.name} expertise")
      end

      assignment.update!(status: "accepted", accepted_at: now)
      previous = TaskTransitionService.transition!(task, to: "assigned")
      audit(task, event_type: "assignment_accepted", actor_type: "contributor",
        assignment: assignment, contributor: assignment.contributor,
        previous_state: previous, new_state: task.status,
        message: "#{assignment.contributor.name} accepted the assignment. Routing complete.")
    end
  end

  def decline
    respond(target: "declined") do |task, assignment, now|
      reason = @reason || "No reason given"
      assignment.update!(status: "declined", declined_at: now, ended_at: now, decline_reason: reason)
      previous = TaskTransitionService.transition!(task, to: "declined", reason: "contributor_declined")
      audit(task, event_type: "assignment_declined", actor_type: "contributor",
        assignment: assignment, contributor: assignment.contributor,
        previous_state: previous, new_state: task.status,
        message: "#{assignment.contributor.name} declined the assignment: #{reason}",
        metadata: { reason: reason })
    end
  end

  private

  def respond(target:)
    task_id = Assignment.where(id: @assignment_id).pick(:task_id) or
      raise ActiveRecord::RecordNotFound, "Couldn't find Assignment with id=#{@assignment_id}"

    with_locked_task(task_id) do |task|
      assignment = Assignment.lock.find(@assignment_id)
      next Result.new(assignment: assignment, task: task, changed: false) if assignment.status == target

      unless assignment.offered?
        raise Errors::InvalidTransition.new(from: task.status, action: "#{target.delete_suffix('ed')} an assignment that is #{assignment.status}",
          message: "This assignment is #{assignment.status} and can no longer be #{target}")
      end

      yield task, assignment, Time.current
      Result.new(assignment: assignment, task: task, changed: true)
    end
  end
end
