import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { useExpertiseAreas, useTasks, type TaskFilters } from '../api/hooks'
import { Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner } from '../components/ui/primitives'
import { PendingTimer, PriorityBadge, RoutingCell, TaskStatusBadge } from '../components/StatusBadges'
import { TaskActions } from '../components/TaskActions'
import { TASK_STATUS } from '../lib/status'
import { formatDateTime, formatShort } from '../lib/format'
import type { Task, TaskStatus } from '../api/types'

const VIEWS = [
  { value: '', label: 'All tasks' },
  { value: 'open', label: 'Open' },
  { value: 'needs_intervention', label: 'Needs intervention' },
  { value: 'unresolved', label: 'Unresolved routing' },
  { value: 'overdue_offers', label: 'Unanswered offers' },
]

function PendingDuration({ task }: { task: Task }) {
  if (task.status === 'routing_pending' && task.routing?.status === 'pending') {
    return <PendingTimer startedAt={task.routing.started_at} />
  }
  if (task.status === 'awaiting_acceptance') return <span className="text-xs text-amber-700 dark:text-amber-400">awaiting reply</span>
  return <span className="text-xs text-slate-400">—</span>
}

export function TasksPage() {
  const [params, setParams] = useSearchParams()
  const { data: areas } = useExpertiseAreas()
  const [q, setQ] = useState(params.get('q') ?? '')

  const filters: TaskFilters = {
    q: params.get('q') ?? undefined,
    status: params.get('status') ?? undefined,
    priority: params.get('priority') ?? undefined,
    expertise_id: params.get('expertise_id') ?? undefined,
    view: params.get('view') ?? undefined,
    sort: params.get('sort') ?? undefined,
    page: Number(params.get('page') ?? 1),
    per_page: 20,
  }
  const { data, isLoading, isFetching, error, refetch } = useTasks(filters)

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  // Debounced search.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) update('q', q)
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const hasFilters = ['q', 'status', 'priority', 'expertise_id', 'view'].some((k) => params.get(k))
  const meta = data?.meta

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Every task with its routing and assignment state."
        actions={<Link to="/tasks/new"><Button variant="primary" icon={<Plus className="size-4" />}>Create task</Button></Link>}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <Input aria-label="Search tasks" placeholder="Search by title or #id" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Select aria-label="View" value={params.get('view') ?? ''} onChange={(e) => update('view', e.target.value)} className="w-auto">
            {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
          <Select aria-label="Status" value={params.get('status') ?? ''} onChange={(e) => update('status', e.target.value)} className="w-auto">
            <option value="">Any status</option>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
            {params.get('status')?.includes(',') && <option value={params.get('status')!}>Multiple</option>}
          </Select>
          <Select aria-label="Priority" value={params.get('priority') ?? ''} onChange={(e) => update('priority', e.target.value)} className="w-auto">
            <option value="">Any priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Select aria-label="Expertise" value={params.get('expertise_id') ?? ''} onChange={(e) => update('expertise_id', e.target.value)} className="w-auto">
            <option value="">Any expertise</option>
            {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select aria-label="Sort" value={params.get('sort') ?? ''} onChange={(e) => update('sort', e.target.value)} className="w-auto">
            <option value="">Newest first</option>
            <option value="created_at">Oldest first</option>
            <option value="-priority">Priority</option>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => { setQ(''); setParams({}, { replace: true }) }}>
              Clear
            </Button>
          )}
        </div>

        {error ? (
          <div className="p-4"><ErrorBanner error={error} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <Spinner />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No tasks match these filters' : 'No tasks yet'}
            description={hasFilters ? 'Try clearing a filter.' : 'Create a task to start routing work to contributors.'}
            action={!hasFilters && <Link to="/tasks/new"><Button variant="primary">Create task</Button></Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm" aria-busy={isFetching}>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                <tr>
                  <th scope="col" className="px-3 py-2.5">ID</th>
                  <th scope="col" className="px-3 py-2.5">Title</th>
                  <th scope="col" className="px-3 py-2.5">Expertise</th>
                  <th scope="col" className="px-3 py-2.5">Priority</th>
                  <th scope="col" className="px-3 py-2.5">Created</th>
                  <th scope="col" className="px-3 py-2.5">Task status</th>
                  <th scope="col" className="px-3 py-2.5">Routing</th>
                  <th scope="col" className="px-3 py-2.5">Assignee</th>
                  <th scope="col" className="px-3 py-2.5">Pending</th>
                  <th scope="col" className="px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data?.data.map((task) => (
                  <tr key={task.id} className="align-top hover:bg-slate-50/60 dark:hover:bg-slate-800/30" data-testid="task-row" data-task-id={task.id}>
                    <td className="px-3 py-3 text-xs text-slate-400 tabular-nums">#{task.id}</td>
                    <td className="min-w-44 px-4 py-3">
                      <Link to={`/tasks/${task.id}`} className="font-medium text-slate-900 hover:text-blue-700 hover:underline dark:text-slate-100">{task.title}</Link>
                      {task.needs_intervention && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Needs intervention</p>}
                    </td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-600 dark:text-slate-400">{task.required_expertise.name}</td>
                    <td className="px-3 py-3"><PriorityBadge priority={task.priority} /></td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-500 tabular-nums" title={formatDateTime(task.created_at)}>{formatShort(task.created_at)}</td>
                    <td className="px-3 py-3"><TaskStatusBadge status={task.status} /></td>
                    <td className="px-3 py-3"><RoutingCell routing={task.routing} /></td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap">
                      {task.current_assignment ? (
                        <span>
                          {task.current_assignment.contributor.name}
                          <span className="block text-[11px] text-slate-500">
                            {task.current_assignment.status === 'offered' ? 'offered' : task.current_assignment.source === 'manual' ? 'manual' : 'via routing'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-3"><PendingDuration task={task} /></td>
                    <td className="px-3 py-3"><TaskActions task={task} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800">
            <span>{meta.total} task{meta.total === 1 ? '' : 's'} · page {meta.page} of {Math.max(meta.total_pages, 1)}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label="Previous page" disabled={meta.page <= 1} onClick={() => update('page', String(meta.page - 1))}><ChevronLeft className="size-4" /></Button>
              <Button size="sm" variant="ghost" aria-label="Next page" disabled={meta.page >= meta.total_pages} onClick={() => update('page', String(meta.page + 1))}><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
