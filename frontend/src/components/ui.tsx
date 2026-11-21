import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { STATUS_LABEL, PRIORITY_LABEL, formatDuration } from '../lib/format';
import type { Priority, TaskStatus } from '../api/types';
import { ApiError } from '../api/client';

const STATUS_STYLE: Record<TaskStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-300',
  routing_pending: 'bg-blue-50 text-blue-800 ring-blue-300',
  awaiting_acceptance: 'bg-amber-50 text-amber-800 ring-amber-300',
  assigned: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  in_progress: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  completed: 'bg-slate-100 text-slate-600 ring-slate-300',
  declined: 'bg-red-50 text-red-700 ring-red-300',
  assignment_failed: 'bg-red-50 text-red-700 ring-red-300',
  needs_intervention: 'bg-amber-50 text-amber-800 ring-amber-300',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-300',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span data-testid="status-badge" data-status={status} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  low: 'bg-slate-50 text-slate-600 ring-slate-200',
  medium: 'bg-sky-50 text-sky-700 ring-sky-200',
  high: 'bg-orange-50 text-orange-700 ring-orange-200',
  urgent: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${PRIORITY_STYLE[priority]}`}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/**
 * Elapsed time that ticks every second. Re-syncs whenever the server reports a new value,
 * so the display never drifts far from the database.
 */
export function ElapsedTime({ seconds, label = 'Waiting' }: { seconds: number | null | undefined; label?: string }) {
  // Anchor = server value plus the local time it was received. Re-anchored on every server update.
  const [anchor, setAnchor] = useState(() => ({ base: seconds ?? 0, at: Date.now() }));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setAnchor({ base: seconds ?? 0, at: Date.now() });
  }, [seconds]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (seconds == null) return <span>—</span>;
  const elapsed = anchor.base + Math.floor((now - anchor.at) / 1000);
  return (
    <span className="tabular-nums" aria-label={`${label} ${formatDuration(elapsed)}`}>
      {formatDuration(elapsed)}
    </span>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 p-8 text-center">
      <Inbox className="h-8 w-8 text-slate-400" aria-hidden />
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

function hasFieldErrors(d: unknown): d is { fields: Array<{ field: string; message: string }> } {
  return typeof d === 'object' && d !== null && Array.isArray((d as { fields?: unknown }).fields);
}

/** Describes an API failure in operator language and offers a retry when that is useful. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const isApi = error instanceof ApiError;
  const message = isApi
    ? error.retryable
      ? 'The server could not complete this request. Your data was not changed. Try again.'
      : error.message
    : 'Something went wrong.';
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">
        <p>{message}</p>
        {isApi && hasFieldErrors(error.details) && (
          <ul className="mt-1 list-disc pl-5">
            {error.details.fields.map((f) => (
              <li key={f.field + f.message}>{f.message}</li>
            ))}
          </ul>
        )}
      </div>
      {onRetry && (!isApi || error.retryable) && (
        <button type="button" onClick={onRetry} className="btn-secondary">
          Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ kind, children }: { kind: 'success' | 'error' | 'info'; children: ReactNode }) {
  const style = kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-800';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${style}`}>
      {children}
    </div>
  );
}
