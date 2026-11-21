class Assignment < ApplicationRecord
  STATUSES = %w[offered accepted declined withdrawn completed].freeze
  # Statuses that hold the task's single active-assignee slot. Mirrored by the
  # partial unique index index_assignments_one_active_per_task.
  ACTIVE_STATUSES = %w[offered accepted].freeze
  SOURCES = %w[routing manual].freeze

  belongs_to :task
  belongs_to :contributor
  belongs_to :routing_attempt, optional: true

  validates :status, inclusion: { in: STATUSES }
  validates :assignment_source, inclusion: { in: SOURCES }

  scope :active, -> { where(status: ACTIVE_STATUSES) }

  STATUSES.each do |s|
    define_method(:"#{s}?") { status == s }
  end

  def active?
    ACTIVE_STATUSES.include?(status)
  end
end
