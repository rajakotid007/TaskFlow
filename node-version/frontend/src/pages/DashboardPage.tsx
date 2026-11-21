import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertOctagon, CheckCircle2, Clock, Hourglass, PlusCircle, Send, UserCheck, XCircle, Layers } from 'lucide-react';
import { useDashboard } from '../api/hooks';
import { Card, ElapsedTime, ErrorState, Empty, Loading, PriorityBadge } from '../components/ui';
import { EVENT_LABEL, PRIORITY_LABEL, formatDateTime } from '../lib/format';

export function DashboardPage() {
  const { data, isPending, error, refetch } = useDashboard();
  if (isPending) return <Loading label="Loading operations summary…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const c = data.counts;
  const metrics = [
    { label: 'Total tasks', value: c.total_tasks, icon: Layers, tone: 'text-slate-700 bg-slate-100' },
    { label: 'Awaiting routing', value: c.awaiting_routing, icon: Send, tone: 'text-blue-700 bg-blue-50' },
    { label: 'Awaiting acceptance', value: c.awaiting_acceptance, icon: Hourglass, tone: 'text-amber-700 bg-amber-50' },
    { label: 'Active assignments', value: c.active_assignments, icon: UserCheck, tone: 'text-emerald-700 bg-emerald-50' },
    { label: 'Unresolved routing requests', value: c.unresolved_routing_requests, icon: Clock, tone: 'text-blue-700 bg-blue-50' },
    { label: 'Requiring intervention', value: c.requiring_intervention, icon: AlertOctagon, tone: 'text-amber-700 bg-amber-50' },
    { label: 'Declined or failed', value: c.declined_or_failed, icon: XCircle, tone: 'text-red-700 bg-red-50' },
    { label: 'Completed', value: c.completed, icon: CheckCircle2, tone: 'text-slate-600 bg-slate-100' },
  ];
  const chart = (['urgent', 'high', 'medium', 'low'] as const).map((p) => ({ name: PRIORITY_LABEL[p], open: data.open_by_priority[p] ?? 0 }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations dashboard</h1>
          <p className="text-sm text-slate-500">Live counts from the database. Unresolved requests are shown as waiting, not failed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/tasks/new" className="btn-primary"><PlusCircle className="h-4 w-4" aria-hidden /> New task</Link>
          <Link to="/routing" className="btn-secondary">Routing operations</Link>
          <Link to="/tasks" className="btn-secondary">All tasks</Link>
        </div>
      </header>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="card flex items-center gap-4 p-4">
            <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${m.tone}`}><m.icon className="h-5 w-5" aria-hidden /></span>
            <div>
              <p className="text-2xl font-semibold tabular-nums" data-testid={`metric-${m.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{m.value}</p>
              <p className="text-xs text-slate-500">{m.label}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Open tasks by priority" className="lg:col-span-1">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={28} />
                <Tooltip />
                <Bar dataKey="open" name="Open tasks" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Unresolved routing requests" className="lg:col-span-1">
          {data.unresolved_requests.length === 0 ? (
            <Empty title="No unresolved requests" hint="Every routing request has returned or been resolved." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.unresolved_requests.map((r) => (
                <li key={r.task_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/tasks/${r.task_id}`} className="block truncate text-sm font-medium text-blue-700 hover:underline">{r.title}</Link>
                    <p className="text-xs text-slate-500">Still waiting on routing. This may be slow or may not return.</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PriorityBadge priority={r.priority} />
                    <span className="text-sm text-slate-700"><ElapsedTime seconds={r.pending_seconds} /></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activity" className="lg:col-span-1">
          {data.activity.length === 0 ? (
            <Empty title="No activity yet" hint="Create a task to see routing and assignment events here." />
          ) : (
            <ol className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {data.activity.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <Activity className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-800">{EVENT_LABEL[a.event_type] ?? a.event_type}</p>
                    <p className="truncate text-slate-600">
                      <Link to={`/tasks/${a.task_id}`} className="text-blue-700 hover:underline">{a.task_title}</Link>
                    </p>
                    <p className="text-xs text-slate-400">{formatDateTime(a.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
