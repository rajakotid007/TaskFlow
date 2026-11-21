import { useState } from 'react'
import { Ban, CheckCheck, CheckCircle2, Pencil, Play, RefreshCw, RotateCcw, Send, Undo2, UserCheck, XCircle } from 'lucide-react'
import { Button } from './ui/primitives'
import { Dialog } from './ui/Dialog'
import { Field, Textarea } from './ui/primitives'
import { useToast } from './ui/Toast'
import { ManualAssignDialog } from './ManualAssignDialog'
import { EditTaskDialog } from './EditTaskDialog'
import { useTaskCommand, type TaskCommand } from '../api/hooks'
import { ApiError } from '../api/client'
import type { Task, TaskAction, TaskDetail } from '../api/types'

// Each dialog remembers the task version (and, for a decline, the offer) as
// they were when it opened. If the task changes while the operator reads the
// dialog, the API answers 409 instead of applying an action to a state the
// operator never saw.
type ReasonDialog = { kind: 'decline' | 'release' | 'cancel' | 'restart'; seenVersion: number; assignmentId?: number } | null

const isDetail = (task: Task): task is TaskDetail => 'assignments' in task

const SUCCESS: Partial<Record<TaskCommand['kind'], string>> = {
  route: 'Routing request sent',
  intervene: 'Contributor assigned',
  recover: 'Recovery started',
  start: 'Work started',
  complete: 'Task completed',
  cancel: 'Task cancelled',
  accept: 'Assignment accepted',
  decline: 'Assignment declined',
  update: 'Task updated',
}

/**
 * Operator controls for a task. Which buttons appear comes from the API's
 * available_actions; the API re-checks every rule when the command arrives.
 */
export function TaskActions({ task, compact = false }: { task: Task; compact?: boolean }) {
  const toast = useToast()
  const command = useTaskCommand(task.id, task.version)
  const [assignVersion, setAssignVersion] = useState<number | null>(null)
  const [editVersion, setEditVersion] = useState<number | null>(null)
  const [reasonDialog, setReasonDialog] = useState<ReasonDialog>(null)
  const [reason, setReason] = useState('')
  const has = (a: TaskAction) => task.available_actions.includes(a)
  const busy = command.isPending
  const size = compact ? 'sm' : 'md'
  const offerId = task.current_assignment?.status === 'offered' ? task.current_assignment.id : null

  const openReason = (kind: NonNullable<ReasonDialog>['kind']) =>
    setReasonDialog({ kind, seenVersion: task.version, assignmentId: kind === 'decline' ? offerId ?? undefined : undefined })

  const run = (cmd: TaskCommand, after?: () => void, seenVersion?: number) =>
    command.mutate({ cmd, seenVersion }, {
      onSuccess: (res) => {
        const changed = res.meta?.changed !== false
        toast({
          kind: changed ? 'success' : 'info',
          title: changed ? (SUCCESS[cmd.kind] ?? 'Done') : 'No change needed',
          message: changed ? undefined : 'The task was already in that state.',
        })
        after?.()
      },
      onError: (err) => {
        const stale = err instanceof ApiError && (err.code === 'stale_version' || err.code === 'concurrent_modification')
        toast({
          kind: 'error',
          title: stale ? 'Task changed before your action' : 'Action failed',
          message: stale ? `${err.message} The view has been refreshed.` : err.message,
        })
        // The dialog described a state that no longer exists; reopening it
        // shows the current one.
        if (stale) after?.()
      },
    })

  const closeReason = () => {
    setReasonDialog(null)
    setReason('')
  }

  const confirmReason = () => {
    if (!reasonDialog) return
    const r = reason.trim() || undefined
    const v = reasonDialog.seenVersion
    switch (reasonDialog.kind) {
      case 'decline':
        // Sent even if the offer has since been withdrawn: the API then
        // explains why it can no longer be declined.
        if (reasonDialog.assignmentId) run({ kind: 'decline', assignment_id: reasonDialog.assignmentId, reason: r }, closeReason)
        break
      case 'release':
        run({ kind: 'recover', recovery_action: 'release', reason: r }, closeReason, v)
        break
      case 'cancel':
        run({ kind: 'cancel', reason: r }, closeReason, v)
        break
      case 'restart':
        run({ kind: 'route', mode: 'restart' }, closeReason, v)
        break
    }
  }

  const reasonCopy = {
    decline: {
      title: 'Record decline',
      description: `Record that ${task.current_assignment?.contributor.name ?? 'the contributor'} declined. The task will need recovery.`,
      label: 'Reason given',
      cta: 'Record decline',
    },
    release: {
      title: 'Release assignment',
      description:
        task.status === 'in_progress'
          ? 'Use when the contributor cannot finish (for example, they are ill or left). The contributor is freed and the task can be re-routed — skipping them — or assigned to someone else.'
          : 'Use when the assignment fell through before work began. The contributor is freed and the task can be re-routed — skipping them — or assigned to someone else.',
      label: 'What happened?',
      cta: 'Release',
    },
    cancel: { title: 'Cancel task', description: 'Any outstanding routing request is superseded and any assignment withdrawn. This cannot be undone.', label: 'Reason (optional)', cta: 'Cancel task' },
    restart: {
      title: 'Restart routing',
      description:
        task.status === 'awaiting_acceptance'
          ? 'The open offer will be withdrawn and a new routing request sent.'
          : 'The outstanding request will be superseded and a new one sent. If the old request returns later, its result will be ignored.',
      label: null,
      cta: 'Restart routing',
    },
  } as const

  const current = reasonDialog ? reasonCopy[reasonDialog.kind] : null

  return (
    <div className={compact ? 'flex flex-nowrap items-center gap-1.5' : 'flex flex-wrap items-center gap-2'}>
      {has('submit_routing') && (
        <Button size={size} variant="primary" icon={<Send className="size-4" />} loading={busy} onClick={() => run({ kind: 'route', mode: 'submit' })}>
          {compact ? 'Route' : 'Submit for routing'}
        </Button>
      )}
      {has('retry_routing') && (
        <Button size={size} variant="primary" icon={<RotateCcw className="size-4" />} loading={busy} onClick={() => run({ kind: 'recover', recovery_action: 'retry_routing' })}>
          {compact ? 'Retry' : 'Retry routing'}
        </Button>
      )}
      {has('accept_offer') && offerId && (
        <Button size={size} variant="success" icon={<CheckCircle2 className="size-4" />} loading={busy} onClick={() => run({ kind: 'accept', assignment_id: offerId })}>
          {compact ? 'Accept' : 'Record acceptance'}
        </Button>
      )}
      {has('decline_offer') && offerId && (
        <Button
          size={size}
          icon={<XCircle className="size-4" />}
          disabled={busy}
          onClick={() => openReason('decline')}
          aria-label="Record decline"
          title={compact ? 'Record decline' : undefined}
        >
          {!compact && 'Record decline'}
        </Button>
      )}
      {has('assign_manually') && (
        <Button
          size={size}
          icon={<UserCheck className="size-4" />}
          disabled={busy}
          onClick={() => setAssignVersion(task.version)}
          aria-label={task.status === 'assigned' ? 'Reassign' : 'Assign manually'}
          title={compact ? (task.status === 'assigned' ? 'Reassign' : 'Assign manually') : undefined}
        >
          {(!compact || task.status === 'assigned' || task.status === 'routing_pending') && (task.status === 'assigned' ? 'Reassign' : compact ? 'Assign' : 'Assign manually')}
        </Button>
      )}
      {!compact && has('restart_routing') && (
        <Button size={size} icon={<RefreshCw className="size-4" />} disabled={busy} onClick={() => openReason('restart')}>
          Restart routing
        </Button>
      )}
      {has('start_work') && !compact && (
        <Button size={size} variant={compact ? 'secondary' : 'primary'} icon={<Play className="size-4" />} loading={busy} onClick={() => run({ kind: 'start' })}>
          Start work
        </Button>
      )}
      {!compact && has('release') && (
        <Button size={size} icon={<Undo2 className="size-4" />} disabled={busy} onClick={() => openReason('release')}>
          Release assignment
        </Button>
      )}
      {has('complete') && !compact && (
        <Button size={size} variant={compact ? 'secondary' : 'success'} icon={<CheckCheck className="size-4" />} loading={busy} onClick={() => run({ kind: 'complete' })}>
          Complete
        </Button>
      )}
      {!compact && has('edit') && isDetail(task) && (
        <Button size={size} variant="ghost" icon={<Pencil className="size-4" />} disabled={busy} onClick={() => setEditVersion(task.version)}>
          Edit details
        </Button>
      )}
      {!compact && has('cancel') && (
        <Button size={size} variant="ghost" icon={<Ban className="size-4" />} disabled={busy} onClick={() => openReason('cancel')}>
          Cancel task
        </Button>
      )}

      {assignVersion !== null && (
        <ManualAssignDialog
          task={task}
          open
          onClose={() => setAssignVersion(null)}
          submitting={busy}
          onConfirm={(contributor_id, note) =>
            run({ kind: 'intervene', contributor_id, note: note || undefined }, () => setAssignVersion(null), assignVersion)}
        />
      )}

      {editVersion !== null && isDetail(task) && (
        <EditTaskDialog
          task={task}
          onClose={() => { command.reset(); setEditVersion(null) }}
          submitting={busy}
          error={command.error}
          onSave={(changes) => run({ kind: 'update', task: changes }, () => setEditVersion(null), editVersion)}
        />
      )}

      <Dialog
        open={!!reasonDialog}
        onClose={closeReason}
        title={current?.title ?? ''}
        description={current?.description}
        footer={
          <>
            <Button variant="ghost" onClick={closeReason}>Back</Button>
            <Button variant={reasonDialog?.kind === 'cancel' || reasonDialog?.kind === 'decline' ? 'danger' : 'primary'} loading={busy} onClick={confirmReason}>
              {current?.cta}
            </Button>
          </>
        }
      >
        {current?.label && (
          <Field label={current.label} htmlFor="action-reason">
            <Textarea id="action-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" />
          </Field>
        )}
      </Dialog>
    </div>
  )
}
