import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { formatDuration } from '../lib/format'

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('turns API error bodies into ApiError with code and field errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'validation_failed', message: 'Title can\'t be blank', details: { title: ["can't be blank"] } } }), { status: 422 }),
    ))
    const err = (await api.post('/tasks', {}).catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'validation_failed', message: "Title can't be blank" })
    expect(err.fieldErrors).toEqual({ title: ["can't be blank"] })
  })

  it('reports an unreachable backend clearly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(api.get('/tasks')).rejects.toMatchObject({ code: 'network_error', message: expect.stringContaining('Cannot reach') })
  })

  it('handles non-JSON error pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })))
    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 502, message: 'Request failed (502 Bad Gateway)' })
  })
})

describe('formatDuration', () => {
  it.each([
    [5, '5s'],
    [65, '1m 05s'],
    [3725, '1h 02m'],
    [90000, '1d 1h'],
  ])('%i → %s', (s, out) => expect(formatDuration(s)).toBe(out))
})
