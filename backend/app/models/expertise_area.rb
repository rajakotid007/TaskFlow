class ExpertiseArea < ApplicationRecord
  has_many :contributor_expertises, dependent: :restrict_with_error
  has_many :contributors, through: :contributor_expertises
  has_many :tasks, foreign_key: :required_expertise_id, inverse_of: :required_expertise, dependent: :restrict_with_error

  validates :name, presence: true, uniqueness: { case_sensitive: false }, length: { maximum: 60 }
end
