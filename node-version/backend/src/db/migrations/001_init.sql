-- TaskFlow initial schema.
-- Invariants enforced in the database, not only in application code:
--   * one active assignment per task  (partial unique index on assignments)
--   * one pending routing attempt per task (partial unique index on routing_attempts)
--   * valid enum values via CHECK constraints
-- Active assignment statuses: 'proposed' (awaiting contributor) and 'accepted' (work owned).

CREATE TABLE expertise_areas (
  id   BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(btrim(name)) > 0)
);

CREATE TABLE contributors (
  id                    BIGSERIAL PRIMARY KEY,
  name                  TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  email                 TEXT NOT NULL UNIQUE CHECK (email LIKE '%@%'),
  availability          TEXT NOT NULL DEFAULT 'available'
                        CHECK (availability IN ('available', 'limited', 'unavailable')),
  max_active_assignments INTEGER NOT NULL DEFAULT 3 CHECK (max_active_assignments >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contributor_expertise (
  contributor_id    BIGINT NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  expertise_area_id BIGINT NOT NULL REFERENCES expertise_areas(id) ON DELETE CASCADE,
  PRIMARY KEY (contributor_id, expertise_area_id)
);

CREATE TABLE tasks (
  id                         BIGSERIAL PRIMARY KEY,
  title                      TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description                TEXT NOT NULL DEFAULT '',
  required_expertise_id      BIGINT NOT NULL REFERENCES expertise_areas(id),
  priority                   TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status                     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                               'draft', 'routing_pending', 'awaiting_acceptance', 'assigned',
                               'in_progress', 'completed', 'declined', 'assignment_failed',
                               'needs_intervention', 'cancelled')),
  status_reason              TEXT,
  due_date                   DATE,
  version                    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  current_routing_attempt_id BIGINT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_status_idx ON tasks(status);
CREATE INDEX tasks_created_at_idx ON tasks(created_at DESC);

CREATE TABLE routing_attempts (
  id                      BIGSERIAL PRIMARY KEY,
  task_id                 BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- pending: unresolved (may never return). resolved: produced a result.
  -- no_match: resolved with no eligible contributor. superseded: replaced by operator action.
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'resolved', 'no_match', 'superseded')),
  request_token           UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  -- Predetermined simulation outcome. INTERNAL: never serialized to operators.
  simulated_outcome       TEXT NOT NULL CHECK (simulated_outcome IN ('returns', 'never')),
  simulated_delay_ms      INTEGER CHECK (simulated_delay_ms IS NULL OR simulated_delay_ms > 0),
  selected_contributor_id BIGINT REFERENCES contributors(id),
  excluded_contributor_ids BIGINT[] NOT NULL DEFAULT '{}',
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ,
  superseded_at           TIMESTAMPTZ,
  late_result_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'resolved' OR completed_at IS NOT NULL),
  CHECK (status <> 'superseded' OR superseded_at IS NOT NULL)
);
CREATE UNIQUE INDEX routing_attempts_one_pending_per_task
  ON routing_attempts(task_id) WHERE status = 'pending';
CREATE INDEX routing_attempts_task_idx ON routing_attempts(task_id);

ALTER TABLE tasks
  ADD CONSTRAINT tasks_current_routing_attempt_fk
  FOREIGN KEY (current_routing_attempt_id) REFERENCES routing_attempts(id);

CREATE TABLE assignments (
  id                 BIGSERIAL PRIMARY KEY,
  task_id            BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contributor_id     BIGINT NOT NULL REFERENCES contributors(id),
  routing_attempt_id BIGINT REFERENCES routing_attempts(id),
  assignment_source  TEXT NOT NULL CHECK (assignment_source IN ('routing', 'manual')),
  status             TEXT NOT NULL CHECK (status IN (
                       'proposed', 'accepted', 'declined', 'failed', 'released', 'completed')),
  reason             TEXT,
  offered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at        TIMESTAMPTZ,
  declined_at        TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Active = proposed or accepted. At most one active assignment per task.
CREATE UNIQUE INDEX assignments_one_active_per_task
  ON assignments(task_id) WHERE status IN ('proposed', 'accepted');
CREATE INDEX assignments_contributor_active_idx
  ON assignments(contributor_id) WHERE status IN ('proposed', 'accepted');
CREATE INDEX assignments_task_idx ON assignments(task_id);

CREATE TABLE task_events (
  id              BIGSERIAL PRIMARY KEY,
  task_id         BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('operator', 'contributor', 'system')),
  actor_id        TEXT,
  previous_state  TEXT,
  new_state       TEXT,
  contributor_id  BIGINT REFERENCES contributors(id),
  routing_attempt_id BIGINT REFERENCES routing_attempts(id),
  explanation     TEXT NOT NULL DEFAULT '',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON task_events(task_id, id);
CREATE INDEX task_events_type_idx ON task_events(event_type);
CREATE INDEX task_events_created_idx ON task_events(created_at DESC);
