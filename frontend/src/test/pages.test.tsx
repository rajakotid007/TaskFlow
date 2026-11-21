import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardPage } from '../pages/DashboardPage'
import { NewTaskPage } from '../pages/NewTaskPage'
import { TasksPage } from '../pages/TasksPage'
import { TaskDetailPage } from '../pages/TaskDetailPage'
import type { DashboardSummary } from '../api/types'
import { makeDetail, makeTask, mockApi, paged, renderRoute, type MockCall } from './utils'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const summary: DashboardSummary = {
  generated_at: '2026-11-20T10:00:00Z',
  expected_window_seconds: 20,
  totals: {
    tasks: 21, draft: 3, routing_pending: 2, unresolved_routing: 1, awaiting_acceptance: 4,
    active_assignments: 5, needs_intervention: 3, declined_or_failed: 2, completed: 6, cancelled: 1,
  },
  by_status: {},
  open_by_priority: { urgent: 1, high: 2 },
  open_by_expertise: {},
  routing_outcomes: { pending: 2, matched: 10, no_match: 1, superseded: 2, late_results_ignored: 1 },
  attention: [makeTask({ id: 9, title: 'Hotfix login loop', status: 'declined', status_reason: 'contributor_declined' })],
  recent_events: [],
}

describe('DashboardPage', () => {
  it('renders metrics from the API', async () => {
    mockApi({ 'GET /dashboard/summary': { data: summary } })
    renderRoute(<DashboardPage />)

    const tile = await screen.findByTestId('stat-Unresolved routing')
    expect(tile).toHaveTextContent('1')
    expect(screen.getByTestId('stat-Total tasks')).toHaveTextContent('21')
    expect(screen.getByTestId('stat-Needs intervention')).toHaveTextContent('3')
    expect(screen.getByText('Hotfix login loop')).toBeInTheDocument()
    expect(screen.getByText('Contributor declined the offer')).toBeInTheDocument()
  })

  it('shows an error with retry when the API fails', async () => {
    mockApi({ 'GET /dashboard/summary': { status: 500, body: { error: { code: 'boom', message: 'Database unavailable' } } } })
    renderRoute(<DashboardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('NewTaskPage', () => {
  const areas = { data: [{ id: 4, name: 'React', contributor_count: 3 }] }

  it('shows validation errors and does not submit', async () => {
    const { calls } = mockApi({ 'GET /expertise_areas': areas })
    renderRoute(<NewTaskPage />)
    await screen.findByRole('option', { name: /React/ })

    await userEvent.click(screen.getByRole('button', { name: /Create & submit/ }))

    expect(await screen.findByText('Title must be at least 3 characters')).toBeInTheDocument()
    expect(screen.getByText('Choose the expertise this task needs')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('creates and submits a task for routing', async () => {
    const { calls } = mockApi({
      'GET /expertise_areas': areas,
      'POST /tasks': { data: makeDetail({ id: 42, status: 'routing_pending' }) },
    })
    const { router } = renderRoute(<NewTaskPage />, { path: '/tasks/new' })
    await screen.findByRole('option', { name: /React/ })

    await userEvent.type(screen.getByLabelText(/Title/), 'Build settings page')
    await userEvent.selectOptions(screen.getByLabelText(/Required expertise/), '4')
    await userEvent.selectOptions(screen.getByLabelText(/Priority/), 'urgent')
    await userEvent.click(screen.getByRole('button', { name: /Create & submit/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/42'))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({ submit: true, task: { title: 'Build settings page', required_expertise_id: 4, priority: 'urgent' } })
  })

  it('maps server-side validation errors onto fields', async () => {
    mockApi({
      'GET /expertise_areas': areas,
      'POST /tasks': { status: 422, body: { error: { code: 'validation_failed', message: 'Title is taken', details: { title: ['is reserved'] } } } },
    })
    renderRoute(<NewTaskPage />)
    await screen.findByRole('option', { name: /React/ })
    await userEvent.type(screen.getByLabelText(/Title/), 'Reserved title')
    await userEvent.selectOptions(screen.getByLabelText(/Required expertise/), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText('is reserved')).toBeInTheDocument()
  })
})

describe('TasksPage', () => {
  it('sends filters to the API and reflects them in the URL', async () => {
    const { calls } = mockApi({
      'GET /expertise_areas': { data: [] },
      'GET /tasks': (call: MockCall) => ({
        body: paged(call.query.get('status') === 'declined' ? [makeTask({ id: 2, title: 'Declined one', status: 'declined' })] : [makeTask()]),
      }),
    })
    const { router } = renderRoute(<TasksPage />, { path: '/tasks' })
    expect(await screen.findByText('Fix billing bug')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'declined')

    expect(await screen.findByText('Declined one')).toBeInTheDocument()
    expect(router.state.location.search).toContain('status=declined')
    expect(calls.some((c) => c.path === '/tasks' && c.query.get('status') === 'declined')).toBe(true)
  })

  it('shows a live pending timer for routing tasks without claiming failure', async () => {
    const startedAt = new Date(Date.now() - 95_000).toISOString()
    mockApi({
      'GET /expertise_areas': { data: [] },
      'GET /tasks': {
        ...paged([
          makeTask({
            status: 'routing_pending',
            routing: { attempt_id: 1, attempt_number: 1, status: 'pending', started_at: startedAt, elapsed_seconds: 95, beyond_expected_window: true },
            available_actions: ['assign_manually', 'restart_routing', 'cancel'],
          }),
        ]),
      },
    })
    renderRoute(<TasksPage />, { path: '/tasks' })
    const row = await screen.findByTestId('task-row')
    const timers = within(row).getAllByTestId('pending-timer')
    expect(timers[0]).toHaveTextContent(/1m 3\ds/)
    expect(timers[0]).toHaveAttribute('title', expect.stringContaining('It may still arrive'))
    expect(row).not.toHaveTextContent(/fail/i)
  })
})

describe('TaskDetailPage — intervention and recovery', () => {
  const pendingTask = makeDetail({
    id: 7,
    version: 5,
    status: 'routing_pending',
    available_actions: ['assign_manually', 'restart_routing', 'edit', 'cancel'],
    routing_attempts: [
      {
        id: 70, task_id: 7, attempt_number: 1, status: 'pending', trigger: 'submit', started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: null, elapsed_seconds: 60, beyond_expected_window: true, outcome: null, outcome_reason: null,
        selected_contributor: null, superseded_at: null, superseded_reason: null, late_result_at: null, late_outcome: null, late_contributor: null,
      },
    ],
  })

  it('explains an unresolved request without calling it failed', async () => {
    mockApi({ 'GET /tasks/7': { data: pendingTask }, 'GET /tasks/7/history': { data: [] } })
    renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/7' })
    const explanation = await screen.findByTestId('state-explanation')
    expect(explanation).toHaveTextContent('longer than the usual')
    expect(explanation).toHaveTextContent('has not failed')
  })

  it('assigns a contributor manually, sending the version the operator saw', async () => {
    const { calls } = mockApi({
      'GET /tasks/7': { data: pendingTask },
      'GET /tasks/7/history': { data: [] },
      'GET /tasks/7/eligible_contributors': {
        data: [
          { id: 3, name: 'Priya', email: 'p@x', availability: 'available', max_active_assignments: 3, expertise_areas: [], active_assignment_count: 1, active_assignments: [], created_at: '', eligible: true, ineligible_reason: null, previously_declined: false },
          { id: 4, name: 'Omar', email: 'o@x', availability: 'unavailable', max_active_assignments: 3, expertise_areas: [], active_assignment_count: 0, active_assignments: [], created_at: '', eligible: false, ineligible_reason: 'currently unavailable', previously_declined: false },
        ],
      },
      'POST /tasks/7/intervene': { data: makeDetail({ id: 7, status: 'assigned' }), meta: { changed: true } },
    })
    renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/7' })

    await userEvent.click(await screen.findByRole('button', { name: 'Assign manually' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/will be superseded/)).toBeInTheDocument()
    expect(await within(dialog).findByRole('radio', { name: /Omar/ })).toBeDisabled()
    expect(within(dialog).getByText('currently unavailable')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('radio', { name: /Priya/ }))
    await userEvent.type(within(dialog).getByLabelText(/Note/), 'Owns this module')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))

    await waitFor(() => expect(calls.some((c) => c.path === '/tasks/7/intervene')).toBe(true))
    const post = calls.find((c) => c.path === '/tasks/7/intervene')!
    expect(post.body).toEqual({ contributor_id: 3, note: 'Owns this module', expected_version: 5 })
    expect(await screen.findByText('Contributor assigned')).toBeInTheDocument()
  })

  it('retries routing after a decline', async () => {
    const declined = makeDetail({
      id: 8, version: 4, status: 'declined', status_reason: 'contributor_declined',
      available_actions: ['retry_routing', 'assign_manually', 'edit', 'cancel'],
      assignments: [{ id: 1, task_id: 8, contributor: { id: 2, name: 'Bob' }, routing_attempt_id: 1, source: 'routing', status: 'declined', offered_at: null, accepted_at: null, declined_at: null, ended_at: null, decline_reason: 'On holiday', end_reason: null }],
    })
    const { calls } = mockApi({
      'GET /tasks/8': { data: declined },
      'GET /tasks/8/history': { data: [] },
      'POST /tasks/8/recover': { data: makeDetail({ id: 8, status: 'routing_pending' }), meta: { changed: true } },
    })
    renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/8' })

    expect(await screen.findByTestId('state-explanation')).toHaveTextContent('Bob declined: “On holiday”')
    await userEvent.click(screen.getByRole('button', { name: 'Retry routing' }))
    await waitFor(() => expect(calls.find((c) => c.path === '/tasks/8/recover')?.body).toEqual({ recovery_action: 'retry_routing', expected_version: 4 }))
  })

  it('tells the operator when the task changed underneath them (409)', async () => {
    mockApi({
      'GET /tasks/7': { data: pendingTask },
      'GET /tasks/7/history': { data: [] },
      'POST /tasks/7/route': {
        status: 409,
        body: { error: { code: 'stale_version', message: 'Task changed since you loaded it (now assigned, version 6).' } },
      },
    })
    renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/7' })
    await userEvent.click(await screen.findByRole('button', { name: 'Restart routing' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restart routing' }))

    expect(await screen.findByText('Task changed before your action')).toBeInTheDocument()
    expect(screen.getByText(/now assigned, version 6/)).toBeInTheDocument()
  })
})
