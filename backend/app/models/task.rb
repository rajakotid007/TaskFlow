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

  normalizes :title, with: ->(title) { title.squish }

  validates :title, presence: true, length: { minimum: 3, maximum: 200 }
  validates :description, length: { maximum: 5000 }
  validates :priority, inclusion: { in: PRIORITIES }
  validates :status, inclusion: { in: STATUSES }
  validate :due_date_is_valid

  STATUSES.each do |s|
    define_method(:"#{s}?") { status == s }
  end

  # The earliest calendar date anywhere in the world right now (UTC-12). The
  # operator's time zone is unknown, so "today" is accepted for every zone.
  def self.earliest_today
    Time.current.in_time_zone("Etc/GMT+12").to_date
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

  # Contributors whose assignment was released (it fell through). Routing
  # skips them like decliners; an operator may still choose them manually.
  def released_contributor_ids
    assignments.select(&:released?).map(&:contributor_id).uniq
  end

  # The engine should not re-offer to anyone this task already fell through with.
  def excluded_from_routing_contributor_ids
    (declined_contributor_ids + released_contributor_ids).uniq
  end

  # The active offer, once it has waited longer than contributors normally
  # take to answer. Like an unresolved routing request, it is flagged for the
  # operator rather than expired.
  def overdue_offer(now = Time.current)
    offer = active_assignment
    offer if awaiting_acceptance? && offer&.offered? && offer.overdue?(now)
  end

  private

  def due_date_is_valid
    raw = due_date_before_type_cast
    if raw.present? && due_date.nil?
      errors.add(:due_date, "is not a valid date")
    elsif due_date && will_save_change_to_due_date? && due_date < self.class.earliest_today
      errors.add(:due_date, "cannot be in the past")
    end
  end
end
