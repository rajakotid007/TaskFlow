class OperationsChannel < ApplicationCable::Channel
  def subscribed
    stream_from OperationsBroadcaster::STREAM
  end
end
