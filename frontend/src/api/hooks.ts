// TanStack Query hooks. Polling is the reliable fallback when WebSocket updates are unavailable.
// Routing views poll faster so pending requests and elapsed time stay current.
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from './client';
import type {
  Contributor, DashboardSummary, EventRow, Expertise, Page, RoutingAttemptRow, Task, TaskDetail,
} from './types';

export const keys = {
  tasks: (params: object) => ['tasks', params] as const,
  task: (id: number) => ['task', id] as const,
  dashboard: ['dashboard'] as const,
  routing: (status: string) => ['routing', status] as const,
  events: (params: object) => ['events', params] as const,
  contributors: ['contributors'] as const,
  expertise: ['expertise'] as const,
  simulation: ['simulation'] as const,
};

const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export function useTasks(params: { search?: string; status?: string; priority?: string; routing?: string; page: number; per_page?: number }) {
  return useQuery({
    queryKey: keys.tasks(params),
    queryFn: () => api<Page<Task>>(`/tasks${qs({ ...params, per_page: params.per_page ?? 20 })}`),
    refetchInterval: 5_000,
    placeholderData: (prev) => prev,
  });
}

export function useTask(id: number) {
  return useQuery({
    queryKey: keys.task(id),
    queryFn: () => api<TaskDetail>(`/tasks/${id}`),
    // Poll while routing is pending so elapsed time and resolution appear without a refresh.
    refetchInterval: (q) => (q.state.data?.routing.state === 'pending' ? 3_000 : 10_000),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: () => api<DashboardSummary>('/dashboard/summary'), refetchInterval: 5_000 });
}

export function useRoutingAttempts(status: string) {
  return useQuery({
    queryKey: keys.routing(status),
    queryFn: () => api<Page<RoutingAttemptRow>>(`/routing-attempts${qs({ status, per_page: 50 })}`),
    refetchInterval: 3_000,
  });
}

export function useEvents(params: { task_id?: number; event_type?: string; page: number }) {
  return useQuery({
    queryKey: keys.events(params),
    queryFn: () => api<Page<EventRow>>(`/events${qs({ ...params, per_page: 25 })}`),
    refetchInterval: 5_000,
    placeholderData: (prev) => prev,
  });
}

export function useContributors() {
  return useQuery({ queryKey: keys.contributors, queryFn: () => api<{ data: Contributor[] }>('/contributors'), refetchInterval: 10_000 });
}

export function useExpertise() {
  return useQuery({ queryKey: keys.expertise, queryFn: () => api<{ data: Expertise[] }>('/expertise-areas'), staleTime: Infinity });
}

export function useSimulationStatus() {
  return useQuery({ queryKey: keys.simulation, queryFn: () => api<{ controls_enabled: boolean }>('/simulation/status'), staleTime: Infinity });
}

/** Invalidates everything a task-changing command can affect. */
function useInvalidateAfterTaskChange() {
  const qc = useQueryClient();
  return (taskId?: number) => {
    const invalidate: QueryKey[] = [['tasks'], keys.dashboard, ['routing'], ['events'], keys.contributors];
    invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
    if (taskId) void qc.invalidateQueries({ queryKey: keys.task(taskId) });
  };
}

export type CreateTaskBody = {
  title: string; description: string; required_expertise_id: number; priority: string;
  due_date: string | null; submit: boolean; simulation?: 'success' | 'delayed' | 'never';
};

export function useCreateTask() {
  const invalidate = useInvalidateAfterTaskChange();
  return useMutation({
    mutationFn: (body: CreateTaskBody) => api<Task>('/tasks', { method: 'POST', json: body }),
    onSuccess: (task) => invalidate(task.id),
  });
}

export function useRouteTask() {
  const invalidate = useInvalidateAfterTaskChange();
  return useMutation({
    mutationFn: ({ id, expected_version }: { id: number; expected_version?: number }) =>
      api<{ created: boolean; task: TaskDetail }>(`/tasks/${id}/route`, { method: 'POST', json: { expected_version } }),
    onSuccess: (_r, v) => invalidate(v.id),
  });
}

export type InterveneBody = { action: 'assign' | 'reroute' | 'fail_assignment' | 'cancel'; contributor_id?: number; reason?: string };

export function useIntervene(taskId: number) {
  const invalidate = useInvalidateAfterTaskChange();
  return useMutation({
    mutationFn: (body: InterveneBody) => api<Task>(`/tasks/${taskId}/intervene`, { method: 'POST', json: body }),
    onSettled: () => invalidate(taskId),
  });
}

export type RecoverBody = { action: 'retry_routing' | 'choose_contributor'; contributor_id?: number; reason?: string };

export function useRecover(taskId: number) {
  const invalidate = useInvalidateAfterTaskChange();
  return useMutation({
    mutationFn: (body: RecoverBody) => api<Task>(`/tasks/${taskId}/recover`, { method: 'POST', json: body }),
    onSettled: () => invalidate(taskId),
  });
}

export function useAdvanceTask(taskId: number) {
  const invalidate = useInvalidateAfterTaskChange();
  return useMutation({
    mutationFn: (status: 'in_progress' | 'completed') => api<Task>(`/tasks/${taskId}`, { method: 'PATCH', json: { status } }),
    onSettled: () => invalidate(taskId),
  });
}

export function useAssignmentAction() {
  const invalidate = useInvalidateAfterTaskChange();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: number; taskId: number; action: 'accept' | 'decline'; reason?: string }) =>
      api(`/assignments/${id}/${action}`, { method: 'POST', json: action === 'decline' ? { reason } : {} }),
    onSettled: (_d, _e, v) => invalidate(v.taskId),
  });
}

export function useContributorMutation(id?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Contributor> & { expertise_ids?: number[] }) =>
      api<Contributor>(id ? `/contributors/${id}` : '/contributors', { method: id ? 'PATCH' : 'POST', json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.contributors }),
  });
}
