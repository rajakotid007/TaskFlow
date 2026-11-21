module RoutingHelpers
  # Route a task with a forced simulation plan.
  def route!(task, behavior: "respond", delay: 10, mode: :submit)
    RoutingRequestService.call(task_id: task.id, mode: mode,
      simulation: { behavior: behavior, delay_seconds: delay }).attempt
  end

  # Run the engine for an attempt as the scheduled job would.
  def deliver!(attempt, force: false)
    RoutingEngineJob.perform_now(attempt.request_token, force: force)
    attempt.reload
  end

  def event_types(task)
    task.task_events.reload.map(&:event_type)
  end
end

RSpec.configure { |c| c.include RoutingHelpers }
