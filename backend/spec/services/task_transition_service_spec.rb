require "rails_helper"

RSpec.describe TaskTransitionService do
  let(:task) { create(:task) }

  it "applies an allowed transition and bumps the version" do
    expect { described_class.transition!(task, to: "routing_pending") }.to change { task.reload.version }.by(1)
    expect(task.status).to eq("routing_pending")
  end

  {
    "draft" => %w[awaiting_acceptance in_progress completed declined],
    "routing_pending" => %w[in_progress completed declined],
    "awaiting_acceptance" => %w[in_progress completed assignment_failed],
    "assigned" => %w[routing_pending completed declined],
    "completed" => Task::STATUSES,
    "cancelled" => Task::STATUSES
  }.each do |from, targets|
    targets.each do |to|
      it "refuses #{from} → #{to}" do
        task.update_columns(status: from)
        expect { described_class.transition!(task, to: to) }.to raise_error(Errors::InvalidTransition)
        expect(task.reload.status).to eq(from)
      end
    end
  end

  it "covers every status in the transition table" do
    expect(described_class::ALLOWED.keys).to match_array(Task::STATUSES)
    expect(described_class::ALLOWED.values.flatten.uniq - Task::STATUSES).to be_empty
  end

  it "is backed by a database CHECK constraint" do
    expect { task.update_columns(status: "nonsense") }.to raise_error(ActiveRecord::StatementInvalid, /tasks_status_check/)
  end
end
