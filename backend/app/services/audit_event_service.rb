# Appends to task_events and, once the surrounding transaction commits,
# notifies connected operator consoles. Broadcasts carry ids only — clients
# refetch, so no internal simulation detail can leak through the socket.
class AuditEventService
  def self.record!(task:, event_type:, message:, actor_type: "operator", previous_state: nil, new_state: nil,
                   routing_attempt: nil, assignment: nil, contributor: nil, metadata: {})
    event = TaskEvent.create!(
      task: task,
      event_type: event_type,
      actor_type: actor_type,
      previous_state: previous_state,
      new_state: new_state,
      routing_attempt: routing_attempt,
      assignment: assignment,
      contributor: contributor,
      message: message,
      metadata: metadata
    )

    ActiveRecord.after_all_transactions_commit do
      OperationsBroadcaster.event(event)
    end

    event
  end
end
