import { describe, expect, it, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateTaskPage } from '../pages/CreateTaskPage';
import { mockApi, renderWithProviders } from '../test/renderWithProviders';

const expertise = { data: [{ id: 1, name: 'Python' }, { id: 2, name: 'QA' }] };
afterEach(() => vi.unstubAllGlobals());

describe('Create task form', () => {
  it('blocks submission and explains each missing required field', async () => {
    const { calls } = mockApi({ '/api/v1/expertise-areas': () => ({ body: expertise }), '/api/v1/simulation/status': () => ({ body: { controls_enabled: false } }) });
    renderWithProviders(<CreateTaskPage />);
    await screen.findByLabelText(/task title/i);
    await userEvent.click(screen.getByRole('button', { name: /create and submit/i }));

    expect(await screen.findByText('Enter a task title.')).toBeInTheDocument();
    expect(screen.getByText('Choose the required expertise.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('rejects a due date in the past', async () => {
    mockApi({ '/api/v1/expertise-areas': () => ({ body: expertise }), '/api/v1/simulation/status': () => ({ body: { controls_enabled: false } }) });
    renderWithProviders(<CreateTaskPage />);
    await screen.findByLabelText(/task title/i);
    await userEvent.type(screen.getByLabelText(/task title/i), 'Ship it');
    await userEvent.selectOptions(screen.getByLabelText(/required expertise/i), '1');
    await userEvent.type(screen.getByLabelText(/due date/i), '2001-01-01');
    await userEvent.click(screen.getByRole('button', { name: /create and submit/i }));
    expect(await screen.findByText('The due date cannot be in the past.')).toBeInTheDocument();
  });

  it('saves a draft without routing when Save draft is used', async () => {
    const { calls } = mockApi({
      '/api/v1/expertise-areas': () => ({ body: expertise }),
      '/api/v1/simulation/status': () => ({ body: { controls_enabled: false } }),
      '/api/v1/tasks': (init) => ({ status: 201, body: { id: 42, ...JSON.parse(String(init?.body)), status: 'draft' } }),
    });
    renderWithProviders(<CreateTaskPage />);
    await screen.findByLabelText(/task title/i);
    await userEvent.type(screen.getByLabelText(/task title/i), 'Write runbook');
    await userEvent.selectOptions(screen.getByLabelText(/required expertise/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/tasks')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
  });
});
