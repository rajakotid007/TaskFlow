import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useContributorMutation, useContributors, useExpertise } from '../api/hooks';
import { Card, Empty, ErrorState, Loading, Notice } from '../components/ui';
import { STATUS_LABEL } from '../lib/format';
import type { Contributor } from '../api/types';

const AVAIL_STYLE: Record<Contributor['availability'], string> = {
  available: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  limited: 'bg-amber-50 text-amber-800 ring-amber-300',
  unavailable: 'bg-slate-100 text-slate-600 ring-slate-300',
};

export function ContributorsPage() {
  const list = useContributors();
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contributors</h1>
          <p className="text-sm text-slate-500">Expertise, availability, and current load. Routing only offers work to contributors who are not unavailable and below capacity.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>{showForm ? 'Close form' : 'Add contributor'}</button>
      </header>

      {notice && <Notice kind="success">{notice}</Notice>}
      {showForm && <NewContributor onCreated={(name) => { setNotice(`${name} added.`); setShowForm(false); }} />}

      {list.isPending ? (
        <Loading label="Loading contributors…" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <Empty title="No contributors yet" hint="Add contributors so routing has someone to offer tasks to." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.data.data.map((c) => <ContributorCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

function ContributorCard({ c }: { c: Contributor }) {
  const update = useContributorMutation(c.id);
  const [error, setError] = useState<string | null>(null);
  const full = c.active_assignment_count >= c.max_active_assignments;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">{c.name}</h2>
          <p className="truncate text-sm text-slate-500">{c.email}</p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Availability for {c.name}</span>
          <select
            className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${AVAIL_STYLE[c.availability]}`}
            value={c.availability}
            disabled={update.isPending}
            onChange={async (e) => {
              setError(null);
              try {
                await update.mutateAsync({ availability: e.target.value as Contributor['availability'] });
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <option value="available">Available</option>
            <option value="limited">Limited</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {c.expertise.map((e) => (
          <span key={e} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{e}</span>
        ))}
      </div>
      <p className={`mt-3 text-sm ${full ? 'text-amber-800' : 'text-slate-600'}`}>
        Active assignments: <span className="font-medium tabular-nums">{c.active_assignment_count}</span> / {c.max_active_assignments}
        {full && ' · at capacity'}
      </p>
      {c.assigned_tasks.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-sm">
          {c.assigned_tasks.map((t) => (
            <li key={`${t.task_id}-${t.assignment_status}`} className="flex justify-between gap-2">
              <Link to={`/tasks/${t.task_id}`} className="truncate text-blue-700 hover:underline">{t.title}</Link>
              <span className="shrink-0 text-xs text-slate-500">{t.assignment_status === 'proposed' ? 'Awaiting acceptance' : STATUS_LABEL[t.task_status]}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}

function NewContributor({ onCreated }: { onCreated: (name: string) => void }) {
  const expertise = useExpertise();
  const create = useContributorMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [areas, setAreas] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (expertise.isPending) return <Loading />;
  return (
    <Card title="New contributor">
      <form
        className="grid gap-4 md:grid-cols-2"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!name.trim()) return setError('Enter a name.');
          if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
          if (areas.length === 0) return setError('Choose at least one expertise area.');
          try {
            await create.mutateAsync({ name: name.trim(), email: email.trim(), expertise_ids: areas });
            onCreated(name.trim());
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div>
          <label htmlFor="c-name" className="label">Name</label>
          <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="c-email" className="label">Email</label>
          <input id="c-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <fieldset className="md:col-span-2">
          <legend className="label">Expertise areas</legend>
          <div className="flex flex-wrap gap-2">
            {(expertise.data?.data ?? []).map((x) => (
              <label key={x.id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={areas.includes(x.id)}
                  onChange={(e) => setAreas((prev) => (e.target.checked ? [...prev, x.id] : prev.filter((i) => i !== x.id)))}
                />
                {x.name}
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700 md:col-span-2">{error}</p>}
        <div className="md:col-span-2">
          <button type="submit" className="btn-primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save contributor'}</button>
        </div>
      </form>
    </Card>
  );
}
