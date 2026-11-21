import { Link, useSearchParams } from 'react-router'
import { ArrowRight, History } from 'lucide-react'
import { useEvents } from '../api/hooks'
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner } from '../components/ui/primitives'
import { ACTOR_LABEL, EVENT_LABEL, EVENT_TONE, humanize } from '../lib/status'
import { formatDateTime } from '../lib/format'

export function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const taskId = params.get('task_id') ?? ''
  const eventType = params.get('event_type') ?? ''
  const actorType = params.get('actor_type') ?? ''
  const page = Number(params.get('page') ?? 1)
  const { data, isLoading, error, refetch } = useEvents({ task_id: taskId, event_type: eventType, actor_type: actorType, page })

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader title="Activity history" description="Append-only audit trail of every task transition, newest first." />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Task ID" placeholder="Task ID" inputMode="numeric" value={taskId} onChange={(e) => set('task_id', e.target.value.replace(/\D/g, ''))} className="w-32" />
        <Select aria-label="Event type" value={eventType} onChange={(e) => set('event_type', e.target.value)} className="w-auto">
          <option value="">All event types</option>
          {(data?.meta.event_types ?? Object.keys(EVENT_LABEL)).map((t) => <option key={t} value={t}>{EVENT_LABEL[t] ?? humanize(t)}</option>)}
        </Select>
        <Select aria-label="Actor" value={actorType} onChange={(e) => set('actor_type', e.target.value)} className="w-auto">
          <option value="">Any actor</option>
          {Object.entries(ACTOR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      <Card>
        {error ? (
          <div className="p-4"><ErrorBanner error={error} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <Spinner />
        ) : !data || data.data.length === 0 ? (
          <EmptyState icon={<History className="size-6" />} title="No events match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Event</th>
                  <th className="px-4 py-2.5">Task</th>
                  <th className="px-4 py-2.5">Contributor</th>
                  <th className="px-4 py-2.5">Actor</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5">Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((e) => (
                  <tr key={e.id} className="align-top" data-testid="activity-row" data-event-type={e.event_type}>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500 tabular-nums">{formatDateTime(e.created_at)}</td>
                    <td className="px-4 py-3"><Badge tone={EVENT_TONE[e.event_type] ?? 'gray'}>{EVENT_LABEL[e.event_type] ?? humanize(e.event_type)}</Badge></td>
                    <td className="max-w-48 px-4 py-3">
                      <Link to={`/tasks/${e.task.id}`} className="text-xs font-medium hover:text-blue-700 hover:underline">#{e.task.id} {e.task.title}</Link>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{e.contributor?.name ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-600">{ACTOR_LABEL[e.actor_type]}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-600">
                      {e.previous_state || e.new_state ? (
                        <span className="inline-flex items-center gap-1">
                          {humanize(e.previous_state) || '—'} <ArrowRight className="size-3" aria-label="to" /> {humanize(e.new_state) || '—'}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="min-w-72 px-4 py-3 text-xs text-slate-700 dark:text-slate-300">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800">
            <span>{data.meta.total} events · page {data.meta.page} of {data.meta.total_pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= data.meta.total_pages} onClick={() => set('page', String(page + 1))}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
