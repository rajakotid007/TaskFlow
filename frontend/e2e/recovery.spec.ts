import { test, expect } from '@playwright/test';
import { createRoutedTask, expectStatus } from './helpers';

// Use case 4: decline, inspect the reason, reopen for routing, and do not re-offer the same contributor.
test('recovery after decline reroutes to a different contributor', async ({ page }) => {
  await createRoutedTask(page, 'E2E recovery', 'Python', 'success');
  await expectStatus(page, 'awaiting_acceptance');

  const first = (await page.getByText(/^Contributor$/).locator('xpath=following-sibling::dd[1]').textContent())?.trim();
  expect(first).toBeTruthy();

  await page.getByRole('button', { name: 'Decline' }).click();
  await page.getByLabel('Decline reason').fill('Currently at capacity');
  await page.getByRole('button', { name: 'Confirm decline' }).click();
  await expectStatus(page, 'declined');
  await expect(page.getByText('Currently at capacity').first()).toBeVisible();

  await page.getByRole('button', { name: 'Retry routing', exact: true }).click();
  await expectStatus(page, 'routing_pending');
  await expectStatus(page, 'awaiting_acceptance');

  const second = (await page.getByText(/^Contributor$/).locator('xpath=following-sibling::dd[1]').textContent())?.trim();
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);
  await expect(page.locator('#history').getByText('Assignment declined')).toBeVisible();
});
