import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Routes fetch calls to handlers keyed by path prefix. Unmatched calls fail the test loudly. */
export function mockApi(routes: Record<string, (init?: RequestInit, url?: URL) => { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    calls.push({ url: url.pathname + url.search, method });
    const key = Object.keys(routes).find((k) => url.pathname === k || url.pathname.startsWith(`${k}/`) && k !== '/api/v1/tasks' || url.pathname === k);
    if (!key) throw new Error(`Unmocked request: ${method} ${url.pathname}${url.search}`);
    const { status = 200, body } = routes[key](init, url);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}
