import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog } from './ui/Dialog'
import { Button, ErrorBanner, Field, Input, Select, Textarea } from './ui/primitives'
import { useExpertiseAreas, type TaskInput } from '../api/hooks'
import { ApiError } from '../api/client'
import { makeTaskSchema, type TaskFormValues } from '../pages/NewTaskPage'
import type { TaskDetail } from '../api/types'

/**
 * Edits a task's details. Only changed fields are sent. Required expertise is
 * locked while a routing request or assignment depends on it.
 */
export function EditTaskDialog({ task, onClose, onSave, submitting, error }: {
  task: TaskDetail
  onClose: () => void
  onSave: (changes: Partial<TaskInput>) => void
  submitting: boolean
  error: unknown
}) {
  const { data: areas } = useExpertiseAreas()
  const schema = makeTaskSchema(task.due_date)
  const initial: TaskFormValues = {
    title: task.title,
    description: task.description ?? '',
    required_expertise_id: String(task.required_expertise.id),
    priority: task.priority,
    due_date: task.due_date ?? '',
  }
  const { register, handleSubmit, formState: { errors } } = useForm<TaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  })
  const expertiseEditable = task.expertise_editable ?? false
  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {}
  const err = (k: keyof TaskFormValues) => errors[k]?.message ?? fieldErrors[k]?.join(', ')

  const submit = handleSubmit((v) => {
    const changes: Partial<TaskInput> = {}
    if (v.title.trim() !== initial.title) changes.title = v.title.trim()
    if ((v.description ?? '') !== initial.description) changes.description = v.description ?? ''
    if (v.priority !== initial.priority) changes.priority = v.priority
    if ((v.due_date ?? '') !== initial.due_date) changes.due_date = v.due_date || null
    if (expertiseEditable && v.required_expertise_id !== initial.required_expertise_id) {
      changes.required_expertise_id = Number(v.required_expertise_id)
    }
    if (Object.keys(changes).length === 0) onClose()
    else onSave(changes)
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit task"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={submitting} onClick={submit}>Save changes</Button>
        </>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-4">
        {error != null && !(error instanceof ApiError && error.code === 'validation_failed') && <ErrorBanner error={error} />}
        <Field label="Title" htmlFor="edit-title" required error={err('title')}>
          <Input id="edit-title" {...register('title')} aria-invalid={!!err('title')} />
        </Field>
        <Field label="Description" htmlFor="edit-description" error={err('description')}>
          <Textarea id="edit-description" {...register('description')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Required expertise"
            htmlFor="edit-expertise"
            error={err('required_expertise_id')}
            hint={expertiseEditable ? undefined : 'Locked while routing or an assignment depends on it.'}
          >
            <Select id="edit-expertise" {...register('required_expertise_id')} disabled={!expertiseEditable}>
              {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>) ?? (
                <option value={initial.required_expertise_id}>{task.required_expertise.name}</option>
              )}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="edit-priority" error={err('priority')}>
            <Select id="edit-priority" {...register('priority')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
        <Field label="Due date" htmlFor="edit-due" error={err('due_date')}>
          <Input id="edit-due" type="date" {...register('due_date')} className="sm:w-56" />
        </Field>
      </form>
    </Dialog>
  )
}
