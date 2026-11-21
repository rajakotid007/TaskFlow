export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Field errors from a 422 validation_failed response, keyed by attribute. */
  get fieldErrors(): Record<string, string[]> {
    if (this.code !== 'validation_failed' || !this.details) return {}
    return this.details as Record<string, string[]>
  }
}

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/**
 * Elapsed-time displays must agree with the server, not the operator's PC
 * clock (a clock 30 s fast would turn every routing request amber at once).
 * Each response's Date header gives the server time to the second.
 */
let clockOffsetMs = 0

export function serverNow() {
  return Date.now() + clockOffsetMs
}

function syncClock(res: Response) {
  const header = res.headers?.get?.('Date')
  if (!header) return
  const server = Date.parse(header)
  if (Number.isNaN(server)) return
  // The header has 1 s resolution; +500 ms centres the estimate. Small
  // differences are noise and would make timers jump back and forth.
  const offset = server + 500 - Date.now()
  if (Math.abs(offset - clockOffsetMs) > 1500) clockOffsetMs = offset
}

type Query = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, query?: Query) {
  const url = `${BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  { body, query }: { body?: unknown; query?: Query } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the TaskFlow API. Check that the backend is running.')
  }

  syncClock(res)
  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      // Non-JSON body (e.g. proxy error page) — handled below.
    }
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? `Request failed (${res.status} ${res.statusText})`,
      err?.details,
    )
  }
  return json as T
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
}
