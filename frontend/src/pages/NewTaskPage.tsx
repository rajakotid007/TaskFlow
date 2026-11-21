import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router'
import { Save, Send } from 'lucide-react'
import { useCreateTask, useExpertiseAreas } from '../api/hooks'
import { ApiError } from '../api/client'
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Textarea } from '../components/ui/primitives'
import { useToast } from '../components/ui/Toast'
import { localDateString } from '../lib/format'

/**
 * Shared by create and edit. "Today" is the operator's local date (not UTC).
 * When editing, a due date that has since passed may be kept unchanged.
 */
export function makeTaskSchema(keepDueDate?: string | null) {
  return z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200, 'Title must be 200 characters or fewer'),
    description: z.string().max(5000, 'Description must be 5000 characters or fewer').optional(),
    required_expertise_id: z.string().min(1, 'Choose the expertise this task needs'),
    priority: z.enum(['low', 'medium', 'high', 'urgent'], { message: 'Choose a priority' }),
    due_date: z
      .string()
      .optional()
      .refine((v) => !v || v === keepDueDate || v >= localDateString(), 'Due date cannot be in the past'),
  })
}

export const taskSchema = makeTaskSchema()

export type TaskFormValues = z.infer<typeof taskSchema>

export function NewTaskPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: areas, error: areasError } = useExpertiseAreas()
  const create = useCreateTask()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: '', description: '', required_expertise_id: '', priority: 'medium', due_date: '' },
  })

  const submit = (route: boolean) =>
    handleSubmit((values) => {
      create.mutate(
        {
          task: {
            title: values.title,
            description: values.description || undefined,
            required_expertise_id: Number(values.required_expertise_id),
            priority: values.priority,
            due_date: values.due_date || null,
          },
          submit: route,
        },
        {
          onSuccess: (task) => {
            toast({
              kind: 'success',
              title: route ? 'Task created and sent for routing' : 'Draft saved',
              message: route ? 'Waiting for the routing engine to propose a contributor.' : 'Submit it for routing when ready.',
            })
            navigate(`/tasks/${task.id}`)
          },
          onError: (err) => {
            if (err instanceof ApiError) {
              const fields = err.fieldErrors
              for (const [field, msgs] of Object.entries(fields)) {
                const key = field === 'required_expertise' ? 'required_expertise_id' : field
                if (key in taskSchema.shape) setError(key as keyof TaskFormValues, { message: msgs.join(', ') })
              }
            }
          },
        },
      )
    })

  const err = (k: keyof TaskFormValues) => errors[k]?.message

  return (
    <>
      <PageHeader title="Create task" description="Describe the work and the expertise it needs. Routing finds a matching contributor." />
      <Card className="max-w-2xl">
        <form noValidate onSubmit={submit(true)} className="space-y-5 p-5">
          {create.error && <ErrorBanner error={create.error} />}
          {areasError && <ErrorBanner error={areasError} />}

          <Field label="Title" htmlFor="title" required error={err('title')}>
            <Input id="title" {...register('title')} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'title-error' : undefined} placeholder="e.g. Fix N+1 query on invoices page" />
          </Field>

          <Field label="Description" htmlFor="description" error={err('description')} hint="Context that helps the contributor decide.">
            <Textarea id="description" {...register('description')} aria-invalid={!!errors.description} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Required expertise" htmlFor="required_expertise_id" required error={err('required_expertise_id')}>
              <Select id="required_expertise_id" {...register('required_expertise_id')} aria-invalid={!!errors.required_expertise_id}>
                <option value="">Select expertise…</option>
                {areas?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.contributor_count} contributor{a.contributor_count === 1 ? '' : 's'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="priority" required error={err('priority')}>
              <Select id="priority" {...register('priority')} aria-invalid={!!errors.priority}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
          </div>

          <Field label="Due date" htmlFor="due_date" error={err('due_date')}>
            <Input id="due_date" type="date" {...register('due_date')} aria-invalid={!!errors.due_date} className="sm:w-56" />
          </Field>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-5 dark:border-slate-800">
            <Button icon={<Save className="size-4" />} onClick={submit(false)} disabled={create.isPending}>
              Save draft
            </Button>
            <Button type="submit" variant="primary" icon={<Send className="size-4" />} loading={create.isPending}>
              Create &amp; submit for routing
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}
