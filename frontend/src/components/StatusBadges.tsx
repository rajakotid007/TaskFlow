import { useEffect, useState } from 'react'
import { Clock, Hourglass } from 'lucide-react'
import { Badge } from './ui/primitives'
import type { Priority, RoutingStatus, RoutingSummary, TaskStatus } from '../api/types'
import { PRIORITY, ROUTING_STATUS, TASK_STATUS } from '../lib/status'
import { formatDuration, secondsSince } from '../lib/format'
import { serverNow } from '../api/client'

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS[status]
  return (
    <Badge tone={meta.tone} dot pulse={status === 'routing_pending'} title={meta.hint}>
      {meta.label}
    </Badge>
  )
}

export function RoutingStatusBadge({ status }: { status: RoutingStatus }) {
  const meta = ROUTING_STATUS[status]
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY[priority]
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

/** Re-renders every `intervalMs` so elapsed timers tick without refetching. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export const EXPECTED_WINDOW_SECONDS = 20

/**
 * How long a routing request has been outstanding. Past the normal window it
 * turns amber and says so — it never claims the request has failed, because
 * the system cannot know that.
 */
export function PendingTimer({ startedAt, windowSeconds = EXPECTED_WINDOW_SECONDS, verbose = false }: {
  startedAt: string
  windowSeconds?: number
  verbose?: boolean
}) {
  const now = useNow()
  const elapsed = secondsSince(startedAt, now)
  const beyond = elapsed > windowSeconds
  const Icon = beyond ? Hourglass : Clock

  return (
    <span
      className={beyond ? 'inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400' : 'inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300'}
      title={beyond ? `No result after ${formatDuration(elapsed)} — longer than the usual ${windowSeconds}s. It may still arrive.` : 'Waiting for the routing engine'}
      data-testid="pending-timer"
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">{formatDuration(elapsed)}</span>
      {verbose && <span>{beyond ? '· beyond usual window' : '· waiting'}</span>}
    </span>
  )
}

/** Routing cell for tables: pending → live timer, otherwise the latest outcome. */
export function RoutingCell({ routing }: { routing: RoutingSummary | null }) {
  if (!routing) return <span className="text-xs text-slate-400">—</span>
  if (routing.status === 'pending') {
    return (
      <div className="flex flex-col gap-1">
        <RoutingStatusBadge status="pending" />
        <PendingTimer startedAt={routing.started_at} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <RoutingStatusBadge status={routing.status} />
      <span className="text-[11px] text-slate-500">attempt #{routing.attempt_number}</span>
    </div>
  )
}
