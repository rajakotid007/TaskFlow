class ApplicationController < ActionController::API
  MAX_PER_PAGE = 100

  rescue_from ActiveRecord::RecordNotFound do |e|
    render_error(:not_found, "not_found", e.message)
  end
  rescue_from ActiveRecord::RecordInvalid do |e|
    render_error(:unprocessable_entity, "validation_failed", e.record.errors.full_messages.to_sentence,
      e.record.errors.to_hash)
  end
  rescue_from ActionController::ParameterMissing, Errors::BadRequest do |e|
    render_error(:bad_request, "bad_request", e.message)
  end
  rescue_from Errors::InvalidTransition, Errors::NotEligible do |e|
    render_error(:unprocessable_entity, e.code, e.message, e.details)
  end
  rescue_from Errors::StaleVersion do |e|
    render_error(:conflict, e.code, e.message, e.details)
  end
  rescue_from Errors::SimulationDisabled do |e|
    render_error(:forbidden, e.code, e.message)
  end
  rescue_from Errors::RoutingUnavailable do |e|
    render_error(:service_unavailable, e.code, e.message)
  end
  # The partial unique indexes are the last line of defence; if a race gets
  # past the row locks, the database refuses and the client is told to reload.
  rescue_from ActiveRecord::RecordNotUnique, ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout do |e|
    Rails.logger.warn("[concurrency] #{e.class}: #{e.message}")
    render_error(:conflict, "concurrent_modification",
      "Another action changed this task at the same moment. Reload and try again.")
  end
  rescue_from ActiveRecord::ConnectionNotEstablished do |e|
    Rails.logger.error("[db] #{e.class}: #{e.message}")
    render_error(:service_unavailable, "database_unavailable", "The database is unavailable. Try again shortly.")
  end

  private

  def render_data(data, status: :ok, meta: nil)
    body = { data: data }
    body[:meta] = meta if meta
    render json: body, status: status
  end

  def render_error(status, code, message, details = nil)
    render json: { error: { code: code, message: message, details: details.presence }.compact }, status: status
  end

  def paginate(scope)
    page = [ params.fetch(:page, 1).to_i, 1 ].max
    per_page = params.fetch(:per_page, 25).to_i.clamp(1, MAX_PER_PAGE)
    total = scope.count
    records = scope.offset((page - 1) * per_page).limit(per_page)
    [ records, { page: page, per_page: per_page, total: total, total_pages: (total.to_f / per_page).ceil } ]
  end

  def expected_version
    scalar_param(:expected_version).presence
  end

  # A top-level value that must be a string or number. A hash or array where a
  # scalar belongs is a malformed request (400), not a server error.
  def scalar_param(key, required: false)
    value = required ? params.require(key) : params[key]
    if value.is_a?(ActionController::Parameters) || value.is_a?(Array)
      raise Errors::BadRequest, "#{key} must be a single value"
    end

    value
  end

  def simulation_params
    sim = params[:simulation]
    return nil if sim.blank?
    raise Errors::BadRequest, "simulation must be an object" unless sim.is_a?(ActionController::Parameters)

    sim.permit(:behavior, :delay_seconds).to_h.symbolize_keys
  end
end
