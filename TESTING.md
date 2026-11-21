# Testing

## Commands

```bash
# Backend (inside the api container)
docker compose run --rm api bundle exec rspec
docker compose run --rm api bundle exec rspec spec/concurrency   # real multi-threaded races
docker compose run --rm api bundle exec rubocop

# Frontend
cd frontend
npm test              # Vitest + React Testing Library
npm run lint          # ESLint
npm run typecheck     # tsc -b (strict)
npm run e2e           # Playwright (needs: docker compose up -d, SIMULATION_CONTROLS_ENABLED=true)
```

## Coverage summary

### Backend — RSpec (103 examples)

| File | What it covers |
|---|---|
| `spec/services/routing_lifecycle_spec.rb` | All four use cases at service level: submit/idempotent submit/stale version; match → offer → accept with full event sequence; no-match explanation; re-validation of a proposal that became invalid during the delay; never-returning request stays pending for 2 h (time travel) and is flagged unresolved but never failed; restart routing; manual intervention supersedes, late result recorded and ignored, duplicate late delivery recorded once; offer withdrawal; ineligible contributor refused; decline → retry excludes decliner; everyone-declined explanation; release before work; idempotent decline; accept-after-decline refused; start/complete frees capacity; cancel prevents revival by a late result; append-only events. |
| `spec/services/task_transition_service_spec.rb` | Every forbidden transition from key states; table covers all statuses; DB CHECK constraint backs it. |
| `spec/services/routing_simulation_spec.rb` | Over 5 000 samples: never-return ratio within 0.20 ± 0.02; all delays within 5–20 s and covering the range; forced plans; validation; refused when controls are disabled. |
| `spec/services/expertise_matching_service_spec.rb` | Expertise filter, least-loaded choice with deterministic tie-break, unavailable/at-capacity/declined exclusions with reasons. |
| `spec/concurrency/routing_concurrency_spec.rb` | Real threads on separate DB connections released by a latch: manual intervention vs engine result (×10), two operators with the same version, 5 concurrent submissions, 4 tasks racing for one contributor with capacity 1, accept vs reassignment (×10), and the DB indexes rejecting a second active assignment / second pending attempt without any application locks. |
| `spec/requests/tasks_api_spec.rb` | Create draft / create+submit / validation errors / mass-assignment protection / 400; filtering and pagination; simulated outcome never in operator responses; idempotent route; intervene + late result via HTTP; 409 stale version; 422 invalid transition and ineligible contributor; eligible contributor list; accept idempotency; decline → recover. |
| `spec/requests/operations_api_spec.rb` | Dashboard counts from real data (incl. unresolved after time travel); contributor create/validate/update; unresolved routing filter; events filter; simulation controls refused when disabled; deliver-now; 404 format. |

Use-case mapping to the brief's 15 backend scenarios: creation/validation (tasks
API), matching (matching spec), successful routing, 5–20 s delay (simulation
spec + scheduled-at assertion), never-returning, acceptance, decline, recovery,
manual intervention, late response, duplicate-assignment prevention,
concurrent attempts, invalid transitions, audit history, idempotency — all
present in the files above.

### Frontend — Vitest + Testing Library (18 tests)

* `src/test/pages.test.tsx` — dashboard renders API metrics; dashboard API error
  with retry; create-task validation errors (nothing sent); create & submit
  payload and navigation; server-side 422 mapped onto fields; task filtering
  updates URL and request; pending timer past the window says "may still
  arrive" and never "failed"; task detail explanation for unresolved routing;
  manual intervention dialog (ineligible contributor disabled with reason, sends
  `expected_version`); retry routing after decline; 409 surfaced as "Task
  changed before your action".
* `src/test/client.test.ts` — API error parsing (field errors), unreachable
  backend, non-JSON error pages, duration formatting.

### End-to-end — Playwright (5 scenarios, real stack)

`frontend/e2e/use-cases.spec.ts`. Each test creates its own expertise area and
contributors via the API, so runs are isolated and repeatable. Routing uses
forced simulation plans for determinism; delays are real.

1. **Routine assignment** — draft created in the UI, routed (3 s), page updates
   live to Awaiting acceptance, accepted, history has all five events.
2. **Unresolved routing** — never-returning request; after 20 s the page says it
   "has not failed", controls stay enabled, task listed under
   *Unresolved routing* with no "failed" text, survives a browser reload.
3. **Human intervention** — manual assignment while pending (8 s request);
   attempt superseded; ~8 s later history shows *Late result ignored*
   proposing the other contributor; still exactly one assignment.
4. **Recovery after decline** — decline with reason in the UI, reason shown,
   manual recovery to another contributor (decliner flagged), both assignments
   in history.
5. **Retry routing** — after a decline, the retry offers the task to the other
   contributor; two attempts and a recovery event.

## Verification results (actual runs, 2026-11-20/21)

| Suite | Result |
|---|---|
| RSpec | **103 examples, 0 failures** (≈11 s) |
| RuboCop | 71 files, **no offenses** |
| Vitest | **18 passed** |
| ESLint / `tsc -b` | clean |
| Playwright (Edge, 2 workers) | **5 passed** on two consecutive runs (54 s, 44 s) |

Manual checks against the running stack (curl):

* 6 tasks submitted concurrently with real random routing: all answered in
  9–20 s; capacity respected.
* Use case 3 live: result arrived 13 s after the request, recorded as
  `stale_result_ignored`; manual assignment kept.
* **Worker restart** during a 20 s delay: delivery still applied (23 s) — the
  scheduled job lives in Redis, state in Postgres.
* **Redis stopped**: `POST /tasks/:id/route` → `503 routing_unavailable`, task
  stayed `draft`, no attempt created; recovered after Redis restarted.
* All pages rendered in Edge with no console errors; WebSocket status "Live".

## Problems found during verification (and fixed)

* Request specs initially memoized `response.parsed_body` with `let`, so later
  assertions read the first response — fixed by making it a method.
* Updating a contributor's expertise did not remove deselected areas
  (`autosave` missing on `contributor_expertises`) — real bug, fixed, covered.
* Concurrency spec hit the capacity rule across iterations (test setup bug).
* Sidekiq's scheduled poll interval scaled with stale registered processes,
  delaying 3 s responses to ~13 s — switched to a fixed
  `poll_interval_average = 1`.
* E2E flakiness from 3 Puma threads under 3 parallel browsers in dev mode —
  raised to 8 threads, Playwright limited to 2 workers.

## Known limitations

* E2E tests depend on real elapsed time (≈45–55 s total). The unresolved
  scenario must wait past 20 s because the browser, API and worker do not share
  a controllable clock.
* E2E runs need the Docker stack and leave their (uniquely named) tasks and
  contributors in the development database.
* No frontend test for the WebSocket connection itself; it is exercised by the
  E2E tests (live status updates without reload) and by the polling fallback
  path in code.
* No coverage percentage is reported (no coverage tool configured on the
  backend; `@vitest/coverage-v8` is installed but not gated).
