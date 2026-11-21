import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { useCreateTask, useExpertise, useRoutingAttempts, useSimulationStatus } from '../api/hooks';
import type { RoutingAttemptRow } from '../api/types';
import { Card, ElapsedTime, Empty, ErrorState, Loading, Notice } from '../components/ui';
import { formatDateTime } from '../lib/format';

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'no_match', label: 'No match' },
  { key: 'superseded', label: 'Superseded' },
  { key: '', label: 'All' },
] as const;

export function RoutingPage() {
  const [tab, setTab] = useState<string>('pending');
  const q = useRoutingAttempts(tab);
  const sim = useSimulationStatus();
  const showSim = import.meta.env.DEV && sim.data?.controls_enabled;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Routing operations</h1>
        <p className="text-sm text-slate-500">
          Pending requests stay open until a result is delivered or an operator intervenes. Nothing is declared failed automatically.
        </p>
      </header>

      <div role="tablist" aria-label="Routing outcome" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key || 'all'}
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showSim && <SimulationPanel />}

      <Card title={`Requests${q.data ? ` (${q.data.meta.total})` : ''}`}>
        {q.isPending ? (
          <Loading label="Loading routing requests…" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.data.length === 0 ? (
          <Empty title="No requests in this view" hint="Submitted tasks create a routing request." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Routing requests</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">Request</th>
                  <th scope="col" className="px-3 py-2">Task</th>
                  <th scope="col" className="px-3 py-2">Outcome</th>
                  <th scope="col" className="px-3 py-2">Started</th>
                  <th scope="col" className="px-3 py-2">Elapsed</th>
                  <th scope="col" className="px-3 py-2">Notes</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.data.map((r) => <AttemptRow key={r.id} r={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AttemptRow({ r }: { r: RoutingAttemptRow }) {
  const label = { pending: 'Unresolved', resolved: 'Resolved', no_match: 'No match', superseded: 'Superseded' }[r.status];
  const tone = { pending: 'text-blue-800 bg-blue-50', resolved: 'text-emerald-800 bg-emerald-50', no_match: 'text-amber-800 bg-amber-50', superseded: 'text-slate-600 bg-slate-100' }[r.status];
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-500">#{r.id}</td>
      <td className="max-w-xs px-3 py-3"><Link to={`/tasks/${r.task_id}`} className="font-medium text-blue-700 hover:underline">{r.task_title}</Link></td>
      <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span></td>
      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDateTime(r.started_at)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-slate-700">{r.status === 'pending' ? <ElapsedTime seconds={r.pending_seconds} /> : '—'}</td>
      <td className="px-3 py-3 text-slate-600">
        {r.status === 'pending' && 'Still waiting. May be slow or may never return.'}
        {r.status === 'resolved' && r.selected_contributor_name && `Matched ${r.selected_contributor_name}`}
        {r.status === 'superseded' && `Superseded ${formatDateTime(r.superseded_at)}`}
        {r.status === 'no_match' && 'No eligible contributor'}
        {r.late_result_at && <span className="ml-1 block text-xs text-amber-800">Late result ignored {formatDateTime(r.late_result_at)}</span>}
      </td>
      <td className="px-3 py-3 text-right">
        <Link to={`/tasks/${r.task_id}${r.status === 'pending' ? '#manual-assignment' : ''}`} className="btn-secondary px-2 py-1 text-xs">
          {r.status === 'pending' ? 'Intervene' : 'Open task'}
        </Link>
      </td>
    </tr>
  );
}

/** Development-only controls that force a routing outcome. Kept apart from operator workflows. */
function SimulationPanel() {
  const create = useCreateTask();
  const expertise = useExpertise();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cases: Array<{ key: 'success' | 'delayed' | 'never'; label: string; hint: string }> = [
    { key: 'success', label: 'Successful response', hint: 'Returns after 5 seconds' },
    { key: 'delayed', label: 'Delayed response', hint: 'Returns after 20 seconds' },
    { key: 'never', label: 'Never returns', hint: 'Stays unresolved until an operator acts' },
  ];
  const launch = async (simulation: 'success' | 'delayed' | 'never') => {
    if (!expertise.data?.data[0]) return setError('No expertise areas are available.');
    setError(null);
    setMessage(null);
    try {
      const task = await create.mutateAsync({
        title: `Demo routing (${simulation})`,
        description: 'Created from the development simulation panel.',
        required_expertise_id: expertise.data?.data[0]?.id ?? 0,
        priority: 'high',
        due_date: null,
        submit: true,
        simulation,
      });
      navigate(`/tasks/${task.id}`, { state: { flash: `Demo task created with a forced ${simulation} outcome.` } });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card title="Development simulation" actions={<span className="inline-flex items-center gap-1 text-xs text-amber-800"><FlaskConical className="h-3.5 w-3.5" aria-hidden /> Dev only</span>}>
      <p className="mb-3 text-sm text-slate-600">Create a demo task with a forced outcome to reproduce a scenario. Ordinary operator screens never reveal the predetermined outcome.</p>
      <div className="flex flex-wrap gap-2">
        {cases.map((c) => (
          <button key={c.key} className="btn-secondary" title={c.hint} onClick={() => void launch(c.key)} disabled={create.isPending}>{c.label}</button>
        ))}
      </div>
      {message && <Notice kind="info">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}
