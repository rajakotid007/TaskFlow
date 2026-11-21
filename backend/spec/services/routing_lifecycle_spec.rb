require "rails_helper"

# Service-level coverage of the four assessment use cases and the rules
# around them. Concurrency with real parallel connections lives in
# spec/concurrency.
RSpec.describe "Routing lifecycle" do
  let(:ruby) { create(:expertise_area, name: "Ruby") }
  let!(:alice) { create(:contributor, name: "Alice", expertise: [ ruby ]) }
  let(:task) { create(:task, required_expertise: ruby, priority: "high") }

  describe "submitting for routing" do
    it "creates a pending attempt, moves the task to routing_pending and schedules the engine with the planned delay" do
      freeze_time do
        attempt = nil
        expect { attempt = route!(task, delay: 12) }
          .to have_enqueued_job(RoutingEngineJob).with(kind_of(String)).at(12.seconds.from_now).on_queue("routing")

        expect(attempt).to be_pending
        expect(attempt.attempt_number).to eq(1)
        expect(attempt.request_token).to be_present
        expect(task.reload).to be_routing_pending
        expect(event_types(task)).to eq(%w[routing_requested])
      end
    end

    it "is idempotent: submitting again while pending returns the same attempt" do
      first = route!(task)
      result = RoutingRequestService.call(task_id: task.id, mode: :submit)

      expect(result.created).to be(false)
      expect(result.attempt).to eq(first)
      expect(task.routing_attempts.count).to eq(1)
    end

    it "rejects routing a task that is not in a routable state" do
      task.update!(status: "completed")
      expect { route!(task) }.to raise_error(Errors::InvalidTransition)
    end

    it "rejects a stale expected_version" do
      expect {
        RoutingRequestService.call(task_id: task.id, mode: :submit, expected_version: task.version + 1)
      }.to raise_error(Errors::StaleVersion)
    end
  end

  describe "Use case 1 — routine assignment" do
    it "proposes a matching contributor, who accepts; routing completes and history explains it" do
      attempt = route!(task)
      deliver!(attempt)

      expect(attempt).to be_matched
      expect(attempt.selected_contributor).to eq(alice)
      expect(task.reload).to be_awaiting_acceptance
      offer = task.active_assignment
      expect(offer).to have_attributes(status: "offered", contributor: alice, assignment_source: "routing", routing_attempt: attempt)

      AssignmentService.accept(assignment_id: offer.id)

      expect(task.reload).to be_assigned
      expect(offer.reload).to be_accepted
      expect(event_types(task)).to eq(%w[routing_requested routing_matched assignment_offered assignment_accepted])
      expect(task.task_events.find_by(event_type: "assignment_accepted"))
        .to have_attributes(actor_type: "contributor", previous_state: "awaiting_acceptance", new_state: "assigned")
    end

    it "treats repeated acceptance as a no-op" do
      deliver!(route!(task))
      offer = task.reload.active_assignment
      AssignmentService.accept(assignment_id: offer.id)

      result = AssignmentService.accept(assignment_id: offer.id)
      expect(result.changed).to be(false)
      expect(task.task_events.where(event_type: "assignment_accepted").count).to eq(1)
    end

    it "fails routing with an explanation when nobody has the expertise" do
      task = create(:task, required_expertise: create(:expertise_area, name: "COBOL"))
      attempt = deliver!(route!(task))

      expect(attempt).to be_no_match
      expect(attempt.outcome_reason).to include("No contributors have COBOL expertise")
      expect(task.reload).to have_attributes(status: "assignment_failed", status_reason: "no_eligible_contributor")
    end

    it "re-validates the engine's proposal when the result arrives" do
      attempt = route!(task)
      alice.update!(availability: "unavailable")
      # The engine computed its answer before Alice went unavailable.
      RoutingResultHandler.call(request_token: attempt.request_token, contributor_id: alice.id, reason: "picked Alice")

      expect(attempt.reload).to be_no_match
      expect(attempt.outcome_reason).to include("no longer eligible: currently unavailable")
      expect(task.reload).to be_assignment_failed
    end
  end

  describe "Use case 2 — unresolved routing" do
    it "never delivers a never_return request and never converts it into a failure" do
      attempt = nil
      expect { attempt = route!(task, behavior: "never_return") }.not_to have_enqueued_job(RoutingEngineJob)

      travel 2.hours do
        expect(attempt.reload).to be_pending
        expect(attempt.beyond_expected_window?).to be(true)
        expect(attempt.elapsed_seconds).to be_within(1).of(7200)
        expect(task.reload).to be_routing_pending
        expect(TaskQuery.unresolved).to include(task)
        expect(TaskQuery.needs_intervention).to include(task)
      end
    end

    it "does not flag a request inside the normal window" do
      attempt = route!(task, behavior: "never_return")
      travel 10.seconds do
        expect(attempt.reload.beyond_expected_window?).to be(false)
        expect(TaskQuery.unresolved).not_to include(task)
      end
    end

    it "still drops a never_return request if its job somehow runs" do
      attempt = route!(task, behavior: "never_return")
      deliver!(attempt)
      expect(attempt).to be_pending
    end

    it "lets the operator restart routing, superseding the outstanding request" do
      old = route!(task, behavior: "never_return")
      fresh = route!(task, mode: :restart)

      expect(old.reload).to have_attributes(status: "superseded", superseded_reason: "routing_restarted")
      expect(fresh).to have_attributes(status: "pending", attempt_number: 2, trigger: "restart")
      expect(task.reload).to be_routing_pending
      expect(event_types(task)).to eq(%w[routing_requested routing_superseded routing_requested])
    end
  end

  describe "Use case 3 — human intervention" do
    let!(:bob) { create(:contributor, name: "Bob", expertise: [ ruby ]) }

    it "supersedes the pending request; the late result is recorded and ignored" do
      attempt = route!(task, delay: 20)
      ManualInterventionService.call(task_id: task.id, contributor_id: bob.id, note: "Bob knows this codebase")

      expect(attempt.reload).to have_attributes(status: "superseded", superseded_reason: "manual_assignment")
      expect(task.reload).to be_assigned
      manual = task.active_assignment
      expect(manual).to have_attributes(contributor: bob, assignment_source: "manual", status: "accepted")

      # The engine now answers (it would pick Alice, the less loaded contributor).
      deliver!(attempt)

      expect(attempt).to be_superseded
      expect(attempt).to have_attributes(late_outcome: "matched", late_contributor: alice)
      expect(attempt.late_result_at).to be_present
      expect(task.reload).to be_assigned
      expect(task.assignments.active).to eq([ manual ])
      expect(event_types(task)).to eq(%w[routing_requested routing_superseded manual_assignment stale_result_ignored])
      expect(task.task_events.last.message).to include("Ignored", "manual assignment")
    end

    it "records a duplicate late delivery only once" do
      attempt = route!(task)
      ManualInterventionService.call(task_id: task.id, contributor_id: bob.id)
      deliver!(attempt)
      result = RoutingResultHandler.call(request_token: attempt.request_token, contributor_id: alice.id, reason: "again")

      expect(result.outcome).to eq(:duplicate)
      expect(task.task_events.where(event_type: "stale_result_ignored").count).to eq(1)
    end

    it "withdraws an open offer when the operator assigns someone else" do
      deliver!(route!(task))
      offer = task.reload.active_assignment
      expect(offer.contributor).to eq(alice)

      ManualInterventionService.call(task_id: task.id, contributor_id: bob.id)

      expect(offer.reload).to have_attributes(status: "withdrawn", end_reason: "manual_reassignment")
      expect { AssignmentService.accept(assignment_id: offer.id) }.to raise_error(Errors::InvalidTransition)
      expect(task.reload.active_assignment.contributor).to eq(bob)
    end

    it "is idempotent for the same contributor" do
      ManualInterventionService.call(task_id: task.id, contributor_id: bob.id)
      result = ManualInterventionService.call(task_id: task.id, contributor_id: bob.id)
      expect(result.changed).to be(false)
      expect(task.assignments.count).to eq(1)
    end

    it "refuses an ineligible contributor" do
      outsider = create(:contributor, name: "Olga")
      expect { ManualInterventionService.call(task_id: task.id, contributor_id: outsider.id) }
        .to raise_error(Errors::NotEligible, /lacks required expertise/)

      full = create(:contributor, name: "Fay", expertise: [ ruby ], max_active_assignments: 1)
      ManualInterventionService.call(task_id: create(:task, required_expertise: ruby).id, contributor_id: full.id)
      expect { ManualInterventionService.call(task_id: task.id, contributor_id: full.id) }
        .to raise_error(Errors::NotEligible, /at capacity/)
      expect(task.reload).to be_draft
    end

    it "rejects an intervention based on a stale view" do
      version = task.version
      route!(task)
      expect {
        ManualInterventionService.call(task_id: task.id, contributor_id: bob.id, expected_version: version)
      }.to raise_error(Errors::StaleVersion)
    end
  end

  describe "Use case 4 — recovery" do
    let!(:bob) { create(:contributor, name: "Bob", expertise: [ ruby ]) }

    it "records the decline reason, then retries routing excluding the contributor who declined" do
      deliver!(route!(task))
      offer = task.reload.active_assignment
      AssignmentService.decline(assignment_id: offer.id, reason: "On holiday next week")

      expect(task.reload).to have_attributes(status: "declined", status_reason: "contributor_declined")
      expect(offer.reload).to have_attributes(status: "declined", decline_reason: "On holiday next week")

      AssignmentRecoveryService.call(task_id: task.id, action: "retry_routing",
        simulation: { behavior: "respond", delay_seconds: 5 })
      retry_attempt = task.reload.pending_routing_attempt
      expect(retry_attempt).to have_attributes(attempt_number: 2, trigger: "retry")

      deliver!(retry_attempt)
      expect(task.reload.active_assignment.contributor).to eq(bob)
      expect(task.assignments.map(&:status)).to eq(%w[declined offered])
      expect(event_types(task)).to eq(%w[
        routing_requested routing_matched assignment_offered assignment_declined
        recovery_initiated routing_requested routing_matched assignment_offered
      ])
    end

    it "fails cleanly when everyone eligible has declined" do
      bob.update!(availability: "unavailable")
      deliver!(route!(task))
      AssignmentService.decline(assignment_id: task.reload.active_assignment.id, reason: "busy")
      attempt = deliver!(route!(task, mode: :retry))

      expect(attempt).to be_no_match
      expect(attempt.outcome_reason).to include("Alice (previously declined this task)", "Bob (currently unavailable)")
    end

    it "allows choosing a specific contributor after a decline" do
      deliver!(route!(task))
      AssignmentService.decline(assignment_id: task.reload.active_assignment.id)
      ManualInterventionService.call(task_id: task.id, contributor_id: bob.id)
      expect(task.reload).to be_assigned
    end

    it "releases an assignment that failed before work began" do
      ManualInterventionService.call(task_id: task.id, contributor_id: bob.id)
      AssignmentRecoveryService.call(task_id: task.id, action: "release", reason: "Contributor fell ill")

      expect(task.reload).to have_attributes(status: "assignment_failed", status_reason: "assignment_released")
      expect(task.assignments.first).to have_attributes(status: "withdrawn", end_reason: "released")
      expect(task.assignments.active).to be_empty

      attempt = deliver!(route!(task, mode: :retry))
      expect(attempt).to be_matched
    end

    it "treats repeated decline as a no-op" do
      deliver!(route!(task))
      offer = task.reload.active_assignment
      AssignmentService.decline(assignment_id: offer.id, reason: "busy")
      expect(AssignmentService.decline(assignment_id: offer.id).changed).to be(false)
    end

    it "cannot accept after declining" do
      deliver!(route!(task))
      offer = task.reload.active_assignment
      AssignmentService.decline(assignment_id: offer.id)
      expect { AssignmentService.accept(assignment_id: offer.id) }.to raise_error(Errors::InvalidTransition)
    end
  end

  describe "lifecycle after assignment" do
    it "starts, completes, and frees the contributor's capacity" do
      ManualInterventionService.call(task_id: task.id, contributor_id: alice.id)
      TaskLifecycleService.start(task_id: task.id)
      TaskLifecycleService.complete(task_id: task.id)

      expect(task.reload).to be_completed
      expect(task.assignments.first).to be_completed
      expect(alice.active_assignments.reload).to be_empty
      expect { route!(task) }.to raise_error(Errors::InvalidTransition)
    end

    it "cancelling supersedes pending routing so a late result cannot revive the task" do
      attempt = route!(task)
      TaskLifecycleService.cancel(task_id: task.id, reason: "No longer needed")
      deliver!(attempt)

      expect(task.reload).to be_cancelled
      expect(task.assignments).to be_empty
      expect(attempt.reload.late_outcome).to eq("matched")
    end
  end

  describe "audit history" do
    it "is append-only" do
      route!(task)
      event = task.task_events.first
      expect { event.update!(message: "rewritten") }.to raise_error(ActiveRecord::ReadOnlyRecord)
    end
  end
end
