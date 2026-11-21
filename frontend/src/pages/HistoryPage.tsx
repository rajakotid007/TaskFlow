import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEvents } from '../api/hooks';
import { Card, Empty, ErrorState, Loading } from '../components/ui';
import { EVENT_LABEL, STATUS_LABEL, formatDateTime } from '../lib/format';

const EVENT_TYPES = Object.keys(EVENT_LABEL);

export function HistoryPage() {
  const [taskId, setTaskId] = useState('');
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(1);
  const numericTask = Number(taskId);
  const validTask = taskId === '' || (Number.isInteger(numericTask) && numericTask > 0);
  const q = useEvents({ task_id: validTask && taskId ? numericTask : undefined, event_type: eventType || undefined, page });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Activity history</h1>
        <p className="text-sm text-slate-500">Every important transition is recorded with its actor, the states before and after, and an explanation.</p>
      </header>

      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="h-task" className="label">Task ID</label>
            <input
              id="h-task"
              inputMode="numeric"
              className="input"
              value={taskId}
              aria-invalid={!validTask}
              aria-describedby={!validTask ? 'h-task-error' : undefined}
              onChange={(e) => { setTaskId(e.target.value.replace(/[^0-9]/g, '')); setPage(1); }}
              placeholder="All tasks"
            />
            {!validTask && <p id="h-task-error" className="mt-1 text-sm text-red-700">Enter a task number.</p>}
          </div>
          <div>
            <label htmlFor="h-type" className="label">Event type</label>
            <select id="h-type" className="input" value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(1); }}>
              <option value="">All events</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
            </select>
          </div>
        </div>

        {q.isPending ? (
          <Loading label="Loading activity…" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.data.length === 0 ? (
          <Empty title="No matching events" hint="Adjust the filters, or create and route a task." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Activity events</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">Timestamp</th>
                  <th scope="col" className="px-3 py-2">Event</th>
                  <th scope="col" className="px-3 py-2">Task</th>
                  <th scope="col" className="px-3 py-2">Contributor</th>
                  <th scope="col" className="px-3 py-2">Actor</th>
                  <th scope="col" className="px-3 py-2">State change</th>
                  <th scope="col" className="px-3 py-2">Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.data.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDateTime(e.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-800">{EVENT_LABEL[e.event_type] ?? e.event_type}</td>
                    <td className="max-w-[12rem] px-3 py-2.5"><Link to={`/tasks/${e.task_id}`} className="block truncate text-blue-700 hover:underline">#{e.task_id} {e.task_title}</Link></td>
                    <td className="px-3 py-2.5 text-slate-700">{e.contributor_name ?? '—'}</td>
                    <td className="px-3 py-2.5 capitalize text-slate-600">{e.actor_type}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {e.previous_state && e.new_state ? `${STATUS_LABEL[e.previous_state as keyof typeof STATUS_LABEL] ?? e.previous_state} → ${STATUS_LABEL[e.new_state as keyof typeof STATUS_LABEL] ?? e.new_state}` : '—'}
                    </td>
                    <td className="max-w-md px-3 py-2.5 text-slate-700">{e.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {q.data && q.data.meta.total_pages > 1 && (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="text-slate-600">Page {q.data.meta.page} of {q.data.meta.total_pages}</span>
            <button className="btn-secondary" disabled={page >= q.data.meta.total_pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </nav>
        )}
      </Card>
    </div>
  );
}
