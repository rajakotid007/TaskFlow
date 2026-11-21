import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useCreateTask, useExpertise, useSimulationStatus } from '../api/hooks';
import { ErrorState, Loading, Notice } from '../components/ui';
import { PRIORITY_LABEL } from '../lib/format';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const schema = z.object({
  title: z.string().trim().min(1, 'Enter a task title.').max(200, 'Keep the title to 200 characters or fewer.'),
  description: z.string().max(5000, 'Keep the description to 5,000 characters or fewer.'),
  required_expertise_id: z.coerce.number({ invalid_type_error: 'Choose the required expertise.' }).int().positive('Choose the required expertise.'),
  priority: z.enum(['low', 'medium', 'high', 'urgent'], { errorMap: () => ({ message: 'Choose a priority.' }) }),
  due_date: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date.')
    .refine((v) => !v || v >= todayIso(), 'The due date cannot be in the past.'),
  simulation: z.enum(['normal', 'success', 'delayed', 'never']).default('normal'),
});

type FormValues = z.input<typeof schema>;

export function CreateTaskPage() {
  const navigate = useNavigate();
  const expertise = useExpertise();
  const sim = useSimulationStatus();
  const create = useCreateTask();
  const intent = useRef<'draft' | 'submit'>('submit');
  const showSimulation = import.meta.env.DEV && sim.data?.controls_enabled;

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', description: '', required_expertise_id: '' as unknown as number, priority: 'medium', due_date: '', simulation: 'normal' },
  });

  const onValid = async (values: FormValues) => {
    const parsed = schema.parse(values);
    const simulation = parsed.simulation === 'normal' ? undefined : parsed.simulation;
    try {
      const task = await create.mutateAsync({
        title: parsed.title,
        description: parsed.description,
        required_expertise_id: parsed.required_expertise_id,
        priority: parsed.priority,
        due_date: parsed.due_date || null,
        submit: intent.current === 'submit',
        ...(showSimulation && simulation ? { simulation } : {}),
      });
      navigate(`/tasks/${task.id}`, {
        state: { flash: intent.current === 'submit' ? 'Task created and submitted for routing.' : 'Draft saved. It has not been routed.' },
      });
    } catch {
      /* error shown below */
    }
  };

  if (expertise.isPending) return <Loading />;
  if (expertise.error) return <ErrorState error={expertise.error} onRetry={() => void expertise.refetch()} />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Create task</h1>
        <p className="text-sm text-slate-500">Save a draft, or create the task and submit it for automatic routing.</p>
      </header>

      {create.error && <ErrorState error={create.error} />}

      <form
        noValidate
        onSubmit={handleSubmit(onValid)}
        className="card space-y-5 p-6"
        aria-label="New task"
      >
        <div>
          <label htmlFor="title" className="label">Task title <span aria-hidden className="text-red-600">*</span></label>
          <input id="title" className="input" aria-invalid={!!errors.title} aria-describedby={errors.title ? 'title-error' : undefined} {...register('title')} />
          {errors.title && <p id="title-error" className="mt-1 text-sm text-red-700">{errors.title.message}</p>}
        </div>

        <div>
          <label htmlFor="description" className="label">Description</label>
          <textarea id="description" rows={4} className="input" aria-invalid={!!errors.description} {...register('description')} />
          {errors.description && <p className="mt-1 text-sm text-red-700">{errors.description.message}</p>}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="expertise" className="label">Required expertise <span aria-hidden className="text-red-600">*</span></label>
            <select id="expertise" className="input" aria-invalid={!!errors.required_expertise_id} {...register('required_expertise_id')}>
              <option value="">Select an area…</option>
              {expertise.data.data.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {errors.required_expertise_id && <p className="mt-1 text-sm text-red-700">{errors.required_expertise_id.message}</p>}
          </div>
          <div>
            <label htmlFor="priority" className="label">Priority <span aria-hidden className="text-red-600">*</span></label>
            <select id="priority" className="input" {...register('priority')}>
              {(Object.keys(PRIORITY_LABEL) as Array<keyof typeof PRIORITY_LABEL>).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            {errors.priority && <p className="mt-1 text-sm text-red-700">{errors.priority.message}</p>}
          </div>
        </div>

        <div className="md:w-1/2">
          <label htmlFor="due" className="label">Due date <span className="font-normal text-slate-500">(optional)</span></label>
          <input id="due" type="date" className="input" aria-invalid={!!errors.due_date} {...register('due_date')} />
          {errors.due_date && <p className="mt-1 text-sm text-red-700">{errors.due_date.message}</p>}
        </div>

        {showSimulation && (
          <fieldset className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Development simulation</legend>
            <label htmlFor="simulation" className="label">Forced routing outcome</label>
            <select id="simulation" className="input md:w-1/2" {...register('simulation')}>
              <option value="normal">Normal (20% never return, others 5–20s)</option>
              <option value="success">Success after 5s</option>
              <option value="delayed">Delayed 20s</option>
              <option value="never">Never returns</option>
            </select>
          </fieldset>
        )}

        {create.isSuccess && <Notice kind="success">Task saved.</Notice>}

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
          <button type="submit" className="btn-secondary" disabled={create.isPending} onClick={() => (intent.current = 'draft')}>
            Save draft
          </button>
          <button type="submit" className="btn-primary" disabled={create.isPending} onClick={() => (intent.current = 'submit')}>
            {create.isPending ? 'Creating…' : 'Create and submit for routing'}
          </button>
        </div>
      </form>
    </div>
  );
}
