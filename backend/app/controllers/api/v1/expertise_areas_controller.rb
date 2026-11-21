module Api
  module V1
    class ExpertiseAreasController < ApplicationController
      def index
        areas = ExpertiseArea.order(:name)
        contributor_counts = ContributorExpertise.group(:expertise_area_id).count
        render_data(areas.map { |a| { id: a.id, name: a.name, contributor_count: contributor_counts.fetch(a.id, 0) } })
      end

      rescue_from ActiveRecord::RecordNotUnique do
        render_error(:unprocessable_entity, "validation_failed", "Name has already been taken",
          { name: [ "has already been taken" ] })
      end

      def create
        area = ExpertiseArea.create!(params.expect(expertise_area: [ :name ]))
        render_data({ id: area.id, name: area.name, contributor_count: 0 }, status: :created)
      end
    end
  end
end
