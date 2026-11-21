module TaskSerializer
  module_function

  # Preload: required_expertise, routing_attempts, assignments: :contributor
  def summary(task, now: Time.current)
    latest = task.latest_routing_attempt
    active = task.active_assignment
    {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      status_reason: task.status_reason,
      due_date: task.due_date,
      version: task.version,
      created_at: task.created_at,
      updated_at: task.updated_at,
      required_expertise: { id: task.required_expertise.id, name: task.required_expertise.name },
      current_assignment: active && {
        id: active.id,
        status: active.status,
        source: active.assignment_source,
        contributor: { id: active.contributor.id, name: active.contributor.name }
      },
      routing: latest && {
        attempt_id: latest.id,
        attempt_number: latest.attempt_number,
        status: latest.status,
        started_at: latest.started_at,
        elapsed_seconds: latest.elapsed_seconds(now),
        beyond_expected_window: latest.beyond_expected_window?(now)
      },
      routing_attempt_count: task.routing_attempts.size,
      needs_intervention: needs_intervention?(task, latest, now),
      available_actions: available_actions(task, active)
    }
  end

  def detail(task, now: Time.current)
    summary(task, now: now).merge(
      routing_attempts: task.routing_attempts.sort_by(&:attempt_number).reverse.map { |a| RoutingAttemptSerializer.call(a, now: now) },
      assignments: task.assignments.sort_by(&:id).reverse.map { |a| AssignmentSerializer.call(a) },
      expected_window_seconds: RoutingAttempt::EXPECTED_WINDOW_SECONDS
    )
  end

  def needs_intervention?(task, latest, now)
    Task::RECOVERABLE_STATUSES.include?(task.status) ||
      (task.routing_pending? && latest&.beyond_expected_window?(now))
  end

  # What the operator can do right now. The API enforces these rules again;
  # this list only drives which controls the UI offers.
  def available_actions(task, active)
    actions = []
    case task.status
    when "draft" then actions += %w[submit_routing assign_manually edit]
    when "routing_pending" then actions += %w[assign_manually restart_routing edit]
    when "awaiting_acceptance" then actions += %w[accept_offer decline_offer assign_manually restart_routing edit]
    when "assigned" then actions += %w[start_work release assign_manually edit]
    when "in_progress" then actions += %w[complete edit]
    when "declined", "assignment_failed" then actions += %w[retry_routing assign_manually edit]
    end
    actions << "cancel" unless task.terminal?
    actions
  end
end
