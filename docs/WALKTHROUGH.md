# Walkthrough outline (≤ 10 minutes)

Start with `docker compose up -d`, the migration, the seed, and three terminals: API, worker, frontend. Open http://localhost:5173.

1. **Dashboard (1 min).** Point out real counts from the database, the unresolved request with its elapsed time, and that it is described as waiting, not failed.
2. **Routine assignment, Use Case 1 (2 min).** Create a Python task with the forced "Success after 5s" outcome. Show "Routing pending" with the elapsed clock, then "Awaiting acceptance" after about 5 seconds, delivered by the worker. Accept it. Show the Activity history.
3. **Unresolved routing, Use Case 2 (2 min).** Create a task with "Never returns". It stays pending. Explain that the system cannot tell slow from never, so nothing is declared failed and there is no timeout. Show the intervention controls.
4. **Human intervention, Use Case 3 (2 min).** On a "Delayed 20s" task, manually assign a contributor during routing. Wait for the late result. Show "Stale result ignored" and that the manual assignment is intact.
5. **Recovery, Use Case 4 (2 min).** Decline with a reason. Show the recovery panel. Retry routing. The previous contributor is not offered the task again.
6. **Integrity (1 min).** Point to the database constraints and the partial unique index, and the tests: concurrency, duplicate submissions, stale results.
