# Sends a task to the routing engine.
#
# mode:
#   :submit  — draft → routing_pending
#   :retry   — declined / assignment_failed → routing_pending
#   :restart — routing_pending / awaiting_acceptance → routing_pending, superseding
#              the outstanding request (or withdrawing the open offer)
#
# Repeating :submit or :retry while a request is already pending is a no-op
# that returns the existing attempt, so double-clicks and client retries are safe.
class RoutingRequestService < ApplicationService
  Result = Data.define(:task, :attempt, :created)

  START_STATES = {
    submit: %w[draft],
    retry: %w[declined assignment_failed],
    restart: %w[routing_pending awaiting_acceptance]
  }.freeze

  def initialize(task_id:, mode: :submit, expected_version: nil, simulation: nil, actor_type: "operator")
    @task_id = task_id
    @mode = mode.to_sym
    @expected_version = expected_version
    @simulation = simulation
    @actor_type = actor_type
    raise Errors::BadRequest, "unknown routing mode #{mode}" unless START_STATES.key?(@mode)
  end

  def call
    with_locked_task(@task_id) do |task|
      if @mode != :restart && task.routing_pending?
        next Result.new(task: task, attempt: task.routing_attempts.pending.first, created: false)
      end

      check_version!(task, @expected_version)
      unless START_STATES.fetch(@mode).include?(task.status)
        raise Errors::InvalidTransition.new(from: task.status, action: "#{@mode} routing")
      end

      plan = RoutingSimulation.plan(@simulation)
      previous_state = task.status

      if @mode == :restart
        supersede_pending_attempt!(task, reason: "routing_restarted", explanation: "operator restarted routing")
        withdraw_active_assignment!(task, reason: "routing_restarted", explanation: "operator restarted routing")
      end
      if @mode == :retry
        audit(task, event_type: "recovery_initiated", actor_type: @actor_type,
          previous_state: previous_state, new_state: previous_state,
          message: "Recovery: retrying routing after task was #{previous_state.humanize.downcase}" +
                   (task.status_reason.present? ? " (#{task.status_reason.humanize.downcase})" : ""))
      end

      attempt = task.routing_attempts.create!(
        attempt_number: (task.routing_attempts.maximum(:attempt_number) || 0) + 1,
        trigger: @mode.to_s,
        status: "pending",
        started_at: Time.current,
        simulated_behavior: plan.behavior,
        simulated_delay_seconds: plan.delay_seconds,
        simulation_source: plan.source
      )
      TaskTransitionService.transition!(task, to: "routing_pending", action: "#{@mode} routing")

      audit(task,
        event_type: "routing_requested", actor_type: @actor_type, routing_attempt: attempt,
        previous_state: previous_state, new_state: task.status,
        message: "Routing request ##{attempt.attempt_number} sent to the routing engine " \
                 "(#{task.required_expertise.name}). Awaiting result.",
        metadata: { mode: @mode.to_s })

      dispatch!(attempt, plan)
      Result.new(task: task, attempt: attempt, created: true)
    end
  end

  private

  # The job is enqueued inside the transaction: if Redis is unreachable the
  # whole request rolls back and the operator is told, instead of a pending
  # attempt existing that was never actually sent. The minimum delay is well
  # beyond commit latency, and the job retries if it runs before commit.
  #
  # never_return requests are deliberately not enqueued: the engine drops them.
  def dispatch!(attempt, plan)
    return unless plan.behavior == "respond"

    RoutingEngineJob.set(wait: plan.delay_seconds.seconds).perform_later(attempt.request_token)
  rescue RedisClient::Error, Redis::BaseError, Errno::ECONNREFUSED => e
    raise Errors::RoutingUnavailable, "Routing engine queue is unreachable (#{e.class}). Nothing was sent; try again shortly."
  end
end
