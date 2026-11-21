# Edits and the non-routing lifecycle steps: start, complete, cancel.
class TaskLifecycleService < ApplicationService
  EDITABLE = %i[title description priority due_date required_expertise_id].freeze
  # Changing expertise would invalidate an outstanding request or assignment.
  EXPERTISE_EDITABLE_IN = %w[draft declined assignment_failed].freeze

  def self.update(task_id:, attributes:, expected_version: nil)
    new(task_id, expected_version).update(attributes)
  end

  def self.start(task_id:, expected_version: nil) = new(task_id, expected_version).start
  def self.complete(task_id:, expected_version: nil) = new(task_id, expected_version).complete
  def self.cancel(task_id:, expected_version: nil, reason: nil) = new(task_id, expected_version).cancel(reason)

  def initialize(task_id, expected_version)
    @task_id = task_id
    @expected_version = expected_version
  end

  def update(attributes)
    with_locked_task(@task_id) do |task|
      check_version!(task, @expected_version)
      raise Errors::InvalidTransition.new(from: task.status, action: "edit") if task.terminal?

      attrs = attributes.to_h.symbolize_keys.slice(*EDITABLE)
      if attrs.key?(:required_expertise_id) && attrs[:required_expertise_id].to_i != task.required_expertise_id &&
         !EXPERTISE_EDITABLE_IN.include?(task.status)
        raise Errors::InvalidTransition.new(from: task.status, action: "change required expertise",
          message: "Required expertise can only change while the task is draft, declined or assignment failed")
      end

      task.assign_attributes(attrs)
      changes = task.changes_to_save.except("updated_at")
      next task if changes.empty?

      task.version += 1
      task.save!
      audit(task, event_type: "task_updated", previous_state: task.status, new_state: task.status,
        message: "Task details updated (#{changes.keys.map(&:humanize).join(', ')})",
        metadata: { changes: changes })
      task
    end
  end

  def start
    step(to: "in_progress", already: "in_progress", event: "work_started") do |task|
      "#{task.active_assignment.contributor.name} started work"
    end
  end

  def complete
    step(to: "completed", already: "completed", event: "task_completed") do |task|
      assignment = task.assignments.active.first
      assignment.update!(status: "completed", ended_at: Time.current, end_reason: "completed")
      "Task completed by #{assignment.contributor.name}"
    end
  end

  def cancel(reason)
    step(to: "cancelled", already: "cancelled", event: "task_cancelled") do |task|
      explanation = "task cancelled"
      supersede_pending_attempt!(task, reason: "task_cancelled", explanation: explanation)
      withdraw_active_assignment!(task, reason: "task_cancelled", explanation: explanation)
      "Task cancelled by operator" + (reason.present? ? ": #{reason}" : "")
    end
  end

  private

  def step(to:, already:, event:)
    with_locked_task(@task_id) do |task|
      next task if task.status == already

      check_version!(task, @expected_version)
      unless TaskTransitionService.allowed?(task.status, to)
        raise Errors::InvalidTransition.new(from: task.status, to: to)
      end

      message = yield task
      previous = TaskTransitionService.transition!(task, to: to)
      audit(task, event_type: event, previous_state: previous, new_state: task.status,
        assignment: task.assignments.reload.max_by(&:id), message: message)
      task
    end
  end
end
