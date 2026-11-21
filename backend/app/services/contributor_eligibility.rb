# Rules for whether a contributor may hold an assignment for a task.
#
# * routing: expertise, available, below capacity, and has not already
#   declined this task (the engine should not re-offer to someone who said no).
# * manual: expertise, available, below capacity. An operator may deliberately
#   re-assign someone who previously declined.
#
# Offered assignments count toward capacity: an outstanding offer reserves the
# contributor's slot until it is accepted, declined or withdrawn.
class ContributorEligibility
  def self.reason_ineligible(contributor, task, mode:)
    unless contributor.has_expertise?(task.required_expertise_id)
      return "lacks required expertise (#{task.required_expertise.name})"
    end
    return "currently unavailable" unless contributor.available?

    active = contributor.assignments.active.where.not(task_id: task.id).count
    if active >= contributor.max_active_assignments
      return "at capacity (#{active}/#{contributor.max_active_assignments} active assignments)"
    end

    if mode == :routing && task.declined_contributor_ids.include?(contributor.id)
      return "previously declined this task"
    end

    nil
  end
end
