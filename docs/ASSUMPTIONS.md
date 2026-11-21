# Assumptions

## Product
- Single-operator demonstration environment. There is no login. The operator is the constant actor `operator`. Contributor actions (accept/decline) are unauthenticated and identify the contributor by the assignment's owner.
- Each task requires exactly one expertise area. Each contributor has one or more.
- A task has at most one active assignee at any time.

## Contributor availability and capacity
- `availability` is one of `available`, `limited`, `unavailable`. Unavailable contributors are never routed to and cannot be chosen manually. `limited` contributors are eligible.
- `max_active_assignments` (default 3) bounds how many *proposed or accepted* assignments a contributor holds. A contributor at capacity is skipped by routing.
- A contributor who declined or failed a task is excluded from automatic routing for that task only.

## Assignment acceptance
- Routing and manual assignment both create a `proposed` assignment. The task becomes `awaiting_acceptance`. Work begins only after the contributor accepts.
- Manual assignment does **not** skip acceptance. The brief's "Routing Pending → Manually Assigned → In Progress" path is simplified to "→ Awaiting Acceptance → Assigned". Documented as a simplification.
- Accept and decline are idempotent. Repeating an accept returns the existing assignment. Declining requires a reason.

## Routing simulation
- Outcome is decided once, at request creation, and stored on the attempt (`simulated_outcome`, `simulated_delay_ms`).
- Normal mode: 20% of requests are `never`. The rest return after a uniform delay in [5000, 20000] ms.
- Development overrides (`ALLOW_SIMULATION_CONTROLS=true`, default outside production): `success` = 5 s, `delayed` = 20 s, `never`. The UI exposes them only in a development panel.
- The predetermined outcome is never serialized. Tests assert this.
- There is no automatic timeout. A never-returning request stays pending until an operator reroutes, assigns, fails, or cancels.
- Matching: contributors with the expertise, not unavailable, under capacity, not previously declined/failed for this task. Ordered by active load, then id. Deterministic.
- When no contributor matches, the task moves to `needs_intervention` with the reason.

## Late results
- Any operator action that supersedes a pending request marks it `superseded`. The job is **not** removed from the queue, so the late result is still delivered, recorded as `stale_result_ignored`, and the attempt gets `late_result_at`. This is intentional, because Use Case 3 requires recording the ignored late result.

## Intentional simplifications
- Task fields are editable only in `draft` and `needs_intervention`.
- Priority is a fixed enum (`low`, `medium`, `high`, `urgent`). It does not affect routing order.
- Due dates are informational. There are no overdue alerts.
- Pagination is offset-based. Search is a case-insensitive title match.
- Money, time zones and notifications (email, Slack) are out of scope.
