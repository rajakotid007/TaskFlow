# Decides, when a routing request is created, how the simulated engine will
# behave for it. The plan is persisted on the attempt so behaviour is
# reproducible and survives restarts; it is never shown to the operator.
class RoutingSimulation
  NEVER_RETURN_PROBABILITY = 0.2
  MIN_DELAY_SECONDS = 5
  MAX_DELAY_SECONDS = 20
  FORCED_DELAY_RANGE = (1..300)

  Plan = Data.define(:behavior, :delay_seconds, :source)

  def self.random_source
    @random_source ||= Random.new
  end

  class << self
    attr_writer :random_source
  end

  # override: { behavior: "respond" | "never_return", delay_seconds: Integer }
  # Only honoured when simulation controls are enabled (development/test).
  def self.plan(override = nil)
    if override.present?
      raise Errors::SimulationDisabled unless Rails.configuration.x.simulation_controls_enabled

      return forced_plan(override)
    end

    if random_source.rand < NEVER_RETURN_PROBABILITY
      Plan.new(behavior: "never_return", delay_seconds: nil, source: "random")
    else
      Plan.new(behavior: "respond", delay_seconds: random_source.rand(MIN_DELAY_SECONDS..MAX_DELAY_SECONDS), source: "random")
    end
  end

  def self.forced_plan(override)
    behavior = override[:behavior].to_s
    unless RoutingAttempt::BEHAVIORS.include?(behavior)
      raise Errors::BadRequest, "simulation.behavior must be one of #{RoutingAttempt::BEHAVIORS.join(', ')}"
    end
    return Plan.new(behavior: behavior, delay_seconds: nil, source: "forced") if behavior == "never_return"

    delay = (override[:delay_seconds].presence || MIN_DELAY_SECONDS).to_i
    raise Errors::BadRequest, "simulation.delay_seconds must be within #{FORCED_DELAY_RANGE}" unless FORCED_DELAY_RANGE.cover?(delay)

    Plan.new(behavior: behavior, delay_seconds: delay, source: "forced")
  end
end
