module AssignmentSerializer
  module_function

  def call(assignment)
    {
      id: assignment.id,
      task_id: assignment.task_id,
      contributor: { id: assignment.contributor.id, name: assignment.contributor.name },
      routing_attempt_id: assignment.routing_attempt_id,
      source: assignment.assignment_source,
      status: assignment.status,
      offered_at: assignment.offered_at,
      accepted_at: assignment.accepted_at,
      declined_at: assignment.declined_at,
      ended_at: assignment.ended_at,
      decline_reason: assignment.decline_reason,
      end_reason: assignment.end_reason
    }
  end
end
