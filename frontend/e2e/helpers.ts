import { expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Each test builds its own isolated world — a unique expertise area and
 * contributors who only have that expertise — so tests never compete with
 * seed data or each other for capacity.
 */
export async function setupWorld(request: APIRequestContext, contributorNames: string[]) {
  const uid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const area = await post(request, '/expertise_areas', { expertise_area: { name: `E2E ${uid}` } })
  const contributors = []
  for (const name of contributorNames) {
    contributors.push(
      await post(request, '/contributors', {
        contributor: { name: `${name} ${uid}`, email: `${name.toLowerCase()}.${uid}@e2e.test`, expertise_area_ids: [area.id] },
      }),
    )
  }
  return { uid, area, contributors: contributors as { id: number; name: string }[] }
}

export async function post(request: APIRequestContext, path: string, body: unknown) {
  const res = await request.post(`/api/v1${path}`, { data: body })
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy()
  return (await res.json()).data
}

/** Creates a task and routes it with a forced simulation plan (dev-only control). */
export async function createRoutedTask(
  request: APIRequestContext,
  areaId: number,
  title: string,
  simulation: { behavior: 'respond' | 'never_return'; delay_seconds?: number },
) {
  return post(request, '/tasks', { task: { title, required_expertise_id: areaId, priority: 'high' }, submit: true, simulation })
}

export async function expectStatus(page: Page, status: string) {
  await expect(page.getByTestId('task-status')).toHaveAttribute('data-status', status)
}

export function historyEvent(page: Page, type: string) {
  return page.getByTestId('task-history').locator(`[data-event-type="${type}"]`)
}
