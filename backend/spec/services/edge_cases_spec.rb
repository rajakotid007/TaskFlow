require "rails_helper"

# Rules added after the edge-case review: who routing may re-offer to, offers
# that nobody answers, releasing started work, and contributor changes that
# affect work already held.
RSpec.describe "Edge cases" do
  let(:ruby) { create(:expertise_area, name: "Ruby") }
  let!(:alice) { create(:contributor, name: "Alice", expertise: [ ruby ]) }
  let!(:bob) { create(:contributor, name: "Bob", expertise: [ ruby ]) }
  let(:task) { create(:task, required_expertise: ruby) }

  def assign_via_routing!(task)
    deliver!(route!(task))
    AssignmentService.accept(assignment_id: task.reload.active_assignment.id)
    task.reload
  end

  def release!(task)
    AssignmentRecoveryService.call(task_id: task.id, action: "release", reason: "fell sick")
  end

  describe "retry routing after a release" do
    it "skips the contributor who was released and offers the task to someone else" do
      assign_via_routing!(task)
      expect(task.active_assignment.contributor).to eq(alice)

      release!(task)
      deliver!(route!(task, mode: :retry))

      expect(task.reload.active_assignment.contributor).to eq(bob)
    end

    it "fails with an explanation when the released contributor is the only expert" do
      bob.update!(availability: "unavailable")
      assign_via_routing!(task)
      release!(task)
      deliver!(route!(task, mode: :retry))

      expect(task.reload).to be_assignment_failed
      expect(task.latest_routing_attempt.outcome_reason).to include("Alice (previously released from this task)")
    end

    it "still lets an operator choose the released contributor manually" do
      assign_via_routing!(task)
      release!(task)

      ManualInterventionService.call(task_id: task.id, contributor_id: alice.id)
      expect(task.reload).to be_assigned
      expect(task.active_assignment.contributor).to eq(alice)
    end
  end

  describe "releasing work that has started" do
    it "moves an in-progress task to assignment_failed and frees the contributor" do
      assign_via_routing!(task)
      TaskLifecycleService.start(task_id: task.id)

      release!(task)

      task.reload
      expect(task).to be_assignment_failed
      expect(task.status_reason).to eq("assignment_released")
      expect(alice.assignments.active).to be_empty
      expect(task.task_events.last.message).to include("after work had started")
    end
  end

  describe "offers nobody answers" do
    before { deliver!(route!(task)) }

    it "is not flagged inside the response window" do
      expect(TaskQuery.needs_intervention).not_to include(task)
      expect(task.reload.overdue_offer).to be_nil
    end

    it "is flagged for intervention once the window passes, without expiring the offer" do
      travel(Assignment::OFFER_RESPONSE_WINDOW_SECONDS.seconds + 1.second) do
        expect(TaskQuery.needs_intervention).to include(task)
        expect(TaskQuery.overdue_offers).to include(task)
        expect(task.reload.overdue_offer).to be_offered
        expect(task).to be_awaiting_acceptance
      end
    end
  end

  describe "accepting an offer" do
    before { deliver!(route!(task)) }

    let(:offer) { task.reload.active_assignment }

    it "is refused when the contributor has since been marked unavailable" do
      offer.contributor.update!(availability: "unavailable")

      expect { AssignmentService.accept(assignment_id: offer.id) }
        .to raise_error(Errors::NotEligible, /marked unavailable/)
      expect(offer.reload).to be_offered
    end

    it "is refused when the contributor no longer has the required expertise" do
      contributor = offer.contributor
      contributor.contributor_expertises.build(expertise_area: create(:expertise_area, name: "Go"))
      contributor.save!
      contributor.contributor_expertises.find_by(expertise_area: ruby).destroy!

      expect { AssignmentService.accept(assignment_id: offer.id) }
        .to raise_error(Errors::NotEligible, /no longer have Ruby expertise/)
    end
  end

  describe "task validation" do
    it "rejects a due date that is not a real date instead of clearing it" do
      task.update!(due_date: Date.current + 3)
      task.due_date = "2026-13-45"

      expect(task).not_to be_valid
      expect(task.errors[:due_date]).to include("is not a valid date")
    end

    it "rejects a due date in the past but accepts today in every time zone" do
      expect(build(:task, due_date: Date.current - 2)).not_to be_valid
      expect(build(:task, due_date: Task.earliest_today)).to be_valid
    end

    it "keeps a due date that has since passed when other fields change" do
      saved = create(:task, due_date: Date.current + 1)
      travel(3.days) do
        expect(saved.update(title: "Renamed task")).to be(true)
      end
    end

    it "trims titles and requires at least 3 characters" do
      expect(build(:task, title: "  x ")).not_to be_valid
      expect(create(:task, title: "  Fix   login  ").title).to eq("Fix login")
    end
  end
end
