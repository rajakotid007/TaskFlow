module Api
  module V1
    class EventsController < ApplicationController
      def index
        scope = TaskEvent.includes(:task, :contributor).order(created_at: :desc, id: :desc)
        scope = scope.where(task_id: params[:task_id]) if params[:task_id].present?
        types = params[:event_type].to_s.split(",").map(&:strip).reject(&:empty?)
        scope = scope.where(event_type: types) if types.any?
        scope = scope.where(actor_type: params[:actor_type]) if params[:actor_type].present?
        records, meta = paginate(scope)
        render_data(records.map { |e| TaskEventSerializer.call(e) }, meta: meta.merge(event_types: TaskEvent::EVENT_TYPES))
      end
    end
  end
end
