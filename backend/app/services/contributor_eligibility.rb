# Rules for whether a contributor may hold an assignment for a task.
#
# * routing: expertise, available, below capacity, and has not already
#   declined or been released from this task (the engine should not re-offer
#   to someone it already fell through with).
# * manual: expertise, available, below capacity. An operator may deliberately
#   re-assign someone who previously declined or was released.
#
# Offered assignments count toward capacity: an outstanding offer reserves the
# contributor's slot until it is accepted, declined or withdrawn.
class ContributorEligibility
  def self.reason_ineligible(contributor, task, mode:)
    unless contributor.has_expertise?(task.required_expertise_id)
      return "lacks required expertise (#{task.required_expertise.name})"
    end
    return "currently unavailable" unless contributor.available?

    active = active_elsewhere(contributor, task)
    if active >= contributor.max_active_assignments
      return "at capacity (#{active}/#{contributor.max_active_assignments} active assignments)"
    end

    if mode == :routing
      return "previously declined this task" if task.declined_contributor_ids.include?(contributor.id)
      return "previously released from this task" if task.released_contributor_ids.include?(contributor.id)
    end

    nil
  end

  # Uses preloaded active_assignments when a listing loaded them; locked
  # command paths load the contributor fresh, so they always count in the
  # database.
  def self.active_elsewhere(contributor, task)
    if contributor.association(:active_assignments).loaded?
      contributor.active_assignments.count { |a| a.task_id != task.id }
    else
      contributor.assignments.active.where.not(task_id: task.id).count
    end
  end
end
