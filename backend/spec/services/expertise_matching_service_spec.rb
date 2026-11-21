require "rails_helper"

RSpec.describe ExpertiseMatchingService do
  let(:react) { create(:expertise_area, name: "React") }
  let(:python) { create(:expertise_area, name: "Python") }
  let(:task) { create(:task, required_expertise: react) }

  def match = described_class.call(task: task)

  it "only considers contributors with the required expertise" do
    create(:contributor, name: "Py", expertise: [ python ])
    fe = create(:contributor, name: "Fe", expertise: [ python, react ])
    expect(match.contributor).to eq(fe)
    expect(match.considered).to eq(1)
  end

  it "prefers the least-loaded eligible contributor, breaking ties by id" do
    busy = create(:contributor, name: "Busy", expertise: [ react ])
    free1 = create(:contributor, name: "Free1", expertise: [ react ])
    create(:contributor, name: "Free2", expertise: [ react ])
    ManualInterventionService.call(task_id: create(:task, required_expertise: react).id, contributor_id: busy.id)

    expect(match.contributor).to eq(free1)
    expect(match.reason).to include("Free1", "lowest active load (0)")
  end

  it "skips unavailable, at-capacity and previously-declined contributors and explains why" do
    create(:contributor, name: "Away", expertise: [ react ], availability: "unavailable")
    full = create(:contributor, name: "Full", expertise: [ react ], max_active_assignments: 1)
    ManualInterventionService.call(task_id: create(:task, required_expertise: react).id, contributor_id: full.id)

    result = match
    expect(result.contributor).to be_nil
    expect(result.reason).to include("Away (currently unavailable)", "Full (at capacity (1/1 active assignments))")
  end

  it "explains when nobody has the expertise" do
    expect(match.contributor).to be_nil
    expect(match.reason).to eq("No contributors have React expertise")
  end
end
