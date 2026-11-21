# Straightforward expertise matching: among contributors with the required
# expertise who are eligible, pick the least-loaded one (ties → lowest id, so
# results are deterministic). Returns the choice plus an explanation.
class ExpertiseMatchingService < ApplicationService
  Result = Data.define(:contributor, :reason, :considered, :rejected)

  def initialize(task:)
    @task = task
  end

  def call
    candidates = Contributor.with_expertise(@task.required_expertise_id)
      .includes(:contributor_expertises, :active_assignments).order(:id).to_a
    expertise = @task.required_expertise.name

    if candidates.empty?
      return Result.new(contributor: nil, reason: "No contributors have #{expertise} expertise", considered: 0, rejected: {})
    end

    rejected = {}
    eligible = candidates.filter_map do |c|
      if (why = ContributorEligibility.reason_ineligible(c, @task, mode: :routing))
        rejected[c.id] = why
        nil
      else
        c
      end
    end

    if eligible.empty?
      return Result.new(
        contributor: nil,
        reason: "All #{candidates.size} #{expertise} contributor(s) are ineligible: " +
          candidates.map { |c| "#{c.name} (#{rejected[c.id]})" }.join("; "),
        considered: candidates.size, rejected: rejected
      )
    end

    loads = eligible.to_h { |c| [ c.id, c.active_assignments.size ] }
    chosen = eligible.min_by { |c| [ loads.fetch(c.id), c.id ] }
    Result.new(
      contributor: chosen,
      reason: "#{chosen.name} has #{expertise} expertise and the lowest active load " \
              "(#{loads.fetch(chosen.id)}) of #{eligible.size} eligible contributor(s)",
      considered: candidates.size, rejected: rejected
    )
  end
end
