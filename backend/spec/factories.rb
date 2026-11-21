FactoryBot.define do
  factory :expertise_area do
    sequence(:name) { |n| "Expertise #{n}" }
  end

  factory :contributor do
    sequence(:name) { |n| "Contributor #{n}" }
    sequence(:email) { |n| "contributor#{n}@example.test" }
    availability { "available" }
    max_active_assignments { 3 }

    transient do
      expertise { [] }
    end

    after(:build) do |contributor, ctx|
      areas = Array(ctx.expertise).presence || [ create(:expertise_area) ]
      areas.each { |area| contributor.contributor_expertises.build(expertise_area: area) }
    end
  end

  factory :task do
    sequence(:title) { |n| "Task #{n}" }
    description { "Something that needs doing" }
    priority { "medium" }
    status { "draft" }
    association :required_expertise, factory: :expertise_area
  end
end
