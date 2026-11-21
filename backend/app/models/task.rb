class Task < ApplicationRecord
  STATUSES = %w[
    draft routing_pending awaiting_acceptance assigned in_progress
    completed declined assignment_failed cancelled
  ].freeze
  TERMINAL_STATUSES = %w[completed cancelled].freeze
  RECOVERABLE_STATUSES = %w[declined assignment_failed].freeze
  PRIORITIES = %w[low medium high urgent].freeze

  belongs_to :required_expertise, class_name: "ExpertiseArea"
  has_many :routing_attempts, -> { order(:attempt_number) }, dependent: :restrict_with_error, inverse_of: :task
  has_many :assignments, -> { order(:created_at, :id) }, dependent: :restrict_with_error, inverse_of: :task
  has_many :task_events, -> { order(:created_at, :id) }, dependent: :restrict_with_error, inverse_of: :task

  validates :title, presence: true, length: { maximum: 200 }
  validates :description, length: { maximum: 5000 }
  validates :priority, inclusion: { in: PRIORITIES }
  validates :status, inclusion: { in: STATUSES }

  STATUSES.each do |s|
    define_method(:"#{s}?") { status == s }
  end

  def terminal?
    TERMINAL_STATUSES.include?(status)
  end

  def pending_routing_attempt
    routing_attempts.detect(&:pending?)
  end

  def active_assignment
    assignments.detect(&:active?)
  end

  def latest_routing_attempt
    routing_attempts.max_by(&:attempt_number)
  end

  def declined_contributor_ids
    assignments.select(&:declined?).map(&:contributor_id).uniq
  end
end
