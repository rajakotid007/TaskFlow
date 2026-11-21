import { test, expect } from '@playwright/test';
import { createRoutedTask, expectStatus } from './helpers';

// Use case 2: a never-returning request stays unresolved, visible, timed, and actionable.
test('unresolved routing stays pending, is never declared failed, and allows intervention', async ({ page }) => {
  await createRoutedTask(page, 'E2E unresolved routing', 'Python', 'never');
  await expectStatus(page, 'routing_pending');

  await expect(page.getByText(/still waiting|Routing has not failed/i).first()).toBeVisible();
  await expect(page.getByText(/Routing has not failed/)).toBeVisible();
  await expect(page.getByText(/^Unresolved for/).first()).toBeVisible();

  // Wait beyond the normal response window: it must still not be treated as failed.
  await page.waitForTimeout(22_000);
  await expectStatus(page, 'routing_pending');
  await expect(page.getByTestId('status-badge').first()).not.toHaveAttribute('data-status', 'declined');
  await expect(page.getByTestId('status-badge').first()).not.toHaveAttribute('data-status', 'assignment_failed');

  // Operator intervenes by choosing a contributor manually.
  await page.locator('#manual-contributor').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expectStatus(page, 'awaiting_acceptance');
  await expect(page.locator('#history').getByText('Manual intervention')).toBeVisible();
});
