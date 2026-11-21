module ContributorSerializer
  module_function

  # Preload: expertise_areas, active_assignments: :task
  def call(contributor)
    active = contributor.active_assignments
    {
      id: contributor.id,
      name: contributor.name,
      email: contributor.email,
      availability: contributor.availability,
      max_active_assignments: contributor.max_active_assignments,
      expertise_areas: contributor.expertise_areas.sort_by(&:name).map { |e| { id: e.id, name: e.name } },
      active_assignment_count: active.size,
      active_assignments: active.sort_by(&:id).map do |a|
        { id: a.id, status: a.status, task: { id: a.task.id, title: a.task.title, status: a.task.status, priority: a.task.priority } }
      end,
      created_at: contributor.created_at
    }
  end
end
