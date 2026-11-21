class TaskEvent < ApplicationRecord
  EVENT_TYPES = %w[
    task_created task_updated
    routing_requested routing_superseded routing_matched routing_no_match stale_result_ignored
    assignment_offered assignment_accepted assignment_declined assignment_withdrawn assignment_released
    manual_assignment recovery_initiated
    work_started task_completed task_cancelled
  ].freeze
  ACTOR_TYPES = %w[operator routing_engine contributor system].freeze

  belongs_to :task
  belongs_to :routing_attempt, optional: true
  belongs_to :assignment, optional: true
  belongs_to :contributor, optional: true

  validates :event_type, inclusion: { in: EVENT_TYPES }
  validates :actor_type, inclusion: { in: ACTOR_TYPES }
  validates :message, presence: true

  # History is append-only.
  def readonly?
    persisted?
  end
end
