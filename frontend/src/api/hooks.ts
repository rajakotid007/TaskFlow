import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  Contributor,
  DashboardSummary,
  EligibleContributor,
  ExpertiseArea,
  Paged,
  Priority,
  RoutingAttempt,
  SimulationAttempt,
  SimulationOverride,
  SimulationStatus,
  Task,
  TaskDetail,
  TaskEvent,
} from './types'
import { usePollInterval } from '../lib/live'

type Data<T> = { data: T }
type Command = { data: TaskDetail; meta: { changed: boolean } }

export interface TaskFilters {
  q?: string
  status?: string
  priority?: string
  expertise_id?: string
  view?: string
  sort?: string
  page?: number
  per_page?: number
}

// ---- queries --------------------------------------------------------------

export function useTasks(filters: TaskFilters) {
  const refetchInterval = usePollInterval()
  return useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => api.get<Paged<Task>>('/tasks', { ...filters }),
    placeholderData: keepPreviousData,
    refetchInterval,
  })
}

export function useTask(id: number) {
  const refetchInterval = usePollInterval()
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<Data<TaskDetail>>(`/tasks/${id}`).then((r) => r.data),
    refetchInterval,
  })
}

export function useTaskHistory(id: number) {
  return useQuery({
    queryKey: ['task', id, 'history'],
    queryFn: () =>
      api.get<Data<TaskEvent[]> & { meta?: { total: number } }>(`/tasks/${id}/history`)
        .then((r) => ({ events: r.data, total: r.meta?.total ?? r.data.length })),
  })
}

export function useEligibleContributors(taskId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['task', taskId, 'eligible'],
    queryFn: () => api.get<Data<EligibleContributor[]>>(`/tasks/${taskId}/eligible_contributors`).then((r) => r.data),
    enabled,
  })
}

export function useDashboard() {
  const refetchInterval = usePollInterval()
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Data<DashboardSummary>>('/dashboard/summary').then((r) => r.data),
    refetchInterval,
  })
}

export function useExpertiseAreas() {
  return useQuery({
    queryKey: ['expertise-areas'],
    queryFn: () => api.get<Data<ExpertiseArea[]>>('/expertise_areas').then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useContributors(params: { q?: string; expertise_id?: string; availability?: string } = {}) {
  const refetchInterval = usePollInterval()
  return useQuery({
    queryKey: ['contributors', params],
    queryFn: () => api.get<Paged<Contributor>>('/contributors', { ...params, per_page: 100 }),
    placeholderData: keepPreviousData,
    refetchInterval,
  })
}

export function useRoutingAttempts(filter: string, page = 1) {
  const refetchInterval = usePollInterval()
  return useQuery({
    queryKey: ['routing-attempts', filter, page],
    queryFn: () => api.get<Paged<RoutingAttempt>>('/routing-attempts', { filter, page, per_page: 25 }),
    placeholderData: keepPreviousData,
    refetchInterval,
  })
}

export function useEvents(params: { task_id?: string; event_type?: string; actor_type?: string; page?: number }) {
  const refetchInterval = usePollInterval()
  return useQuery({
    queryKey: ['events', params],
    queryFn: () => api.get<Paged<TaskEvent> & { meta: { event_types: string[] } }>('/events', { ...params, per_page: 50 }),
    placeholderData: keepPreviousData,
    refetchInterval,
  })
}

export function useSimulationStatus() {
  return useQuery({
    queryKey: ['simulation', 'status'],
    queryFn: () => api.get<Data<SimulationStatus>>('/simulation').then((r) => r.data),
    staleTime: Infinity,
    retry: false,
  })
}

export function useSimulationAttempts(enabled: boolean) {
  const refetchInterval = usePollInterval()
  return useQuery({
    queryKey: ['simulation', 'attempts'],
    queryFn: () => api.get<Data<SimulationAttempt[]>>('/simulation/routing-attempts').then((r) => r.data),
    enabled,
    refetchInterval,
  })
}

// ---- mutations ------------------------------------------------------------

/** After any command, refresh everything that could reflect it. */
function useInvalidateAll() {
  const qc = useQueryClient()
  return (task?: TaskDetail) => {
    if (task) qc.setQueryData(['task', task.id], task)
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['task'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['routing-attempts'] })
    qc.invalidateQueries({ queryKey: ['events'] })
    qc.invalidateQueries({ queryKey: ['contributors'] })
    qc.invalidateQueries({ queryKey: ['simulation'] })
  }
}

export interface TaskInput {
  title: string
  description?: string
  required_expertise_id: number
  priority: Priority
  due_date?: string | null
}

export function useCreateTask() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (vars: { task: TaskInput; submit: boolean; simulation?: SimulationOverride }) =>
      api.post<Data<TaskDetail>>('/tasks', vars).then((r) => r.data),
    onSuccess: (task) => invalidate(task),
  })
}

export type TaskCommand =
  | { kind: 'route'; mode?: 'submit' | 'retry' | 'restart'; simulation?: SimulationOverride }
  | { kind: 'intervene'; contributor_id: number; note?: string }
  | { kind: 'recover'; recovery_action: 'retry_routing' | 'release'; reason?: string }
  | { kind: 'start' }
  | { kind: 'complete' }
  | { kind: 'cancel'; reason?: string }
  | { kind: 'accept'; assignment_id: number }
  | { kind: 'decline'; assignment_id: number; reason?: string }
  | { kind: 'update'; task: Partial<TaskInput> }

/**
 * All task commands send the version the operator is looking at; the API
 * answers 409 if the task changed in the meantime. A confirmation dialog
 * passes the version from when it opened, so a change that arrives while the
 * operator is reading it is caught instead of silently overridden.
 */
export function useTaskCommand(taskId: number, version: number) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: async ({ cmd, seenVersion }: { cmd: TaskCommand; seenVersion?: number }) => {
      const expected_version = seenVersion ?? version
      switch (cmd.kind) {
        case 'accept':
          return api.post<Command>(`/assignments/${cmd.assignment_id}/accept`)
        case 'decline':
          return api.post<Command>(`/assignments/${cmd.assignment_id}/decline`, { reason: cmd.reason })
        case 'update':
          return api.patch<Command>(`/tasks/${taskId}`, { task: cmd.task, expected_version })
        default: {
          const { kind, ...body } = cmd
          return api.post<Command>(`/tasks/${taskId}/${kind}`, { ...body, expected_version })
        }
      }
    },
    onSuccess: (res) => invalidate(res.data),
    onError: () => invalidate(),
  })
}

export function useDeliverNow() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (attemptId: number) => api.post<Data<RoutingAttempt>>(`/simulation/routing-attempts/${attemptId}/deliver`),
    onSuccess: () => invalidate(),
  })
}

export interface ContributorInput {
  name: string
  email: string
  availability: 'available' | 'unavailable'
  max_active_assignments: number
  expertise_area_ids: number[]
}

export function useSaveContributor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, contributor }: { id?: number; contributor: ContributorInput }) =>
      id
        ? api.patch<Data<Contributor> & { meta?: { warnings?: string[] } }>(`/contributors/${id}`, { contributor })
        : api.post<Data<Contributor> & { meta?: { warnings?: string[] } }>('/contributors', { contributor }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributors'] })
      qc.invalidateQueries({ queryKey: ['expertise-areas'] })
      // Held tasks show whether their assignee is still available.
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task'] })
    },
  })
}
