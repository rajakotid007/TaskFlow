require "rails_helper"

RSpec.describe "Operations APIs", type: :request do
  let(:ruby) { create(:expertise_area, name: "Ruby") }
  def json = response.parsed_body

  describe "GET /api/v1/dashboard/summary" do
    it "reports counts from real data, including unresolved routing" do
      create(:contributor, expertise: [ ruby ])
      slow = create(:task, required_expertise: ruby)
      route!(slow, behavior: "never_return")
      create(:task, required_expertise: ruby, status: "declined")
      create(:task, required_expertise: ruby, status: "completed")

      travel 30.seconds do
        get "/api/v1/dashboard/summary"
      end

      totals = json["data"]["totals"]
      expect(totals).to include("tasks" => 3, "routing_pending" => 1, "unresolved_routing" => 1,
        "needs_intervention" => 2, "declined_or_failed" => 1, "completed" => 1)
      expect(json["data"]["routing_outcomes"]).to include("pending" => 1)
      expect(json["data"]["recent_events"].first["event_type"]).to eq("routing_requested")
    end
  end

  describe "contributors" do
    it "creates with expertise and validates" do
      post "/api/v1/contributors", as: :json,
        params: { contributor: { name: "Dana", email: "dana@example.test", expertise_area_ids: [ ruby.id ] } }
      expect(response).to have_http_status(:created)
      expect(json["data"]["expertise_areas"].map { |e| e["name"] }).to eq([ "Ruby" ])

      post "/api/v1/contributors", as: :json, params: { contributor: { name: "No skills", email: "bad" } }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]["details"].keys).to include("email", "expertise_areas")
    end

    it "updates availability and expertise" do
      python = create(:expertise_area, name: "Python")
      c = create(:contributor, expertise: [ ruby ])
      patch "/api/v1/contributors/#{c.id}", as: :json,
        params: { contributor: { availability: "unavailable", expertise_area_ids: [ python.id ] } }
      expect(json["data"]).to include("availability" => "unavailable")
      expect(json["data"]["expertise_areas"].map { |e| e["name"] }).to eq([ "Python" ])
    end
  end

  describe "contributor changes that affect held work" do
    def json = response.parsed_body

    it "warns when a contributor holding work is made unavailable" do
      area = create(:expertise_area, name: "Elixir")
      dana = create(:contributor, name: "Dana", expertise: [ area ])
      task = create(:task, required_expertise: area)
      ManualInterventionService.call(task_id: task.id, contributor_id: dana.id)

      patch "/api/v1/contributors/#{dana.id}", params: { contributor: { availability: "unavailable" } }, as: :json

      expect(response).to have_http_status(:ok)
      expect(json["meta"]["warnings"]).to eq([ "Dana is unavailable but still holds ##{task.id}" ])
    end

    it "trims names so near-duplicate expertise areas are refused" do
      create(:expertise_area, name: "Ruby")
      post "/api/v1/expertise_areas", params: { expertise_area: { name: "  ruby " } }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "routing attempts" do
    it "filters unresolved attempts" do
      create(:contributor, expertise: [ ruby ])
      route!(create(:task, required_expertise: ruby), behavior: "never_return")
      route!(create(:task, required_expertise: ruby))

      travel 25.seconds do
        get "/api/v1/routing-attempts", params: { filter: "unresolved" }
      end
      expect(json["data"].size).to eq(2)
      expect(json["data"]).to all(include("beyond_expected_window" => true))
    end
  end

  describe "events" do
    it "filters by event type and task" do
      task = create(:task, required_expertise: ruby)
      route!(task)
      TaskLifecycleService.cancel(task_id: task.id)

      get "/api/v1/events", params: { event_type: "task_cancelled", task_id: task.id }
      expect(json["data"].map { |e| e["event_type"] }).to eq([ "task_cancelled" ])
      expect(json["meta"]["event_types"]).to include("stale_result_ignored")
    end
  end

  describe "simulation controls" do
    it "are refused when disabled" do
      Rails.configuration.x.simulation_controls_enabled = false
      task = create(:task, required_expertise: ruby)

      post "/api/v1/tasks/#{task.id}/route", as: :json, params: { simulation: { behavior: "never_return" } }
      expect(response).to have_http_status(:forbidden)
      expect(task.reload).to be_draft

      get "/api/v1/simulation/routing-attempts"
      expect(response).to have_http_status(:forbidden)
    end

    it "can force delivery of a never-returning attempt" do
      create(:contributor, expertise: [ ruby ])
      task = create(:task, required_expertise: ruby)
      attempt = route!(task, behavior: "never_return")

      post "/api/v1/simulation/routing-attempts/#{attempt.id}/deliver"
      expect(json["data"]["status"]).to eq("matched")
      expect(task.reload).to be_awaiting_acceptance
    end
  end

  it "reports a missing record as 404" do
    get "/api/v1/tasks/999999"
    expect(response).to have_http_status(:not_found)
    expect(json["error"]["code"]).to eq("not_found")
  end
end
