# Assumptions

Product and engineering decisions made where the brief left room, and why.

## Product

* **Single operator, no authentication.** The console is a demo environment for
  one operator. All operator actions are attributed to actor `operator`.
* **Contributor responses are recorded by the operator.** There is no
  contributor-facing app; "Record acceptance" / "Record decline" stand in for
  the contributor answering. These events are attributed to `contributor`.
* **Manual assignment is immediately accepted.** When an operator picks a
  contributor, that is treated as an agreed assignment (status `accepted`,
  source `manual`), not a new offer. This matches the brief's
  "Routing Pending → Manually Assigned → In Progress".
* **Reassignment is allowed until work starts.** An operator may replace an
  open offer or an accepted assignment that has not started. Once a task is
  `in_progress` the assignee is fixed (complete or cancel instead).
* **"Needs intervention" is derived, not stored.** A task needs intervention if
  it is `declined`, `assignment_failed`, or has a routing request pending for
  more than 20 s. Storing it would mean changing state on a timer, which would
  amount to declaring slow requests failed.
* **Required expertise can only change** while a task is draft, declined or
  assignment failed, so a pending request or assignment is never invalidated by
  an edit.

## Contributor availability and capacity

* Each contributor is `available` or `unavailable` and has
  `max_active_assignments` (default 3, range 1–20).
* **Offers count toward capacity.** An outstanding offer reserves the slot until
  it is accepted, declined or withdrawn. Otherwise routing could offer the same
  contributor more tasks than they can take.
* Routing only considers contributors who have the expertise, are available,
  are below capacity, and **have not already declined this task**.
* Manual assignment applies the same rules except the last: an operator may
  deliberately go back to someone who declined (the dialog flags them).
* Eligibility is checked twice: when the engine computes its match, and again
  under lock when the result is applied (capacity may have changed during the
  5–20 s delay). If the proposed contributor is no longer eligible, the attempt
  is recorded as `no_match` with that explanation.

## Assignment acceptance

* An offer stays open until the contributor responds or an operator acts; offers
  do not expire.
* Declining requires no reason (defaults to "No reason given") but the UI asks
  for one, and it is shown wherever the task's recovery is decided.
* Accept/decline are idempotent: repeating the same answer is a no-op; the
  opposite answer after one was recorded is rejected (422).

## Routing simulation

* **The outcome is decided at request creation** and stored on the attempt
  (`simulated_behavior`, `simulated_delay_seconds`, `simulation_source`): 20 %
  `never_return`, otherwise `respond` after a uniform integer delay of 5–20 s.
  Persisting the plan makes behaviour reproducible and restart-safe.
* `never_return` requests are never enqueued: the engine drops them. Nothing in
  the system ever resolves them except an operator action.
* Responding requests are scheduled as Sidekiq jobs with the planned delay.
  Delivery lags the plan by roughly 0–2 s (Sidekiq polls its schedule every
  second; more under heavy load or right after a worker restart).
* The engine is modelled as a remote service: it computes its match without
  holding locks, then calls back. Matching is deliberately simple —
  least active load among eligible contributors, ties to lowest id.
* The planned outcome is **not** exposed by any operator endpoint or broadcast.
  It is visible only through `/api/v1/simulation/*` and the Simulation lab,
  which exist only when `SIMULATION_CONTROLS_ENABLED=true` and never in
  production.
* Forced plans (for demos and tests) accept `respond` with a 1–300 s delay, or
  `never_return`. "Deliver now" may answer even a `never_return` request, to
  demonstrate a late result after intervention.

## Unresolved vs failed vs superseded

| Term | Meaning | Stored as |
|---|---|---|
| **Unresolved** | Request sent, no answer yet, older than the normal 20 s window. Might be slow, might never come. | attempt `pending` (derived flag `beyond_expected_window`) |
| **Failed** | The engine *answered* that nobody is eligible, or an assignment was released before work. | attempt `no_match`; task `assignment_failed` with `status_reason` |
| **Superseded** | An operator replaced the request (manual assignment, restart, cancel). A later answer is recorded as `late_result_at/late_outcome` and ignored. | attempt `superseded` |

## Edge-case rules

* **Routing never re-offers a task to someone it already fell through with.**
  Contributors who declined it, and those whose assignment was released, are
  skipped by retry routing. An operator may still pick them manually; the
  dialog flags them ("Declined before" / "Released before").
* **Unanswered offers are flagged, not expired.** Contributors answer on human
  time, so an offer with no response for `OFFER_RESPONSE_WINDOW_SECONDS`
  (default 30 minutes) counts as needing intervention, and the task explains
  it in amber. The offer stays open until someone acts.
* **Releasing works before and after work starts.** An in-progress task can be
  released (contributor ill, left, blocked); it becomes assignment failed and
  can be re-routed or reassigned.
* **Accepting needs an available contributor with the expertise.** Changing a
  contributor never changes work they already hold. Instead the save returns
  warnings listing affected tasks, and those tasks show the assignee as
  unavailable.
* **Due dates are real dates, not in the past.** Because the operator's time
  zone is unknown, the API accepts any date that is today somewhere (from
  UTC−12). The form uses the browser's local date. A due date that has since
  passed is kept when other fields are edited.
* **Elapsed times use the server clock.** The console estimates the server
  clock from each response's `Date` header, so a wrong PC clock does not make
  requests look overdue or fresh.
* **Dialogs remember what the operator saw.** A confirmation sends the task
  version from when the dialog opened; if the task changed meanwhile the API
  answers 409. `expected_version` stays optional for API clients that prefer
  idempotent retries.
* **Lost engine jobs look like slow ones, by design.** If the worker is killed
  hard mid-delivery, the request stays pending and is surfaced as unresolved —
  the same path as a request that never returns.

## Intentional simplifications

* No auth, multi-tenant support, notifications or email.
* No contributor working hours, time zones or skill levels.
* Pagination is offset-based.
* Development Docker setup only; no production image or deployment.
* The dashboard is a live snapshot, not historical analytics.
