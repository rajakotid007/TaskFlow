require "rails_helper"

RSpec.describe "Tasks API", type: :request do
  let(:ruby) { create(:expertise_area, name: "Ruby") }
  let!(:alice) { create(:contributor, name: "Alice", expertise: [ ruby ]) }
  def json = response.parsed_body

  def post_json(path, body = {}) = post(path, params: body, as: :json)

  describe "POST /api/v1/tasks" do
    let(:attrs) { { title: "Fix N+1 in billing", description: "Slow page", required_expertise_id: ruby.id, priority: "urgent" } }

    it "saves a draft" do
      post_json "/api/v1/tasks", task: attrs
      expect(response).to have_http_status(:created)
      expect(json["data"]).to include("title" => "Fix N+1 in billing", "status" => "draft", "priority" => "urgent")
      expect(json["data"]["available_actions"]).to include("submit_routing", "assign_manually")
    end

    it "creates and submits for routing in one step" do
      post_json "/api/v1/tasks", task: attrs, submit: true, simulation: { behavior: "respond", delay_seconds: 5 }
      expect(response).to have_http_status(:created)
      expect(json["data"]["status"]).to eq("routing_pending")
      expect(json["data"]["routing"]).to include("status" => "pending", "attempt_number" => 1, "beyond_expected_window" => false)
      expect(RoutingEngineJob).to have_been_enqueued
    end

    it "returns field errors for invalid input" do
      post_json "/api/v1/tasks", task: { title: "", required_expertise_id: ruby.id, priority: "whenever" }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]["code"]).to eq("validation_failed")
      expect(json["error"]["details"].keys).to include("title", "priority")
    end

    it "ignores attributes that are not permitted" do
      post_json "/api/v1/tasks", task: attrs.merge(status: "completed", version: 99)
      expect(json["data"]).to include("status" => "draft", "version" => 0)
    end

    it "returns 400 when the task payload is missing" do
      post_json "/api/v1/tasks", {}
      expect(response).to have_http_status(:bad_request)
    end
  end

  describe "GET /api/v1/tasks" do
    before do
      create(:task, title: "Alpha upgrade", required_expertise: ruby, priority: "low")
      create(:task, title: "Beta outage", required_expertise: ruby, priority: "urgent", status: "declined")
    end

    it "paginates and filters" do
      get "/api/v1/tasks", params: { q: "beta" }
      expect(json["data"].map { |t| t["title"] }).to eq([ "Beta outage" ])
      expect(json["meta"]).to include("total" => 1, "page" => 1)

      get "/api/v1/tasks", params: { view: "needs_intervention" }
      expect(json["data"].map { |t| t["title"] }).to eq([ "Beta outage" ])

      get "/api/v1/tasks", params: { sort: "-priority", per_page: 1 }
      expect(json["data"].first["title"]).to eq("Beta outage")
      expect(json["meta"]["total_pages"]).to eq(2)
    end
  end

  describe "routing and intervention" do
    let(:task) { create(:task, required_expertise: ruby) }
    let!(:bob) { create(:contributor, name: "Bob", expertise: [ ruby ]) }

    it "never exposes the simulated outcome to the operator" do
      post_json "/api/v1/tasks/#{task.id}/route", simulation: { behavior: "never_return" }
      get "/api/v1/tasks/#{task.id}"
      get "/api/v1/routing-attempts"

      body = response.body
      expect(json["data"].first.keys).not_to include("simulated_behavior", "simulated_delay_seconds", "simulation_source")
      expect(body).not_to include("never_return")
    end

    it "is idempotent when routing is submitted twice" do
      post_json "/api/v1/tasks/#{task.id}/route"
      post_json "/api/v1/tasks/#{task.id}/route"
      expect(response).to have_http_status(:ok)
      expect(json["meta"]["changed"]).to be(false)
      expect(task.routing_attempts.count).to eq(1)
    end

    it "intervenes, and history shows the late result being ignored" do
      post_json "/api/v1/tasks/#{task.id}/route", simulation: { behavior: "respond", delay_seconds: 20 }
      version = json["data"]["version"]
      post_json "/api/v1/tasks/#{task.id}/intervene", contributor_id: bob.id, expected_version: version, note: "Urgent"
      expect(response).to have_http_status(:ok)
      expect(json["data"]).to include("status" => "assigned")
      expect(json["data"]["current_assignment"]).to include("source" => "manual", "contributor" => include("name" => "Bob"))

      perform_enqueued_jobs

      get "/api/v1/tasks/#{task.id}/history"
      expect(json["data"].map { |e| e["event_type"] }).to eq(%w[routing_requested routing_superseded manual_assignment stale_result_ignored])
      get "/api/v1/tasks/#{task.id}"
      expect(json["data"]["status"]).to eq("assigned")
      expect(json["data"]["routing_attempts"].first).to include("status" => "superseded", "late_outcome" => "matched")
    end

    it "returns 409 when acting on a stale version" do
      post_json "/api/v1/tasks/#{task.id}/route"
      post_json "/api/v1/tasks/#{task.id}/intervene", contributor_id: bob.id, expected_version: 0
      expect(response).to have_http_status(:conflict)
      expect(json["error"]).to include("code" => "stale_version")
      expect(json["error"]["details"]).to include("current_status" => "routing_pending")
    end

    it "returns 422 for an invalid transition" do
      post_json "/api/v1/tasks/#{task.id}/complete"
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]["code"]).to eq("invalid_transition")
    end

    it "returns 422 with a reason for an ineligible contributor" do
      outsider = create(:contributor, name: "Olga")
      post_json "/api/v1/tasks/#{task.id}/intervene", contributor_id: outsider.id
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]["message"]).to include("lacks required expertise")
    end

    it "lists eligible contributors for manual assignment" do
      create(:contributor, name: "Away", expertise: [ ruby ], availability: "unavailable")
      get "/api/v1/tasks/#{task.id}/eligible_contributors"
      expect(json["data"].map { |c| [ c["name"], c["eligible"] ] }).to eq([ [ "Alice", true ], [ "Away", false ], [ "Bob", true ] ])
    end
  end

  describe "accept / decline / recover" do
    let(:task) { create(:task, required_expertise: ruby) }

    before do
      post_json "/api/v1/tasks/#{task.id}/route", simulation: { behavior: "respond", delay_seconds: 5 }
      perform_enqueued_jobs
    end

    let(:assignment_id) { task.reload.active_assignment.id }

    it "accepts (idempotently)" do
      post_json "/api/v1/assignments/#{assignment_id}/accept"
      expect(json["data"]["status"]).to eq("assigned")
      post_json "/api/v1/assignments/#{assignment_id}/accept"
      expect(response).to have_http_status(:ok)
      expect(json["meta"]["changed"]).to be(false)
    end

    it "declines with a reason, then recovers by retrying routing" do
      post_json "/api/v1/assignments/#{assignment_id}/decline", reason: "Out of office"
      expect(json["data"]).to include("status" => "declined")
      expect(json["data"]["assignments"].first).to include("status" => "declined", "decline_reason" => "Out of office")
      expect(json["data"]["available_actions"]).to include("retry_routing", "assign_manually")

      post_json "/api/v1/tasks/#{task.id}/recover", recovery_action: "retry_routing"
      expect(json["data"]).to include("status" => "routing_pending")
      expect(json["data"]["routing"]["attempt_number"]).to eq(2)
    end

    it "rejects an unknown recovery action" do
      post_json "/api/v1/tasks/#{task.id}/recover", recovery_action: "teleport"
      expect(response).to have_http_status(:bad_request)
    end
  end

  describe "malformed requests" do
    let(:task) { create(:task, required_expertise: ruby) }

    it "returns 400, not 500, when a field that should be an object is a string" do
      post_json "/api/v1/tasks", task: "oops"
      expect(response).to have_http_status(:bad_request)

      post_json "/api/v1/tasks", task: { title: "Valid title", required_expertise_id: ruby.id }, submit: true,
        simulation: "fast"
      expect(response).to have_http_status(:bad_request)
      expect(Task.count).to eq(0)
    end

    it "returns 400 when a field that should be a single value is an object" do
      post_json "/api/v1/tasks/#{task.id}/intervene", contributor_id: { id: alice.id }
      expect(response).to have_http_status(:bad_request)

      post_json "/api/v1/tasks/#{task.id}/cancel", expected_version: [ 1 ]
      expect(response).to have_http_status(:bad_request)
      expect(task.reload).to be_draft
    end

    it "rejects an invalid due date on update and keeps the existing one" do
      task.update!(due_date: Date.current + 5)
      patch "/api/v1/tasks/#{task.id}", params: { task: { due_date: "2026-13-45" } }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]["details"]).to include("due_date" => [ "is not a valid date" ])
      expect(task.reload.due_date).to eq(Date.current + 5)
    end
  end

  describe "GET /api/v1/tasks/:id/history" do
    it "returns events oldest first with the total count" do
      task = create(:task, required_expertise: ruby)
      TaskLifecycleService.update(task_id: task.id, attributes: { title: "Renamed once" })
      TaskLifecycleService.update(task_id: task.id, attributes: { title: "Renamed twice" })

      get "/api/v1/tasks/#{task.id}/history"
      expect(json["data"].map { |e| e["message"] }.last).to include("Title")
      expect(json["data"].first["created_at"] <= json["data"].last["created_at"]).to be(true)
      expect(json["meta"]).to include("total" => 2, "limit" => Api::V1::TasksController::HISTORY_LIMIT)
    end
  end
end
