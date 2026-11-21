# Demo data. Every task's history is produced by driving the real services
# (routing requests, engine deliveries, accepts, declines, interventions) at
# backdated times, so the seeded audit trail is exactly what the application
# would have recorded.
#
#   bin/rails db:seed            # no-op if tasks already exist
#   SEED_RESET=1 bin/rails db:seed

require "active_support/testing/time_helpers"
include ActiveSupport::Testing::TimeHelpers

if Task.exists? && ENV["SEED_RESET"].blank?
  puts "Seed data already present (#{Task.count} tasks). Set SEED_RESET=1 to rebuild."
  return
end

ActiveRecord::Base.connection.execute(<<~SQL)
  TRUNCATE task_events, assignments, routing_attempts, tasks, contributor_expertises, contributors, expertise_areas
  RESTART IDENTITY CASCADE
SQL

# Seeds use forced simulation plans so the demo state is predictable.
Rails.configuration.x.simulation_controls_enabled = true
real_adapter = RoutingEngineJob.queue_adapter
# Backdated deliveries are performed inline below; nothing goes to Sidekiq.
RoutingEngineJob.queue_adapter = ActiveJob::QueueAdapters::TestAdapter.new

areas = %w[Ruby Java Python React TypeScript DevOps AI/ML Database\ Engineering QA].index_with { |name| ExpertiseArea.create!(name: name) }

[
  [ "Priya Raman", %w[Ruby Database\ Engineering], 3 ],
  [ "Marcus Bell", %w[Ruby React TypeScript], 3 ],
  [ "Sofia Alvarez", %w[Java DevOps], 2 ],
  [ "Kenji Watanabe", %w[Python AI/ML], 3 ],
  [ "Amara Okafor", %w[React TypeScript], 4 ],
  [ "Lukas Becker", %w[DevOps Database\ Engineering], 3 ],
  [ "Hannah Cohen", %w[QA TypeScript], 3 ],
  [ "Rahul Mehta", %w[Java Python], 2 ],
  [ "Elena Petrova", %w[AI/ML Python Database\ Engineering], 2 ],
  [ "Tomás Silva", %w[Ruby DevOps], 3 ],
  [ "Grace Liu", %w[React QA], 3 ],
  [ "Omar Haddad", %w[Java QA], 2, "unavailable" ],
  [ "Nina Kowalski", %w[TypeScript React Ruby], 3 ]
].each do |name, skills, capacity, availability|
  c = Contributor.new(name: name, email: "#{name.unicode_normalize(:nfkd).gsub(/[^\x00-\x7F]/, '').downcase.tr(' ', '.')}@taskflow.example",
    max_active_assignments: capacity, availability: availability || "available")
  skills.each { |s| c.contributor_expertises.build(expertise_area: areas.fetch(s)) }
  c.save!
end
people = Contributor.all.index_by(&:name)

def create_task(title, expertise, priority, description, due_in_days: nil)
  TaskCreationService.call(attributes: {
    title: title, description: description, required_expertise_id: expertise.id, priority: priority,
    due_date: due_in_days && Date.current + due_in_days
  })
end

def routed(task, delay: 9)
  attempt = RoutingRequestService.call(task_id: task.id, simulation: { behavior: "respond", delay_seconds: delay }).attempt
  travel(delay.seconds)
  RoutingEngineJob.perform_now(attempt.request_token)
  task.reload
end

def offer(task) = task.reload.active_assignment
def accept(task) = AssignmentService.accept(assignment_id: offer(task).id)

base = 6.days.ago.change(hour: 9)
step = 0
at = ->(&blk) { travel_to(base + (step += 1) * 5.hours + rand(0..40).minutes) { blk.call } }

srand(7)

# Completed
[
  [ "Upgrade Rails to 8.0 on billing service", "Ruby", "high" ],
  [ "Add GIN index for order search", "Database Engineering", "medium" ],
  [ "Fix flaky checkout E2E test", "QA", "low" ]
].each do |title, skill, prio|
  at.call do
    t = routed(create_task(title, areas[skill], prio, "Completed work item from last week."))
    accept(t)
    travel 2.hours
    TaskLifecycleService.start(task_id: t.id)
    travel 1.day
    TaskLifecycleService.complete(task_id: t.id)
  end
end

# In progress
[
  [ "Migrate CI runners to ARM", "DevOps", "medium" ],
  [ "Train churn prediction baseline", "AI/ML", "high" ]
].each do |title, skill, prio|
  at.call do
    t = routed(create_task(title, areas[skill], prio, "Actively being worked on.", due_in_days: 4))
    accept(t)
    travel 3.hours
    TaskLifecycleService.start(task_id: t.id)
  end
end

# Assigned via routine routing
at.call do
  t = routed(create_task("Build settings page with React Hook Form", areas["React"], "medium",
    "New account settings page.", due_in_days: 7))
  accept(t)
end

# Use case 3 history: operator intervened, the engine answered late and was ignored
at.call do
  t = create_task("Patch payment webhook signature check", areas["Java"], "urgent",
    "Security fix — must ship today.", due_in_days: 1)
  attempt = RoutingRequestService.call(task_id: t.id, simulation: { behavior: "respond", delay_seconds: 20 }).attempt
  travel 12.seconds
  ManualInterventionService.call(task_id: t.id, contributor_id: people["Sofia Alvarez"].id,
    note: "Sofia owns the payments module; not waiting on routing.")
  travel 8.seconds
  RoutingEngineJob.perform_now(attempt.request_token)
end

# Awaiting acceptance
[
  [ "Typed API client for contributor endpoints", "TypeScript", "medium" ],
  [ "Optimise slow reporting query", "Database Engineering", "high" ]
].each do |title, skill, prio|
  at.call { routed(create_task(title, areas[skill], prio, "Waiting on the proposed contributor.", due_in_days: 5)) }
end

# Declined
[
  [ "Write Terraform module for Redis", "DevOps", "medium", "On call this week, no capacity for new infra work." ],
  [ "Evaluate embedding models for search", "AI/ML", "high", "Conflict of interest: I reviewed the vendor proposal." ]
].each do |title, skill, prio, reason|
  at.call do
    t = routed(create_task(title, areas[skill], prio, "Offer was declined; needs recovery."))
    travel 40.minutes
    AssignmentService.decline(assignment_id: offer(t).id, reason: reason)
  end
end

# Use case 4 history: declined, retried, accepted by someone else
at.call do
  t = routed(create_task("Refactor background job retries", areas["Ruby"], "medium", "Recovered after a decline."))
  AssignmentService.decline(assignment_id: offer(t).id, reason: "Out of office until Monday")
  travel 15.minutes
  attempt = AssignmentRecoveryService.call(task_id: t.id, action: "retry_routing",
    simulation: { behavior: "respond", delay_seconds: 7 }).pending_routing_attempt
  travel 7.seconds
  RoutingEngineJob.perform_now(attempt.request_token)
  accept(t)
end

# Assignment failed: everyone with the expertise is unavailable or full
at.call do
  people["Omar Haddad"] # unavailable QA/Java contributor
  qa_busy = %w[Hannah\ Cohen Grace\ Liu].map { |n| people[n] }
  qa_busy.each { |c| c.update!(availability: "unavailable") }
  routed(create_task("Accessibility audit of task table", areas["QA"], "medium", "No QA contributor was available."))
  qa_busy.each { |c| c.update!(availability: "available") }
end

# Assignment failed: released before work began
at.call do
  t = create_task("Kafka consumer lag dashboard", areas["Java"], "low", "Assigned contributor had to drop it.")
  ManualInterventionService.call(task_id: t.id, contributor_id: people["Rahul Mehta"].id)
  travel 5.hours
  AssignmentRecoveryService.call(task_id: t.id, action: "release", reason: "Rahul was pulled onto an incident")
end

# Cancelled while routing was outstanding
at.call do
  t = create_task("Prototype GraphQL gateway", areas["TypeScript"], "low", "Deprioritised.")
  RoutingRequestService.call(task_id: t.id, simulation: { behavior: "never_return" })
  travel 3.minutes
  TaskLifecycleService.cancel(task_id: t.id, reason: "Deprioritised in planning")
end

# Drafts
[
  [ "Document on-call runbook for routing engine", "DevOps", "low" ],
  [ "Python 3.13 compatibility sweep", "Python", "medium" ],
  [ "Design review: contributor capacity model", "Ruby", "low" ]
].each do |title, skill, prio|
  at.call { create_task(title, areas[skill], prio, "Not yet submitted for routing.", due_in_days: 10) }
end

# Currently outstanding routing (relative to now). These two never return;
# the operator console cannot tell them apart from slow requests.
travel_to(4.minutes.ago) do
  t = create_task("Hotfix: login redirect loop", areas["React"], "urgent", "Customers cannot sign in on Safari.", due_in_days: 0)
  RoutingRequestService.call(task_id: t.id, simulation: { behavior: "never_return" })
end
travel_to(50.seconds.ago) do
  t = create_task("Rotate leaked staging credentials", areas["DevOps"], "high", "Rotate and audit access.", due_in_days: 1)
  RoutingRequestService.call(task_id: t.id, simulation: { behavior: "never_return" })
end

RoutingEngineJob.queue_adapter = real_adapter
Rails.configuration.x.simulation_controls_enabled = ENV.fetch("SIMULATION_CONTROLS_ENABLED", "false") == "true"

puts "Seeded #{ExpertiseArea.count} expertise areas, #{Contributor.count} contributors, #{Task.count} tasks, " \
     "#{RoutingAttempt.count} routing attempts, #{TaskEvent.count} events."
puts "Tasks by status: #{Task.group(:status).count.sort.to_h}"
