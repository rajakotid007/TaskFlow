import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, ErrorState } from '../components/ui';
import { formatDuration } from '../lib/format';
import { ApiError } from '../api/client';

describe('status presentation', () => {
  it('labels routing pending distinctly from awaiting acceptance', () => {
    render(<><StatusBadge status="routing_pending" /><StatusBadge status="awaiting_acceptance" /></>);
    expect(screen.getByText('Routing pending')).toBeInTheDocument();
    expect(screen.getByText('Awaiting acceptance')).toBeInTheDocument();
  });

  it('formats elapsed waiting time for operators', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(47)).toBe('47s');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('API error handling', () => {
  it('offers a retry for server errors and says nothing was changed', () => {
    render(<ErrorState error={new ApiError(500, 'internal_error', 'boom')} onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/your data was not changed/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows field-level validation messages without a retry for 422', () => {
    const err = new ApiError(422, 'validation_failed', 'Title is required.', {
      fields: [{ field: 'title', message: 'Title is required.' }],
    });
    render(<ErrorState error={err} onRetry={() => {}} />);
    expect(screen.getAllByText('Title is required.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('marks network failures as retryable', () => {
    expect(new ApiError(0, 'network_error', 'x').retryable).toBe(true);
    expect(new ApiError(409, 'conflict', 'x').retryable).toBe(false);
  });
});
