class ApplicationService
  def self.call(...)
    new(...).call
  end

  private

  # Every command that mutates a task starts here: the task row lock
  # serializes operator actions, contributor responses and engine callbacks.
  def with_locked_task(task_id)
    Task.transaction do
      task = Task.lock.find(task_id)
      yield task
    end
  end

  def check_version!(task, expected_version)
    return if expected_version.blank?
    return if task.version == expected_version.to_i

    raise Errors::StaleVersion.new(task)
  end

  def audit(task, **attrs)
    AuditEventService.record!(task: task, **attrs)
  end

  # Marks the task's outstanding routing request as superseded. Its result, if
  # it ever arrives, will be recorded as stale and ignored.
  def supersede_pending_attempt!(task, reason:, explanation:)
    attempt = task.routing_attempts.pending.lock.first
    return unless attempt

    attempt.update!(status: "superseded", superseded_at: Time.current, superseded_reason: reason)
    audit(task,
      event_type: "routing_superseded", routing_attempt: attempt,
      message: "Routing request ##{attempt.attempt_number} superseded after #{attempt.elapsed_seconds}s without a result: #{explanation}",
      metadata: { reason: reason, pending_seconds: attempt.elapsed_seconds })
    attempt
  end

  def withdraw_active_assignment!(task, reason:, explanation:, event_type: "assignment_withdrawn")
    assignment = task.assignments.active.lock.first
    return unless assignment

    previous = assignment.status
    assignment.update!(status: "withdrawn", ended_at: Time.current, end_reason: reason)
    audit(task,
      event_type: event_type, assignment: assignment, contributor: assignment.contributor,
      message: "#{previous == 'offered' ? 'Offer to' : 'Assignment of'} #{assignment.contributor.name} withdrawn: #{explanation}",
      metadata: { reason: reason, previous_assignment_status: previous })
    assignment
  end
end
