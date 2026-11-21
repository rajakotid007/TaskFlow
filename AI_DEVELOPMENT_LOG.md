# AI Development Log

A factual record of how AI assistance was used to build TaskFlow.

## Tools

* **Claude Code** (Anthropic CLI agent, model Claude Opus 5.5) running in the
  VS Code extension on Windows 11. It planned, wrote all code and docs, ran
  commands (Docker, npm, RSpec, Playwright) and read the results.
* The brief mentions Cursor; **Cursor was not used** in this session.
* The human operator supplied the brief, approved environment actions
  (restarting WSL/Docker, clearing caches) and reviews the result.

All work happened in one continuous Claude Code session on 2026-11-20/21
(local time). There are no other AI sessions behind this code.

## 1. Planning and decomposition

* Inspected the machine first: Node 24 and Docker were present; Ruby,
  PostgreSQL and Redis were not. Decision: run Postgres, Redis, Rails and
  Sidekiq in Docker Compose; run Vite natively.
* Wrote `ARCHITECTURE.md` before any code: three separate state machines
  (task, routing attempt, assignment), DB-level invariants, lock ordering
  (task row first, then contributor), version checks, and "unresolved" as a
  derived view rather than a state.
* Followed the brief's phases: backend foundation → routing engine →
  frontend → operator workflows → QA → docs.

## 2. Important architectural decisions

| Decision | Reasoning |
|---|---|
| Serialize every task command on `SELECT … FOR UPDATE` of the task row | One simple rule makes engine callbacks, operator actions and contributor responses mutually exclusive per task. |
| Partial unique indexes for "one active assignment" and "one pending attempt" | Correctness should not depend on every code path remembering the lock. |
| Persist the simulation plan on the attempt | Reproducible, restart-safe, testable; never serialized to operator views. |
| Don't enqueue `never_return` requests at all | The honest model of a dropped request; nothing can accidentally resolve it. |
| Enqueue the engine job *inside* the request transaction (`enqueue_after_transaction_commit = false`) | If Redis is down the request rolls back and the operator gets a 503, instead of a "pending" request that was never sent. Verified live by stopping Redis. |
| Merge "no match" and "released before work" into `assignment_failed` with a `status_reason` | Keeps the state machine small while history stays specific. |
| Server returns `available_actions` | The UI shows only valid controls, while the API re-validates everything. |
| Cable messages carry ids only; client refetches | No internal data can leak through the socket; polling fallback uses the same path. |

## 3. Corrections and changes of direction

These happened during the session and changed what was built:

1. **Environment failures.** Docker/WSL hung twice
   (`HCS_E_CONNECTION_TIMEOUT`, then after the disk filled). The first Ruby
   image had corrupted gemspecs from being built while WSL was failing; rebuilt
   with `--no-cache`. With the user's approval: restarted WSL + Docker, cleared
   the npm cache and Docker build cache.
2. **State naming.** The first architecture draft had a separate
   `routing_failed` state and an unresolved line for "assignment failed before
   work". Revised to a single `assignment_failed` + `status_reason` before
   implementation.
3. **Gem incompatibilities found at runtime, not assumed:** `json` 3.1 broke
   the `jsonb` default in the migration (pinned 2.x, also switched to a SQL
   default); `redis` 6 is rejected by Action Cable (pinned 5.4);
   `connection_pool` 3 crashed Sidekiq's scheduler (pinned 2.5).
4. **Sidekiq delivery drift.** Playwright showed a forced 3 s response
   arriving after 13 s. Reading the Sidekiq source showed
   `average_scheduled_poll_interval` is multiplied by the registered process
   count (inflated by restarts). Switched to fixed `poll_interval_average`.
5. **Port conflict.** Port 5173 was used by an unrelated project on the
   machine, so the frontend moved to 5174 (CORS / cable origins updated).
6. **Browser for E2E.** Playwright's Chromium download failed with a full disk;
   configured Playwright to use the system Microsoft Edge (`channel: msedge`),
   with an env switch back to bundled Chromium.
7. **UI review from screenshots.** Screenshots of every page in Edge exposed:
   filter selects stretched full width (`w-full` vs `w-auto`), clipped action
   buttons in table rows, and a misleading "Pending" value for resolved tasks.
   Fixed and re-screenshotted.
8. **TypeScript 7 → 5.9.** The Vite template shipped TS 7 and oxlint; the brief
   asks for ESLint, whose TypeScript tooling targets TS 5.x, so TS was pinned.

## 4. AI suggestions reviewed and rejected/adjusted

* An automatic timeout that marks old pending requests failed — rejected; it
  contradicts the brief. Replaced by the derived "beyond expected window" flag.
* Storing "needs intervention" as a task status — rejected for the same reason.
* Running the routing engine match inside the result handler's lock —
  adjusted: the engine computes outside (like a remote service) and the
  handler re-validates under lock, which is what exposed the
  "proposal no longer eligible" case now covered by a test.

## 5. Testing and verification steps

* Backend specs written alongside services; first run had 26 failures, all
  investigated: missing `type: :request`, memoized response in specs, a capacity
  setup bug in the concurrency spec, one real bug (contributor expertise
  removal not saved).
* Live checks with curl against the running stack: concurrent routing, UC3
  late result, worker restart, Redis outage.
* Frontend: `tsc` strict, ESLint (fixed a `set-state-in-effect` finding),
  Vitest (one mock-helper bug fixed), Playwright (timing/thread issues fixed,
  then two clean consecutive runs).
* Final results are in [TESTING.md](TESTING.md).

## 6. Remaining limitations

See "Known limitations" in TESTING.md and "Intentional omissions" in
README.md. Notably: no auth, development-only Docker setup, E2E tests use
real time, and the machine's disk was nearly full during development (about
2 GB free after cleanup).
