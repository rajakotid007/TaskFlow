import { expect, test } from '@playwright/test'
import { createRoutedTask, expectStatus, historyEvent, post, setupWorld } from './helpers'

// These run against the real backend and Sidekiq worker. Routing outcomes are
// made deterministic with forced simulation plans; the delays are real.

test('Use case 1 — routine assignment: create, route, accept, inspect history', async ({ page, request }) => {
  test.setTimeout(90_000)
  const { area, contributors } = await setupWorld(request, ['Ada'])
  const title = `Routine ${Date.now()}`

  // Create the task through the UI as a draft.
  await page.goto('/tasks/new')
  await page.getByLabel(/Title/).fill(title)
  await page.getByLabel(/Required expertise/).selectOption(String(area.id))
  await page.getByLabel(/Priority/).selectOption('medium')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByTestId('task-title')).toHaveText(title)
  await expectStatus(page, 'draft')

  // Submit for routing with a forced 3 s engine response.
  const taskId = Number(page.url().split('/').pop())
  await post(request, `/tasks/${taskId}/route`, { simulation: { behavior: 'respond', delay_seconds: 3 } })
  await expectStatus(page, 'routing_pending')
  await expect(page.getByTestId('state-explanation')).toContainText('Results usually arrive within')

  // The engine's answer arrives via the worker and the page updates by itself.
  await expectStatus(page, 'awaiting_acceptance')
  await expect(page.getByTestId('state-explanation')).toContainText(contributors[0].name)

  await page.getByRole('button', { name: 'Record acceptance' }).click()
  await expectStatus(page, 'assigned')
  await expect(page.getByTestId('assignment').first()).toHaveAttribute('data-status', 'accepted')
  await expect(page.getByTestId('routing-attempt').first()).toHaveAttribute('data-status', 'matched')

  for (const type of ['task_created', 'routing_requested', 'routing_matched', 'assignment_offered', 'assignment_accepted']) {
    await expect(historyEvent(page, type)).toHaveCount(1)
  }
})

test('Use case 2 — unresolved routing stays visible, actionable, and is never called failed', async ({ page, request }) => {
  test.setTimeout(90_000)
  const { area } = await setupWorld(request, ['Ben'])
  const task = await createRoutedTask(request, area.id, `Unresolved ${Date.now()}`, { behavior: 'never_return' })

  await page.goto(`/tasks/${task.id}`)
  await expectStatus(page, 'routing_pending')
  const explanation = page.getByTestId('state-explanation')
  await expect(explanation).toContainText('Results usually arrive within')

  // Cross the normal 20 s window (no faster clock is available end-to-end).
  await expect(explanation).toContainText('has not failed', { timeout: 30_000 })
  await expect(explanation).toContainText('longer than the usual')
  await expect(page.getByTestId('pending-timer').first()).toContainText('beyond usual window')
  await expectStatus(page, 'routing_pending')
  await expect(page.getByRole('button', { name: 'Assign manually' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Restart routing' })).toBeEnabled()

  // The operator can keep working elsewhere; the task is listed as unresolved.
  await page.goto('/tasks?view=unresolved')
  const row = page.locator(`[data-testid="task-row"][data-task-id="${task.id}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Routing pending')
  await expect(row).not.toContainText(/failed/i)

  // Survives a browser refresh: state lives on the server.
  await page.reload()
  await expect(row).toBeVisible()
})

test('Use case 3 — manual intervention while pending; the late result is ignored', async ({ page, request }) => {
  const { area, contributors } = await setupWorld(request, ['Cara', 'Dev'])
  const [cara, dev] = contributors
  const task = await createRoutedTask(request, area.id, `Intervene ${Date.now()}`, { behavior: 'respond', delay_seconds: 8 })

  await page.goto(`/tasks/${task.id}`)
  await expectStatus(page, 'routing_pending')

  await page.getByRole('button', { name: 'Assign manually' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('will be superseded')
  await dialog.getByRole('radio', { name: new RegExp(dev.name) }).check()
  await dialog.getByLabel(/Note/).fill('Dev owns this area')
  await dialog.getByRole('button', { name: 'Assign' }).click()

  await expectStatus(page, 'assigned')
  await expect(page.getByTestId('state-explanation')).toContainText(`${dev.name} owns this task`)
  await expect(page.getByTestId('routing-attempt').first()).toHaveAttribute('data-status', 'superseded')

  // The original request returns ~8 s after it was sent (it would pick Cara, who has no load).
  await expect(historyEvent(page, 'stale_result_ignored')).toHaveCount(1, { timeout: 20_000 })
  await expect(historyEvent(page, 'stale_result_ignored')).toContainText(`proposed ${cara.name}`)
  await expect(page.getByText('Late result ignored').first()).toBeVisible()

  // The operator's decision stands and there is still exactly one active assignment.
  await expectStatus(page, 'assigned')
  await expect(page.getByTestId('assignment')).toHaveCount(1)
  await expect(page.getByTestId('assignment').first()).toContainText(dev.name)
})

test('Use case 4 — recovery after a decline: reason visible, previous attempts kept', async ({ page, request }) => {
  const { area, contributors } = await setupWorld(request, ['Eve', 'Finn'])
  const [eve, finn] = contributors
  const task = await createRoutedTask(request, area.id, `Recover ${Date.now()}`, { behavior: 'respond', delay_seconds: 2 })

  await page.goto(`/tasks/${task.id}`)
  await expectStatus(page, 'awaiting_acceptance')
  await expect(page.getByTestId('state-explanation')).toContainText(eve.name)

  await page.getByRole('button', { name: 'Record decline' }).click()
  await page.getByRole('dialog').getByLabel('Reason given').fill('On holiday next week')
  await page.getByRole('dialog').getByRole('button', { name: 'Record decline' }).click()

  await expectStatus(page, 'declined')
  await expect(page.getByTestId('state-explanation')).toContainText('declined: “On holiday next week”')
  await expect(page.getByRole('button', { name: 'Retry routing' })).toBeVisible()

  // Recover by choosing a different contributor; Eve is flagged as having declined.
  await page.getByRole('button', { name: 'Assign manually' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Declined before')).toBeVisible()
  await dialog.getByRole('radio', { name: new RegExp(finn.name) }).check()
  await dialog.getByRole('button', { name: 'Assign' }).click()

  await expectStatus(page, 'assigned')
  const assignments = page.getByTestId('assignment')
  await expect(assignments).toHaveCount(2)
  await expect(page.locator('[data-testid="assignment"][data-status="declined"]')).toContainText('On holiday next week')
  await expect(page.locator('[data-testid="assignment"][data-status="accepted"]')).toContainText(finn.name)
  await expect(historyEvent(page, 'assignment_declined')).toContainText('On holiday next week')
  await expect(historyEvent(page, 'manual_assignment')).toHaveCount(1)
})

test('Recovery by retrying routing skips the contributor who declined', async ({ page, request }) => {
  const { area, contributors } = await setupWorld(request, ['Gus', 'Hana'])
  const [gus, hana] = contributors
  const task = await createRoutedTask(request, area.id, `Retry ${Date.now()}`, { behavior: 'respond', delay_seconds: 2 })

  await page.goto(`/tasks/${task.id}`)
  await expectStatus(page, 'awaiting_acceptance')
  await expect(page.getByTestId('state-explanation')).toContainText(gus.name)
  const offer = (await (await request.get(`/api/v1/tasks/${task.id}`)).json()).data.current_assignment
  await post(request, `/assignments/${offer.id}/decline`, { reason: 'Busy' })
  await expectStatus(page, 'declined')

  await post(request, `/tasks/${task.id}/recover`, { recovery_action: 'retry_routing', simulation: { behavior: 'respond', delay_seconds: 2 } })
  await expectStatus(page, 'awaiting_acceptance')
  await expect(page.getByTestId('state-explanation')).toContainText(hana.name)
  await expect(page.getByTestId('routing-attempt')).toHaveCount(2)
  await expect(historyEvent(page, 'recovery_initiated')).toHaveCount(1)
})
