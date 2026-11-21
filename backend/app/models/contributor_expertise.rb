class ContributorExpertise < ApplicationRecord
  belongs_to :contributor
  belongs_to :expertise_area

  validates :expertise_area_id, uniqueness: { scope: :contributor_id }
end
