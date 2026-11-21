import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import clsx from 'clsx'
import { ArrowLeft, Hourglass, Info } from 'lucide-react'
import { useTask, useTaskHistory } from '../api/hooks'
import { Badge, Card, CardHeader, EmptyState, ErrorBanner, Spinner } from '../components/ui/primitives'
import { EventTimeline } from '../components/EventTimeline'
import { PendingTimer, PriorityBadge, RoutingStatusBadge, TaskStatusBadge, useNow } from '../components/StatusBadges'
import { TaskActions } from '../components/TaskActions'
import { ASSIGNMENT_STATUS, STATUS_REASON, TASK_STATUS, humanize } from '../lib/status'
import { formatDate, formatDateTime, formatDuration, secondsSince } from '../lib/format'
import type { RoutingAttempt, TaskDetail } from '../api/types'

/** Plain-language explanation of the current state. */
function Explanation({ task }: { task: TaskDetail }) {
  const now = useNow()
  const pending = task.routing_attempts.find((a) => a.status === 'pending')
  const latest = task.routing_attempts[0]
  const lastDecline = task.assignments.find((a) => a.status === 'declined')
  const a = task.current_assignment

  const statusTone = TASK_STATUS[task.status].tone
  let tone: 'blue' | 'amber' | 'red' | 'green' | 'gray' = statusTone === 'violet' ? 'gray' : statusTone
  let body: ReactNode = TASK_STATUS[task.status].hint

  if (task.status === 'routing_pending' && pending) {
    const elapsed = secondsSince(pending.started_at, now)
    const beyond = elapsed > task.expected_window_seconds
    tone = beyond ? 'amber' : 'blue'
    body = beyond ? (
      <>
        Routing request #{pending.attempt_number} has been outstanding for <strong>{formatDuration(elapsed)}</strong>, longer
        than the usual 5–{task.expected_window_seconds}s. It has <strong>not failed</strong> — the engine may still answer —
        but there is no way to know whether it will. You can keep waiting, assign a contributor manually, or restart routing.
        If the original request answers later, its result will be recorded and ignored.
      </>
    ) : (
      <>Routing request #{pending.attempt_number} was sent {formatDuration(elapsed)} ago. Results usually arrive within 5–{task.expected_window_seconds}s. You can intervene at any time.</>
    )
  } else if (task.status === 'awaiting_acceptance' && a) {
    body = <>The routing engine proposed <strong>{a.contributor.name}</strong>{latest?.outcome_reason ? ` (${latest.outcome_reason})` : ''}. Record their response, or assign someone else.</>
  } else if (task.status === 'declined' && lastDecline) {
    body = <><strong>{lastDecline.contributor.name}</strong> declined: “{lastDecline.decline_reason}”. Retry routing (they will be skipped) or choose a contributor manually.</>
  } else if (task.status === 'assignment_failed') {
    body =
      task.status_reason === 'no_eligible_contributor' && latest?.outcome_reason ? (
        <>Routing request #{latest.attempt_number} found nobody: {latest.outcome_reason}. Retry once availability changes, or assign manually.</>
      ) : (
        <>{STATUS_REASON[task.status_reason ?? ''] ?? 'No assignment is in place.'} Retry routing or assign manually.</>
      )
  } else if ((task.status === 'assigned' || task.status === 'in_progress') && a) {
    body = <><strong>{a.contributor.name}</strong> {task.status === 'in_progress' ? 'is working on this task' : 'owns this task'} ({a.source === 'manual' ? 'assigned manually by an operator' : 'accepted a routing offer'}).</>
  }

  const cls = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
    red: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
    gray: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200',
  }[tone]
  const Icon = tone === 'amber' ? Hourglass : Info

  return (
    <div className={clsx('flex gap-3 rounded-lg border px-4 py-3 text-sm', cls)} data-testid="state-explanation">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{body}</p>
    </div>
  )
}

function AttemptRow({ attempt, windowSeconds }: { attempt: RoutingAttempt; windowSeconds: number }) {
  return (
    <li className="px-5 py-3" data-testid="routing-attempt" data-status={attempt.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Attempt #{attempt.attempt_number}</span>
        <RoutingStatusBadge status={attempt.status} />
        <span className="text-xs text-slate-500">{humanize(attempt.trigger)}</span>
        {attempt.late_result_at && <Badge tone="violet">Late result ignored</Badge>}
        <span className="ml-auto text-xs text-slate-500 tabular-nums">{formatDateTime(attempt.started_at)}</span>
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
        {attempt.status === 'pending' && <p>Waiting for result · <PendingTimer startedAt={attempt.started_at} windowSeconds={windowSeconds} verbose /></p>}
        {attempt.outcome_reason && <p>Returned after {formatDuration(attempt.elapsed_seconds)}: {attempt.outcome_reason}</p>}
        {attempt.superseded_at && (
          <p>Superseded after {formatDuration(attempt.elapsed_seconds)} without a result ({humanize(attempt.superseded_reason)}).</p>
        )}
        {attempt.late_result_at && (
          <p>
            Result arrived later at {formatDateTime(attempt.late_result_at)} —{' '}
            {attempt.late_outcome === 'matched' ? `proposed ${attempt.late_contributor?.name}` : 'no match'} — and was ignored.
          </p>
        )}
      </div>
    </li>
  )
}

export function TaskDetailPage() {
  const id = Number(useParams().id)
  const { data: task, isLoading, error, refetch } = useTask(id)
  const { data: history } = useTaskHistory(id)

  if (isLoading) return <Spinner />
  if (error || !task) return <ErrorBanner error={error ?? new Error('Task not found')} onRetry={() => refetch()} />

  return (
    <>
      <Link to="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-200">
        <ArrowLeft className="size-4" /> Tasks
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 tabular-nums">#{task.id} · created {formatDateTime(task.created_at)}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight" data-testid="task-title">{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="task-status" data-status={task.status}>
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <Badge>{task.required_expertise.name}</Badge>
            {task.due_date && <span className="text-xs text-slate-500">Due {formatDate(task.due_date)}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <Explanation task={task} />
        <Card className="p-4">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Actions</h2>
          {task.available_actions.length > 0 ? <TaskActions task={task} /> : <p className="text-sm text-slate-500">No further actions — this task is {TASK_STATUS[task.status].label.toLowerCase()}.</p>}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Description</dt>
                <dd className="mt-1 whitespace-pre-wrap">{task.description || <span className="text-slate-400">No description</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Current assignee</dt>
                <dd className="mt-1">{task.current_assignment ? `${task.current_assignment.contributor.name} (${ASSIGNMENT_STATUS[task.current_assignment.status].label.toLowerCase()})` : 'None'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Version</dt>
                <dd className="mt-1 tabular-nums">{task.version}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Routing attempts" description="Newest first. A superseded attempt's late result is kept for the record but never applied." />
            {task.routing_attempts.length === 0 ? (
              <EmptyState title="Not routed yet" />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {task.routing_attempts.map((a) => <AttemptRow key={a.id} attempt={a} windowSeconds={task.expected_window_seconds} />)}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Assignments" description="At most one is active (offered or accepted) at any time." />
            {task.assignments.length === 0 ? (
              <EmptyState title="No assignments yet" />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {task.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm" data-testid="assignment" data-status={a.status}>
                    <span className="font-medium">{a.contributor.name}</span>
                    <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
                    <span className="text-xs text-slate-500">{a.source === 'manual' ? 'Manual' : `Routing #${task.routing_attempts.find((r) => r.id === a.routing_attempt_id)?.attempt_number ?? ''}`}</span>
                    <span className="ml-auto text-xs text-slate-500 tabular-nums">{a.offered_at && formatDateTime(a.offered_at)}</span>
                    {(a.decline_reason || a.end_reason) && (
                      <p className="w-full text-xs text-slate-600 dark:text-slate-400">
                        {a.decline_reason ? `Declined: ${a.decline_reason}` : `Ended: ${humanize(a.end_reason)}`}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader title="History" description="Every transition, in order." />
          <div className="px-5 pt-4" data-testid="task-history">
            {history ? <EventTimeline events={history} /> : <Spinner />}
          </div>
        </Card>
      </div>
    </>
  )
}
