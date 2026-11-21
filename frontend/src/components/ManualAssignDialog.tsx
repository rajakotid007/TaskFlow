import { useState } from 'react'
import clsx from 'clsx'
import { UserCheck } from 'lucide-react'
import { Dialog } from './ui/Dialog'
import { Badge, Button, Field, Spinner, Textarea } from './ui/primitives'
import { useEligibleContributors } from '../api/hooks'
import type { Task } from '../api/types'

export function ManualAssignDialog({ task, open, onClose, onConfirm, submitting }: {
  task: Task
  open: boolean
  onClose: () => void
  onConfirm: (contributorId: number, note: string) => void
  submitting: boolean
}) {
  const { data, isLoading, error } = useEligibleContributors(task.id, open)
  const [selected, setSelected] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const consequence =
    task.status === 'routing_pending'
      ? 'The outstanding routing request will be superseded. If it returns later, its result will be recorded and ignored.'
      : task.status === 'awaiting_acceptance'
        ? 'The open offer will be withdrawn.'
        : task.status === 'assigned'
          ? 'The current assignee will be replaced.'
          : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign manually"
      description={<>Choose a contributor with <strong>{task.required_expertise.name}</strong> expertise for “{task.title}”.</>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<UserCheck className="size-4" />}
            disabled={selected === null}
            loading={submitting}
            onClick={() => selected !== null && onConfirm(selected, note)}
          >
            Assign
          </Button>
        </>
      }
    >
      {consequence && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{consequence}</p>
      )}
      {isLoading && <Spinner label="Loading contributors…" />}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">Nobody has {task.required_expertise.name} expertise yet. Add a contributor in the directory.</p>
      )}
      <fieldset className="space-y-2">
        <legend className="sr-only">Contributor</legend>
        {data?.map((c) => (
          <label
            key={c.id}
            className={clsx(
              'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
              c.eligible ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60' : 'cursor-not-allowed opacity-60',
              selected === c.id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700',
            )}
          >
            <input
              type="radio"
              name="contributor"
              value={c.id}
              disabled={!c.eligible}
              checked={selected === c.id}
              onChange={() => setSelected(c.id)}
              className="accent-blue-600"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                {c.previously_declined && <Badge tone="red">Declined before</Badge>}
                {c.previously_released && <Badge tone="amber">Released before</Badge>}
                {task.current_assignment?.contributor.id === c.id && <Badge tone="green">Current</Badge>}
              </div>
              <p className="text-xs text-slate-500">
                {c.eligible ? `${c.active_assignment_count}/${c.max_active_assignments} active assignments` : c.ineligible_reason}
              </p>
            </div>
          </label>
        ))}
      </fieldset>
      <div className="mt-4">
        <Field label="Note (optional)" htmlFor="assign-note" hint="Recorded in the task history.">
          <Textarea id="assign-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" placeholder="Why this contributor?" />
        </Field>
      </div>
    </Dialog>
  )
}
