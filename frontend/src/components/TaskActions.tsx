import { useState } from 'react'
import { Ban, CheckCheck, CheckCircle2, Play, RefreshCw, RotateCcw, Send, Undo2, UserCheck, XCircle } from 'lucide-react'
import { Button } from './ui/primitives'
import { Dialog } from './ui/Dialog'
import { Field, Textarea } from './ui/primitives'
import { useToast } from './ui/Toast'
import { ManualAssignDialog } from './ManualAssignDialog'
import { useTaskCommand, type TaskCommand } from '../api/hooks'
import { ApiError } from '../api/client'
import type { Task, TaskAction } from '../api/types'

type ReasonDialog = { kind: 'decline' | 'release' | 'cancel' | 'restart' } | null

const SUCCESS: Partial<Record<TaskCommand['kind'], string>> = {
  route: 'Routing request sent',
  intervene: 'Contributor assigned',
  recover: 'Recovery started',
  start: 'Work started',
  complete: 'Task completed',
  cancel: 'Task cancelled',
  accept: 'Assignment accepted',
  decline: 'Assignment declined',
}

/**
 * Operator controls for a task. Which buttons appear comes from the API's
 * available_actions; the API re-checks every rule when the command arrives.
 */
export function TaskActions({ task, compact = false }: { task: Task; compact?: boolean }) {
  const toast = useToast()
  const command = useTaskCommand(task.id, task.version)
  const [assignOpen, setAssignOpen] = useState(false)
  const [reasonDialog, setReasonDialog] = useState<ReasonDialog>(null)
  const [reason, setReason] = useState('')
  const has = (a: TaskAction) => task.available_actions.includes(a)
  const busy = command.isPending
  const size = compact ? 'sm' : 'md'
  const offerId = task.current_assignment?.status === 'offered' ? task.current_assignment.id : null

  const run = (cmd: TaskCommand, after?: () => void) =>
    command.mutate(cmd, {
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
      },
    })

  const closeReason = () => {
    setReasonDialog(null)
    setReason('')
  }

  const confirmReason = () => {
    if (!reasonDialog) return
    const r = reason.trim() || undefined
    switch (reasonDialog.kind) {
      case 'decline':
        if (offerId) run({ kind: 'decline', assignment_id: offerId, reason: r }, closeReason)
        break
      case 'release':
        run({ kind: 'recover', recovery_action: 'release', reason: r }, closeReason)
        break
      case 'cancel':
        run({ kind: 'cancel', reason: r }, closeReason)
        break
      case 'restart':
        run({ kind: 'route', mode: 'restart' }, closeReason)
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
      description: 'Use when the assignment fell through before work began. The contributor is freed and the task can be re-routed or assigned to someone else.',
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
          onClick={() => setReasonDialog({ kind: 'decline' })}
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
          onClick={() => setAssignOpen(true)}
          aria-label={task.status === 'assigned' ? 'Reassign' : 'Assign manually'}
          title={compact ? (task.status === 'assigned' ? 'Reassign' : 'Assign manually') : undefined}
        >
          {(!compact || task.status === 'assigned' || task.status === 'routing_pending') && (task.status === 'assigned' ? 'Reassign' : compact ? 'Assign' : 'Assign manually')}
        </Button>
      )}
      {!compact && has('restart_routing') && (
        <Button size={size} icon={<RefreshCw className="size-4" />} disabled={busy} onClick={() => setReasonDialog({ kind: 'restart' })}>
          Restart routing
        </Button>
      )}
      {has('start_work') && !compact && (
        <Button size={size} variant={compact ? 'secondary' : 'primary'} icon={<Play className="size-4" />} loading={busy} onClick={() => run({ kind: 'start' })}>
          Start work
        </Button>
      )}
      {!compact && has('release') && (
        <Button size={size} icon={<Undo2 className="size-4" />} disabled={busy} onClick={() => setReasonDialog({ kind: 'release' })}>
          Release assignment
        </Button>
      )}
      {has('complete') && !compact && (
        <Button size={size} variant={compact ? 'secondary' : 'success'} icon={<CheckCheck className="size-4" />} loading={busy} onClick={() => run({ kind: 'complete' })}>
          Complete
        </Button>
      )}
      {!compact && has('cancel') && (
        <Button size={size} variant="ghost" icon={<Ban className="size-4" />} disabled={busy} onClick={() => setReasonDialog({ kind: 'cancel' })}>
          Cancel task
        </Button>
      )}

      {assignOpen && (
        <ManualAssignDialog
          task={task}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          submitting={busy}
          onConfirm={(contributor_id, note) => run({ kind: 'intervene', contributor_id, note: note || undefined }, () => setAssignOpen(false))}
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
