module Api
  module V1
    # Contributor responses. In this single-operator demo the operator records
    # the contributor's answer on their behalf; events are attributed to the
    # contributor.
    class AssignmentsController < ApplicationController
      def accept
        result = AssignmentService.accept(assignment_id: params[:id])
        render_result(result)
      end

      def decline
        result = AssignmentService.decline(assignment_id: params[:id], reason: params[:reason])
        render_result(result)
      end

      private

      def render_result(result)
        task = Task.includes(*TasksController::DETAIL_INCLUDES).find(result.task.id)
        render_data(TaskSerializer.detail(task), meta: { changed: result.changed })
      end
    end
  end
end
