require "rails_helper"

RSpec.describe RoutingSimulation do
  describe ".plan (random)" do
    let(:plans) do
      described_class.random_source = Random.new(42)
      Array.new(5000) { described_class.plan }
    end

    it "makes roughly 20% of requests never return" do
      ratio = plans.count { |p| p.behavior == "never_return" } / plans.size.to_f
      expect(ratio).to be_within(0.02).of(0.20)
    end

    it "delays every responding request by 5–20 seconds, covering the whole range" do
      delays = plans.select { |p| p.behavior == "respond" }.map(&:delay_seconds)
      expect(delays).to all(be_between(5, 20))
      expect(delays.uniq.sort).to eq((5..20).to_a)
    end

    it "marks plans as random" do
      expect(plans.map(&:source).uniq).to eq(%w[random])
    end
  end

  describe ".plan (forced)" do
    it "honours a forced response delay" do
      plan = described_class.plan(behavior: "respond", delay_seconds: 3)
      expect(plan).to have_attributes(behavior: "respond", delay_seconds: 3, source: "forced")
    end

    it "honours a forced never_return" do
      expect(described_class.plan(behavior: "never_return").behavior).to eq("never_return")
    end

    it "validates the override" do
      expect { described_class.plan(behavior: "explode") }.to raise_error(Errors::BadRequest)
      expect { described_class.plan(behavior: "respond", delay_seconds: 0) }.to raise_error(Errors::BadRequest)
    end

    it "is refused when simulation controls are disabled" do
      Rails.configuration.x.simulation_controls_enabled = false
      expect { described_class.plan(behavior: "respond") }.to raise_error(Errors::SimulationDisabled)
    end
  end
end
