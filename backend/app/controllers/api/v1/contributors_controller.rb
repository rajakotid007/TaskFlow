module Api
  module V1
    class ContributorsController < ApplicationController
      INCLUDES = [ :expertise_areas, { active_assignments: :task } ].freeze

      # Two saves with the same email at the same moment both pass the
      # uniqueness validation; the unique index stops the second.
      rescue_from ActiveRecord::RecordNotUnique do
        render_error(:unprocessable_entity, "validation_failed", "Email has already been taken",
          { email: [ "has already been taken" ] })
      end

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
        contributor = Contributor.includes(:expertise_areas, :contributor_expertises, active_assignments: :task)
          .find(contributor.id)
        render_data(ContributorSerializer.call(contributor), meta: { warnings: held_work_warnings(contributor) })
      end

      private

      def contributor_params
        params.expect(contributor: [ :name, :email, :availability, :max_active_assignments, expertise_area_ids: [] ])
      end

      # Saving never changes work the contributor already holds; these tell
      # the operator which tasks may now need reassigning.
      def held_work_warnings(contributor)
        held = contributor.active_assignments.sort_by(&:id)
        return [] if held.empty?

        refs = ->(list) { list.map { |a| "##{a.task.id}" }.join(", ") }
        warnings = []
        warnings << "#{contributor.name} is unavailable but still holds #{refs.call(held)}" unless contributor.available?
        missing = held.reject { |a| contributor.has_expertise?(a.task.required_expertise_id) }
        warnings << "#{contributor.name} no longer has the expertise for #{refs.call(missing)}" if missing.any?
        if held.size > contributor.max_active_assignments
          warnings << "#{contributor.name} holds #{held.size} active assignments, " \
                      "above the new limit of #{contributor.max_active_assignments}"
        end
        warnings
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
