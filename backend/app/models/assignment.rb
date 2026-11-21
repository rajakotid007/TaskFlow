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

  # Contributors answer offers on human time, not engine time. Past this an
  # unanswered offer needs the operator's attention; it is never auto-expired.
  OFFER_RESPONSE_WINDOW_SECONDS = Integer(ENV.fetch("OFFER_RESPONSE_WINDOW_SECONDS", 30.minutes.to_i))

  scope :active, -> { where(status: ACTIVE_STATUSES) }
  scope :overdue_offers, -> { where(status: "offered", offered_at: ...OFFER_RESPONSE_WINDOW_SECONDS.seconds.ago) }

  STATUSES.each do |s|
    define_method(:"#{s}?") { status == s }
  end

  def active?
    ACTIVE_STATUSES.include?(status)
  end

  def released?
    withdrawn? && end_reason == "released"
  end

  def overdue?(now = Time.current)
    offered? && offered_at.present? && (now - offered_at) > OFFER_RESPONSE_WINDOW_SECONDS
  end
end
