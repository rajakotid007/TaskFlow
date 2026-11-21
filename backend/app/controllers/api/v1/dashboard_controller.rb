module Api
  module V1
    class DashboardController < ApplicationController
      def summary
        by_status = Task.group(:status).count
        open = Task.where.not(status: Task::TERMINAL_STATUSES)
        attempts = RoutingAttempt.all

        render_data({
          generated_at: Time.current,
          expected_window_seconds: RoutingAttempt::EXPECTED_WINDOW_SECONDS,
          totals: {
            tasks: by_status.values.sum,
            draft: by_status.fetch("draft", 0),
            routing_pending: by_status.fetch("routing_pending", 0),
            unresolved_routing: TaskQuery.unresolved.count,
            awaiting_acceptance: by_status.fetch("awaiting_acceptance", 0),
            active_assignments: by_status.fetch("assigned", 0) + by_status.fetch("in_progress", 0),
            needs_intervention: TaskQuery.needs_intervention.count,
            declined_or_failed: by_status.fetch("declined", 0) + by_status.fetch("assignment_failed", 0),
            completed: by_status.fetch("completed", 0),
            cancelled: by_status.fetch("cancelled", 0)
          },
          by_status: by_status,
          open_by_priority: open.group(:priority).count,
          open_by_expertise: open.joins(:required_expertise).group("expertise_areas.name").count,
          routing_outcomes: {
            pending: attempts.pending.count,
            matched: attempts.where(status: "matched").count,
            no_match: attempts.where(status: "no_match").count,
            superseded: attempts.where(status: "superseded").count,
            late_results_ignored: attempts.where.not(late_result_at: nil).count
          },
          attention: TaskQuery.needs_intervention.includes(:required_expertise, :routing_attempts, assignments: :contributor)
            .order(Arel.sql(TaskQuery::SORTS["priority"] + " DESC"), created_at: :asc).limit(8)
            .map { |t| TaskSerializer.summary(t) },
          recent_events: TaskEvent.includes(:task, :contributor).order(created_at: :desc, id: :desc).limit(12)
            .map { |e| TaskEventSerializer.call(e) }
        })
      end
    end
  end
end
