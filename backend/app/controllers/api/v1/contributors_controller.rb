module Api
  module V1
    class ContributorsController < ApplicationController
      INCLUDES = [ :expertise_areas, { active_assignments: :task } ].freeze

      def index
        scope = Contributor.includes(*INCLUDES).order(:name)
        scope = scope.with_expertise(params[:expertise_id]) if params[:expertise_id].present?
        scope = scope.where(availability: params[:availability]) if params[:availability].present?
        if (q = params[:q].to_s.strip.presence)
          scope = scope.where("contributors.name ILIKE :q OR contributors.email ILIKE :q", q: "%#{Contributor.sanitize_sql_like(q)}%")
        end
        records, meta = paginate(scope)
        render_data(records.map { |c| ContributorSerializer.call(c) }, meta: meta)
      end

      def show
        render_data(ContributorSerializer.call(Contributor.includes(*INCLUDES).find(params[:id])))
      end

      def create
        contributor = Contributor.new(contributor_attrs)
        assign_expertise(contributor)
        contributor.save!
        render_data(ContributorSerializer.call(contributor.reload), status: :created)
      end

      def update
        contributor = Contributor.find(params[:id])
        Contributor.transaction do
          contributor.assign_attributes(contributor_attrs)
          assign_expertise(contributor) if contributor_params.key?(:expertise_area_ids)
          contributor.save!
        end
        render_data(ContributorSerializer.call(Contributor.includes(*INCLUDES).find(contributor.id)))
      end

      private

      def contributor_params
        params.require(:contributor).permit(:name, :email, :availability, :max_active_assignments, expertise_area_ids: [])
      end

      def contributor_attrs
        contributor_params.except(:expertise_area_ids)
      end

      def assign_expertise(contributor)
        ids = Array(contributor_params[:expertise_area_ids]).reject(&:blank?).map(&:to_i).uniq
        areas = ExpertiseArea.where(id: ids).to_a
        raise Errors::BadRequest, "Unknown expertise area id(s): #{(ids - areas.map(&:id)).join(', ')}" if areas.size != ids.size

        existing = contributor.contributor_expertises.index_by(&:expertise_area_id)
        existing.each { |area_id, ce| ce.mark_for_destruction unless ids.include?(area_id) }
        (ids - existing.keys).each { |area_id| contributor.contributor_expertises.build(expertise_area_id: area_id) }
      end
    end
  end
end
