module Api
  module V1
    class RoutingAttemptsController < ApplicationController
      INCLUDES = [ :selected_contributor, :late_contributor, { task: :required_expertise } ].freeze

      # filter: pending | unresolved | resolved | superseded | late
      def index
        scope = RoutingAttempt.includes(*INCLUDES).order(started_at: :desc, id: :desc)
        scope = scope.where(task_id: params[:task_id]) if params[:task_id].present?
        scope = case params[:filter]
        when "pending" then scope.pending
        when "unresolved" then scope.unresolved_beyond_window
        when "resolved" then scope.where(status: %w[matched no_match])
        when "superseded" then scope.where(status: "superseded")
        when "late" then scope.where.not(late_result_at: nil)
        else scope
        end
        records, meta = paginate(scope)
        now = Time.current
        render_data(records.map { |a| RoutingAttemptSerializer.call(a, now: now, include_task: true) },
          meta: meta.merge(expected_window_seconds: RoutingAttempt::EXPECTED_WINDOW_SECONDS))
      end

      def show
        attempt = RoutingAttempt.includes(*INCLUDES).find(params[:id])
        render_data(RoutingAttemptSerializer.call(attempt, include_task: true))
      end
    end
  end
end
