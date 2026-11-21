import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useIntervene, useRecover, useRouteTask, useTasks } from '../api/hooks';
import type { Task, TaskStatus } from '../api/types';
import { Card, ElapsedTime, Empty, ErrorState, Loading, Notice, PriorityBadge, StatusBadge } from '../components/ui';
import { PRIORITY_LABEL, STATUS_LABEL, formatDateTime } from '../lib/format';

const ALL_STATUSES = Object.keys(STATUS_LABEL) as TaskStatus[];

export function TasksPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [routing, setRouting] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const query = useTasks({ search, status, priority, routing, page });
  const route = useRouteTask();

  const filtersChanged = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const submitTask = async (task: Task) => {
    setNotice(null);
    try {
      await route.mutateAsync({ id: task.id });
      setNotice({ kind: 'success', text: `“${task.title}” submitted for routing.` });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-sm text-slate-500">Search, filter, and act on tasks. Pending duration is measured from the routing request.</p>
        </div>
        <Link to="/tasks/new" className="btn-primary">New task</Link>
      </header>

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <label className="relative md:col-span-2">
            <span className="sr-only">Search by title</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input className="input pl-9" placeholder="Search by title" value={search} onChange={(e) => filtersChanged(() => setSearch(e.target.value))} />
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select className="input" value={status} onChange={(e) => filtersChanged(() => setStatus(e.target.value))}>
              <option value="">All statuses</option>
              {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by priority</span>
            <select className="input" value={priority} onChange={(e) => filtersChanged(() => setPriority(e.target.value))}>
              <option value="">All priorities</option>
              {(Object.keys(PRIORITY_LABEL) as Array<keyof typeof PRIORITY_LABEL>).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={routing === 'pending'} onChange={(e) => filtersChanged(() => setRouting(e.target.checked ? 'pending' : ''))} />
            Routing pending only
          </label>
        </div>

        {query.isPending ? (
          <Loading label="Loading tasks…" />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.data.length === 0 ? (
          <Empty title="No tasks match these filters" hint="Clear the filters or create a new task." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Tasks</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">ID</th>
                  <th scope="col" className="px-3 py-2">Title</th>
                  <th scope="col" className="px-3 py-2">Expertise</th>
                  <th scope="col" className="px-3 py-2">Priority</th>
                  <th scope="col" className="px-3 py-2">Created</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Routing</th>
                  <th scope="col" className="px-3 py-2">Assignee</th>
                  <th scope="col" className="px-3 py-2">Pending</th>
                  <th scope="col" className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data.data.map((t) => (
                  <TaskRow key={t.id} task={t} onSubmit={() => void submitTask(t)} onNotice={setNotice} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {query.data && query.data.meta.total_pages > 1 && (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="text-slate-600">Page {query.data.meta.page} of {query.data.meta.total_pages}</span>
            <button className="btn-secondary" disabled={page >= query.data.meta.total_pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </nav>
        )}
      </Card>
    </div>
  );
}

function TaskRow({ task, onSubmit, onNotice }: { task: Task; onSubmit: () => void; onNotice: (n: { kind: 'success' | 'error'; text: string }) => void }) {
  const retry = useIntervene(task.id);
  const recover = useRecover(task.id);
  const canSubmit = task.status === 'draft' || task.status === 'needs_intervention';
  const canRecover = task.status === 'declined' || task.status === 'assignment_failed';
  const canRetry = task.status === 'routing_pending';

  const doRetry = async () => {
    try {
      await retry.mutateAsync({ action: 'reroute', reason: 'Retried from task list' });
      onNotice({ kind: 'success', text: `Routing restarted for “${task.title}”.` });
    } catch (e) {
      onNotice({ kind: 'error', text: (e as Error).message });
    }
  };
  const doRecover = async () => {
    try {
      await recover.mutateAsync({ action: 'retry_routing' });
      onNotice({ kind: 'success', text: `“${task.title}” reopened for routing.` });
    } catch (e) {
      onNotice({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <tr className="align-top hover:bg-slate-50/60">
      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-500">#{task.id}</td>
      <td className="max-w-xs px-3 py-3">
        <Link to={`/tasks/${task.id}`} className="font-medium text-blue-700 hover:underline">{task.title}</Link>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-slate-700">{task.expertise.name}</td>
      <td className="px-3 py-3"><PriorityBadge priority={task.priority} /></td>
      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDateTime(task.created_at)}</td>
      <td className="px-3 py-3"><StatusBadge status={task.status} /></td>
      <td className="px-3 py-3 text-slate-600">{task.routing.state === 'pending' ? 'Pending' : 'Idle'}</td>
      <td className="px-3 py-3 text-slate-700">{task.current_assignment?.contributor.name ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-3 text-slate-600"><ElapsedTime seconds={task.routing.pending_seconds} /></td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Link to={`/tasks/${task.id}`} className="btn-secondary px-2 py-1 text-xs">View</Link>
          {canSubmit && (
            <button className="btn-primary px-2 py-1 text-xs" onClick={onSubmit}>Submit</button>
          )}
          {canRetry && (
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => void doRetry()} disabled={retry.isPending}>Retry routing</button>
          )}
          {canRecover && (
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => void doRecover()} disabled={recover.isPending}>Recover</button>
          )}
          <Link to={`/tasks/${task.id}#manual-assignment`} className="btn-secondary px-2 py-1 text-xs">Assign</Link>
          <Link to={`/tasks/${task.id}#history`} className="btn-secondary px-2 py-1 text-xs">History</Link>
        </div>
      </td>
    </tr>
  );
}

