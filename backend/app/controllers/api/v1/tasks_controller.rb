module Api
  module V1
    class TasksController < ApplicationController
      DETAIL_INCLUDES = [ :required_expertise, { routing_attempts: %i[selected_contributor late_contributor] },
                          { assignments: :contributor } ].freeze

      def index
        scope = TaskQuery.new(params).scope.includes(:required_expertise, :routing_attempts, assignments: :contributor)
        records, meta = paginate(scope)
        now = Time.current
        render_data(records.map { |t| TaskSerializer.summary(t, now: now) }, meta: meta)
      end

      def show
        render_data(TaskSerializer.detail(load_task))
      end

      def create
        task = TaskCreationService.call(attributes: task_params, submit: ActiveModel::Type::Boolean.new.cast(params[:submit]),
          simulation: simulation_params)
        render_data(TaskSerializer.detail(load_task(task.id)), status: :created)
      end

      def update
        TaskLifecycleService.update(task_id: params[:id], attributes: task_params, expected_version: expected_version)
        render_task
      end

      # mode defaults from the task's state: draft → submit, declined/failed →
      # retry, pending → submit (idempotent no-op). Restart must be explicit.
      def route
        mode = params[:mode].presence || inferred_route_mode
        result = RoutingRequestService.call(task_id: params[:id], mode: mode, expected_version: expected_version,
          simulation: simulation_params)
        render_task(changed: result.created)
      end

      def intervene
        result = ManualInterventionService.call(task_id: params[:id], contributor_id: params.require(:contributor_id),
          expected_version: expected_version, note: params[:note])
        render_task(changed: result.changed)
      end

      def recover
        AssignmentRecoveryService.call(task_id: params[:id], action: params.require(:recovery_action),
          expected_version: expected_version, reason: params[:reason], simulation: simulation_params)
        render_task
      end

      def start
        TaskLifecycleService.start(task_id: params[:id], expected_version: expected_version)
        render_task
      end

      def complete
        TaskLifecycleService.complete(task_id: params[:id], expected_version: expected_version)
        render_task
      end

      def cancel
        TaskLifecycleService.cancel(task_id: params[:id], expected_version: expected_version, reason: params[:reason])
        render_task
      end

      def history
        task = Task.find(params[:id])
        events = task.task_events.includes(:task, :contributor).reorder(created_at: :asc, id: :asc)
        render_data(events.map { |e| TaskEventSerializer.call(e) })
      end

      # Contributors with the task's expertise and whether each could be
      # assigned manually right now — powers the intervention dialog.
      def eligible_contributors
        task = load_task
        contributors = Contributor.with_expertise(task.required_expertise_id)
          .includes(:expertise_areas, :contributor_expertises, active_assignments: :task).order(:name)
        render_data(contributors.map do |c|
          reason = ContributorEligibility.reason_ineligible(c, task, mode: :manual)
          ContributorSerializer.call(c).merge(
            eligible: reason.nil?, ineligible_reason: reason,
            previously_declined: task.declined_contributor_ids.include?(c.id))
        end)
      end

      private

      def task_params
        params.require(:task).permit(:title, :description, :required_expertise_id, :priority, :due_date)
      end

      def load_task(id = params[:id])
        Task.includes(*DETAIL_INCLUDES).find(id)
      end

      def render_task(changed: true)
        render_data(TaskSerializer.detail(load_task), meta: { changed: changed })
      end

      def inferred_route_mode
        status = Task.where(id: params[:id]).pick(:status) or raise ActiveRecord::RecordNotFound, "Couldn't find Task with id=#{params[:id]}"
        Task::RECOVERABLE_STATUSES.include?(status) ? :retry : :submit
      end
    end
  end
end
