module Errors
  class DomainError < StandardError
    def code = "domain_error"
    def details = {}
  end

  class InvalidTransition < DomainError
    def initialize(from:, to: nil, action: nil, message: nil)
      @from, @to, @action = from, to, action
      super(message || "Cannot #{action || "move task to #{to}"} while task is #{from.to_s.humanize.downcase}")
    end

    def code = "invalid_transition"
    def details = { from: @from, to: @to, action: @action }.compact
  end

  class StaleVersion < DomainError
    def initialize(task)
      @task = task
      super("Task changed since you loaded it (now #{task.status.humanize.downcase}, version #{task.version}). Review the latest state and try again.")
    end

    def code = "stale_version"
    def details = { current_version: @task.version, current_status: @task.status }
  end

  class NotEligible < DomainError
    def initialize(contributor, reason)
      @contributor = contributor
      super("#{contributor.name} cannot take this task: #{reason}")
    end

    def code = "contributor_not_eligible"
    def details = { contributor_id: @contributor.id }
  end

  class RoutingUnavailable < DomainError
    def code = "routing_unavailable"
  end

  class BadRequest < DomainError
    def code = "bad_request"
  end

  class SimulationDisabled < DomainError
    def initialize = super("Simulation controls are disabled in this environment")
    def code = "simulation_disabled"
  end
end
