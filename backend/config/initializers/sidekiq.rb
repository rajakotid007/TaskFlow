redis_config = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }

Sidekiq.configure_server do |config|
  config.redis = redis_config
  # Routing responses are scheduled 5–20 s out. Poll the schedule every
  # second so delivery time stays close to the simulated delay. This is a
  # fixed interval: the default (average_scheduled_poll_interval) is scaled by
  # the number of registered Sidekiq processes and drifted to ~10 s in testing.
  config[:poll_interval_average] = 1
end

Sidekiq.configure_client do |config|
  config.redis = redis_config
end
