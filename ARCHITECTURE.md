# TaskFlow — Architecture

TaskFlow is an operator console for creating tasks, routing them to contributors
by expertise through a deliberately unreliable asynchronous routing engine,
intervening while routing is outstanding, and recovering from declines or
failed routing.

## 1. Major components

```
 ┌────────────────────────┐   REST /api/v1   ┌──────────────────────────────┐
 │ React + TS (Vite)      │ ───────────────▶ │ Rails 8 API (Puma)            │
 │ TanStack Query cache   │ ◀─────────────── │  controllers → services       │
 │ Action Cable consumer  │   WebSocket      │  models / serializers         │
 └────────────────────────┘ ◀─── /cable ──── │  OperationsChannel            │
                                             └───────┬───────────────┬──────┘
                                                     │ Active Record │ Active Job
                                                     ▼               ▼
                                             ┌──────────────┐  ┌───────────┐
                                             │ PostgreSQL 16│  │ Redis 7   │
                                             │ source of    │  │ Sidekiq   │
                                             │ truth        │  │ queue +   │
                                             └──────────────┘  │ cable pub │
                                                     ▲         └─────┬─────┘
                                                     │               ▼
                                                     │       ┌──────────────────┐
                                                     └────── │ Sidekiq worker   │
                                                             │ RoutingEngineJob │
                                                             └──────────────────┘
```

* **PostgreSQL is the only source of truth.** Every routing request, its
  simulated behaviour, every assignment and every event is a row. Redis only
  holds the job queue and the Action Cable pub/sub channel. Losing Redis can
  lose a *delivery*, never state.
* **The routing engine is simulated as an external system.** `RoutingEngineJob`
  plays the role of a remote service: it is scheduled with a 5–20 s delay,
  computes a match, and "calls back" into `RoutingResultHandler`. For ~20 % of
  requests the engine never calls back at all.
* **Real-time is an optimisation, not a dependency.** The server broadcasts
  small `{type, task_id}` notifications; the client invalidates its query cache
  and refetches. When the socket is down, TanStack Query polls.

## 2. Folder structure

```
taskflow/
├── docker-compose.yml        postgres, redis, api, worker
├── backend/                  Rails API
│   ├── app/
│   │   ├── controllers/api/v1/   thin controllers, one per resource
│   │   ├── models/               Task, RoutingAttempt, Assignment, TaskEvent, ...
│   │   ├── services/             business rules (one service per command)
│   │   ├── queries/              TaskQuery (filters, "unresolved", "needs intervention")
│   │   ├── jobs/                 RoutingEngineJob
│   │   ├── channels/             OperationsChannel
│   │   └── serializers/          plain-Ruby JSON serializers
│   ├── db/seeds.rb               demo data produced by driving the real services
│   └── spec/                     RSpec (services, requests, concurrency)
└── frontend/                 React + TypeScript
    ├── src/
    │   ├── api/              typed client, query keys, hooks
    │   ├── components/       UI primitives + domain components
    │   ├── pages/            Dashboard, Tasks, NewTask, TaskDetail, ...
    │   └── lib/              formatting, status metadata, cable client
    └── e2e/                  Playwright specs
```

## 3. Database relationships

```
expertise_areas 1──* contributor_expertises *──1 contributors
expertise_areas 1──* tasks (required_expertise_id)
tasks 1──* routing_attempts *──0..1 contributors (selected_contributor_id)
tasks 1──* assignments *──1 contributors
routing_attempts 1──0..1 assignments (routing_attempt_id, null for manual)
tasks 1──* task_events
```

Key constraints:

| Constraint | Purpose |
|---|---|
| `index_assignments_one_active_per_task` — partial unique on `assignments(task_id) WHERE status IN ('offered','accepted')` | A task never has two active assignees, regardless of application bugs or races. |
| `index_routing_attempts_one_pending_per_task` — partial unique on `routing_attempts(task_id) WHERE status = 'pending'` | At most one routing request is authoritative for a task at a time. |
| unique `routing_attempts.request_token` | Engine callbacks are addressed by token; replays are detectable. |
| unique `contributor_expertises(contributor_id, expertise_area_id)` | No duplicate skills. |
| CHECK constraints on every status column | Invalid states are rejected by the database, not just Ruby. |
| FKs on every reference | No orphan rows. |

## 4. State machines

Three separate state machines, so a pending routing request is never confused
with an accepted assignment.

### 4.1 Task status

| State | Meaning |
|---|---|
| `draft` | Saved, not yet submitted. |
| `routing_pending` | A routing request is outstanding. Operator may intervene. |
| `awaiting_acceptance` | Engine proposed a contributor; an `offered` assignment exists. |
| `assigned` | A contributor accepted, or the operator assigned manually. |
| `in_progress` | Assignee started work. |
| `completed` | Terminal. |
| `declined` | The offered contributor declined. Needs operator recovery. |
| `assignment_failed` | Engine responded "no eligible contributor", or an accepted assignment was released before work began. `status_reason` says which. Needs recovery. |
| `cancelled` | Terminal. Operator cancelled. |

"Needs intervention" is a *derived* view (declined, assignment_failed, or
routing pending longer than the normal 20 s window), not a stored state — so
the system never claims to know a slow request has failed.

Transitions (enforced by `TaskTransitionService`, anything else raises
`InvalidTransition` → HTTP 422):

```
draft ──route──▶ routing_pending
routing_pending ──engine match──▶ awaiting_acceptance
routing_pending ──engine no match──▶ assignment_failed
routing_pending ──restart routing──▶ routing_pending  (old attempt superseded)
routing_pending ──manual assign──▶ assigned           (attempt superseded)
awaiting_acceptance ──accept──▶ assigned
awaiting_acceptance ──decline──▶ declined
awaiting_acceptance ──manual assign──▶ assigned       (offer withdrawn)
declined | assignment_failed ──retry routing──▶ routing_pending
declined | assignment_failed | draft ──manual assign──▶ assigned
assigned ──release (failed before work)──▶ assignment_failed
assigned ──start──▶ in_progress
in_progress ──complete──▶ completed
any non-terminal ──cancel──▶ cancelled   (pending attempt superseded, active assignment withdrawn)
```

### 4.2 Routing attempt status

| State | Meaning |
|---|---|
| `pending` | Request sent, no result yet. Could be slow or never return — the system does not know. |
| `matched` | Engine returned a contributor and the result was applied. |
| `no_match` | Engine returned "no eligible contributor" and the result was applied. |
| `superseded` | Operator intervened (manual assignment, retry, cancel) while pending. Any later result is recorded as stale and ignored. |

A superseded attempt keeps `late_result_at` / `late_outcome` if the engine
eventually answers, so history shows the ignored response.

The simulated behaviour (`respond` / `never_return`) and delay are stored on the
attempt when it is created but are **never serialized to the operator UI**.

### 4.3 Assignment status

| State | Active? | Meaning |
|---|---|---|
| `offered` | yes | Proposed by routing; awaiting contributor response. |
| `accepted` | yes | Contributor owns the task (routing acceptance or manual). |
| `declined` | no | Contributor declined the offer. |
| `withdrawn` | no | Operator replaced the offer/assignment before work began. |
| `completed` | no | Task completed. |

## 5. Routing lifecycle

1. `POST /tasks/:id/route` → `RoutingRequestService` locks the task row,
   validates the transition, creates a `pending` attempt with a unique
   `request_token`, decides the simulated behaviour (20 % `never_return`,
   otherwise `respond` after a uniform 5–20 s delay), moves the task to
   `routing_pending`, writes a `routing_requested` event, and — after commit —
   schedules `RoutingEngineJob` (only for `respond`).
2. `RoutingEngineJob` (the "remote engine") runs `ExpertiseMatchingService`
   and calls `RoutingResultHandler.call(request_token:, contributor_id: | nil)`.
3. `RoutingResultHandler` locks task → attempt. If the attempt is no longer
   `pending` or the task is no longer `routing_pending` *for that attempt*, the
   result is **stale**: it records `late_result_at/late_outcome` and a
   `stale_result_ignored` event and changes nothing else. Otherwise it
   re-validates the contributor (capacity can change during the delay), creates
   an `offered` assignment and moves the task to `awaiting_acceptance` — or to
   `assignment_failed` with an explanation.

There is **no automatic timeout**. A never-returning request stays `pending`
until the operator acts.

## 6. Concurrency safeguards

* **Pessimistic row locks.** Every command runs in a transaction that does
  `SELECT … FOR UPDATE` on the task row first (then contributor rows, in id
  order, when capacity matters). All task mutations serialize on that lock, so
  "operator assigns" and "engine result arrives" cannot interleave.
* **Attempt identity.** Results are addressed by `request_token`; only the
  task's current pending attempt may change the task.
* **Database invariants as the backstop.** Partial unique indexes make a
  second active assignment or second pending attempt impossible even if a code
  path forgets the lock.
* **Optimistic version for operator intent.** `tasks.version` increments on
  every transition. Operator commands may send `expected_version`; if the task
  changed since the operator looked at it, the API returns `409 Conflict`
  instead of acting on stale information.
* **Idempotent commands.** Re-sending `accept` on an accepted assignment,
  `decline` on a declined one, or `route` on a task that is already routing
  returns the current state with `200` instead of creating duplicates.

## 7. Recovery behaviour

* **Declined / assignment_failed** → operator can *retry routing* (new attempt;
  contributors who already declined this task are excluded) or *assign
  manually* to any eligible contributor.
* **Pending (slow or lost)** → operator can *assign manually* or *restart
  routing* (supersedes the old attempt and creates a fresh one).
* **Assignment failed before work** (`assigned`, not started) → operator can
  *release* it: the assignment becomes `withdrawn` and the task returns to a
  recoverable state for re-routing or manual assignment.

All history is append-only in `task_events`; attempts and assignments are never
deleted.

## 8. Service map

| Service | Responsibility |
|---|---|
| `TaskCreationService` | Create (and optionally submit) in one transaction |
| `RoutingRequestService` | submit / retry / restart; plans simulation; dispatches engine job |
| `RoutingSimulation` | 20 % never-return, 5–20 s delays; forced plans when enabled |
| `ExpertiseMatchingService` | Least-loaded eligible contributor + explanation |
| `ContributorEligibility` | Expertise, availability, capacity, previously-declined rules |
| `RoutingResultHandler` | Applies or records-as-stale an engine result |
| `AssignmentService` | Contributor accept / decline (idempotent) |
| `ManualInterventionService` | Operator assignment; supersedes / withdraws as needed |
| `AssignmentRecoveryService` | retry_routing / release |
| `TaskLifecycleService` | edit, start, complete, cancel |
| `TaskTransitionService` | The task state machine |
| `AuditEventService` + `OperationsBroadcaster` | Append event; broadcast after commit |

## 9. Trade-offs

* Sidekiq scheduled jobs (not in-process timers) make delays survive API
  restarts; if Redis is flushed, outstanding deliveries are lost and those
  attempts simply look unresolved — which is the honest outcome.
* Notifications carry no payload beyond ids, so nothing internal leaks and the
  client always renders server truth, at the cost of an extra fetch.
* Sidekiq polls its schedule every second (`poll_interval_average = 1`), so
  delivery lags the planned delay by up to ~1–2 s. Sidekiq's default interval
  scales with the number of registered processes and drifted to ~10 s here.
* Single-operator demo: no authentication. Actor on events is `operator`,
  `routing_engine`, `contributor` or `system`.
