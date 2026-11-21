import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api, serverNow } from '../api/client'
import { localDateString } from '../lib/format'
import { taskSchema } from '../pages/NewTaskPage'
import { TaskDetailPage } from '../pages/TaskDetailPage'
import { makeDetail, mockApi, renderRoute } from './utils'

afterEach(() => vi.unstubAllGlobals())

const respondWithDate = (date: Date) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"data":[]}', { status: 200, headers: { Date: date.toUTCString() } })))

describe('server clock', () => {
  it('measures elapsed time on the server clock, not the browser clock', async () => {
    respondWithDate(new Date(Date.now() + 60_000))
    await api.get('/tasks')
    expect(serverNow() - Date.now()).toBeGreaterThan(58_000)

    respondWithDate(new Date())
    await api.get('/tasks')
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(2_000)
  })
})

describe('due date', () => {
  it('compares against the local calendar date, not UTC', () => {
    const base = { title: 'Valid title', required_expertise_id: '1', priority: 'medium' as const }
    expect(taskSchema.safeParse({ ...base, due_date: localDateString() }).success).toBe(true)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(taskSchema.safeParse({ ...base, due_date: localDateString(yesterday) }).success).toBe(false)
  })
})

describe('TaskDetailPage — edge cases', () => {
  it('sends the version from when a dialog opened, so a change made meanwhile is caught', async () => {
    let version = 5
    const { calls, fetchMock } = mockApi({
      'GET /tasks/9': () => ({ body: { data: makeDetail({ id: 9, version, status: 'routing_pending', available_actions: ['assign_manually', 'restart_routing', 'cancel'] }) } }),
      'GET /tasks/9/history': { data: [] },
      'POST /tasks/9/cancel': { status: 409, body: { error: { code: 'stale_version', message: 'Task changed since you loaded it.' } } },
    })
    const { queryClient } = renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/9' })

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel task' }))
    const dialog = await screen.findByRole('dialog')

    // A live update arrives while the dialog is open.
    version = 6
    await queryClient.refetchQueries({ queryKey: ['task', 9] })
    await waitFor(() => expect(screen.getByText('6')).toBeInTheDocument())

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel task' }))
    await waitFor(() => expect(calls.find((c) => c.path === '/tasks/9/cancel')?.body).toEqual({ expected_version: 5 }))
    expect(await screen.findByText('Task changed before your action')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalled()
  })

  it('flags an offer that has gone unanswered past the response window', async () => {
    const offeredAt = new Date(Date.now() - 2 * 3600_000 - 30_000).toISOString()
    mockApi({
      'GET /tasks/10': {
        data: makeDetail({
          id: 10, status: 'awaiting_acceptance', offer_response_window_seconds: 1800,
          available_actions: ['accept_offer', 'decline_offer', 'assign_manually', 'restart_routing', 'cancel'],
          current_assignment: { id: 4, status: 'offered', source: 'routing', offered_at: offeredAt, overdue: true, contributor: { id: 2, name: 'Bob', available: true } },
        }),
      },
      'GET /tasks/10/history': { data: [] },
    })
    renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/10' })
    const explanation = await screen.findByTestId('state-explanation')
    expect(explanation).toHaveTextContent('has had no answer for 2h 00m')
    expect(explanation).toHaveTextContent('It has not expired')
  })

  it('warns when the assignee has been marked unavailable', async () => {
    mockApi({
      'GET /tasks/11': {
        data: makeDetail({
          id: 11, status: 'in_progress', available_actions: ['complete', 'release', 'edit', 'cancel'],
          current_assignment: { id: 5, status: 'accepted', source: 'manual', contributor: { id: 3, name: 'Priya', available: false } },
        }),
      },
      'GET /tasks/11/history': { data: [] },
    })
    renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/11' })
    expect(await screen.findByTestId('state-explanation')).toHaveTextContent('Priya is now marked unavailable')
    expect(screen.getByRole('button', { name: 'Release assignment' })).toBeInTheDocument()
  })

  it('edits task details, sending only the fields that changed', async () => {
    const { calls } = mockApi({
      'GET /tasks/12': { data: makeDetail({ id: 12, version: 2, title: 'Old title', expertise_editable: false, available_actions: ['submit_routing', 'edit', 'cancel'] }) },
      'GET /tasks/12/history': { data: [] },
      'GET /expertise_areas': { data: [{ id: 1, name: 'Ruby', contributor_count: 2 }] },
      'PATCH /tasks/12': { data: makeDetail({ id: 12, version: 3, title: 'New title' }), meta: { changed: true } },
    })
    renderRoute(<TaskDetailPage />, { path: '/tasks/:id', url: '/tasks/12' })

    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Required expertise/)).toBeDisabled()
    const title = within(dialog).getByLabelText(/Title/)
    await userEvent.clear(title)
    await userEvent.type(title, 'New title')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ task: { title: 'New title' }, expected_version: 2 }))
    expect(await screen.findByText('Task updated')).toBeInTheDocument()
  })
})
