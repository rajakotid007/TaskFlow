module Api
  module V1
    # Development/test-only controls for reproducing the assessment scenarios
    # deterministically. Disabled unless SIMULATION_CONTROLS_ENABLED=true and
    # never available in production. Kept apart from the operator API: these
    # endpoints are the only place the simulated behaviour is visible.
    class SimulationController < ApplicationController
      before_action :require_enabled, except: :status

      def status
        render_data({ enabled: Rails.configuration.x.simulation_controls_enabled,
                      never_return_probability: RoutingSimulation::NEVER_RETURN_PROBABILITY,
                      delay_range_seconds: [ RoutingSimulation::MIN_DELAY_SECONDS, RoutingSimulation::MAX_DELAY_SECONDS ] })
      end

      def attempts
        scope = RoutingAttempt.includes(task: :required_expertise).order(started_at: :desc).limit(50)
        scope = scope.where(task_id: params[:task_id]) if params[:task_id].present?
        render_data(scope.map do |a|
          RoutingAttemptSerializer.call(a, include_task: true).merge(
            simulated_behavior: a.simulated_behavior,
            simulated_delay_seconds: a.simulated_delay_seconds,
            simulation_source: a.simulation_source)
        end)
      end

      # Makes the engine answer this attempt immediately — including one that
      # was planned never to return. Used to demonstrate a late response
      # arriving after an operator intervened.
      def deliver
        attempt = RoutingAttempt.find(params[:id])
        RoutingEngineJob.perform_now(attempt.request_token, force: true)
        attempt.reload
        render_data(RoutingAttemptSerializer.call(attempt, include_task: true))
      end

      private

      def require_enabled
        raise Errors::SimulationDisabled unless Rails.configuration.x.simulation_controls_enabled
      end
    end
  end
end
