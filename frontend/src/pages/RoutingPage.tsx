import { useState } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { Radar } from 'lucide-react'
import { useRoutingAttempts } from '../api/hooks'
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '../components/ui/primitives'
import { PendingTimer, PriorityBadge, RoutingStatusBadge } from '../components/StatusBadges'
import { formatDateTime, formatDuration } from '../lib/format'
import { humanize } from '../lib/status'

const FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'unresolved', label: 'Unresolved (> 20s)' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'late', label: 'Late results' },
  { value: '', label: 'All' },
]

export function RoutingPage() {
  const [filter, setFilter] = useState('pending')
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useRoutingAttempts(filter, page)
  const windowSeconds = Number(data?.meta.expected_window_seconds ?? 20)

  return (
    <>
      <PageHeader
        title="Routing operations"
        description="Every request sent to the routing engine. Pending requests may be slow or may never return — the console cannot tell which, so nothing is marked failed automatically."
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter routing attempts">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => { setFilter(f.value); setPage(1) }}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset',
              filter === f.value ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        {error ? (
          <div className="p-4"><ErrorBanner error={error} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <Spinner />
        ) : !data || data.data.length === 0 ? (
          <EmptyState icon={<Radar className="size-6" />} title="No routing requests in this view" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-2.5">Task</th>
                  <th className="px-4 py-2.5">Attempt</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Sent</th>
                  <th className="px-4 py-2.5">Waiting / took</th>
                  <th className="px-4 py-2.5">Outcome</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((a) => (
                  <tr key={a.id} className="align-top" data-testid="routing-row">
                    <td className="max-w-64 px-4 py-3">
                      <Link to={`/tasks/${a.task_id}`} className="font-medium hover:text-blue-700 hover:underline">#{a.task_id} {a.task?.title}</Link>
                      <div className="mt-1 flex items-center gap-2">
                        {a.task && <PriorityBadge priority={a.task.priority} />}
                        <span className="text-xs text-slate-500">{a.task?.required_expertise}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">#{a.attempt_number} · {humanize(a.trigger)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <RoutingStatusBadge status={a.status} />
                        {a.late_result_at && <Badge tone="violet">Late result ignored</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500 tabular-nums">{formatDateTime(a.started_at)}</td>
                    <td className="px-4 py-3">
                      {a.status === 'pending' ? <PendingTimer startedAt={a.started_at} windowSeconds={windowSeconds} verbose /> : <span className="text-xs text-slate-500 tabular-nums">{formatDuration(a.elapsed_seconds)}</span>}
                    </td>
                    <td className="max-w-80 px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                      {a.status === 'pending' && 'Awaiting result'}
                      {a.outcome_reason}
                      {a.status === 'superseded' && <>Superseded: {humanize(a.superseded_reason)}.</>}
                      {a.late_result_at && (
                        <span className="block">Late {a.late_outcome === 'matched' ? `match (${a.late_contributor?.name})` : 'no-match'} at {formatDateTime(a.late_result_at)} — ignored.</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {a.status === 'pending' && (
                        <Link to={`/tasks/${a.task_id}`}><Button size="sm">Intervene</Button></Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800">
            <span>Page {data.meta.page} of {data.meta.total_pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= data.meta.total_pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
