# TaskFlow — Task Assignment & Routing Operations Platform

TaskFlow is an operator console for getting work to the right people. An
operator creates a task that needs a particular kind of expertise (Ruby, React,
DevOps, …). TaskFlow sends it to an **asynchronous routing engine**, which
proposes a contributor with that expertise; that contributor accepts or
declines.

The routing engine is deliberately unreliable, as real ones are. Usually it
answers within 5–20 seconds, but about one request in five **never answers at
all**, and the operator cannot tell which kind they are waiting on. TaskFlow is
built around that uncertainty:

- A request that hasn't answered is shown as **waiting**, never as **failed**.
  There are no automatic timeouts.
- The operator can **step in at any time**: assign someone directly, restart
  routing, or cancel.
- If the engine answers *after* the operator has decided, the late answer is
  **recorded and ignored**. It can never overwrite the operator's decision.
- Declines and failed assignments can be **recovered**, and every step is kept
  in a complete **audit history**.
- A task can **never have two active assignees**. The database enforces this,
  not just the UI.

It is a complete, working full-stack application: a **Ruby on Rails 8** API on
**PostgreSQL**, a **Sidekiq** worker on **Redis** that plays the routing
engine, **Action Cable** for live updates, and a **React + TypeScript**
operator console.

---

## Demo video


https://github.com/user-attachments/assets/ccab415d-c5bf-4b7f-be51-7d34eccac634





## Contents

1. [Demo video](#demo-video)
2. [Repository layout](#repository-layout)
3. [Features](#features)
4. [How it works](#how-it-works)
5. [Tech stack](#tech-stack)
6. [Project structure](#project-structure)
7. [Setup](#setup)
8. [Everyday commands](#everyday-commands)
9. [Using the console: the four core scenarios](#using-the-console-the-four-core-scenarios)
10. [API reference](#api-reference)
11. [Testing](#testing)
12. [Troubleshooting](#troubleshooting)
13. [Design decisions, trade-offs and limitations](#design-decisions-trade-offs-and-limitations)
14. [Further documentation](#further-documentation)

---

## Repository layout

The repository contains **two implementations** of the same brief:

| Path | Implementation | Role |
|---|---|---|
| repo root: `backend/`, `frontend/`, `docker-compose.yml` | **Rails 8 API + Sidekiq + Action Cable**, React 19 console | **Primary.** Matches the requested stack and is verified end to end. *Everything in this README describes it.* |
| [`node-version/`](node-version/) | Node 22 + Fastify + BullMQ API, React 18 console | Earlier implementation, kept for reference. Self-contained, with its own [README](node-version/README.md), compose file and docs. |

---

## Features

### 1. Task management
- **Create tasks** with a title, description, required expertise, priority
  (`low`, `medium`, `high`, `urgent`) and an optional due date.
- **Save as draft** or **create and submit for routing** in one step. If routing
  cannot be dispatched (for example, Redis is down), the task isn't created
  either, so nothing is left half-submitted.
- **Form validation** in the browser (title at least 3 characters, expertise
  required, due date not in the past in the operator's own time zone) and again
  on the server, which also rejects dates that don't exist (e.g. `2026-13-45`)
  instead of silently clearing them. Server errors appear next to the matching
  fields. Malformed request bodies get a `400`, never a server error.
- **Edit details** (title, description, priority, due date) on any non-final
  task from the task page; only changed fields are sent. The
  required expertise can change only while the task is `draft`, `declined` or
  `assignment_failed`, so an in-flight request or assignment is never
  invalidated.
- **Lifecycle:** start work, mark complete, cancel. Cancelling supersedes any
  outstanding routing request and withdraws any assignment.

### 2. Automatic, expertise-based routing
- Routing considers contributors who **have the required expertise**, are
  **available**, are **below their capacity** (`max_active_assignments`,
  default 3), and **have not already declined, or been released from, this
  task**.
- It picks the **least-loaded** eligible contributor, breaking ties by lowest
  id so results are deterministic. Every decision is recorded with a
  plain-English reason, e.g. *"Priya Raman has Ruby expertise and the lowest
  active load (0) of 3 eligible contributor(s)"*.
- When nobody qualifies, it says exactly why, e.g. *"All 2 QA contributor(s)
  are ineligible: Hannah Cohen (currently unavailable); Grace Liu (at capacity
  (3/3 active assignments))"*.
- A proposal becomes an **offer**. The contributor **accepts** (task becomes
  `assigned`) or **declines** with a reason (task becomes `declined`).

### 3. Realistic, unreliable routing simulation
- Each routing request's behaviour is **decided once, when it is created**, and
  stored with it:
  - **80 %** answer after a random delay of **5–20 seconds**
  - **20 %** **never answer**
- Never-answering requests are simply never delivered, and nothing ever times
  them out.
- The planned behaviour is **never shown on operator screens or in the operator
  API**. A slow request and a lost one look identical, as they would in real
  life.

### 4. Honest handling of unresolved requests
- A pending request shows a **live elapsed-time counter** in the task table,
  the task page and the routing view.
- After the usual 20-second window, it turns **amber** and is labelled
  *"beyond usual window"*. The task page explains: *"It has not failed — the
  engine may still answer — but there is no way to know whether it will."*
- These tasks appear under **Unresolved routing** and **Needs intervention** on
  the dashboard and task list. They stay fully actionable, and they survive a
  browser refresh because all state lives in PostgreSQL.

### 5. Human intervention
An offer has no deadline either. If nobody answers within
`OFFER_RESPONSE_WINDOW_SECONDS` (default 30 minutes), the task turns amber and
joins *Needs intervention* (and the *Unanswered offers* view), but the offer
stays open. Accepting requires the contributor to still be available and to
still have the expertise.

At any point before work starts, the operator can:
- **Assign manually:** choose from eligible contributors. Each candidate shows
  their load, and ineligible ones are greyed out with the reason. The operator
  can add a note.
  - If routing was pending, the request is **superseded**.
  - If an offer was open, it is **withdrawn**.
  - If someone was already assigned, they are **replaced**.
- **Restart routing:** supersede the current request (or withdraw the open
  offer) and send a fresh one.
- **Cancel** the task.

A manual assignment takes effect immediately: the operator's choice counts as
agreed.

Every confirmation dialog sends the task version from **when it opened**. If the
task changes while the operator is reading it (for example, the contributor
accepts while the *Cancel task* dialog is open), the API answers `409`, the
dialog closes and the operator sees the new state.

### 6. Late results never win
If a superseded request answers later, TaskFlow:
- records the late answer on the attempt (`late_result_at`, `late_outcome`,
  `late_contributor`),
- adds a **"Late result ignored"** event to the history, e.g. *"Late result for
  routing request #1 arrived 13s after it was sent (proposed Marcus Bell).
  Ignored: request was superseded (manual assignment). Task remains assigned."*,
- changes **nothing else**.

### 7. Recovery
- **After a decline:** the reason is shown prominently. The operator can
  **retry routing**, which automatically skips everyone who declined this task,
  or **assign manually**, where anyone who declined is flagged *"Declined
  before"*.
- **After routing finds nobody:** retry once availability changes, or assign
  manually.
- **When an assignment falls through** — before work begins or after it
  started (the contributor is ill, left, or blocked) — **release** it with a
  reason. The contributor is freed, the task becomes recoverable, and retry
  routing skips them (a manual pick shows them as *"Released before"*).
- **When a contributor changes** (made unavailable, expertise removed, capacity
  lowered), work they already hold is left alone, but the save lists the
  affected tasks and those tasks warn that the assignee is unavailable.
- Earlier attempts and assignments are **never deleted**. The task page lists
  every routing attempt and every assignment, newest first.

### 8. Data integrity and concurrency safety
- **One active assignee per task**, guaranteed by a PostgreSQL partial unique
  index. **One outstanding routing request per task**, guaranteed the same way.
- Every action locks the task's database row first, so an operator click, a
  contributor response and a routing result can never interleave.
- **Stale-view protection:** every action sends the task version the operator
  was looking at. If the task changed in the meantime, the action is refused
  (*"Task changed before your action"*) instead of silently overwriting newer
  state.
- **Safe repeats:** double-clicks and retries (routing twice, accepting twice,
  assigning the same person twice) are harmless no-ops.
- Several tasks can route at the same time without over-allocating a
  contributor.

### 9. Audit history
- An append-only log records every important step: who did it (operator,
  routing engine, contributor or system), the state before and after, and a
  plain-English explanation.
- History rows cannot be edited.
- Filter by task, event type and actor.

### 10. Real-time updates
- Changes appear **without refreshing**: routing results, accepts, declines, and
  actions from other browser tabs.
- A connection indicator in the sidebar shows **Live**, **Connecting** or
  **Polling**. If the WebSocket drops, the console refreshes every 4 seconds
  until it reconnects.

### 11. Operator console pages
| Page | Path | What you can do there |
|---|---|---|
| **Dashboard** | `/` | Eight live counters (total tasks, routing pending, awaiting acceptance, active assignments, unresolved routing, needs intervention, declined or failed, completed), each linking to a filtered task list. A **Needs attention** list (highest priority first, with live timers), **Recent activity**, and charts of open tasks by priority and routing outcomes. |
| **Tasks** | `/tasks` | Search by title or `#id`. Filter by view (all / open / needs intervention / unresolved), status, priority and expertise, and sort. Filters live in the URL, so dashboard links and refreshes keep them. Columns: ID, title, expertise, priority, created, task status, routing status, assignee, pending time, quick actions. |
| **Create task** | `/tasks/new` | The task form, with **Save draft** and **Create & submit for routing**. |
| **Task detail** | `/tasks/:id` | A colour-coded **explanation of why the task is in its current state**, every available action, task details, all routing attempts (with superseded and late-result details), all assignments (with decline reasons), and the full timeline. |
| **Routing operations** | `/routing` | Every routing request, filterable by Pending, Unresolved (> 20 s), Resolved, Superseded, Late results or All. Live waiting times, outcomes and reasons, with an **Intervene** shortcut. |
| **Contributors** | `/contributors` | Cards with expertise, availability, a capacity meter and current tasks. **Add** or **edit** contributors (name, email, availability, capacity 1–20, expertise). |
| **Activity history** | `/activity` | The audit trail as a table (timestamp, event, task, contributor, actor, state change, explanation), filterable by task ID, event type and actor. |
| **Simulation lab** *(dev only)* | `/simulation` | Start scenarios with a forced engine behaviour, see each request's planned behaviour, and **Deliver now** to make the engine answer immediately. |

Light and dark themes are available (toggle in the sidebar). The layout works on
phones and tablets, and dialogs and controls are keyboard-accessible.

---

## How it works

### Architecture

```
                         ┌──────────────────────────────┐
  Browser                │ Rails 8 API (Puma, :3000)    │
  React console ─REST──▶ │  controllers → services      │──▶ PostgreSQL 16
  (Vite, :5174) ◀─WS───  │  Action Cable /cable         │    (source of truth)
                         └──────────┬───────────────────┘          ▲
                                    │ enqueue (delayed job)        │
                                    ▼                              │
                                 Redis 7 ──▶ Sidekiq worker ───────┘
                          (job queue +       RoutingEngineJob
                           cable pub/sub)    "the routing engine"
```

- **PostgreSQL is the single source of truth.** Every routing request (with its
  planned behaviour), assignment and event is a database row.
- **Redis carries only the job queue and the live-update channel.** Losing Redis
  can delay or lose a *delivery*, never data.
- **The routing engine is modelled as an external service.** `RoutingEngineJob`
  runs after the planned delay, works out a match *without* holding locks (as a
  remote system would), and "calls back". `RoutingResultHandler` then
  re-checks everything under lock before applying it.
- **Live updates are only a notification.** Messages carry just
  `{ type, task_id, event_id, at }`; the console then refetches from the API.
  Nothing internal can leak, and the console always shows server truth.

### Data model

```
expertise_areas 1──* contributor_expertises *──1 contributors
expertise_areas 1──* tasks (required_expertise_id)
tasks 1──* routing_attempts      (selected / late contributor → contributors)
tasks 1──* assignments *──1 contributors     (routing_attempt_id, null for manual)
tasks 1──* task_events           (append-only audit log)
```

| Table | Purpose |
|---|---|
| `tasks` | The work item: title, priority, due date, `status`, `status_reason`, and a `version` that increments on every change |
| `routing_attempts` | One row per request to the engine: unique `request_token`, timing, outcome and reason, supersede/late-result details, and the (hidden) simulation plan |
| `assignments` | Who holds or held the task: `offered`, `accepted`, `declined`, `withdrawn` or `completed`, with timestamps and reasons |
| `task_events` | The audit log: event type, actor, previous and new state, message, JSON metadata |
| `contributors`, `expertise_areas`, `contributor_expertises` | The directory, with availability and capacity |

Every reference has a foreign key, and every status column has a database CHECK
constraint. Two **partial unique indexes** enforce the core rules even if
application code were wrong:

- `index_assignments_one_active_per_task`: unique `task_id` where status is
  `offered` or `accepted`
- `index_routing_attempts_one_pending_per_task`: unique `task_id` where status
  is `pending`

### Three separate state machines

A pending routing request, an open offer and an accepted assignment are
different things, so each has its own status.

**Task status** (what the operator sees):

| Status | Meaning |
|---|---|
| `draft` | Saved, not yet submitted |
| `routing_pending` | A routing request is outstanding. It might be slow; it might never answer. |
| `awaiting_acceptance` | The engine proposed a contributor; their answer is pending |
| `assigned` | A contributor owns the task (accepted the offer, or assigned manually) |
| `in_progress` | Work has started |
| `completed` | Finished (final) |
| `declined` | The proposed contributor declined; needs recovery |
| `assignment_failed` | The engine found nobody (`status_reason: no_eligible_contributor`), or the assignment was released (`assignment_released`); needs recovery |
| `cancelled` | Cancelled by the operator (final) |

**Allowed task transitions** (enforced by `TaskTransitionService`; anything else
is rejected with `invalid_transition`):

| From | Allowed next states |
|---|---|
| `draft` | `routing_pending`, `assigned`, `cancelled` |
| `routing_pending` | `routing_pending` (restart), `awaiting_acceptance`, `assignment_failed`, `assigned`, `cancelled` |
| `awaiting_acceptance` | `routing_pending` (restart), `assigned`, `declined`, `cancelled` |
| `assigned` | `assigned` (reassign), `in_progress`, `assignment_failed` (release), `cancelled` |
| `in_progress` | `completed`, `assignment_failed` (release), `cancelled` |
| `declined`, `assignment_failed` | `routing_pending` (retry), `assigned`, `cancelled` |
| `completed`, `cancelled` | — (final) |

**Routing attempt status:** `pending` (no answer yet), `matched` (answered with a
contributor and applied), `no_match` (answered "nobody eligible"), `superseded`
(replaced by an operator decision; a later answer is stored as a late result
and ignored).

**Assignment status:** `offered` and `accepted` are **active**; `declined`,
`withdrawn` and `completed` are inactive.

### Unresolved vs failed vs superseded

| Term | What it means | How it's stored |
|---|---|---|
| **Unresolved** | No answer yet, and older than the usual 20 s. It might still come. | Attempt `pending`. "Beyond window" is calculated on the fly, never stored. |
| **Failed** | The engine **did answer**: nobody is eligible. Or an assignment was released. | Attempt `no_match` / task `assignment_failed` with a reason |
| **Superseded** | An operator decision replaced the request | Attempt `superseded`; a later answer is kept as `late_*` fields |

"Needs intervention" is likewise **derived**: declined, failed, or unresolved.
Storing it would mean changing a task's state on a timer, which would amount to
declaring slow requests failed.

### Routing lifecycle, step by step

1. **Request:** `POST /tasks/:id/route` → `RoutingRequestService` locks the
   task, creates a `pending` attempt with a unique token, decides the simulation
   plan, moves the task to `routing_pending`, records a *Routing requested*
   event, and enqueues `RoutingEngineJob` with the planned delay. A
   never-answering request is not enqueued.
2. **Engine works:** after the delay, the job runs `ExpertiseMatchingService`
   (without locks) and passes its answer to `RoutingResultHandler`.
3. **Result arrives:** the handler locks the task, then the attempt.
   - **Still pending:** it re-checks the proposed contributor (availability or
     capacity may have changed during the delay). If they still qualify, it
     creates an `offered` assignment and the task becomes `awaiting_acceptance`.
     Otherwise it records `no_match` with the reason and the task becomes
     `assignment_failed`.
   - **Already superseded:** it records the late result and a *Late result
     ignored* event, and changes nothing else.
   - **Already answered (duplicate delivery):** it does nothing.
4. **Contributor responds:** `accept` → `assigned`; `decline` (with reason) →
   `declined`.

### Who can be assigned (eligibility rules)

| Rule | Routing | Manual assignment |
|---|:---:|:---:|
| Has the task's required expertise | ✔ | ✔ |
| Is `available` | ✔ | ✔ |
| Below capacity (offers count as well as accepted work) | ✔ | ✔ |
| Has not declined this task before | ✔ | — (allowed, but flagged) |

Offers count toward capacity so routing can't offer one person more tasks than
they can take.

### Concurrency and reliability safeguards

| Risk | Safeguard |
|---|---|
| Two active assignees on one task | Partial unique index + task row lock |
| Two outstanding requests for one task | Partial unique index + task row lock + idempotent submit |
| A late routing result overwriting an operator's decision | The result is applied only if its attempt is still `pending`; otherwise it is recorded as stale |
| Operator acting on an outdated screen | `expected_version` check → **409 `stale_version`** |
| Simultaneous actions on the same task | Every action takes the task row lock first, so they run one after another |
| Several tasks competing for one contributor's last slot | Contributor row locked, and capacity re-checked when the result is applied |
| Redis unavailable when routing | The job is enqueued *inside* the transaction, so the whole request rolls back and the API returns **503 `routing_unavailable`**. No phantom "pending" request is left behind. |
| Worker restart during a delay | The scheduled job lives in Redis and the state in Postgres; delivery still happens |
| Browser refresh | All state is server-side; the page reloads exactly as it was |
| Race slips past the locks anyway | The database refuses it, and the API returns **409 `concurrent_modification`** ("reload and try again") |

### Audit event types
`task_created`, `task_updated`, `routing_requested`, `routing_superseded`,
`routing_matched`, `routing_no_match`, `stale_result_ignored`,
`assignment_offered`, `assignment_accepted`, `assignment_declined`,
`assignment_withdrawn`, `assignment_released`, `manual_assignment`,
`recovery_initiated`, `work_started`, `task_completed`, `task_cancelled`.

Actors: `operator`, `routing_engine`, `contributor`, `system`.

---

## Tech stack

Versions are the ones installed and tested.

| Layer | Technology |
|---|---|
| Backend | Ruby 3.3.14, **Rails 8.0.5.2** (API mode), Puma 8.1.2, pg 1.7.0, rack-cors 3.0.0 |
| Background jobs and real-time | **Sidekiq 7.3.9**, **Action Cable** (Redis adapter), redis 5.4.1, connection_pool 2.5.5 |
| Data | **PostgreSQL 16**, **Redis 7** (Docker images `postgres:16-alpine`, `redis:7-alpine`) |
| Backend tests | RSpec (rspec-rails 7.1.1), FactoryBot, shoulda-matchers, RuboCop (rails-omakase) |
| Frontend | **React 19**, **TypeScript 5.9** (strict), **Vite 8**, **Tailwind CSS 4**, React Router 8, **TanStack Query 5**, React Hook Form + **Zod 4**, Recharts 3, lucide-react, @rails/actioncable |
| Frontend tests | Vitest 5, React Testing Library 16, **Playwright** 1.65 |
| Tooling | ESLint 10 + typescript-eslint, Prettier 3, Docker Compose |

Pinned on purpose (reasons are in comments in `backend/Gemfile`):
- `json ~> 2.10`: json 3.x breaks Rails 8.0 serialization
- `redis ~> 5.4`: Action Cable's adapter needs < 6
- `connection_pool ~> 2.5`: Sidekiq 7.3 crashes with 3.x
- TypeScript 5.9: the ESLint tooling doesn't support TypeScript 7 yet

---

## Project structure

```
taskflow/
├── docker-compose.yml           postgres, redis, api (Rails), worker (Sidekiq)
├── .env.example                 compose overrides (origins, simulation controls)
├── backend/                     Rails 8 API
│   ├── Dockerfile.dev
│   ├── app/
│   │   ├── controllers/api/v1/  tasks, assignments, contributors, expertise_areas,
│   │   │                        routing_attempts, events, dashboard, simulation
│   │   ├── models/              Task, RoutingAttempt, Assignment, TaskEvent,
│   │   │                        Contributor, ExpertiseArea, ContributorExpertise
│   │   ├── services/            all business rules (one service per action, see below)
│   │   ├── queries/             TaskQuery: filters, "unresolved", "needs intervention"
│   │   ├── serializers/         JSON shapes (simulation fields never serialized)
│   │   ├── jobs/                RoutingEngineJob: the simulated engine
│   │   └── channels/            OperationsChannel (Action Cable)
│   ├── config/                  routes, sidekiq, cable, CORS, database
│   ├── db/                      migration (constraints and indexes), schema, seeds
│   └── spec/                    services, requests, concurrency (RSpec)
├── frontend/                    React console
│   ├── src/
│   │   ├── api/                 typed fetch client, TanStack Query hooks, types
│   │   ├── components/          layout, UI primitives, status badges, actions, dialogs
│   │   ├── pages/               Dashboard, Tasks, NewTask, TaskDetail, Routing,
│   │   │                        Contributors, Activity, Simulation
│   │   ├── lib/                 live updates (cable + polling), status labels, formatting
│   │   └── test/                Vitest + Testing Library tests
│   ├── e2e/                     Playwright scenarios
│   └── vite.config.ts           dev server :5174, proxies /api and /cable
├── node-version/                reference Node/Fastify implementation
└── ARCHITECTURE.md · ASSUMPTIONS.md · TESTING.md · AI_DEVELOPMENT_LOG.md · SESSION_MAP.md
```

**Backend services:**

| Service | Responsibility |
|---|---|
| `TaskCreationService` | Create a task, and optionally submit it, in one transaction |
| `RoutingRequestService` | Submit / retry / restart routing; plan the simulation; enqueue the engine |
| `RoutingSimulation` | The 20 % never-return rule and 5–20 s delays; forced plans in dev |
| `ExpertiseMatchingService` | Pick the least-loaded eligible contributor and explain why |
| `ContributorEligibility` | Expertise, availability, capacity and previously-declined rules |
| `RoutingResultHandler` | Apply a result, or record it as stale |
| `AssignmentService` | Contributor accept / decline (safe to repeat) |
| `ManualInterventionService` | Operator assignment; supersedes or withdraws as needed |
| `AssignmentRecoveryService` | Retry routing / release an assignment |
| `TaskLifecycleService` | Edit, start, complete, cancel |
| `TaskTransitionService` | The task state machine |
| `AuditEventService`, `OperationsBroadcaster` | Write the audit event; notify consoles after commit |

---

## Setup

### Prerequisites
- **Docker Desktop** (Compose v2). Ruby, PostgreSQL and Redis all run in
  containers, so nothing else needs installing for the backend.
- **Node.js 20 or newer** with npm (developed with Node 24).
- About **2 GB of free disk space** for the images, gems and `node_modules`.

### 1. Get the code
```bash
git clone https://github.com/rajakotid007/TaskFlow.git
cd TaskFlow
```
The repo's `.gitattributes` keeps LF line endings. This matters on Windows:
CRLF line endings would break `backend/bin/*` scripts inside the Linux container.

### 2. Start the backend (PostgreSQL, Redis, Rails API, Sidekiq worker)
```bash
docker compose up -d --build
```
The first start builds the Ruby image, installs gems, and creates and migrates
the databases (`bin/rails db:prepare`). This takes a few minutes. Watch it with:
```bash
docker compose logs -f api        # wait for "Listening on http://0.0.0.0:3000"
```
Check it's up:
```bash
curl http://localhost:3000/up                       # → 200
curl http://localhost:3000/api/v1/dashboard/summary  # → JSON
```

### 3. Load the demo data
```bash
docker compose exec api bin/rails db:seed
```
The seed builds every task by running the real services at backdated times, so
the history you see is exactly what the app would have recorded. It creates:

- **9 expertise areas:** Ruby, Java, Python, React, TypeScript, DevOps, AI/ML,
  Database Engineering, QA
- **13 contributors** with different skills and capacities. One (Omar Haddad)
  is unavailable.
- **20 tasks** in every state:
  - 3 completed, 2 in progress
  - 3 assigned, including one showing a **manual intervention with a late result
    ignored** and one **recovered after a decline**
  - 2 awaiting acceptance, 2 declined (with reasons)
  - 2 assignment failed: one where nobody was eligible, one released
  - 1 cancelled while routing, 3 drafts
  - 2 **unresolved** requests that will never answer

Seeding is skipped if tasks already exist. To wipe and rebuild:
`docker compose exec -e SEED_RESET=1 api bin/rails db:seed`.

### 4. Start the frontend
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5174**. The Vite dev server forwards `/api` and `/cable`
to the Rails API on port 3000, so the browser talks to a single address.

### Services and ports

| Service | Host port | Notes |
|---|---|---|
| Frontend (Vite) | **5174** | Operator console |
| `api` (Rails + Action Cable) | **3000** | REST at `/api/v1`, WebSocket at `/cable`, health at `/up` |
| `worker` (Sidekiq) | — | Queues `routing` and `default`; polls scheduled jobs every second |
| `postgres` | **5433** → 5432 | User / password `taskflow` / `taskflow` (development only) |
| `redis` | **6380** → 6379 | Append-only persistence on |

The non-default host ports (5433, 6380, 5174) avoid clashes with other local
Postgres, Redis or Vite instances.

### Configuration

Backend settings are in `docker-compose.yml`. Override them from your shell or a
`.env` file next to it (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `FRONTEND_ORIGIN` | `http://localhost:5174,http://127.0.0.1:5174` | Allowed browser origins for CORS and Action Cable (comma-separated) |
| `SIMULATION_CONTROLS_ENABLED` | `true` | Enables forced routing outcomes and the Simulation lab. **Never on in production**, whatever the value. |
| `DATABASE_HOST` / `DATABASE_USERNAME` / `DATABASE_PASSWORD` | `postgres` / `taskflow` / `taskflow` | Database connection (development credentials only) |
| `REDIS_URL` | `redis://redis:6379/0` | Sidekiq queue and Action Cable |
| `RAILS_MAX_THREADS` | `8` (api) | Puma threads and DB pool size |

Frontend settings are all optional (see `frontend/.env.example`): `PORT`,
`VITE_API_PROXY_TARGET`, `VITE_API_BASE_URL`, `VITE_CABLE_URL`, `PW_CHANNEL`.

No secrets are committed. `backend/config/master.key` and Rails credentials are
not used in development.

---

## Everyday commands

| Task | Command |
|---|---|
| Start everything (backend) | `docker compose up -d` |
| Start the console | `cd frontend && npm run dev` |
| Stop the backend | `docker compose down` (add `-v` to also delete the database and Redis data) |
| Follow API / worker logs | `docker compose logs -f api` · `docker compose logs -f worker` |
| Rails console | `docker compose exec api bin/rails console` |
| Reset demo data | `docker compose exec -e SEED_RESET=1 api bin/rails db:seed` |
| Run migrations | `docker compose exec api bin/rails db:migrate` |
| Rebuild after changing the Gemfile | `docker compose build api && docker compose up -d` |

---

## Using the console: the four core scenarios

The quickest way to reproduce each scenario is the **Simulation lab**
(`/simulation`, development only). Its **Start** buttons create a task and route
it with a fixed engine behaviour:

| Scenario button | Engine behaviour |
|---|---|
| Normal routing | The real rules: 20 % never answer, the rest answer after 5–20 s |
| Fast response | Answers after 5 s |
| Delayed response (45s) | Answers well after the usual window |
| Never returns | Never answers |

The lab also lists recent requests **with** their planned behaviour; it is the
only screen that shows it. **Deliver now** makes the engine answer a request
immediately, even one planned never to answer. Tasks created on the normal
**Create task** page always follow the real rules.

### Scenario 1: routine assignment
1. Simulation lab → **Fast response** → **Start** (or **Create task** →
   **Create & submit for routing**).
2. Open the task. It shows **Routing pending** with a ticking timer. About 5
   seconds later it changes to **Awaiting acceptance** by itself, and the
   explanation names the proposed contributor and why they were chosen.
3. Click **Record acceptance**. The task becomes **Assigned** and routing is
   complete.
4. The **History** panel shows: Task created → Routing requested → Routing
   matched → Offer made → Offer accepted.

### Scenario 2: unresolved routing
1. Simulation lab → **Never returns** → **Start**, and open the task.
2. For the first 20 seconds it reads *"Results usually arrive within 5–20s"*.
3. After that it turns amber: *"Routing request #1 has been outstanding for 34s,
   longer than the usual 5–20s. It has not failed — the engine may still answer
   — but there is no way to know whether it will."* The timer keeps counting and
   nothing is marked failed.
4. **Assign manually** and **Restart routing** remain available. The task also
   appears under Dashboard → **Unresolved routing** and Tasks → **Unresolved
   routing**. Refresh the browser and it's still there.

### Scenario 3: human intervention with a late result
1. Simulation lab → **Delayed response (45s)** → **Start**, and open the task.
2. Click **Assign manually**. The dialog warns that the outstanding request will
   be superseded. Pick a contributor, optionally add a note, and click
   **Assign**.
3. The task becomes **Assigned**, and the routing attempt shows **Superseded**.
4. When the engine answers (after 45 s, or immediately with **Deliver now** in
   the lab), the history gains **Late result ignored**, naming whom the engine
   would have proposed. The task stays assigned to your choice, with exactly
   one assignment.

### Scenario 4: recovery after a decline
1. Open a task that is **Awaiting acceptance** (or start a **Fast response**
   scenario).
2. Click **Record decline** and enter a reason, e.g. *"On holiday next week"*.
3. The task becomes **Declined** and shows the reason. Recover it either way:
   - **Retry routing:** a new request is sent, and the contributor who declined
     is skipped automatically.
   - **Assign manually:** the decliner appears with a *"Declined before"* tag.
4. Both the declined and the new assignment remain listed, and the history shows
   the whole story.

There's also **Release assignment** on an assigned or in-progress task. Use it
when an assignment falls through; retrying afterwards skips the released
contributor.

---

## API reference

Base path **`/api/v1`**. Requests and responses are JSON. Successful responses
look like `{ "data": …, "meta": … }`. Lists accept `page` and `per_page` (up to
100) and return `meta.total` and `meta.total_pages`.

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/tasks` | List. Filters: `q` (title or `#id`), `status` (comma list), `priority`, `expertise_id`, `view` (`open`, `needs_intervention`, `unresolved`), `sort` (`created_at`, `-created_at`, `-priority`) |
| POST | `/tasks` | Create. `{ "task": { title, description, required_expertise_id, priority, due_date }, "submit": true, "simulation"?: {…} }` |
| GET | `/tasks/:id` | Full detail: routing attempts, assignments, `available_actions`, `version` |
| PATCH | `/tasks/:id` | Edit fields (`{ "task": {…}, "expected_version" }`) |
| POST | `/tasks/:id/route` | Route. `mode`: `submit`, `retry`, `restart` (inferred if omitted) |
| POST | `/tasks/:id/intervene` | Manual assignment: `{ contributor_id, note? }` |
| POST | `/tasks/:id/recover` | `{ recovery_action: "retry_routing" \| "release", reason? }` |
| POST | `/tasks/:id/start` · `/complete` · `/cancel` | Lifecycle (`cancel` accepts `reason`) |
| GET | `/tasks/:id/history` | The task's audit events, oldest first |
| GET | `/tasks/:id/eligible_contributors` | Candidates with `eligible`, `ineligible_reason` and `previously_declined` |
| POST | `/assignments/:id/accept` | Contributor accepts an offer |
| POST | `/assignments/:id/decline` | Contributor declines (`reason`) |
| GET / POST | `/contributors` | List (`q`, `expertise_id`, `availability`) / create |
| GET / PATCH | `/contributors/:id` | Detail / update (`expertise_area_ids` replaces the expertise list) |
| GET / POST | `/expertise_areas` | List (with contributor counts) / create |
| GET | `/routing-attempts` | `filter`: `pending`, `unresolved`, `resolved`, `superseded`, `late`; optional `task_id` |
| GET | `/routing-attempts/:id` | One attempt |
| GET | `/events` | Audit log. Filters: `task_id`, `event_type` (comma list), `actor_type` |
| GET | `/dashboard/summary` | Counters, breakdowns, attention list, recent events |
| GET | `/simulation` | Whether simulation controls are enabled |
| GET | `/simulation/routing-attempts` | *(dev)* Recent attempts **with** their planned behaviour |
| POST | `/simulation/routing-attempts/:id/deliver` | *(dev)* Make the engine answer now |

**Mutating commands** (route, intervene, recover, start, complete, cancel, edit)
accept `expected_version`. **Forced simulation**:
`"simulation": { "behavior": "respond", "delay_seconds": 5 }` or
`{ "behavior": "never_return" }` is accepted on create, route and recover, only
when simulation controls are enabled.

**Repeating a command that already took effect** returns `200` with
`"meta": { "changed": false }`.

### Errors

Every error has the same shape:
```json
{ "error": { "code": "stale_version", "message": "Task changed since you loaded it …", "details": { … } } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Missing or malformed parameters, unknown recovery action, bad simulation values |
| 403 | `simulation_disabled` | Forced simulation used while controls are off |
| 404 | `not_found` | Unknown record |
| 409 | `stale_version` | `expected_version` doesn't match. `details` include the current status and version. |
| 409 | `concurrent_modification` | A simultaneous change hit a database constraint; reload and retry |
| 422 | `validation_failed` | Field errors; `details` maps each field to its messages |
| 422 | `invalid_transition` | The action isn't allowed in the task's current state |
| 422 | `contributor_not_eligible` | Manual assignment of someone who doesn't qualify (with the reason) |
| 503 | `routing_unavailable` | The job queue (Redis) is unreachable; nothing was created |
| 503 | `database_unavailable` | PostgreSQL is unreachable |

### Example: intervene while routing is pending
```http
POST /api/v1/tasks/27/intervene
Content-Type: application/json

{ "contributor_id": 10, "expected_version": 1, "note": "Owns this module" }
```
```json
{
  "data": {
    "id": 27, "status": "assigned", "version": 2,
    "current_assignment": { "id": 31, "status": "accepted", "source": "manual",
                            "contributor": { "id": 10, "name": "Tomás Silva" } },
    "routing_attempts": [ { "attempt_number": 1, "status": "superseded",
                            "superseded_reason": "manual_assignment" } ],
    "available_actions": ["start_work", "release", "assign_manually", "edit", "cancel"]
  },
  "meta": { "changed": true }
}
```

### Example: an action that isn't allowed
```http
POST /api/v1/tasks/12/complete        (task 12 is a draft)
```
```json
422 Unprocessable Entity
{ "error": { "code": "invalid_transition",
             "message": "Cannot move task to completed while task is draft",
             "details": { "from": "draft", "to": "completed" } } }
```

### Live updates (Action Cable)
Subscribe to `OperationsChannel` at `ws://<host>/cable`. Each message is
`{ "type": "<event_type>", "task_id": 27, "event_id": 412, "at": "<ISO time>" }`,
a cue to refetch that task, never a data payload.

---

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Backend (RSpec, **121 examples**) | `docker compose run --rm api bundle exec rspec` | All four scenarios at service level; every forbidden state transition; the 20 % / 5–20 s simulation statistics; matching and eligibility; HTTP API behaviour (validation, 404/409/422/403, idempotency, never exposing the simulation plan); **real multi-threaded race tests** |
| Backend lint | `docker compose run --rm api bundle exec rubocop` | Rails Omakase style |
| Frontend (Vitest, **24 tests**) | `cd frontend && npm test` | Dashboard, create-task validation and submission, filters, pending timers, intervention dialog, retry after decline, 409 handling, API error parsing, server-clock timers, local-date due dates, dialog version pinning, unanswered offers, edit dialog |
| Frontend lint and types | `npm run lint && npm run typecheck` | ESLint; strict TypeScript |
| End-to-end (Playwright, **5 scenarios**) | `cd frontend && npm run e2e` | Routine assignment, unresolved routing, intervention with a late result, recovery after decline, retry skipping the decliner, all in a real browser against the real stack |

**The race tests** run threads on separate database connections and release
them simultaneously. They cover:
- manual intervention vs an arriving routing result
- two operators acting on the same version
- five simultaneous submissions
- four tasks competing for one contributor's last slot
- accept vs reassignment

They also show the database rejecting a second active assignment even with the
application's locks bypassed.

**End-to-end tests** need the Docker stack running with
`SIMULATION_CONTROLS_ENABLED=true`. They create their own uniquely-named
expertise area and contributors, so they don't depend on the seed data. By
default they use the installed **Microsoft Edge** (`PW_CHANNEL=msedge`). To use
Playwright's Chromium instead, run `npx playwright install chromium` and set
`PW_CHANNEL=chromium`. They wait in real time for the routing engine (about
45–55 s for the whole suite).

Detailed results and the coverage map are in [TESTING.md](TESTING.md).

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Tasks never leave *Routing pending*, even with *Fast response* | The worker isn't running: `docker compose ps`, then `docker compose up -d worker`, and check `docker compose logs worker` |
| A normal task stays pending past 20 s | Expected about 20 % of the time: it's a never-answering request. Use **Assign manually** or **Restart routing**. |
| Sidebar says **Polling** instead of **Live** | The WebSocket can't connect. Check the API is up and your browser origin is in `FRONTEND_ORIGIN`. The console keeps working by polling. |
| Browser shows "Cannot reach the TaskFlow API" | The API isn't running or is still starting: `docker compose logs -f api` |
| `Port … is already in use` | Change the host port in `docker-compose.yml` (Postgres, Redis, API) or set `PORT` for Vite. If the frontend port changes, add it to `FRONTEND_ORIGIN`. |
| Simulation lab says controls are disabled | Set `SIMULATION_CONTROLS_ENABLED=true` and run `docker compose up -d` |
| `bin/rails: … /usr/bin/env: 'ruby\r'` in the container | CRLF line endings. Re-checkout so the repo's `.gitattributes` applies: `git rm --cached -r . && git reset --hard`. **This discards uncommitted changes**, so commit or stash first. |
| First `docker compose up` is slow | It's installing gems into the `bundle` volume; later starts are fast |
| Docker or WSL hangs on Windows (`HCS_E_CONNECTION_TIMEOUT`) | Run `wsl --shutdown`, restart Docker Desktop, and make sure the disk isn't full |
| Want a clean slate | `docker compose down -v && docker compose up -d --build`, then seed again |

---

## Design decisions, trade-offs and limitations

- **No automatic timeouts, by design.** Only the operator decides that waiting
  is over. "Unresolved" and "needs intervention" are calculated views, not
  stored states.
- **Manual assignment is immediately accepted.** The operator's choice counts as
  agreed, matching the brief's *Routing pending → Manually assigned → In
  progress* path.
- **Offers count toward capacity,** so routing can't over-commit a contributor
  while offers are outstanding.
- **Simple matching:** least active load among eligible contributors. There's no
  skills scoring, time zones or calendars.
- **Single-operator demo; no login.** The operator records contributors'
  accept/decline on their behalf; those events are attributed to the
  contributor.
- **Live messages carry ids only.** That costs one refetch per event, in
  exchange for never leaking internal state and always showing server truth.
- **Delivery timing:** Sidekiq checks its schedule every second, so answers
  arrive within about 1–2 s of the planned delay.
- **Development setup only.** Docker Compose runs Rails in development mode over
  a bind mount (noticeably slower on Windows). There's no production image or
  deployment.
- **End-to-end tests use real time,** because the browser, API and worker can't
  share a controllable clock. Backend tests use time travel instead.

More detail: [ASSUMPTIONS.md](ASSUMPTIONS.md).

---

## Further documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, database relationships, state machines, routing lifecycle, concurrency, recovery, trade-offs |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | Product decisions, availability and capacity rules, acceptance behaviour, simulation choices, simplifications |
| [TESTING.md](TESTING.md) | Test commands, coverage summary, verification results, problems found and fixed, known limitations |
| [AI_DEVELOPMENT_LOG.md](AI_DEVELOPMENT_LOG.md) | How AI assistance was used, key decisions and corrections |
| [SESSION_MAP.md](SESSION_MAP.md) | Index of the development session stages |
| [node-version/README.md](node-version/README.md) | The reference Node/Fastify implementation |
