class Contributor < ApplicationRecord
  AVAILABILITIES = %w[available unavailable].freeze

  has_many :contributor_expertises, dependent: :destroy, autosave: true
  has_many :expertise_areas, through: :contributor_expertises
  has_many :assignments, dependent: :restrict_with_error
  has_many :active_assignments, -> { active }, class_name: "Assignment", inverse_of: :contributor

  normalizes :name, with: ->(name) { name.squish }
  normalizes :email, with: ->(email) { email.strip }

  validates :name, presence: true, length: { maximum: 120 }
  validates :email, presence: true, uniqueness: { case_sensitive: false },
    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :availability, inclusion: { in: AVAILABILITIES }
  validates :max_active_assignments, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 20 }
  validate :has_expertise

  scope :with_expertise, ->(expertise_area_id) {
    where(id: ContributorExpertise.where(expertise_area_id: expertise_area_id).select(:contributor_id))
  }

  def available?
    availability == "available"
  end

  def active_assignment_count
    active_assignments.size
  end

  def has_expertise?(expertise_area_id)
    contributor_expertises.any? { |ce| ce.expertise_area_id == expertise_area_id }
  end

  private

  def has_expertise
    errors.add(:expertise_areas, "must include at least one area") if contributor_expertises.reject(&:marked_for_destruction?).empty?
  end
end
