class RoutingAttempt < ApplicationRecord
  STATUSES = %w[pending matched no_match superseded].freeze
  TRIGGERS = %w[submit retry restart].freeze
  BEHAVIORS = %w[respond never_return].freeze

  # Responses normally arrive within this window. Past it, the UI flags the
  # attempt as "beyond the expected window" — not as failed.
  EXPECTED_WINDOW_SECONDS = 20

  belongs_to :task
  belongs_to :selected_contributor, class_name: "Contributor", optional: true
  belongs_to :late_contributor, class_name: "Contributor", optional: true
  has_one :assignment, dependent: :restrict_with_error

  validates :status, inclusion: { in: STATUSES }
  validates :trigger, inclusion: { in: TRIGGERS }
  validates :simulated_behavior, inclusion: { in: BEHAVIORS }

  scope :pending, -> { where(status: "pending") }
  scope :unresolved_beyond_window, -> { pending.where(started_at: ...EXPECTED_WINDOW_SECONDS.seconds.ago) }

  STATUSES.each do |s|
    define_method(:"#{s}?") { status == s }
  end

  def elapsed_seconds(now = Time.current)
    ((completed_at || superseded_at || now) - started_at).round
  end

  def beyond_expected_window?(now = Time.current)
    pending? && (now - started_at) > EXPECTED_WINDOW_SECONDS
  end

  def late_result?
    late_result_at.present?
  end
end
