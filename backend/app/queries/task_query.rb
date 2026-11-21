# Filtering and sorting for the task table.
#
#   q            title substring or exact id ("42" or "#42")
#   status       comma-separated task statuses
#   priority     comma-separated priorities
#   expertise_id required expertise
#   view         needs_intervention | unresolved | open
#   sort         created_at | priority | status (prefix "-" for descending; default -created_at)
class TaskQuery
  SORTS = {
    "created_at" => "tasks.created_at",
    "priority" => "CASE tasks.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
    "status" => "tasks.status"
  }.freeze

  def initialize(params)
    @params = params
  end

  def scope
    s = Task.all
    if (q = @params[:q].to_s.strip.presence)
      id = q.delete_prefix("#")
      s = id.match?(/\A\d+\z/) ? s.where(id: id.to_i).or(Task.where("tasks.title ILIKE ?", "%#{Task.sanitize_sql_like(q)}%")) :
        s.where("tasks.title ILIKE ?", "%#{Task.sanitize_sql_like(q)}%")
    end
    s = s.where(status: list(:status)) if list(:status).any?
    s = s.where(priority: list(:priority)) if list(:priority).any?
    s = s.where(required_expertise_id: @params[:expertise_id]) if @params[:expertise_id].present?
    s = apply_view(s, @params[:view])
    apply_sort(s)
  end

  def self.unresolved
    Task.where(status: "routing_pending")
      .where(id: RoutingAttempt.unresolved_beyond_window.select(:task_id))
  end

  def self.needs_intervention
    Task.where(status: Task::RECOVERABLE_STATUSES).or(Task.where(id: unresolved.select(:id)))
  end

  private

  def list(key)
    @params[key].to_s.split(",").map(&:strip).reject(&:empty?)
  end

  def apply_view(s, view)
    case view
    when "needs_intervention" then s.where(id: self.class.needs_intervention.select(:id))
    when "unresolved" then s.where(id: self.class.unresolved.select(:id))
    when "open" then s.where.not(status: Task::TERMINAL_STATUSES)
    else s
    end
  end

  def apply_sort(s)
    key = @params[:sort].to_s
    desc = key.start_with?("-") || key.empty?
    column = SORTS.fetch(key.delete_prefix("-"), SORTS["created_at"])
    s.order(Arel.sql("#{column} #{desc ? 'DESC' : 'ASC'}"), id: :desc)
  end
end
