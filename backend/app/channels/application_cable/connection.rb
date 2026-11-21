module ApplicationCable
  # Single-operator demo: no authentication on the socket. Broadcasts carry
  # only ids and event types.
  class Connection < ActionCable::Connection::Base
  end
end
