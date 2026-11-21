import { useState } from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Plus, Search, Users } from 'lucide-react'
import { useContributors, useExpertiseAreas, useSaveContributor } from '../api/hooks'
import { ApiError } from '../api/client'
import type { Contributor } from '../api/types'
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Spinner } from '../components/ui/primitives'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/Toast'
import { TASK_STATUS } from '../lib/status'

const contributorSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: z.string().trim().email('Enter a valid email'),
  availability: z.enum(['available', 'unavailable']),
  max_active_assignments: z.coerce.number<string | number>().int().min(1, 'At least 1').max(20, 'At most 20'),
  expertise_area_ids: z.array(z.string()).min(1, 'Choose at least one expertise area'),
})
type ContributorForm = z.input<typeof contributorSchema>
type ContributorParsed = z.output<typeof contributorSchema>

function ContributorDialog({ contributor, onClose }: { contributor: Contributor | 'new'; onClose: () => void }) {
  const toast = useToast()
  const { data: areas } = useExpertiseAreas()
  const save = useSaveContributor()
  const existing = contributor === 'new' ? null : contributor
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ContributorForm, unknown, ContributorParsed>({
    resolver: zodResolver(contributorSchema),
    defaultValues: {
      name: existing?.name ?? '',
      email: existing?.email ?? '',
      availability: existing?.availability ?? 'available',
      max_active_assignments: existing?.max_active_assignments ?? 3,
      expertise_area_ids: existing?.expertise_areas.map((e) => String(e.id)) ?? [],
    },
  })

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      { id: existing?.id, contributor: { ...v, expertise_area_ids: v.expertise_area_ids.map(Number) } },
      {
        onSuccess: (res) => {
          const warnings = res.meta?.warnings ?? []
          toast(
            warnings.length > 0
              ? { kind: 'info', title: 'Contributor updated — check their tasks', message: warnings.join('. ') + '. Reassign if needed.' }
              : { kind: 'success', title: existing ? 'Contributor updated' : 'Contributor added' },
          )
          onClose()
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            for (const [field, msgs] of Object.entries(err.fieldErrors)) {
              const key = field === 'expertise_areas' ? 'expertise_area_ids' : field
              if (key in contributorSchema.shape) setError(key as keyof ContributorForm, { message: msgs.join(', ') })
            }
          }
        },
      },
    ),
  )

  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'Add contributor'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={onSubmit}>Save</Button>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {save.error && !(save.error instanceof ApiError && save.error.code === 'validation_failed') && <ErrorBanner error={save.error} />}
        <Field label="Name" htmlFor="c-name" required error={errors.name?.message}>
          <Input id="c-name" {...register('name')} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="c-email" required error={errors.email?.message}>
          <Input id="c-email" type="email" {...register('email')} aria-invalid={!!errors.email} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Availability" htmlFor="c-availability">
            <Select id="c-availability" {...register('availability')}>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </Select>
          </Field>
          <Field label="Max active assignments" htmlFor="c-capacity" error={errors.max_active_assignments?.message} hint="Offers count toward capacity.">
            <Input id="c-capacity" type="number" min={1} max={20} {...register('max_active_assignments')} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Expertise <span className="text-red-600">*</span></legend>
          <div className="grid grid-cols-2 gap-1.5">
            {areas?.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" value={String(a.id)} {...register('expertise_area_ids')} className="accent-blue-600" />
                {a.name}
              </label>
            ))}
          </div>
          {errors.expertise_area_ids && <p role="alert" className="mt-1.5 text-xs text-red-600">{errors.expertise_area_ids.message}</p>}
        </fieldset>
      </form>
    </Dialog>
  )
}

export function ContributorsPage() {
  const [q, setQ] = useState('')
  const [expertise, setExpertise] = useState('')
  const [availability, setAvailability] = useState('')
  const [editing, setEditing] = useState<Contributor | 'new' | null>(null)
  const { data: areas } = useExpertiseAreas()
  const { data, isLoading, error, refetch } = useContributors({ q, expertise_id: expertise, availability })

  return (
    <>
      <PageHeader
        title="Contributors"
        description="Who can take work, their expertise, and current load."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add contributor</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
          <Input aria-label="Search contributors" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Expertise" value={expertise} onChange={(e) => setExpertise(e.target.value)} className="w-auto">
          <option value="">Any expertise</option>
          {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select aria-label="Availability" value={availability} onChange={(e) => setAvailability(e.target.value)} className="w-auto">
          <option value="">Any availability</option>
          <option value="available">Available</option>
          <option value="unavailable">Unavailable</option>
        </Select>
      </div>

      {error ? (
        <ErrorBanner error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Spinner />
      ) : !data || data.data.length === 0 ? (
        <Card><EmptyState icon={<Users className="size-6" />} title="No contributors found" /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.data.map((c) => {
            const load = c.active_assignment_count / c.max_active_assignments
            return (
              <Card key={c.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="truncate text-xs text-slate-500">{c.email}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge tone={c.availability === 'available' ? 'green' : 'gray'} dot>{c.availability === 'available' ? 'Available' : 'Unavailable'}</Badge>
                    <button type="button" onClick={() => setEditing(c)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label={`Edit ${c.name}`}>
                      <Pencil className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {c.expertise_areas.map((e) => <Badge key={e.id} tone="blue">{e.name}</Badge>)}
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Active assignments</span>
                    <span className="tabular-nums">{c.active_assignment_count} / {c.max_active_assignments}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800" role="meter" aria-valuemin={0} aria-valuemax={c.max_active_assignments} aria-valuenow={c.active_assignment_count} aria-label={`${c.name} load`}>
                    <div className={load >= 1 ? 'h-full rounded-full bg-amber-500' : 'h-full rounded-full bg-blue-500'} style={{ width: `${Math.min(100, load * 100)}%` }} />
                  </div>
                </div>
                <ul className="mt-3 space-y-1 text-xs">
                  {c.active_assignments.length === 0 && <li className="text-slate-400">No active tasks</li>}
                  {c.active_assignments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <Link to={`/tasks/${a.task.id}`} className="truncate text-blue-700 hover:underline dark:text-blue-400">#{a.task.id} {a.task.title}</Link>
                      <span className="shrink-0 text-slate-500">{a.status === 'offered' ? 'offered' : TASK_STATUS[a.task.status].label.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}

      {editing && <ContributorDialog contributor={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
