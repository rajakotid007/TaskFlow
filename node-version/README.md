# TaskFlow — Task Assignment & Routing Operations Platform

TaskFlow is an operator console for assigning work to contributors by expertise.
Tasks are sent to an **asynchronous routing engine** that may answer after
5–20 seconds, or **never answer at all**. The console treats an outstanding
request as *waiting*, never as *failed*. The operator can step in at any time,
recover from declines and failed assignments, and read a full audit trail of
what happened and why.

It is a genuinely working full-stack application: a Fastify API and a BullMQ
worker on PostgreSQL + Redis, and a React + TypeScript console that updates in
real time.

---

## Contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Tech stack](#tech-stack)
4. [Project structure](#project-structure)
5. [Project setup](#project-setup)
6. [Running the app](#running-the-app)
7. [Using the console](#using-the-console)
8. [API overview](#api-overview)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)
11. [Further documentation](#further-documentation)
12. [Known limitations](#known-limitations)

---

## Features

### Task management
- Create tasks with title, description, required expertise, priority (`low`,
  `medium`, `high`, `urgent`) and an optional due date.
- **Save as draft** or **create and submit for routing** in one step (one
  database transaction).
- Edit task fields while the task is `draft` or `needs_intervention`.
- Searchable, filterable, paginated task list (status, priority, expertise,
  "routing pending").
- Lifecycle controls: start work, mark complete, cancel.

### Automatic routing
- Expertise-based matching: contributors who have the required expertise, are
  not `unavailable`, are below their capacity (`max_active_assignments`,
  default 3), and have not previously declined or failed this task.
- The **least-loaded** eligible contributor wins, with ties broken by id
  (deterministic).
- Routing proposes an assignment; the contributor must **accept** or
  **decline** (a reason is required to decline).

### Unreliable routing simulation
- Every routing request has its outcome **decided once, when it is created**,
  and stored on the attempt:
  - **80 %** return a result after a uniform **5–20 s** delay
  - **20 %** **never return**
- Never-returning requests are never scheduled and never time out. They stay
  **unresolved** (with a live elapsed-time display) until an operator acts.
- The predetermined outcome is **never sent to the operator UI** (tests assert
  this), so a slow request and a lost one look the same.

### Human intervention
While routing is pending, or an offer is open, the operator can:
- **Assign** a specific contributor (they still have to accept)
- **Reroute** (the **Retry routing** button): supersede the current request and send a new one
- **Mark assignment failed** (with a reason)
- **Cancel** the task

A superseded request may still answer later. Its result is recorded as
**`stale_result_ignored`** (with `late_result_at`) and **never** overrides the
operator's decision.

### Recovery
- Declined and failed assignments stay in the history with their reasons.
- **Retry routing**: the matcher skips everyone who already declined or failed
  this task.
- **Choose contributor**: pick someone directly; they must accept.
- Routing that finds nobody moves the task to `needs_intervention` and records
  the reason.

### Integrity and concurrency
- **At most one active assignee per task**, enforced by a PostgreSQL partial
  unique index (`assignments_one_active_per_task`) as well as row locks.
- **At most one pending routing request per task** (partial unique index
  `routing_attempts_one_pending_per_task`).
- Every command runs in one transaction that locks the task row first.
  Contributor candidate rows are locked during matching, so concurrent routing
  cannot overfill a contributor.
- Optional `expected_version` on mutating commands: if the task changed since
  the operator loaded it, the API answers **409** instead of overwriting the
  newer state.
- Idempotent commands: routing a task that is already pending returns the
  existing request; repeating an accept or a decline is a no-op.
- **Outbox**: queue jobs and real-time broadcasts run only *after* commit, so a
  rolled-back command has no side effects. If Redis is down at dispatch, the
  request stays visible as pending and a `routing_dispatch_failed` event is
  recorded.

### Audit history and real-time updates
- Append-only `task_events` table: timestamp, event type, actor, previous
  state, new state and an explanation, for every important transition.
- Activity page with filters by task and event type, plus pagination.
- Real-time updates over WebSocket (`/cable`). If the socket drops, the UI falls
  back to polling (3 s for pending routing views, 5–10 s elsewhere).
  Broadcasts never contain simulation details.

### Operator console pages
| Page | Path | What it shows |
|---|---|---|
| Dashboard | `/` | Live counts (total, awaiting routing, awaiting acceptance, active assignments, unresolved routing requests, requiring intervention, declined or failed, completed), unresolved requests with elapsed time, recent activity, charts |
| Tasks | `/tasks` | Searchable, filterable table with status, routing state, assignee, pending duration and actions |
| Create task | `/tasks/new` | Validated form (React Hook Form + zod); dev-only "forced routing outcome" selector |
| Task detail | `/tasks/:id` | "Why it is *<status>*" explanation, routing attempts, assignments, accept/decline, intervention and recovery controls, full history |
| Routing | `/routing` | All routing attempts (unresolved, resolved, no match, superseded), elapsed times, late results, plus a dev-only **Development simulation** panel |
| Contributors | `/contributors` | Expertise, availability, capacity, active assignments; create and edit |
| Activity | `/history` | Audit timeline with filters |

---

## How it works

```
React console (Vite :5173)
   │  /api/v1/*  (REST)            ▲  /cable (WebSocket)
   ▼                                │
Fastify API (:3000) ── one transaction per command ──► PostgreSQL 16 (source of truth)
   │  after commit (outbox)                ▲
   ├─► BullMQ delayed job ──► Redis 7 ──► Worker ──► handleRoutingResult()
   └─► publish event ───────► Redis pub/sub ──► API ──► WebSocket clients
```

### Routing lifecycle
1. `POST /tasks/:id/route` locks the task, inserts a `routing_attempts` row with
   a unique `request_token` and its predetermined outcome (`returns` + delay, or
   `never`), and moves the task to `routing_pending`.
2. After commit, a delayed BullMQ job is scheduled **only** for `returns`.
3. When the job fires, the worker calls `handleRoutingResult(attemptId, token)`.
   Under the task lock, the result is applied only if:
   - the token matches,
   - the attempt is still `pending`,
   - the task is still `routing_pending`, and
   - the attempt is the task's current attempt.

   Otherwise the result is recorded as `stale_result_ignored` and nothing else
   changes.
4. A match creates a `proposed` assignment and the task becomes
   `awaiting_acceptance`. No match moves it to `needs_intervention`.

### Three separate status concepts
| Concept | Values |
|---|---|
| **Task status** | `draft`, `routing_pending`, `awaiting_acceptance`, `assigned`, `in_progress`, `completed`, `declined`, `assignment_failed`, `needs_intervention`, `cancelled` |
| **Routing attempt status** | `pending` (unresolved), `resolved`, `no_match`, `superseded` |
| **Assignment status** | `proposed` and `accepted` (active), `declined`, `failed`, `released`, `completed` |

### Task state machine
Defined once in `backend/src/domain/stateMachine.ts`. Every transition is
checked there and guarded by the expected status **and** `version`.

| Action | From | To |
|---|---|---|
| submit for routing | `draft`, `needs_intervention`, `declined`, `assignment_failed` | `routing_pending` |
| routing returned (match) | `routing_pending` | `awaiting_acceptance` |
| routing returned (no match) | `routing_pending` | `needs_intervention` |
| manual assign | `routing_pending`, `needs_intervention`, `declined`, `assignment_failed`, `awaiting_acceptance` | `awaiting_acceptance` |
| reroute | `routing_pending`, `awaiting_acceptance` | `routing_pending` |
| accept | `awaiting_acceptance` | `assigned` |
| decline | `awaiting_acceptance` | `declined` |
| fail assignment | `awaiting_acceptance`, `assigned` | `assignment_failed` |
| start | `assigned` | `in_progress` |
| complete | `in_progress` | `completed` |
| cancel | any non-terminal | `cancelled` |

An illegal transition returns **409 `invalid_transition`**.

### Unresolved vs failed vs superseded
- **Unresolved**: the attempt is `pending`. Shown as "Unresolved for 3m 12s" with
  intervention controls. Never labelled failed.
- **Failed**: a real result. Either routing answered "no eligible contributor"
  (`no_match`), or an assignment was declined or marked failed.
- **Superseded**: an operator decision replaced the request. Any later answer is
  recorded and ignored.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22+, TypeScript 5, **Fastify 5**, `@fastify/websocket`, `@fastify/cors`, zod |
| Database | **PostgreSQL 16**, raw SQL via `pg`, SQL migration `001_init.sql` |
| Jobs / pub-sub | **Redis 7**, **BullMQ 5**, ioredis |
| Frontend | **React 18**, TypeScript, **Vite 5**, Tailwind CSS 3, React Router 6, TanStack Query 5, React Hook Form + zod, Recharts, lucide-react |
| Tests | Vitest (backend and frontend), React Testing Library, Playwright |
| Local infrastructure | Docker Compose (PostgreSQL + Redis) |

> **Note on Rails:** the brief asked for Ruby on Rails. This implementation uses
> Node + TypeScript for the backend because Rails gems could not be installed
> in the environment where it was built (see `docs/ASSUMPTIONS.md`). The
> architecture follows the brief's services, state-machine and constraint design.

---

## Project structure

```
taskflow/
├── docker-compose.yml            PostgreSQL 16 + Redis 7 for local development
├── backend/
│   ├── .env.example
│   ├── src/
│   │   ├── server.ts             API entry point (HTTP + WebSocket)
│   │   ├── app.ts                Routes, zod validation, error handling
│   │   ├── worker.ts             BullMQ worker: delivers routing results
│   │   ├── config.ts             Environment-based configuration
│   │   ├── queue.ts              BullMQ queue
│   │   ├── realtime.ts           Redis pub/sub → WebSocket fan-out
│   │   ├── domain/stateMachine.ts
│   │   ├── db/                   pool, migrate.ts, seed.ts, migrations/001_init.sql
│   │   └── services/             routing, matching, assignments, tasks, contributors,
│   │                             taskTransition, audit, outbox, readModels, simulation, scheduler
│   └── tests/                    api, routing, simulation, stateMachine (Vitest, real Postgres)
├── frontend/
│   ├── src/
│   │   ├── api/                  fetch client, TanStack Query hooks, realtime, types
│   │   ├── components/           Layout, UI primitives
│   │   ├── pages/                Dashboard, Tasks, CreateTask, TaskDetail, Routing, Contributors, History
│   │   └── __tests__/            component and page tests
│   ├── e2e/                      Playwright: routine, unresolved, intervention, recovery
│   └── playwright.config.ts
└── docs/                         ARCHITECTURE, API, ASSUMPTIONS, TESTING, WALKTHROUGH,
                                  AI_DEVELOPMENT_LOG, SESSION_MAP
```

---

## Project setup

### Prerequisites
- **Node.js 22 or newer** and npm
- **Docker Desktop** (for PostgreSQL and Redis), or a local PostgreSQL 16 and Redis 7
- Google Chrome (only for the Playwright end-to-end tests)

### 1. Clone and check out the branch
```bash
git clone https://github.com/rajakotid007/TaskFlow.git
cd TaskFlow
git checkout backend-frontend-changes
```

### 2. Start PostgreSQL and Redis
```bash
docker compose up -d
docker compose ps        # both services should be "healthy"
```
This starts PostgreSQL on **5432** (user/password/db: `taskflow` / `taskflow` /
`taskflow_development`) and Redis on **6379**. If those ports are already taken,
change the left-hand port in `docker-compose.yml` and update `backend/.env` to
match.

> Using a local PostgreSQL instead? Create the role and databases:
> ```sql
> CREATE ROLE taskflow LOGIN PASSWORD 'taskflow';
> CREATE DATABASE taskflow_development OWNER taskflow;
> CREATE DATABASE taskflow_test OWNER taskflow;
> ```

### 3. Configure and prepare the backend
```bash
cd backend
npm install
cp .env.example .env     # Windows PowerShell: Copy-Item .env.example .env
npm run migrate          # applies src/db/migrations/001_init.sql
npm run seed             # resets demo data: 12 contributors, 10 expertise areas, 20 tasks
```

`backend/.env` variables:

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` disables simulation controls and seeding |
| `PORT` | `3000` | API port |
| `DATABASE_URL` | `postgres://taskflow:taskflow@localhost:5432/taskflow_development` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ queue and pub/sub |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `ALLOW_SIMULATION_CONTROLS` | `true` (outside production) | Enables forced routing outcomes for demos and tests |

No secrets are hard-coded. The defaults only point at the local Docker services.

### 4. Install the frontend
```bash
cd ../frontend
npm install
```
The Vite dev server proxies `/api` and `/cable` to `http://localhost:3000`, so no
frontend environment variables are needed.

### Demo data (what `npm run seed` creates)
The seed **wipes and reloads** the development database by driving the real
services, so every task carries genuine routing and assignment history:

- **Expertise areas:** Ruby, Java, Python, React, TypeScript, DevOps, AI/ML,
  Database Engineering, QA, Security
- **12 contributors**, including one `limited` (Jonas Berg), one `unavailable`
  (Rohan Mehta) and one with capacity 2 (Chloe Dubois)
- **20 tasks** covering every status and scenario: drafts, awaiting acceptance,
  assigned, in progress, completed, **three never-returning (unresolved)
  requests**, declined, recovered after decline, no match (Security has no
  contributors), failed assignment, a manual intervention whose **late routing
  result was ignored**, and a cancelled task

---

## Running the app

The app needs **three processes**. Open three terminals:

```bash
# Terminal 1 — API (http://localhost:3000, WebSocket at /cable)
cd backend && npm run dev

# Terminal 2 — routing worker (required: delivers routing results)
cd backend && npm run worker

# Terminal 3 — operator console
cd frontend && npm run dev
```

Open **http://localhost:5173**.

Health check: `GET http://localhost:3000/api/v1/health`

> Without the worker, routing requests stay pending forever. That is the
> correct, honest behaviour, but it isn't the demo you want.

---

## Using the console

The quickest way to see each scenario is the **Development simulation** panel on
the **Routing** page, or the **Forced routing outcome** selector on **Create
task**. Both appear only in development with `ALLOW_SIMULATION_CONTROLS=true`.

| Forced outcome | Behaviour |
|---|---|
| Successful response | Returns after 5 s |
| Delayed response | Returns after 20 s |
| Never returns | Stays unresolved until an operator acts |
| *(normal)* | Real rules: 20 % never return, the rest 5–20 s |

### Use case 1: routine assignment
1. **Create task** → choose expertise (e.g. Python) → forced outcome *Successful
   response* → **Create and submit for routing**.
2. The task shows **Routing pending** with a live elapsed clock, then switches
   to **Awaiting acceptance** on its own (worker → Redis → WebSocket).
3. Open it and click **Accept**. The task becomes **Assigned** and the history
   shows every step.

### Use case 2: unresolved routing
1. Create a task with *Never returns*.
2. It stays **Routing pending / Unresolved** with a growing elapsed time. It is
   not called failed, and there is no automatic timeout.
3. Intervention controls stay available. Refresh the browser and the state is
   still there (it lives in PostgreSQL).

### Use case 3: human intervention
1. Create a task with *Delayed response (20 s)*.
2. Within 20 s, open it and **Assign** a contributor manually. The pending
   request becomes **superseded**.
3. When the original result arrives, the history shows **Stale result
   ignored**, and the manual assignment is untouched.

### Use case 4: recovery
1. On a task awaiting acceptance, click **Decline** and enter a reason.
2. The recovery panel shows the reason. **Retry routing** re-routes without
   offering the task to the previous contributor again, or **Choose
   contributor** (**Assign and request acceptance**) picks someone directly.
3. All earlier attempts and assignments stay visible in the history.

A scripted ≤ 10-minute demo is in [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).

---

## API overview

Base path **`/api/v1`**, JSON in and out. Full reference with examples:
[`docs/API.md`](docs/API.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/expertise-areas` | Expertise catalogue |
| GET | `/tasks` | List. Query: `search`, `status` (comma list), `priority`, `expertise_id`, `routing=pending`, `page`, `per_page` (≤ 100) |
| POST | `/tasks` | Create. Body: `title`, `description`, `required_expertise_id`, `priority`, `due_date`, `submit`, `simulation`* |
| GET | `/tasks/:id` | Detail with attempts, assignments and history |
| PATCH | `/tasks/:id` | Edit fields, or `status: in_progress \| completed`; optional `expected_version` |
| POST | `/tasks/:id/route` | Start routing (idempotent while pending) |
| POST | `/tasks/:id/intervene` | `action`: `assign` (+ `contributor_id`), `reroute`, `fail_assignment`, `cancel` |
| POST | `/tasks/:id/recover` | `action`: `retry_routing` or `choose_contributor` (+ `contributor_id`) |
| GET | `/tasks/:id/history` | Chronological audit events (optional `event_type`) |
| POST | `/assignments/:id/accept` | Contributor accepts (idempotent) |
| POST | `/assignments/:id/decline` | Contributor declines; `reason` required |
| GET / POST | `/contributors` | List / create (`name`, `email`, `availability`, `max_active_assignments`, `expertise_ids`) |
| GET / PATCH | `/contributors/:id` | Detail / update |
| GET | `/routing-attempts` | List (optional `status`), paginated |
| GET | `/routing-attempts/:id` | Attempt detail |
| GET | `/dashboard/summary` | Dashboard counts and lists |
| GET | `/events` | Audit events (filters `task_id`, `event_type`), paginated |
| GET | `/simulation/status` | Whether simulation controls are enabled |

\* `simulation` (`success` \| `delayed` \| `never`) is accepted on create, route,
intervene and recover only when simulation controls are enabled. Otherwise the
API returns 403.

**Errors** always look like:
```json
{ "error": { "code": "validation_failed", "message": "Title is required.",
             "details": { "fields": [{ "field": "title", "message": "Title is required." }] } } }
```
Status codes: `201` created, `400` bad identifier, `403` simulation disabled or
wrong contributor, `404` not found, `409` invalid transition / version conflict /
stale state, `422` validation failed, `503` database unavailable.

---

## Testing

| Suite | Command | Needs |
|---|---|---|
| Backend (Vitest; state machine, simulation, routing and concurrency services, HTTP API) | `cd backend && npm test` | PostgreSQL test database |
| Frontend (Vitest + Testing Library) | `cd frontend && npm test` | nothing |
| Frontend typecheck and build | `cd frontend && npm run typecheck && npm run build` | nothing |
| End-to-end (Playwright) | `cd frontend && npx playwright test` | PostgreSQL, Redis, Chrome |

### Backend tests
They run against a **separate test database**. You must set `DATABASE_URL`: the
fallback in `tests/setup.ts` (`postgres://claude:claude@localhost:5432/taskflow_test`)
is left over from the build environment and won't match the Docker credentials.

```bash
# bash / macOS / Linux
cd backend
DATABASE_URL=postgres://taskflow:taskflow@localhost:5432/taskflow_test npm test

# Windows PowerShell
cd backend
$env:DATABASE_URL="postgres://taskflow:taskflow@localhost:5432/taskflow_test"; npm test
```
With Docker Compose, create the test database once:
`docker compose exec postgres createdb -U taskflow taskflow_test`

### End-to-end tests
Playwright starts the API and Vite itself (or reuses running ones), **reseeds the
development database**, and starts a routing worker. The four specs cover
routine assignment, unresolved routing, human intervention and recovery after
decline.

```bash
cd frontend
# Linux default: /usr/bin/google-chrome. On Windows, point at your Chrome:
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"   # PowerShell
npx playwright test
```

Recorded results and the per-requirement coverage map are in
[`docs/TESTING.md`](docs/TESTING.md).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tasks stay "Routing pending" even with *Successful response* | Start the worker: `cd backend && npm run worker` |
| `ECONNREFUSED 5432` / `6379` | `docker compose up -d`, then check `docker compose ps` |
| Port 5432, 6379, 3000 or 5173 already in use | Change the port in `docker-compose.yml` / `.env` / `vite.config.ts`, and keep `CORS_ORIGIN` in sync |
| Simulation selector / panel missing | Needs `npm run dev` (Vite dev mode) and `ALLOW_SIMULATION_CONTROLS=true` |
| 403 `simulation` errors from the API | Simulation controls are disabled (e.g. `NODE_ENV=production`) |
| Header shows polling instead of live | WebSocket is down; the UI keeps working by polling. Check the API is running and Redis is reachable |
| Playwright cannot launch the browser | Set `CHROME_PATH` to your Chrome executable |
| Want a clean slate | `cd backend && npm run seed` (wipes and reloads demo data) |

---

## Further documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, database relationships, state machine, routing lifecycle, concurrency safeguards, recovery, trade-offs |
| [`docs/API.md`](docs/API.md) | Endpoints with request/response examples |
| [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) | Product, availability, acceptance and simulation decisions; simplifications |
| [`docs/TESTING.md`](docs/TESTING.md) | Commands, coverage map, recorded results, known limitations |
| [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) | ≤ 10-minute demo script |
| [`docs/AI_DEVELOPMENT_LOG.md`](docs/AI_DEVELOPMENT_LOG.md), [`docs/SESSION_MAP.md`](docs/SESSION_MAP.md) | How AI assistance was used |

---

## Known limitations

- **Single-operator demo.** There is no authentication. Contributor accept and
  decline happen from the operator console.
- **Manual assignment still requires acceptance.** It creates a `proposed`
  assignment rather than jumping straight to assigned (documented
  simplification).
- **Outbox without a table.** A crash between commit and enqueue can leave a
  pending request with no job. It stays visible and can be rerouted.
- **E2E tests use real timing** (5–20 s) and reseed the development database.
  They run one at a time.
- **Docker Compose** was written for local PostgreSQL and Redis but has not been
  verified in the original build environment. No ESLint configuration is
  included yet.
- **Backend is not Rails** (see the note under [Tech stack](#tech-stack)).
