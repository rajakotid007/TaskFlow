# TaskFlow architecture

## Components

| Component | Role |
|---|---|
| **API** (`backend/src/server.ts`, `app.ts`) | Fastify HTTP API under `/api/v1`, plus a WebSocket endpoint at `/cable`. Controllers only validate and call services. |
| **Worker** (`backend/src/worker.ts`) | BullMQ worker that delivers delayed routing results by calling `handleRoutingResult`. |
| **PostgreSQL** | Source of truth for tasks, routing attempts, assignments and the audit trail. |
| **Redis** | Holds delayed routing jobs (BullMQ) and carries realtime events between processes (pub/sub). |
| **Frontend** (`frontend/`) | React + TypeScript operator console. TanStack Query for server state; WebSocket invalidation with polling fallback. |

Data flow: the operator's command hits the API, which runs a single PostgreSQL transaction (row-locked on the task). Side effects (queue jobs, realtime broadcasts) are collected in an *outbox* and executed only after commit. The worker later delivers a routing result through the same transactional path.

## Database

```
expertise_areas 1───* contributor_expertise *───1 contributors
tasks ──required_expertise_id──> expertise_areas
tasks 1───* routing_attempts         (tasks.current_routing_attempt_id -> the single pending attempt)
tasks 1───* assignments              (routing_attempts 0..1───* assignments)
tasks 1───* task_events              (append-only audit log)
```

Key constraints (all in `001_init.sql`):

- `assignments_one_active_per_task`: unique partial index on `assignments(task_id) WHERE status IN ('proposed','accepted')`.
- `routing_attempts_one_pending_per_task`: unique partial index on `routing_attempts(task_id) WHERE status = 'pending'`.
- CHECK constraints on every enum-like column, foreign keys everywhere, `request_token UUID UNIQUE`.

## Task state machine

Defined once, in `backend/src/domain/stateMachine.ts`. Every transition goes through `assertTransition` and the `TaskTransitionService` (`transition()`), which also guards the update with the expected status **and** `version`.

```
draft ──submit──> routing_pending ──result──> awaiting_acceptance ──accept──> assigned ──start──> in_progress ──complete──> completed
                       │  │                          │   │                      │
                       │  └──no match──> needs_intervention ──submit/assign──┐   └──fail──┐
                       │                                                     │            │
                       └──manual assign──────────────────────────────> awaiting_acceptance  │
                                                                             │decline     ▼
                                                             declined / assignment_failed ──recover──> routing_pending | awaiting_acceptance
cancel: any non-terminal state -> cancelled (completed and cancelled are terminal)
```

Three separate status concepts, kept apart on purpose:

- **Task status**: what the operator sees (`tasks.status`).
- **Routing attempt status**: `pending` (unresolved), `resolved`, `no_match`, `superseded`.
- **Assignment status**: `proposed`, `accepted` (both *active*), `declined`, `failed`, `released`, `completed`.

## Routing lifecycle

1. `POST /tasks/:id/route` locks the task, inserts a `routing_attempts` row with a **predetermined outcome** (`returns` or `never`, plus a delay for `returns`), moves the task to `routing_pending`, and schedules a delayed job only for `returns`.
2. Never-returning attempts are never scheduled. They stay `pending` until an operator acts. There is no automatic timeout.
3. When the job fires, `handleRoutingResult(attemptId, requestToken)` locks the task and applies the result only if *all* of these hold: the token matches, the attempt is `pending`, the task is `routing_pending`, and the attempt is the task's current attempt. Otherwise it records `stale_result_ignored` and changes nothing else.
4. Matching (`ExpertiseMatchingService`) picks the least-loaded eligible contributor. Candidate rows are locked `FOR UPDATE`.

## Routing states: unresolved, failed, superseded

- **Unresolved**: `routing_attempts.status = 'pending'`. Shown as "Unresolved for 3m 12s" with intervention controls. Never shown as failed.
- **Failed**: `no_match` (routing finished with no eligible contributor) or an assignment marked `failed`/`declined` by a human or contributor. These are real results, not timeouts.
- **Superseded**: `superseded`. An operator decision replaced the request. A late result for it is recorded as ignored.

## Concurrency safeguards

| Risk | Safeguard |
|---|---|
| Two active assignments on one task | Partial unique index + task row lock |
| Two routing requests for one task | Partial unique index on pending attempts + task row lock + idempotent return of the existing pending attempt |
| Stale result overwriting a manual decision | Validity check under the task lock (attempt pending, task routing_pending, current pointer, request token) |
| Job id reuse after a database reset | Job keyed by the attempt's unique `request_token`; handler verifies the token |
| Concurrent accepts | Lock on the task; second caller receives the idempotent success |
| Capacity race on one contributor | Candidate rows locked `FOR UPDATE` during matching |
| Lost update from stale UI | Optional `expected_version` on mutating commands; mismatch returns 409 |
| Side effects from rolled-back transactions | Outbox: queue and broadcast run only after commit |
| Redis unavailable during dispatch | Attempt stays pending and is visible; a `routing_dispatch_failed` event is recorded; operator can reroute |

## Recovery behaviour

- A declined or failed assignment is kept in history with its reason.
- Recovery (`POST /tasks/:id/recover`) reopens routing. The matcher excludes every contributor who declined or failed this task.
- Alternatively the operator chooses a contributor, who still has to accept.

## Realtime

Services publish sanitized events to Redis channel `taskflow:events`. The API process subscribes and forwards them to WebSocket clients. The frontend invalidates the affected TanStack Query keys. If the socket is down, the UI polls: 3 s for routing views and pending tasks, 5 s for dashboard and lists. Events never include the simulation outcome.

## Trade-offs

- **Single PostgreSQL transaction per command** keeps invariants strong. The cost is that the task row is a hot lock; acceptable at this scale.
- **Outbox over transactional messaging**: a crash between commit and enqueue can leave a pending attempt with no job. The pending attempt stays visible and is recoverable by reroute. A full transactional outbox table would close this gap; it is listed as an omission.
- **Realtime is best-effort**: publish failures are logged and skipped, and the database remains authoritative.
