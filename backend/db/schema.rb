# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2026_11_20_000001) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "assignments", force: :cascade do |t|
    t.bigint "task_id", null: false
    t.bigint "contributor_id", null: false
    t.bigint "routing_attempt_id"
    t.string "assignment_source", null: false
    t.string "status", null: false
    t.datetime "offered_at"
    t.datetime "accepted_at"
    t.datetime "declined_at"
    t.datetime "ended_at"
    t.text "decline_reason"
    t.string "end_reason"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["contributor_id", "status"], name: "index_assignments_on_contributor_id_and_status"
    t.index ["contributor_id"], name: "index_assignments_on_contributor_id"
    t.index ["routing_attempt_id"], name: "index_assignments_on_routing_attempt_id"
    t.index ["task_id"], name: "index_assignments_on_task_id"
    t.index ["task_id"], name: "index_assignments_one_active_per_task", unique: true, where: "((status)::text = ANY ((ARRAY['offered'::character varying, 'accepted'::character varying])::text[]))"
    t.check_constraint "assignment_source::text = 'manual'::text OR routing_attempt_id IS NOT NULL", name: "assignments_routing_requires_attempt"
    t.check_constraint "assignment_source::text = ANY (ARRAY['routing'::character varying, 'manual'::character varying]::text[])", name: "assignments_source_check"
    t.check_constraint "status::text = ANY (ARRAY['offered'::character varying, 'accepted'::character varying, 'declined'::character varying, 'withdrawn'::character varying, 'completed'::character varying]::text[])", name: "assignments_status_check"
  end

  create_table "contributor_expertises", force: :cascade do |t|
    t.bigint "contributor_id", null: false
    t.bigint "expertise_area_id", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["contributor_id", "expertise_area_id"], name: "index_contributor_expertises_unique", unique: true
    t.index ["contributor_id"], name: "index_contributor_expertises_on_contributor_id"
    t.index ["expertise_area_id"], name: "index_contributor_expertises_on_expertise_area_id"
  end

  create_table "contributors", force: :cascade do |t|
    t.string "name", null: false
    t.string "email", null: false
    t.string "availability", default: "available", null: false
    t.integer "max_active_assignments", default: 3, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index "lower((email)::text)", name: "index_contributors_on_lower_email", unique: true
    t.check_constraint "availability::text = ANY (ARRAY['available'::character varying, 'unavailable'::character varying]::text[])", name: "contributors_availability_check"
    t.check_constraint "max_active_assignments > 0", name: "contributors_capacity_positive"
  end

  create_table "expertise_areas", force: :cascade do |t|
    t.string "name", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index "lower((name)::text)", name: "index_expertise_areas_on_lower_name", unique: true
  end

  create_table "routing_attempts", force: :cascade do |t|
    t.bigint "task_id", null: false
    t.integer "attempt_number", null: false
    t.uuid "request_token", default: -> { "gen_random_uuid()" }, null: false
    t.string "status", default: "pending", null: false
    t.string "trigger", null: false
    t.datetime "started_at", null: false
    t.datetime "completed_at"
    t.string "outcome"
    t.text "outcome_reason"
    t.bigint "selected_contributor_id"
    t.datetime "superseded_at"
    t.string "superseded_reason"
    t.datetime "late_result_at"
    t.string "late_outcome"
    t.bigint "late_contributor_id"
    t.string "simulated_behavior", null: false
    t.integer "simulated_delay_seconds"
    t.string "simulation_source", default: "random", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["late_contributor_id"], name: "index_routing_attempts_on_late_contributor_id"
    t.index ["request_token"], name: "index_routing_attempts_on_request_token", unique: true
    t.index ["selected_contributor_id"], name: "index_routing_attempts_on_selected_contributor_id"
    t.index ["status"], name: "index_routing_attempts_on_status"
    t.index ["task_id", "attempt_number"], name: "index_routing_attempts_on_task_id_and_attempt_number", unique: true
    t.index ["task_id"], name: "index_routing_attempts_on_task_id"
    t.index ["task_id"], name: "index_routing_attempts_one_pending_per_task", unique: true, where: "((status)::text = 'pending'::text)"
    t.check_constraint "late_outcome IS NULL OR (late_outcome::text = ANY (ARRAY['matched'::character varying, 'no_match'::character varying]::text[]))", name: "routing_attempts_late_outcome_check"
    t.check_constraint "outcome IS NULL OR (outcome::text = ANY (ARRAY['matched'::character varying, 'no_match'::character varying]::text[]))", name: "routing_attempts_outcome_check"
    t.check_constraint "simulated_behavior::text = ANY (ARRAY['respond'::character varying, 'never_return'::character varying]::text[])", name: "routing_attempts_behavior_check"
    t.check_constraint "simulation_source::text = ANY (ARRAY['random'::character varying, 'forced'::character varying]::text[])", name: "routing_attempts_simulation_source_check"
    t.check_constraint "status::text = ANY (ARRAY['pending'::character varying, 'matched'::character varying, 'no_match'::character varying, 'superseded'::character varying]::text[])", name: "routing_attempts_status_check"
    t.check_constraint "trigger::text = ANY (ARRAY['submit'::character varying, 'retry'::character varying, 'restart'::character varying]::text[])", name: "routing_attempts_trigger_check"
  end

  create_table "task_events", force: :cascade do |t|
    t.bigint "task_id", null: false
    t.string "event_type", null: false
    t.string "actor_type", null: false
    t.bigint "actor_id"
    t.string "previous_state"
    t.string "new_state"
    t.bigint "routing_attempt_id"
    t.bigint "assignment_id"
    t.bigint "contributor_id"
    t.text "message", null: false
    t.jsonb "metadata", null: false
    t.datetime "created_at", null: false
    t.index ["assignment_id"], name: "index_task_events_on_assignment_id"
    t.index ["contributor_id"], name: "index_task_events_on_contributor_id"
    t.index ["created_at"], name: "index_task_events_on_created_at"
    t.index ["event_type"], name: "index_task_events_on_event_type"
    t.index ["routing_attempt_id"], name: "index_task_events_on_routing_attempt_id"
    t.index ["task_id", "created_at"], name: "index_task_events_on_task_id_and_created_at"
    t.index ["task_id"], name: "index_task_events_on_task_id"
    t.check_constraint "actor_type::text = ANY (ARRAY['operator'::character varying, 'routing_engine'::character varying, 'contributor'::character varying, 'system'::character varying]::text[])", name: "task_events_actor_type_check"
  end

  create_table "tasks", force: :cascade do |t|
    t.string "title", null: false
    t.text "description"
    t.bigint "required_expertise_id", null: false
    t.string "priority", default: "medium", null: false
    t.string "status", default: "draft", null: false
    t.string "status_reason"
    t.date "due_date"
    t.integer "version", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_tasks_on_created_at"
    t.index ["required_expertise_id"], name: "index_tasks_on_required_expertise_id"
    t.index ["status"], name: "index_tasks_on_status"
    t.check_constraint "priority::text = ANY (ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'urgent'::character varying]::text[])", name: "tasks_priority_check"
    t.check_constraint "status::text = ANY (ARRAY['draft'::character varying, 'routing_pending'::character varying, 'awaiting_acceptance'::character varying, 'assigned'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'declined'::character varying, 'assignment_failed'::character varying, 'cancelled'::character varying]::text[])", name: "tasks_status_check"
  end

  add_foreign_key "assignments", "contributors"
  add_foreign_key "assignments", "routing_attempts"
  add_foreign_key "assignments", "tasks"
  add_foreign_key "contributor_expertises", "contributors", on_delete: :cascade
  add_foreign_key "contributor_expertises", "expertise_areas"
  add_foreign_key "routing_attempts", "contributors", column: "late_contributor_id"
  add_foreign_key "routing_attempts", "contributors", column: "selected_contributor_id"
  add_foreign_key "routing_attempts", "tasks"
  add_foreign_key "task_events", "assignments"
  add_foreign_key "task_events", "contributors"
  add_foreign_key "task_events", "routing_attempts"
  add_foreign_key "task_events", "tasks"
  add_foreign_key "tasks", "expertise_areas", column: "required_expertise_id"
end
