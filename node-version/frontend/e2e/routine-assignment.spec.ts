import { test, expect } from '@playwright/test';
import { createRoutedTask, expectStatus } from './helpers';

// Use case 1: route, contributor accepts, task becomes assigned, history is inspectable.
test('routine assignment completes from routing to accepted assignment', async ({ page }) => {
  await createRoutedTask(page, 'E2E routine assignment', 'Python', 'success');
  await expectStatus(page, 'routing_pending');
  await expect(page.getByText(/Unresolved for/).first()).toBeVisible();

  // The worker delivers the result after roughly 5 seconds.
  await expectStatus(page, 'awaiting_acceptance');
  await page.getByRole('button', { name: 'Accept' }).click();
  await expectStatus(page, 'assigned');

  const history = page.locator('#history');
  await expect(history.getByText('Assignment accepted')).toBeVisible();
  await expect(history.getByText('Routing started')).toBeVisible();
  await expect(history.getByText('Routing result received')).toBeVisible();
});
