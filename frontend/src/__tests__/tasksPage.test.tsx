import { describe, expect, it, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPage } from '../pages/TasksPage';
import { mockApi, renderWithProviders } from '../test/renderWithProviders';

const task = (over: Record<string, unknown>) => ({
  id: 1, title: 'Alpha', description: '', priority: 'high', status: 'routing_pending', status_reason: null,
  due_date: null, version: 2, expertise: { id: 1, name: 'Python' }, created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  routing: { state: 'pending', attempt_id: 9, pending_seconds: 30 }, current_assignment: null, ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('Task management table', () => {
  it('shows pending routing and its elapsed time', async () => {
    mockApi({ '/api/v1/tasks': () => ({ body: { data: [task({})], meta: { page: 1, per_page: 20, total: 1, total_pages: 1 } } }), '/api/v1/expertise-areas': () => ({ body: { data: [] } }) });
    renderWithProviders(<TasksPage />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry routing/i })).toBeInTheDocument();
    // The elapsed value ticks each second, so assert the format rather than an exact second.
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument();
  });

  it('re-queries with the chosen status filter', async () => {
    const { calls } = mockApi({ '/api/v1/tasks': () => ({ body: { data: [], meta: { page: 1, per_page: 20, total: 0, total_pages: 1 } } }), '/api/v1/expertise-areas': () => ({ body: { data: [] } }) });
    renderWithProviders(<TasksPage />);
    await screen.findByText(/no tasks match/i);
    await userEvent.selectOptions(screen.getByLabelText(/filter by status/i), 'draft');
    await waitFor(() => expect(calls.some((c) => c.url.includes('status=draft'))).toBe(true));
  });

  it('offers recovery only for declined or failed tasks', async () => {
    mockApi({
      '/api/v1/tasks': () => ({
        body: { data: [task({ id: 5, title: 'Declined one', status: 'declined', routing: { state: 'idle', attempt_id: null, pending_seconds: null } })], meta: { page: 1, per_page: 20, total: 1, total_pages: 1 } },
      }),
      '/api/v1/expertise-areas': () => ({ body: { data: [] } }),
    });
    renderWithProviders(<TasksPage />);
    expect(await screen.findByRole('button', { name: /recover/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry routing/i })).toBeNull();
  });
});
