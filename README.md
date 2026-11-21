# TaskFlow — Task Assignment & Routing Operations Platform

TaskFlow is an operator console for routing tasks to contributors by expertise
through an asynchronous, deliberately unreliable routing engine. An operator
can create tasks, watch routing happen in real time, step in while a request is
still outstanding, recover from declines and failed routing, and read a
complete audit trail of what happened and why.

It is a working full-stack application: a Rails API backed by PostgreSQL, a
Sidekiq worker that plays the routing engine, Action Cable for live updates,
and a React + TypeScript console.

## Repository layout

This repository contains **two implementations** of the same brief:

| Path | Implementation | Status |
|---|---|---|
| `backend/`, `frontend/`, `docker-compose.yml` (repo root) | **Rails 8 API + Sidekiq + Action Cable**, React 19 console | Primary. Matches the requested stack. Verified end to end (see [TESTING.md](TESTING.md)). |
| [`node-version/`](node-version/) | Node 22 + Fastify + BullMQ API, React 18 console | Earlier implementation, kept for reference. Self-contained, with its own [README](node-version/README.md), `docker-compose.yml` and docs. |

Everything below describes the Rails implementation at the repo root.

## Features

* **Task lifecycle** — create (draft or submit straight away), edit, route,
  accept/decline, start, complete, cancel.
* **Asynchronous routing simulation** — each request is answered after a
  uniform 5–20 s delay, except ~20 % that never answer. The outcome is decided
  and stored when the request is created, and never shown on operator screens.
* **Unresolved requests stay honest** — a pending request shows a live timer and
  turns amber after 20 s ("beyond the usual window"), but is never marked
  failed. There are no automatic timeouts.
* **Human intervention** — assign manually while routing is pending (the
  request is superseded), while an offer is open (the offer is withdrawn), or
  restart routing. A result that arrives later is recorded as
  *late result ignored* and changes nothing.
* **Recovery** — after a decline or a failed/released assignment: retry
  routing (contributors who declined are skipped) or pick someone manually.
* **One active assignee, enforced by the database** — partial unique index,
  row locks, version checks; covered by multi-threaded tests.
* **Audit history** — append-only `task_events`, filterable by task, event
  type and actor.
* **Real-time UI** — Action Cable notifications, with automatic polling
  fallback when the socket is down.
* **Development simulation lab** — force *respond after N s* / *never return*,
  and "deliver now" to replay a late answer. Disabled unless
  `SIMULATION_CONTROLS_ENABLED=true`, never in production.

## Architecture at a glance

```
React (Vite, :5174) ──/api, /cable proxy──▶ Rails API (:3000) ──▶ PostgreSQL 16
                                              │      ▲
                                    enqueue   ▼      │ result callback
                                           Redis 7 ──▶ Sidekiq worker (RoutingEngineJob)
```

PostgreSQL is the single source of truth; Redis only carries the job queue and
cable pub/sub. See [ARCHITECTURE.md](ARCHITECTURE.md) for the state machines,
routing lifecycle and concurrency design, and [ASSUMPTIONS.md](ASSUMPTIONS.md)
for product decisions.

## Technology stack (versions as installed)

| Layer | Technology |
|---|---|
| Backend | Ruby 3.3.14, Rails 8.0.5.2 (API mode), Puma 8.1.2, pg 1.7.0, rack-cors 3.0.0 |
| Jobs / real-time | Sidekiq 7.3.9, redis 5.4.1, connection_pool 2.5.5, Action Cable (Redis adapter) |
| Database / cache | PostgreSQL 16.16, Redis 7.4.12 (Docker images `postgres:16-alpine`, `redis:7-alpine`) |
| Backend tests | RSpec (rspec-rails 7.1.1), FactoryBot (factory_bot_rails 6.5.1), shoulda-matchers 6.5.0, RuboCop (rubocop-rails-omakase 1.1.0) |
| Frontend | React 19.3.1, TypeScript 5.9.3, Vite 8.3.8, Tailwind CSS 4.3.5, React Router 8.5.2, TanStack Query 5.108.2, React Hook Form 7.92.0 + Zod 4.6.7, lucide-react 1.77.0, Recharts 3.11.0, @rails/actioncable 8.1.401 |
| Frontend tests | Vitest 5.1.1, React Testing Library 16.3.3, Playwright 1.65.1 |
| Tooling | ESLint 10.15.0 (typescript-eslint, react-hooks), Prettier 3.10.1, Docker Compose |

Pinned on purpose (see comments in `backend/Gemfile`): `json ~> 2.10` (json 3.x
breaks Rails 8.0 serialization), `redis ~> 5.4` (Action Cable's adapter needs
< 6), `connection_pool ~> 2.5` (Sidekiq 7.3 is incompatible with 3.x),
TypeScript 5.9 (the Vite template now ships TS 7, which the ESLint tooling
does not support yet).

## Prerequisites

* Docker Desktop (Compose v2)
* Node.js 20+ (developed with 24.14)
* No local Ruby, PostgreSQL or Redis needed — they run in containers.

## Installation & running

```bash
# 1. Backend: Postgres, Redis, Rails API and Sidekiq worker
docker compose up -d --build          # first run installs gems and runs db:prepare
docker compose exec api bin/rails db:seed   # demo data (idempotent; SEED_RESET=1 to rebuild)

# 2. Frontend
cd frontend
npm install
npm run dev                            # http://localhost:5174
```

The Vite dev server proxies `/api` and `/cable` to `http://localhost:3000`, so
the browser talks to a single origin.

### Services and ports

| Service | Port | Notes |
|---|---|---|
| `api` | 3000 | Rails API + Action Cable at `/cable`; health check `GET /up` |
| `worker` | — | `bundle exec sidekiq -C config/sidekiq.yml` (queues: `routing`, `default`) |
| `postgres` | 5433 → 5432 | user/password `taskflow` / `taskflow` (dev only) |
| `redis` | 6380 → 6379 | append-only persistence enabled |
| frontend | 5174 | Vite dev server |

### Environment configuration

Set in `docker-compose.yml` (override from your shell or a `.env` file next to
it):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_HOST/USERNAME/PASSWORD` | `postgres` / `taskflow` / `taskflow` | DB connection (dev credentials only) |
| `REDIS_URL` | `redis://redis:6379/0` | Sidekiq and Action Cable |
| `FRONTEND_ORIGIN` | `http://localhost:5174,http://127.0.0.1:5174` | CORS + Action Cable allowed origins (comma separated) |
| `SIMULATION_CONTROLS_ENABLED` | `true` in compose | Enables forced simulation plans and the Simulation lab. Always off in production. |
| `RAILS_MAX_THREADS` | `8` for `api` | Puma threads / DB pool |

Frontend (optional, see `frontend/.env.example`): `VITE_API_BASE_URL`,
`VITE_CABLE_URL`, `VITE_API_PROXY_TARGET`, `PORT`.

### Database

```bash
docker compose exec api bin/rails db:prepare        # create + migrate
docker compose exec api bin/rails db:seed           # 13 contributors, 9 expertise areas, 20 tasks
docker compose exec -e SEED_RESET=1 api bin/rails db:seed   # wipe and rebuild demo data
```

The seed data is produced by running the real services at backdated times, so
the history it shows is exactly what the application records.

## Testing

```bash
docker compose run --rm api bundle exec rspec      # backend: 103 examples
docker compose run --rm api bundle exec rubocop
cd frontend
npm test            # Vitest + Testing Library: 18 tests
npm run lint && npm run typecheck
npm run e2e         # Playwright: 5 scenarios against the running stack
```

E2E tests need the Docker stack running with `SIMULATION_CONTROLS_ENABLED=true`.
They use the system Microsoft Edge (`PW_CHANNEL=msedge`) so no browser
download is required; use `npx playwright install chromium` and
`PW_CHANNEL=chromium` to switch. Details and the latest verified results are in
[TESTING.md](TESTING.md).

## API overview

All endpoints are under `/api/v1`, return `{ "data": …, "meta": … }`, and errors
as `{ "error": { "code", "message", "details" } }`.

| Method & path | Purpose |
|---|---|
| `GET /tasks` | List with `q`, `status`, `priority`, `expertise_id`, `view` (`needs_intervention`, `unresolved`, `open`), `sort`, `page`, `per_page` |
| `POST /tasks` | `{ task: {...}, submit?: bool, simulation?: {...} }` |
| `GET /tasks/:id` · `PATCH /tasks/:id` | Detail (attempts, assignments, available actions) · edit |
| `POST /tasks/:id/route` | `mode`: `submit` / `retry` / `restart` (inferred if omitted) |
| `POST /tasks/:id/intervene` | `{ contributor_id, note? }` — manual assignment |
| `POST /tasks/:id/recover` | `{ recovery_action: "retry_routing" \| "release", reason? }` |
| `POST /tasks/:id/start` · `/complete` · `/cancel` | Lifecycle |
| `GET /tasks/:id/history` · `/eligible_contributors` | Audit trail · manual-assignment candidates with reasons |
| `POST /assignments/:id/accept` · `/decline` | Contributor response (`reason` on decline) |
| `GET /contributors` · `POST` · `GET /:id` · `PATCH /:id` | Directory |
| `GET /expertise_areas` · `POST` | Expertise catalogue |
| `GET /routing-attempts` (`filter`: `pending`, `unresolved`, `resolved`, `superseded`, `late`) · `GET /routing-attempts/:id` | Routing operations |
| `GET /events` (`task_id`, `event_type`, `actor_type`) | Activity history |
| `GET /dashboard/summary` | Metrics, attention list, recent events |
| `GET /simulation` · `GET /simulation/routing-attempts` · `POST /simulation/routing-attempts/:id/deliver` | Dev-only simulation controls |

Mutating task commands accept `expected_version`; if the task changed since the
operator loaded it the API answers **409 `stale_version`**. Repeating a command
that already took effect (route while pending, accept an accepted offer,
assign the same contributor) returns **200** with `meta.changed = false`.

Example — intervene while routing is pending:

```http
POST /api/v1/tasks/27/intervene
{ "contributor_id": 10, "expected_version": 1, "note": "Owns this module" }

200 OK
{ "data": { "id": 27, "status": "assigned", "version": 2,
            "current_assignment": { "id": 31, "status": "accepted", "source": "manual",
                                    "contributor": { "id": 10, "name": "Tomás Silva" } },
            "routing_attempts": [ { "attempt_number": 1, "status": "superseded",
                                    "superseded_reason": "manual_assignment", … } ], … },
  "meta": { "changed": true } }
```

Example — invalid transition:

```http
POST /api/v1/tasks/12/complete      (task is "draft")

422 Unprocessable Entity
{ "error": { "code": "invalid_transition",
             "message": "Cannot move task to completed while task is draft",
             "details": { "from": "draft", "to": "completed" } } }
```

## Demo walkthrough (≤ 10 minutes)

1. **Dashboard (1 min)** — real counts; "Needs attention" lists seeded declines,
   failures and two unresolved requests with live timers.
2. **Routine assignment (2 min)** — Simulation lab → *Fast response* (or Create
   task → *Create & submit*). Watch the task go Routing pending → Awaiting
   acceptance without refreshing; open it, *Record acceptance*; show history.
3. **Unresolved routing (1.5 min)** — Simulation lab → *Never returns*. Open the
   task: after 20 s the explanation turns amber ("has not failed … no way to
   know"). Navigate elsewhere and back; refresh the browser — still there.
4. **Human intervention (2 min)** — Simulation lab → *Delayed response (45s)*.
   Open the task, *Assign manually*; the dialog warns the request will be
   superseded. After the engine answers (or use *Deliver now* in the lab), the
   history shows **Late result ignored** and the assignment is unchanged.
5. **Recovery (2 min)** — open a declined seed task (e.g. "Write Terraform
   module for Redis"): the decline reason is shown. *Retry routing* (the
   decliner is skipped) or *Assign manually* (decliner flagged "Declined
   before"). Show *Release assignment* on an assigned task.
6. **Routing operations & Activity (1 min)** — filters for pending, unresolved,
   superseded and late results; activity history filtered by event type.
7. **Close (0.5 min)** — the concurrency test suite and the partial unique
   index (`index_assignments_one_active_per_task`).

## Intentional omissions and trade-offs

* **No authentication** — single-operator demo. Contributor accept/decline are
  recorded by the operator on the contributor's behalf (events are attributed
  to the contributor).
* **No automatic timeout or retry of routing** — by design; the operator
  decides. "Unresolved" is a derived view (pending > 20 s), not a state.
* **Simple matching** — least-loaded eligible contributor; no skills scoring,
  time zones or calendars.
* **No production deployment** — Docker Compose is development-only (Rails
  runs in development mode over a bind mount, which is slow on Windows).
* **Real-time messages carry ids only** — clients refetch; one extra request per
  event in exchange for never leaking internal state.
* **E2E tests wait real time** for the routing engine (a few seconds; ~25 s for
  the unresolved scenario) because the clock cannot be controlled across the
  browser, API and worker. Backend tests use time travel instead.
