import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { ToastProvider } from '../components/ui/Toast'
import type { Task, TaskDetail } from '../api/types'

export interface MockCall {
  method: string
  path: string
  query: URLSearchParams
  body: Record<string, unknown> | null
}

type Handler = (call: MockCall) => { status?: number; body: unknown } | undefined

/**
 * Replaces fetch with a tiny router: `routes` maps "METHOD /path" (path
 * without /api/v1 and query) to a response. Unmatched requests return 404.
 * Every call is recorded for assertions.
 */
export function mockApi(routes: Record<string, unknown | Handler>) {
  const calls: MockCall[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const call: MockCall = { method, path, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null }
    calls.push(call)
    const route = routes[`${method} ${path}`]
    const isResponseSpec = (r: unknown): r is { status: number; body: unknown } =>
      typeof r === 'object' && r !== null && 'status' in r && 'body' in r
    const result =
      typeof route === 'function'
        ? (route as Handler)(call)
        : route === undefined
          ? undefined
          : isResponseSpec(route)
            ? route
            : { body: route }
    if (!result) return new Response(JSON.stringify({ error: { code: 'not_found', message: `No mock for ${method} ${path}` } }), { status: 404 })
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

export function renderRoute(element: ReactElement, { path = '/', url = path }: { path?: string; url?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '*', element: <div data-testid="navigated" /> },
    ],
    { initialEntries: [url] },
  )
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...utils, router, queryClient }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Fix billing bug',
    description: 'Details',
    priority: 'high',
    status: 'draft',
    status_reason: null,
    due_date: null,
    version: 3,
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    required_expertise: { id: 1, name: 'Ruby' },
    current_assignment: null,
    routing: null,
    routing_attempt_count: 0,
    needs_intervention: false,
    available_actions: ['submit_routing', 'assign_manually', 'edit', 'cancel'],
    ...overrides,
  }
}

export function makeDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return { ...makeTask(overrides), routing_attempts: [], assignments: [], expected_window_seconds: 20, ...overrides }
}

export const paged = <T,>(data: T[]) => ({ data, meta: { page: 1, per_page: 20, total: data.length, total_pages: 1 } })
