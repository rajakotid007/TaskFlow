require "rails_helper"

# Real races: each thread uses its own database connection, and a latch
# releases them together. Transactional fixtures are off so the threads can
# see each other's committed rows; tables are truncated afterwards.
RSpec.describe "Concurrency safeguards" do
  self.use_transactional_tests = false

  after do
    conn = ActiveRecord::Base.connection
    conn.execute("TRUNCATE #{%w[task_events assignments routing_attempts tasks contributor_expertises contributors expertise_areas].join(', ')} RESTART IDENTITY CASCADE")
  end

  # Runs each block in its own thread/connection, started simultaneously.
  # Returns each block's value, or the exception it raised.
  def race(*blocks)
    latch = Concurrent::CountDownLatch.new(1)
    threads = blocks.map do |blk|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          latch.wait
          blk.call
        rescue StandardError => e
          e
        end
      end
    end
    latch.count_down
    threads.map(&:value)
  end

  let(:ruby) { create(:expertise_area, name: "Ruby") }
  # High capacity so repeated iterations don't run into the capacity rule.
  let!(:alice) { create(:contributor, name: "Alice", expertise: [ ruby ], max_active_assignments: 20) }
  let!(:bob) { create(:contributor, name: "Bob", expertise: [ ruby ], max_active_assignments: 20) }

  it "manual intervention racing a routing result always leaves exactly one active assignment — the operator's" do
    10.times do
      task = create(:task, required_expertise: ruby)
      attempt = route!(task)

      results = race(
        -> { ManualInterventionService.call(task_id: task.id, contributor_id: bob.id) },
        -> { RoutingResultHandler.call(request_token: attempt.request_token, contributor_id: alice.id, reason: "engine") }
      )

      expect(results).to all(satisfy { |r| !r.is_a?(Exception) })
      task.reload
      expect(task).to be_assigned
      expect(task.assignments.active.count).to eq(1)
      expect(task.active_assignment).to have_attributes(contributor_id: bob.id, assignment_source: "manual")
      # Whichever order the lock granted, the engine's answer is in the history.
      expect(task.task_events.pluck(:event_type)).to include("manual_assignment")
        .and(satisfy { |types| types.include?("stale_result_ignored") || types.include?("assignment_offered") })
    end
  end

  it "two operators assigning from the same view: one wins, the other gets a version conflict" do
    task = create(:task, required_expertise: ruby)
    version = task.version

    results = race(
      -> { ManualInterventionService.call(task_id: task.id, contributor_id: alice.id, expected_version: version) },
      -> { ManualInterventionService.call(task_id: task.id, contributor_id: bob.id, expected_version: version) }
    )

    expect(results.count { |r| r.is_a?(ManualInterventionService::Result) }).to eq(1)
    expect(results.count { |r| r.is_a?(Errors::StaleVersion) }).to eq(1)
    expect(task.assignments.active.count).to eq(1)
  end

  it "duplicate concurrent submissions create a single routing attempt" do
    task = create(:task, required_expertise: ruby)
    results = race(*Array.new(5) { -> { route!(task) } })

    expect(results).to all(be_a(RoutingAttempt))
    expect(results.map(&:id).uniq.size).to eq(1)
    expect(task.routing_attempts.count).to eq(1)
  end

  it "several tasks routing at once cannot over-allocate a contributor's capacity" do
    bob.update!(availability: "unavailable")
    alice.update!(max_active_assignments: 1)
    tasks = create_list(:task, 4, required_expertise: ruby)
    attempts = tasks.map { |t| route!(t) }

    race(*attempts.map { |a| -> { RoutingResultHandler.call(request_token: a.request_token, contributor_id: alice.id, reason: "engine") } })

    expect(Assignment.active.where(contributor: alice).count).to eq(1)
    expect(attempts.map { |a| a.reload.status }.tally).to eq("matched" => 1, "no_match" => 3)
  end

  it "accept and manual reassignment racing never leave two active assignments" do
    10.times do
      task = create(:task, required_expertise: ruby)
      deliver!(route!(task))
      offer = task.reload.active_assignment

      race(
        -> { AssignmentService.accept(assignment_id: offer.id) },
        -> { ManualInterventionService.call(task_id: task.id, contributor_id: bob.id) }
      )

      expect(task.assignments.active.count).to eq(1)
      expect(task.reload).to be_assigned
    end
  end

  it "the database rejects a second active assignment even without the application's locks" do
    task = create(:task, required_expertise: ruby)
    Assignment.create!(task: task, contributor: alice, assignment_source: "manual", status: "accepted")

    expect {
      Assignment.create!(task: task, contributor: bob, assignment_source: "manual", status: "offered")
    }.to raise_error(ActiveRecord::RecordNotUnique, /index_assignments_one_active_per_task/)
  end

  it "the database rejects a second pending routing attempt" do
    task = create(:task, required_expertise: ruby)
    route!(task)
    expect {
      task.routing_attempts.create!(attempt_number: 9, trigger: "submit", started_at: Time.current, simulated_behavior: "respond")
    }.to raise_error(ActiveRecord::RecordNotUnique, /index_routing_attempts_one_pending_per_task/)
  end
end
