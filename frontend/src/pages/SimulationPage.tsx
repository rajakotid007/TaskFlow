import { useState } from 'react'
import { Link } from 'react-router'
import { FlaskConical, Zap } from 'lucide-react'
import { useCreateTask, useDeliverNow, useExpertiseAreas, useSimulationAttempts, useSimulationStatus } from '../api/hooks'
import type { SimulationOverride } from '../api/types'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Spinner } from '../components/ui/primitives'
import { RoutingStatusBadge } from '../components/StatusBadges'
import { useToast } from '../components/ui/Toast'
import { formatDateTime } from '../lib/format'

const SCENARIOS: { key: string; label: string; description: string; simulation?: SimulationOverride }[] = [
  { key: 'random', label: 'Normal routing', description: 'Real simulation rules: 80% respond after 5–20s, 20% never return.' },
  { key: 'fast', label: 'Fast response', description: 'Responds after 5s. Use for routine assignment and decline/recovery.', simulation: { behavior: 'respond', delay_seconds: 5 } },
  { key: 'delayed', label: 'Delayed response (45s)', description: 'Returns well after the usual window. Intervene first to see the late result ignored.', simulation: { behavior: 'respond', delay_seconds: 45 } },
  { key: 'never', label: 'Never returns', description: 'The engine drops the request. It stays pending until an operator acts.', simulation: { behavior: 'never_return' } },
]

/**
 * Development-only. The only screen that reveals the simulated outcome of a
 * routing request — the operator pages deliberately cannot.
 */
export function SimulationPage() {
  const toast = useToast()
  const { data: status, isLoading } = useSimulationStatus()
  const { data: areas } = useExpertiseAreas()
  const { data: attempts, error } = useSimulationAttempts(!!status?.enabled)
  const create = useCreateTask()
  const deliver = useDeliverNow()
  const [expertise, setExpertise] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('high')
  const [title, setTitle] = useState('')

  if (isLoading) return <Spinner />
  if (!status?.enabled) {
    return <EmptyState icon={<FlaskConical className="size-6" />} title="Simulation controls are disabled" description="Set SIMULATION_CONTROLS_ENABLED=true on the API (development only)." />
  }

  const launch = (s: (typeof SCENARIOS)[number]) => {
    const areaId = Number(expertise || areas?.[0]?.id)
    if (!areaId) return
    create.mutate(
      {
        task: { title: title.trim() || `${s.label} demo ${new Date().toLocaleTimeString()}`, required_expertise_id: areaId, priority },
        submit: true,
        simulation: s.simulation,
      },
      {
        onSuccess: (task) => toast({ kind: 'success', title: `Created #${task.id}`, message: `${s.label} scenario started.` }),
        onError: (e) => toast({ kind: 'error', title: 'Could not start scenario', message: e.message }),
      },
    )
  }

  return (
    <>
      <PageHeader
        title="Simulation lab"
        description={<>Development-only controls for reproducing scenarios. Default rules: {Math.round(status.never_return_probability * 100)}% of requests never return; the rest respond after {status.delay_range_seconds[0]}–{status.delay_range_seconds[1]}s.</>}
      />

      <Card className="mb-6">
        <CardHeader title="Start a scenario" description="Creates a task and submits it for routing with a forced engine behaviour." />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Title (optional)" htmlFor="sim-title"><Input id="sim-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Expertise" htmlFor="sim-expertise">
            <Select id="sim-expertise" value={expertise} onChange={(e) => setExpertise(e.target.value)}>
              {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="sim-priority">
            <Select id="sim-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 border-t border-slate-200 p-5 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800">
          {SCENARIOS.map((s) => (
            <div key={s.key} className="flex flex-col rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-medium">{s.label}</p>
              <p className="mt-1 flex-1 text-xs text-slate-500">{s.description}</p>
              <Button size="sm" className="mt-3" onClick={() => launch(s)} loading={create.isPending} data-testid={`scenario-${s.key}`}>Start</Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent routing requests (with planned behaviour)" description="“Deliver now” makes the engine answer immediately — even a request planned never to return — to demonstrate late results." />
        {error && <div className="p-4"><ErrorBanner error={error} /></div>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
              <tr>
                <th className="px-4 py-2.5">Task</th>
                <th className="px-4 py-2.5">Attempt</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Planned</th>
                <th className="px-4 py-2.5">Sent</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {attempts?.map((a) => (
                <tr key={a.id} data-testid="sim-attempt" data-task-id={a.task_id}>
                  <td className="px-4 py-2.5"><Link to={`/tasks/${a.task_id}`} className="hover:underline">#{a.task_id} {a.task?.title}</Link></td>
                  <td className="px-4 py-2.5 text-xs">#{a.attempt_number}</td>
                  <td className="px-4 py-2.5"><RoutingStatusBadge status={a.status} /></td>
                  <td className="px-4 py-2.5">
                    <Badge tone={a.simulated_behavior === 'never_return' ? 'violet' : 'blue'}>
                      {a.simulated_behavior === 'never_return' ? 'Never returns' : `Responds after ${a.simulated_delay_seconds}s`}
                    </Badge>
                    <span className="ml-2 text-xs text-slate-500">{a.simulation_source}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{formatDateTime(a.started_at)}</td>
                  <td className="px-4 py-2.5">
                    {!a.late_result_at && (a.status === 'pending' || a.status === 'superseded') && (
                      <Button
                        size="sm"
                        icon={<Zap className="size-3.5" />}
                        loading={deliver.isPending && deliver.variables === a.id}
                        onClick={() => deliver.mutate(a.id, { onError: (e) => toast({ kind: 'error', title: 'Delivery failed', message: e.message }) })}
                        data-testid="deliver-now"
                      >
                        Deliver now
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
