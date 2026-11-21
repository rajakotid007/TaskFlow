import { describe, expect, it, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { DashboardPage } from '../pages/DashboardPage';
import { mockApi, renderWithProviders } from '../test/renderWithProviders';

const summary = {
  counts: {
    total_tasks: 12, awaiting_routing: 2, awaiting_acceptance: 3, active_assignments: 4,
    unresolved_routing_requests: 2, requiring_intervention: 1, declined_or_failed: 1, completed: 2,
  },
  open_by_priority: { urgent: 2, high: 3, medium: 4, low: 1 },
  unresolved_requests: [{ task_id: 7, title: 'Investigate Redis timeouts', priority: 'urgent', pending_seconds: 95 }],
  activity: [{ id: 1, task_id: 7, task_title: 'Investigate Redis timeouts', event_type: 'routing_started', explanation: 'x', created_at: new Date().toISOString() }],
};

afterEach(() => vi.unstubAllGlobals());

describe('Operations dashboard', () => {
  it('renders every metric from the API response', async () => {
    mockApi({ '/api/v1/dashboard/summary': () => ({ body: summary }) });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByTestId('metric-total-tasks')).toHaveTextContent('12');
    expect(screen.getByTestId('metric-awaiting-routing')).toHaveTextContent('2');
    expect(screen.getByTestId('metric-declined-or-failed')).toHaveTextContent('1');
    expect(screen.getByTestId('metric-completed')).toHaveTextContent('2');
  });

  it('describes unresolved routing as waiting, never as failed', async () => {
    mockApi({ '/api/v1/dashboard/summary': () => ({ body: summary }) });
    renderWithProviders(<DashboardPage />);
    const link = (await screen.findAllByRole('link', { name: 'Investigate Redis timeouts' }))[0];
    const item = link.closest('li') as HTMLElement;
    expect(within(item).getByText(/may be slow or may not return/i)).toBeInTheDocument();
    expect(within(item).getByText(/^1m \d{2}s$/)).toBeInTheDocument();
    expect(item).not.toHaveTextContent(/failed/i);
  });

  it('shows an error with retry when the summary cannot load', async () => {
    mockApi({ '/api/v1/dashboard/summary': () => ({ status: 500, body: { error: { code: 'internal_error', message: 'x' } } }) });
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
