# Testing

## Commands
```bash
# Backend: unit + service + HTTP tests against a real PostgreSQL test database
cd backend && DATABASE_URL=postgres://<user>:<pw>@localhost:5432/taskflow_test npm test

# Frontend: component, page and API-error tests (mocked fetch)
cd frontend && npm test

# End-to-end: starts API, worker and Vite; reseeds the development database first
cd frontend && DATABASE_URL=postgres://<user>:<pw>@localhost:5432/taskflow_development npx playwright test
```
Set `CHROME_PATH` if Chrome is not at `/usr/bin/google-chrome`. Playwright is configured to use the installed Chrome. The bundled Chromium download was not available in the build sandbox.

## Results (last run in the build sandbox)

| Suite | Result | Notes |
|---|---|---|
| Backend (Vitest) | **54 passed / 54** across 4 files | State machine, simulation, routing and concurrency service tests, HTTP API tests |
| Frontend (Vitest) | **14 passed / 14** across 4 files | Components, dashboard, create-task form, tasks page |
| Frontend build | Succeeded (`vite build`) | Chunk-size warning only |
| Playwright E2E | **4 passed / 4** | Routine assignment, unresolved routing, human intervention, recovery after decline |

The E2E suite ran after the final code change and passed in a single full run. I have not measured flakiness over repeated runs.

## Coverage by requirement

| Required backend behavior | Where (test file) |
|---|---|
| 1 Task creation and validation | `api.test.ts` (422 field errors, draft vs submit) |
| 2 Expertise matching | `routing.test.ts` (least-loaded, deterministic tie-break, unavailable excluded) |
| 3 Successful routing | `routing.test.ts` routine assignment |
| 4 Simulated 5–20 s delay | `simulation.test.ts` (range, override values); `routing.test.ts` scheduled delay |
| 5 Never-returning requests | `routing.test.ts` never-returning, and no exposure through the read model |
| 6 Acceptance | `routing.test.ts`, `api.test.ts` |
| 7 Decline | `routing.test.ts` recovery, `api.test.ts` |
| 8 Recovery after decline | `routing.test.ts` excludes the decliner; manual choice during recovery |
| 9 Manual intervention during pending routing | `routing.test.ts` |
| 10 Late response after intervention | `routing.test.ts` stale result ignored, `late_result_at` set; job-identity test |
| 11 Duplicate assignment prevention | `routing.test.ts` DB rejects second active assignment (23505) |
| 12 Concurrent routing attempts | `routing.test.ts` six concurrent submissions create exactly one attempt |
| 13 Invalid transitions | `stateMachine.test.ts`; `routing.test.ts` 409 on cancelled task |
| 14 Persistent audit history | `routing.test.ts` event sequence assertions |
| 15 Idempotent operations | Duplicate route; repeat accept; repeat decline |

Also covered: transaction rollback leaves no partial writes (`withTransaction`).

## Frontend requirements
The frontend unit tests cover the components, dashboard, create-task form and tasks page. Exact assertions are in `frontend/src/__tests__/`.

Manual intervention and recovery UI are covered end to end (see the E2E suite) rather than by unit tests.

## Known limitations
- The E2E suite depends on real timing (5–20 s). It is reproducible through the forced development outcomes, but not free of timing dependence.
- The E2E suite reseeds the development database and assumes a clean Redis queue. Stale jobs from earlier runs are harmless because of the request-token check, but they still consume worker time.
- Tests share one database and run sequentially.
- No accessibility automation (axe) was run. Accessibility was built in by design: labels, `aria-invalid`, status and alert roles, keyboard-reachable controls.
- No ESLint configuration was added, and Prettier was not run. Lint and format are unverified.
- Docker Compose was written but not started. The sandbox had no Docker daemon, so compose-based startup is unverified.
