import { Link } from 'react-router'
import clsx from 'clsx'
import { AlertTriangle, ArrowRight, CheckCircle2, Hourglass, Inbox, ListTodo, Plus, Radar, UserCheck, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDashboard } from '../api/hooks'
import { Button, Card, CardHeader, ErrorBanner, PageHeader, Spinner } from '../components/ui/primitives'
import { EventTimeline } from '../components/EventTimeline'
import { BarList } from '../components/BarList'
import { PendingTimer, PriorityBadge, TaskStatusBadge } from '../components/StatusBadges'
import { PRIORITY, STATUS_REASON } from '../lib/status'
import type { Priority } from '../api/types'

function Stat({ label, value, icon, tone, to, hint }: {
  label: string
  value: number
  icon: ReactNode
  tone: 'blue' | 'green' | 'amber' | 'red' | 'gray'
  to: string
  hint?: string
}) {
  const toneCls = {
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300',
    green: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',
    gray: 'text-slate-600 bg-slate-100 dark:bg-slate-500/10 dark:text-slate-300',
  }[tone]
  return (
    <Link to={to} className="group" data-testid={`stat-${label}`}>
      <Card className="h-full p-4 transition-shadow group-hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <span className={clsx('rounded-md p-1.5', toneCls)}>{icon}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </Card>
    </Link>
  )
}

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard()

  if (isLoading) return <Spinner />
  if (error || !data) return <ErrorBanner error={error} onRetry={() => refetch()} />

  const t = data.totals
  const priorities = (['urgent', 'high', 'medium', 'low'] as Priority[]).map((p) => ({
    name: PRIORITY[p].label,
    value: data.open_by_priority[p] ?? 0,
  }))
  const outcomes = [
    { name: 'Pending', value: data.routing_outcomes.pending },
    { name: 'Matched', value: data.routing_outcomes.matched },
    { name: 'No match', value: data.routing_outcomes.no_match },
    { name: 'Superseded', value: data.routing_outcomes.superseded },
    { name: 'Late result ignored', value: data.routing_outcomes.late_results_ignored },
  ]

  return (
    <>
      <PageHeader
        title="Operations dashboard"
        description="Live view of task routing and assignment across the team."
        actions={
          <>
            <Link to="/routing"><Button icon={<Radar className="size-4" />}>Routing operations</Button></Link>
            <Link to="/tasks/new"><Button variant="primary" icon={<Plus className="size-4" />}>Create task</Button></Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total tasks" value={t.tasks} icon={<ListTodo className="size-4" />} tone="gray" to="/tasks" />
        <Stat label="Routing pending" value={t.routing_pending} icon={<Radar className="size-4" />} tone="blue" to="/tasks?status=routing_pending" hint={`${t.draft} drafts not yet submitted`} />
        <Stat label="Awaiting acceptance" value={t.awaiting_acceptance} icon={<Inbox className="size-4" />} tone="amber" to="/tasks?status=awaiting_acceptance" />
        <Stat label="Active assignments" value={t.active_assignments} icon={<UserCheck className="size-4" />} tone="green" to="/tasks?status=assigned,in_progress" />
        <Stat label="Unresolved routing" value={t.unresolved_routing} icon={<Hourglass className="size-4" />} tone="amber" to="/tasks?view=unresolved" hint={`No result after ${data.expected_window_seconds}s`} />
        <Stat label="Needs intervention" value={t.needs_intervention} icon={<AlertTriangle className="size-4" />} tone="amber" to="/tasks?view=needs_intervention" />
        <Stat label="Declined or failed" value={t.declined_or_failed} icon={<XCircle className="size-4" />} tone="red" to="/tasks?status=declined,assignment_failed" />
        <Stat label="Completed" value={t.completed} icon={<CheckCircle2 className="size-4" />} tone="gray" to="/tasks?status=completed" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Needs attention"
            description="Declined, failed, or routing longer than the usual window — highest priority first."
            actions={<Link to="/tasks?view=needs_intervention" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">View all <ArrowRight className="size-3" /></Link>}
          />
          {data.attention.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Nothing needs intervention right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.attention.map((task) => (
                <li key={task.id}>
                  <Link to={`/tasks/${task.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="text-xs text-slate-400 tabular-nums">#{task.id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                    <PriorityBadge priority={task.priority} />
                    <TaskStatusBadge status={task.status} />
                    <span className="w-full text-xs text-slate-500 sm:w-auto">
                      {task.status === 'routing_pending' && task.routing ? (
                        <PendingTimer startedAt={task.routing.started_at} verbose />
                      ) : (
                        STATUS_REASON[task.status_reason ?? ''] ?? ''
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" actions={<Link to="/activity" className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">Full history</Link>} />
          <div className="px-5 pt-4">
            <EventTimeline events={data.recent_events.slice(0, 8)} showTask dense />
          </div>
        </Card>

        <Card>
          <CardHeader title="Open tasks by priority" />
          <div className="px-3 py-3"><BarList data={priorities} label="Open tasks" /></div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Routing requests by outcome" description="All attempts. Pending includes requests that are slow and any that may never return — the system cannot tell them apart." />
          <div className="px-3 py-3"><BarList data={outcomes} label="Routing requests" /></div>
        </Card>
      </div>
    </>
  )
}
