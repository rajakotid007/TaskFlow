import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, Info, Play, Flag } from 'lucide-react';
import { useAdvanceTask, useAssignmentAction, useContributors, useIntervene, useRecover, useRouteTask, useTask } from '../api/hooks';
import { ApiError } from '../api/client';
import type { Contributor, TaskDetail } from '../api/types';
import { Card, ElapsedTime, Empty, ErrorState, Loading, Notice, PriorityBadge, StatusBadge } from '../components/ui';
import { EVENT_LABEL, STATUS_LABEL, formatDate, formatDateTime } from '../lib/format';

type Flash = { kind: 'success' | 'error'; text: string } | null;

export function TaskDetailPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const location = useLocation();
  const initialFlash = (location.state as { flash?: string } | null)?.flash;
  const [flash, setFlash] = useState<Flash>(initialFlash ? { kind: 'success', text: initialFlash } : null);
  const q = useTask(taskId);

  if (q.isPending) return <Loading label="Loading task…" />;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="space-y-4">
        <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to tasks</Link>
        {notFound ? <Empty title="Task not found" hint="It may have been removed, or the link is incorrect." /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      </div>
    );
  }
  const t = q.data;
  return (
    <div className="space-y-6">
      <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to tasks</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-slate-500">Task #{t.id} · version {t.version}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            <span>{t.expertise.name}</span>
            <span aria-hidden>·</span>
            <span>Created {formatDateTime(t.created_at)}</span>
            {t.due_date && (<><span aria-hidden>·</span><span>Due {formatDate(t.due_date)}</span></>)}
          </div>
          {t.description && <p className="mt-3 max-w-3xl whitespace-pre-line text-sm text-slate-700">{t.description}</p>}
        </div>
      </header>

      {flash && <Notice kind={flash.kind}>{flash.text}</Notice>}

      <WhyCard task={t} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CurrentAssignment task={t} onFlash={setFlash} />
        <RoutingAttempts task={t} />
      </div>

      <OperatorActions task={t} onFlash={setFlash} />

      {(t.status === 'declined' || t.status === 'assignment_failed') && <RecoveryPanel task={t} onFlash={setFlash} />}

      {['draft', 'routing_pending', 'needs_intervention', 'awaiting_acceptance', 'declined', 'assignment_failed'].includes(t.status) && (
        <ManualAssignment task={t} onFlash={setFlash} />
      )}

      <HistoryCard task={t} />
    </div>
  );
}

const WHY: Record<string, (t: TaskDetail) => string> = {
  draft: () => 'This task is a draft. It has not been routed.',
  routing_pending: () =>
    'A routing request is open and no result has come back yet. Routing has not failed. The request may simply be slow, or it may never return, and the system does not know which. You can keep working, or intervene below.',
  awaiting_acceptance: (t) => `${t.current_assignment?.contributor.name ?? 'A contributor'} has been offered this task. Routing ends when they accept.`,
  assigned: (t) => `${t.current_assignment?.contributor.name ?? 'A contributor'} accepted the assignment. Work has not started yet.`,
  in_progress: (t) => `${t.current_assignment?.contributor.name ?? 'The assignee'} is working on this task.`,
  completed: () => 'Work is complete. The assignment has ended.',
  declined: () => 'The assigned contributor declined. Recover the task by retrying routing or choosing another contributor.',
  assignment_failed: () => 'The assignment failed before work began. Recover the task below.',
  needs_intervention: () => 'Routing finished without an eligible contributor. Choose someone manually or retry routing.',
  cancelled: () => 'This task was cancelled.',
};

function WhyCard({ task: t }: { task: TaskDetail }) {
  const lastRouting = [...t.history].reverse().find((h) => h.event_type.startsWith('routing_') || h.event_type === 'assignment_proposed');
  return (
    <section aria-labelledby="why-heading" className="card flex gap-4 p-5">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden />
      <div className="space-y-1 text-sm">
        <h2 id="why-heading" className="font-semibold text-slate-900">Why it is {STATUS_LABEL[t.status].toLowerCase()}</h2>
        <p className="text-slate-700">{WHY[t.status]?.(t)}</p>
        {t.status === 'routing_pending' && (
          <p className="text-slate-700">Unresolved for <ElapsedTime seconds={t.routing.pending_seconds} /> so far.</p>
        )}
        {t.status_reason && <p className="text-slate-600">Reason: {t.status_reason}</p>}
        {lastRouting && <p className="text-xs text-slate-500">Latest routing event: {lastRouting.explanation}</p>}
      </div>
    </section>
  );
}

function CurrentAssignment({ task: t, onFlash }: { task: TaskDetail; onFlash: (f: Flash) => void }) {
  const action = useAssignmentAction();
  const [declineReason, setDeclineReason] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const a = t.current_assignment;
  const assignment = a ? t.assignments.find((x) => x.id === a.id) : undefined;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      onFlash({ kind: 'success', text: ok });
    } catch (e) {
      onFlash({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <Card title="Current assignment">
      {!a ? (
        <Empty title="No active assignment" hint={t.routing.state === 'pending' ? 'Waiting for routing to propose a contributor.' : 'Routing or a manual assignment will create one.'} />
      ) : (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-slate-500">Contributor</dt><dd className="font-medium text-slate-900">{a.contributor.name}</dd>
            <dt className="text-slate-500">Status</dt><dd>{a.status === 'proposed' ? 'Awaiting acceptance' : 'Accepted'}</dd>
            <dt className="text-slate-500">Source</dt><dd className="capitalize">{a.source}</dd>
            <dt className="text-slate-500">Offered</dt><dd>{formatDateTime(assignment?.offered_at)}</dd>
          </dl>
          {a.status === 'proposed' && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button className="btn-success" disabled={action.isPending} onClick={() => void run(() => action.mutateAsync({ id: a.id, taskId: t.id, action: 'accept' }), `${a.contributor.name} accepted the assignment.`)}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Accept
              </button>
              <button className="btn-danger" disabled={action.isPending} onClick={() => setShowDecline((v) => !v)} aria-expanded={showDecline}>Decline</button>
              {showDecline && (
                <form
                  className="w-full space-y-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    if (!declineReason.trim()) return onFlash({ kind: 'error', text: 'Enter a reason for declining.' });
                    void run(() => action.mutateAsync({ id: a.id, taskId: t.id, action: 'decline', reason: declineReason.trim() }), `${a.contributor.name} declined. Recover the task below.`);
                    setShowDecline(false);
                    setDeclineReason('');
                  }}
                >
                  <label htmlFor="decline-reason" className="label">Decline reason</label>
                  <input id="decline-reason" className="input" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. at capacity this week" />
                  <button type="submit" className="btn-danger">Confirm decline</button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RoutingAttempts({ task: t }: { task: TaskDetail }) {
  return (
    <Card title="Routing attempts">
      {t.attempts.length === 0 ? (
        <Empty title="No routing attempts yet" hint="Submit the task for routing to start one." />
      ) : (
        <ol className="space-y-3">
          {t.attempts.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Request #{r.id}</span>
                <AttemptPill status={r.status} />
              </div>
              <p className="mt-1 text-slate-600">Started {formatDateTime(r.started_at)}</p>
              {r.status === 'pending' && (
                <p className="mt-1 flex items-center gap-1.5 text-blue-800"><Clock className="h-4 w-4" aria-hidden /> Unresolved for <ElapsedTime seconds={r.pending_seconds} /></p>
              )}
              {r.status === 'resolved' && r.selected_contributor && <p className="mt-1 text-slate-700">Matched {r.selected_contributor.name}</p>}
              {r.status === 'no_match' && <p className="mt-1 text-slate-700">No eligible contributor found.</p>}
              {r.status === 'superseded' && <p className="mt-1 text-slate-600">Superseded by an operator decision {formatDateTime(r.superseded_at)}.</p>}
              {r.late_result_at && <p className="mt-1 text-xs text-amber-800">A late result arrived and was ignored {formatDateTime(r.late_result_at)}.</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function AttemptPill({ status }: { status: string }) {
  const style: Record<string, string> = {
    pending: 'bg-blue-50 text-blue-800 ring-blue-300',
    resolved: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
    no_match: 'bg-amber-50 text-amber-800 ring-amber-300',
    superseded: 'bg-slate-100 text-slate-600 ring-slate-300',
  };
  const label: Record<string, string> = { pending: 'Pending', resolved: 'Resolved', no_match: 'No match', superseded: 'Superseded' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style[status]}`}>{label[status]}</span>;
}

function OperatorActions({ task: t, onFlash }: { task: TaskDetail; onFlash: (f: Flash) => void }) {
  const route = useRouteTask();
  const intervene = useIntervene(t.id);
  const advance = useAdvanceTask(t.id);
  const [reason, setReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmFail, setConfirmFail] = useState(false);
  const open = !['completed', 'cancelled'].includes(t.status);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setReason('');
      onFlash({ kind: 'success', text: ok });
    } catch (e) {
      onFlash({ kind: 'error', text: (e as Error).message });
    }
  };

  const canSubmit = t.status === 'draft' || t.status === 'needs_intervention';
  const canRetry = t.status === 'routing_pending';
  const canFail = t.status === 'awaiting_acceptance' || t.status === 'assigned';

  return (
    <Card title="Operator actions">
      <div className="flex flex-wrap gap-2">
        {canSubmit && (
          <button className="btn-primary" disabled={route.isPending} onClick={() => void run(() => route.mutateAsync({ id: t.id }), 'Submitted for routing. A result is pending.')}>
            <Play className="h-4 w-4" aria-hidden /> Submit for routing
          </button>
        )}
        {canRetry && (
          <button className="btn-secondary" disabled={intervene.isPending} onClick={() => void run(() => intervene.mutateAsync({ action: 'reroute', reason: reason || undefined }), 'Routing restarted. The earlier request is superseded and cannot override later decisions.')}>
            Retry routing
          </button>
        )}
        {t.status === 'assigned' && (
          <button className="btn-secondary" disabled={advance.isPending} onClick={() => void run(() => advance.mutateAsync('in_progress'), 'Work started.')}>Start work</button>
        )}
        {t.status === 'in_progress' && (
          <button className="btn-success" disabled={advance.isPending} onClick={() => void run(() => advance.mutateAsync('completed'), 'Task marked complete.')}>
            <Flag className="h-4 w-4" aria-hidden /> Mark complete
          </button>
        )}
        {canFail && !confirmFail && (
          <button className="btn-danger" onClick={() => setConfirmFail(true)}>Mark assignment failed</button>
        )}
        {open && (
          !confirmCancel ? (
            <button className="btn-danger" onClick={() => setConfirmCancel(true)}>Cancel task</button>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              Cancel this task? Any pending routing request will be ignored.
              <button className="btn-danger" onClick={() => { setConfirmCancel(false); void run(() => intervene.mutateAsync({ action: 'cancel', reason: reason || undefined }), 'Task cancelled.'); }}>Yes, cancel</button>
              <button className="btn-secondary" onClick={() => setConfirmCancel(false)}>Keep task</button>
            </span>
          )
        )}
      </div>
      {confirmFail && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setConfirmFail(false);
            void run(() => intervene.mutateAsync({ action: 'fail_assignment', reason: reason.trim() || 'Marked failed by operator.' }), 'Assignment marked failed. Recover the task below.');
          }}
        >
          <div className="min-w-64 flex-1">
            <label htmlFor="fail-reason" className="label">Why did the assignment fail?</label>
            <input id="fail-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="submit" className="btn-danger">Confirm failure</button>
          <button type="button" className="btn-secondary" onClick={() => setConfirmFail(false)}>Back</button>
        </form>
      )}
      {!canSubmit && !canRetry && t.status !== 'assigned' && t.status !== 'in_progress' && !canFail && open === false && (
        <p className="mt-3 text-sm text-slate-500">This task is closed. Its history remains available below.</p>
      )}
    </Card>
  );
}

function RecoveryPanel({ task: t, onFlash }: { task: TaskDetail; onFlash: (f: Flash) => void }) {
  const recover = useRecover(t.id);
  const contributors = useContributors();
  const [choice, setChoice] = useState('');
  const last = t.assignments.find((a) => a.status === 'declined' || a.status === 'failed');
  const eligible = (contributors.data?.data ?? []).filter((c) => eligibleFor(c, t));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      onFlash({ kind: 'success', text: ok });
    } catch (e) {
      onFlash({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <Card title="Recovery">
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-red-50 p-3 text-red-800">
          <p className="font-medium">{t.status === 'declined' ? 'Declined' : 'Assignment failed'}{last ? ` by ${last.contributor.name}` : ''}</p>
          <p className="mt-1">Reason: {last?.reason ?? t.status_reason ?? 'No reason recorded.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={recover.isPending} onClick={() => void run(() => recover.mutateAsync({ action: 'retry_routing' }), 'Task reopened for routing. The previous contributor will not be offered it again.')}>
            Retry routing
          </button>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <label htmlFor="recover-contributor" className="label">Or choose a contributor</label>
          <div className="flex flex-wrap gap-2">
            <select id="recover-contributor" className="input max-w-xs" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Select…</option>
              {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn-secondary" disabled={!choice || recover.isPending} onClick={() => void run(() => recover.mutateAsync({ action: 'choose_contributor', contributor_id: Number(choice) }), 'Contributor assigned. They must accept.')}>
              Assign and request acceptance
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function eligibleFor(c: Contributor, t: TaskDetail): boolean {
  return c.availability !== 'unavailable' && c.expertise.includes(t.expertise.name);
}

function ManualAssignment({ task: t, onFlash }: { task: TaskDetail; onFlash: (f: Flash) => void }) {
  const intervene = useIntervene(t.id);
  const contributors = useContributors();
  const [contributorId, setContributorId] = useState('');
  const [reason, setReason] = useState('');
  const eligible = (contributors.data?.data ?? []).filter((c) => eligibleFor(c, t));

  return (
    <section id="manual-assignment" aria-labelledby="manual-heading" className="scroll-mt-6">
      <Card title="Manual assignment">
        <p className="mb-3 text-sm text-slate-600">
          A manual choice supersedes any pending routing request. The chosen contributor must still accept. Only contributors with the required expertise who are not unavailable are listed.
        </p>
        {contributors.isPending ? (
          <Loading label="Loading contributors…" />
        ) : eligible.length === 0 ? (
          <Empty title="No contributor matches this task" hint="Add expertise to a contributor in the directory, or cancel the task." />
        ) : (
          <form
            className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!contributorId) return onFlash({ kind: 'error', text: 'Choose a contributor.' });
              try {
                await intervene.mutateAsync({ action: 'assign', contributor_id: Number(contributorId), reason: reason.trim() || undefined });
                onFlash({ kind: 'success', text: 'Assigned manually. Any earlier routing result will be ignored.' });
                setContributorId('');
                setReason('');
              } catch (err) {
                onFlash({ kind: 'error', text: (err as Error).message });
              }
            }}
          >
            <div>
              <label htmlFor="manual-contributor" className="label">Contributor</label>
              <select id="manual-contributor" className="input" value={contributorId} onChange={(e) => setContributorId(e.target.value)}>
                <option value="">Select…</option>
                {eligible.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.active_assignment_count}/{c.max_active_assignments} active)</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="manual-reason" className="label">Reason <span className="font-normal text-slate-500">(optional)</span></label>
              <input id="manual-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary" disabled={intervene.isPending}>Assign</button>
          </form>
        )}
      </Card>
    </section>
  );
}

function HistoryCard({ task: t }: { task: TaskDetail }) {
  return (
    <section id="history" aria-labelledby="history-heading" className="scroll-mt-6">
      <Card title="Activity history">
        <h2 id="history-heading" className="sr-only">Activity history</h2>
        {t.history.length === 0 ? (
          <Empty title="No history yet" />
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {[...t.history].reverse().map((h) => (
              <li key={h.id} className="text-sm">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-blue-500" aria-hidden />
                <p className="font-medium text-slate-900">{EVENT_LABEL[h.event_type] ?? h.event_type}</p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(h.created_at)} · {h.actor_type}
                  {h.previous_state && h.new_state && <> · {STATUS_LABEL[h.previous_state as keyof typeof STATUS_LABEL] ?? h.previous_state} → {STATUS_LABEL[h.new_state as keyof typeof STATUS_LABEL] ?? h.new_state}</>}
                </p>
                <p className="mt-0.5 text-slate-700">{h.explanation}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}
