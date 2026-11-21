class CreateCoreSchema < ActiveRecord::Migration[8.0]
  def change
    create_table :expertise_areas do |t|
      t.string :name, null: false
      t.timestamps
    end
    add_index :expertise_areas, "lower(name)", unique: true, name: "index_expertise_areas_on_lower_name"

    create_table :contributors do |t|
      t.string :name, null: false
      t.string :email, null: false
      t.string :availability, null: false, default: "available"
      t.integer :max_active_assignments, null: false, default: 3
      t.timestamps
    end
    add_index :contributors, "lower(email)", unique: true, name: "index_contributors_on_lower_email"
    add_check_constraint :contributors, "availability IN ('available', 'unavailable')", name: "contributors_availability_check"
    add_check_constraint :contributors, "max_active_assignments > 0", name: "contributors_capacity_positive"

    create_table :contributor_expertises do |t|
      t.references :contributor, null: false, foreign_key: { on_delete: :cascade }
      t.references :expertise_area, null: false, foreign_key: true
      t.timestamps
    end
    add_index :contributor_expertises, %i[contributor_id expertise_area_id], unique: true, name: "index_contributor_expertises_unique"

    create_table :tasks do |t|
      t.string :title, null: false
      t.text :description
      t.references :required_expertise, null: false, foreign_key: { to_table: :expertise_areas }
      t.string :priority, null: false, default: "medium"
      t.string :status, null: false, default: "draft"
      t.string :status_reason
      t.date :due_date
      t.integer :version, null: false, default: 0
      t.timestamps
    end
    add_index :tasks, :status
    add_index :tasks, :created_at
    add_check_constraint :tasks, "priority IN ('low', 'medium', 'high', 'urgent')", name: "tasks_priority_check"
    add_check_constraint :tasks,
      "status IN ('draft', 'routing_pending', 'awaiting_acceptance', 'assigned', 'in_progress', " \
      "'completed', 'declined', 'assignment_failed', 'cancelled')",
      name: "tasks_status_check"

    create_table :routing_attempts do |t|
      t.references :task, null: false, foreign_key: true
      t.integer :attempt_number, null: false
      t.uuid :request_token, null: false, default: -> { "gen_random_uuid()" }
      t.string :status, null: false, default: "pending"
      t.string :trigger, null: false
      t.datetime :started_at, null: false
      t.datetime :completed_at
      t.string :outcome
      t.text :outcome_reason
      t.references :selected_contributor, foreign_key: { to_table: :contributors }
      t.datetime :superseded_at
      t.string :superseded_reason
      t.datetime :late_result_at
      t.string :late_outcome
      t.references :late_contributor, foreign_key: { to_table: :contributors }
      # Simulation inputs, decided when the request is created. Internal only:
      # never serialized to the operator UI.
      t.string :simulated_behavior, null: false
      t.integer :simulated_delay_seconds
      t.string :simulation_source, null: false, default: "random"
      t.timestamps
    end
    add_index :routing_attempts, :request_token, unique: true
    add_index :routing_attempts, %i[task_id attempt_number], unique: true
    add_index :routing_attempts, :status
    add_index :routing_attempts, :task_id, unique: true, where: "status = 'pending'",
      name: "index_routing_attempts_one_pending_per_task"
    add_check_constraint :routing_attempts, "status IN ('pending', 'matched', 'no_match', 'superseded')",
      name: "routing_attempts_status_check"
    add_check_constraint :routing_attempts, "outcome IS NULL OR outcome IN ('matched', 'no_match')",
      name: "routing_attempts_outcome_check"
    add_check_constraint :routing_attempts, "late_outcome IS NULL OR late_outcome IN ('matched', 'no_match')",
      name: "routing_attempts_late_outcome_check"
    add_check_constraint :routing_attempts, "trigger IN ('submit', 'retry', 'restart')",
      name: "routing_attempts_trigger_check"
    add_check_constraint :routing_attempts, "simulated_behavior IN ('respond', 'never_return')",
      name: "routing_attempts_behavior_check"
    add_check_constraint :routing_attempts, "simulation_source IN ('random', 'forced')",
      name: "routing_attempts_simulation_source_check"

    create_table :assignments do |t|
      t.references :task, null: false, foreign_key: true
      t.references :contributor, null: false, foreign_key: true
      t.references :routing_attempt, foreign_key: true
      t.string :assignment_source, null: false
      t.string :status, null: false
      t.datetime :offered_at
      t.datetime :accepted_at
      t.datetime :declined_at
      t.datetime :ended_at
      t.text :decline_reason
      t.string :end_reason
      t.timestamps
    end
    add_index :assignments, %i[contributor_id status]
    add_index :assignments, :task_id, unique: true, where: "status IN ('offered', 'accepted')",
      name: "index_assignments_one_active_per_task"
    add_check_constraint :assignments, "assignment_source IN ('routing', 'manual')", name: "assignments_source_check"
    add_check_constraint :assignments, "status IN ('offered', 'accepted', 'declined', 'withdrawn', 'completed')",
      name: "assignments_status_check"
    add_check_constraint :assignments, "assignment_source = 'manual' OR routing_attempt_id IS NOT NULL",
      name: "assignments_routing_requires_attempt"

    create_table :task_events do |t|
      t.references :task, null: false, foreign_key: true
      t.string :event_type, null: false
      t.string :actor_type, null: false
      t.bigint :actor_id
      t.string :previous_state
      t.string :new_state
      t.references :routing_attempt, foreign_key: true
      t.references :assignment, foreign_key: true
      t.references :contributor, foreign_key: true
      t.text :message, null: false
      t.jsonb :metadata, null: false, default: -> { "'{}'::jsonb" }
      t.datetime :created_at, null: false
    end
    add_index :task_events, %i[task_id created_at]
    add_index :task_events, :event_type
    add_index :task_events, :created_at
    add_check_constraint :task_events, "actor_type IN ('operator', 'routing_engine', 'contributor', 'system')",
      name: "task_events_actor_type_check"
  end
end
