Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*ENV.fetch("FRONTEND_ORIGIN", "http://localhost:5174").split(","))

    resource "/api/*",
      headers: :any,
      methods: %i[get post patch put delete options head],
      expose: %w[X-Total-Count Date]
  end
end
