class OperationsBroadcaster
  STREAM = "operations".freeze

  def self.event(event)
    ActionCable.server.broadcast(STREAM, {
      type: event.event_type,
      task_id: event.task_id,
      event_id: event.id,
      at: event.created_at.iso8601(3)
    })
  rescue StandardError => e
    # Real-time delivery is best effort; clients also poll.
    Rails.logger.warn("[OperationsBroadcaster] broadcast failed: #{e.class}: #{e.message}")
  end
end
