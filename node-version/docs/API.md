# REST API (v1)

Base path `/api/v1`. JSON in and out. Errors use one shape:

```json
{ "error": { "code": "validation_failed", "message": "Title is required.", "details": { "fields": [{ "field": "title", "message": "Title is required." }] } } }
```

Status codes: `200` success, `201` created, `400` bad identifier, `403` simulation control disabled or wrong contributor, `404` not found, `409` invalid transition / version conflict / stale state, `422` validation failed, `503` database unavailable, `500` logged internal error.

## Tasks
| Method | Path | Purpose |
|---|---|---|
| GET | `/tasks` | List. Query: `search`, `status` (comma list), `priority`, `expertise_id`, `routing=pending`, `page`, `per_page` (max 100) |
| POST | `/tasks` | Create. `submit: true` creates and routes in one transaction |
| GET | `/tasks/:id` | Detail with attempts, assignments and full history |
| PATCH | `/tasks/:id` | Edit fields (draft / needs_intervention), or `status: in_progress \| completed` |
| POST | `/tasks/:id/route` | Start routing. Idempotent while routing is pending |
| POST | `/tasks/:id/intervene` | `action`: `assign`, `reroute`, `fail_assignment`, `cancel` |
| POST | `/tasks/:id/recover` | `action`: `retry_routing` or `choose_contributor` (declined / failed only) |
| GET | `/tasks/:id/history` | Chronological audit events. Optional `event_type` |

### Example: create and submit
```http
POST /api/v1/tasks
{ "title": "Refactor auth middleware", "description": "Move token checks into one guard.",
  "required_expertise_id": 1, "priority": "high", "due_date": "2026-12-04", "submit": false }
```
```json
{ "id": 25, "title": "Refactor auth middleware", "priority": "high", "status": "draft",
  "due_date": "2026-12-04", "version": 1, "expertise": { "id": 1, "name": "Ruby" },
  "routing": { "state": "idle", "attempt_id": null, "pending_seconds": null },
  "current_assignment": null, "attempts": [], "assignments": [],
  "history": [ { "event_type": "task_created", "actor_type": "operator", "previous_state": null, "new_state": "draft" } ] }
```

### Example: validation error
```http
POST /api/v1/tasks
{ "title": "" }
```
```json
{ "error": { "code": "validation_failed", "message": "Title is required.",
  "details": { "fields": [ { "field": "title", "message": "Title is required." },
    { "field": "required_expertise_id", "message": "Required" }, { "field": "priority", "message": "Required" } ] } } }
```

### Example: list (pagination metadata)
```http
GET /api/v1/tasks?status=awaiting_acceptance&per_page=2
```
```json
{ "data": [ { "id": 24, "status": "awaiting_acceptance", "routing": { "state": "idle" },
  "current_assignment": { "id": 19, "status": "proposed", "source": "manual", "contributor": { "id": 1, "name": "Ava Chen" } } } ],
  "meta": { "page": 1, "per_page": 2, "total": 8, "total_pages": 4 } }
```

### Command examples
- `POST /tasks/:id/route` → `{ "created": true, "attempt_id": 19, "task": { ... } }`. A repeat call returns `created: false` with the same attempt.
- `POST /tasks/:id/intervene` with `{ "action": "assign", "contributor_id": 2, "reason": "Client asked for Mei" }`.
- `POST /tasks/:id/intervene` with `{ "action": "assign" }` → `422 validation_failed` ("contributor_id is required for assign.").
- `POST /tasks/:id/recover` with `{ "action": "retry_routing" }` on a task that is not declined or failed → `409 conflict`.

## Assignments (contributor actions)
| Method | Path | Body |
|---|---|---|
| POST | `/assignments/:id/accept` | none. Idempotent |
| POST | `/assignments/:id/decline` | `{ "reason": "..." }` required |

## Contributors, routing, dashboard, events
| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/contributors` | List with active counts and assigned tasks / create |
| GET / PATCH | `/contributors/:id` | Read / update availability, capacity, expertise |
| GET | `/expertise-areas` | Expertise options |
| GET | `/routing-attempts` | Filter `status`; includes `pending_seconds` for unresolved requests |
| GET | `/routing-attempts/:id` | One attempt |
| GET | `/dashboard/summary` | Counts, unresolved requests, recent activity |
| GET | `/events` | Global activity feed. Filters `task_id`, `event_type` |
| GET | `/health` | Liveness and database check |
| GET | `/simulation/status` | Whether development simulation controls are enabled |

## Realtime
`ws://localhost:3000/cable` sends one JSON frame per event: `{ "type": "routing_started", "taskId": 7, "payload": { ... }, "at": "..." }`. Frames contain no simulation information.
