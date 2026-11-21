# AI development log

This is a factual record of the work done in this build session. Nothing here is reconstructed from memory of other sessions. Only one assistant session produced this codebase.

## AI tools used
- **Claude** (Anthropic), as the coding agent in a Claude Code session with file, shell, and browser tools. Model: Claude Haiku 5.5.
- Shell tools were used for installing dependencies, running tests and migrations, and running the seed, the API, the worker and Playwright.
- No other AI tool was used.

## Initial planning and decomposition
1. Read the master prompt and checked the environment for the required services and runtimes.
2. Attempted to install Rails. **Blocked**: rubygems.org returned 403 from the sandbox egress proxy, while npm and PyPI were reachable.
3. Asked the operator to choose a path. Options were a Node/TypeScript backend, unverified Rails code, or the operator installing gems. The operator chose **Node/TypeScript**.
4. Planned phases from the prompt: backend foundation, routing engine, frontend, operator workflows, verification, documentation.

## Important architectural decisions
- **Stack deviation**: Fastify + pg + BullMQ instead of Rails + Active Record + Sidekiq. Same schema, state machine, routing simulation and API routes. Reason: Rails could not be installed or run here.
- **Explicit state machine** as the only place that decides a legal transition.
- **Transactional outbox**: queue jobs and realtime events are emitted only after commit.
- **Predetermined simulation outcome** stored on the attempt at creation and never serialized.
- **Stale-result test** combines the attempt's pending status, the task's status, the current-attempt pointer, and the request token.
- **Late results are kept, not discarded**: a superseded job is left in the queue so the late result is recorded as ignored (Use Case 3).
- **Manual assignment still requires acceptance** (simplification of the brief's path).

## AI-generated suggestions reviewed, and what changed after running them
These bugs were found by running the code, not by reading it. Each was fixed and re-verified.

1. **Seed hung.** Redis was down. The publisher kept retrying forever, so each publish stalled. *Change*: the publisher now skips events while disconnected (`enableOfflineQueue: false`, status check). Realtime is best-effort, and the database is authoritative.
2. **Elapsed-time display double-counted** after a server refresh, because the base was updated without re-anchoring the clock. *Change*: the display now re-anchors on every server value.
3. **Invalid transitions returned 500.** `InvalidTransitionError` was a plain Error. *Change*: it extends `AppError` with status 409.
4. **`canTransition` threw on an unknown action name** instead of returning null. *Change*: guard added.
5. **Wrong expected value in my own test** (roll 0.2 → 8,000 ms, not 9,000 ms). *Change*: test corrected after recomputing the formula.
6. **Seed created cancelled tasks that had no routing attempt**, so the seed looked up an attempt that did not exist. *Change*: scenario condition corrected.
7. **Job ID reuse.** The seed resets ID sequences, so new attempts reused IDs like `attempt-1`. BullMQ ignored duplicate job IDs, so new routing results were never scheduled. E2E routine and recovery tests stalled at routing pending. *Change*: jobs are keyed by the attempt's unique `request_token`, and the handler rejects a token mismatch. A regression test was added.
8. **Cancelling the job hid the late result.** I first removed the BullMQ job on supersession. The E2E late-result test then found no "stale result ignored" event. The requirement is to record the ignored result. *Change*: the production scheduler no longer removes the job.
9. **Frontend tests failed for setup reasons**: Vitest globals were off (so `vi` was undefined and Testing Library did not clean up between tests); jsdom lacks `ResizeObserver` (needed by Recharts). *Change*: globals enabled and a `ResizeObserver` stub added.
10. **Two timing assertions were too exact** (a live elapsed value read 29 s instead of 30 s; a negative check matched a legitimate metric label). *Change*: assert the format, and scope the check to the row.
11. **Playwright's bundled Chromium could not be downloaded.** *Change*: configured to use the installed Google Chrome.
12. **My own false claim in the middle of the run.** A background E2E notification reported exit code 0, but the output file showed 3 failed tests. I did not rely on the notification. I read the log, found the three failures (see item 7), fixed them, and re-ran the whole suite until it passed.

## Corrections and changes in direction
- Backend language changed from Ruby to TypeScript after the Rails install failed (see decisions).
- `cancel` in the scheduler became a deliberate no-op after item 8.

## Testing and verification steps
- `tsc --noEmit` for backend and frontend.
- Migration applied to a fresh database. Seed run end to end, producing all 20 demonstration tasks.
- Backend Vitest: 54/54 passing.
- A real smoke run of the API plus BullMQ worker: a task routed, went from pending to matched after about 5 seconds, delivered by the worker.
- Frontend Vitest: 14/14 passing. `vite build` succeeded.
- Playwright: 4/4 passing in a full run after the last code change.

## Remaining limitations
- No Rails implementation, no RSpec, no Action Cable library (WebSocket fan-out is hand-built), no Active Record.
- Docker Compose not started or verified.
- Authentication is absent by design (single-operator demonstration).
- No ESLint configuration was added and Prettier was not run. RuboCop is not applicable.
- The E2E scenarios take real time (up to about 25 s each). Not measured across repeated runs.
- The session export and transcript are not produced by this environment and are not attached here.
