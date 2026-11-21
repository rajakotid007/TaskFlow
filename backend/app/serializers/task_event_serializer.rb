module TaskEventSerializer
  module_function

  # Preload: task, contributor
  def call(event)
    {
      id: event.id,
      task: { id: event.task.id, title: event.task.title },
      event_type: event.event_type,
      actor_type: event.actor_type,
      previous_state: event.previous_state,
      new_state: event.new_state,
      message: event.message,
      metadata: event.metadata,
      contributor: event.contributor && { id: event.contributor.id, name: event.contributor.name },
      routing_attempt_id: event.routing_attempt_id,
      assignment_id: event.assignment_id,
      created_at: event.created_at
    }
  end
end
