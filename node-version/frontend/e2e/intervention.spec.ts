import { test, expect } from '@playwright/test';
import { createRoutedTask, expectStatus } from './helpers';

// Use case 3: a manual decision made while routing is pending must survive the late routing result.
test('late routing result cannot overwrite a manual assignment', async ({ page }) => {
  await createRoutedTask(page, 'E2E late result', 'Python', 'delayed');
  await expectStatus(page, 'routing_pending');

  await page.locator('#manual-contributor').selectOption({ index: 1 });
  const chosen = await page.locator('#manual-contributor option:checked').textContent();
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expectStatus(page, 'awaiting_acceptance');

  // Wait past the 20-second window so the original routing result arrives and is ignored.
  await page.waitForTimeout(24_000);
  await page.reload();
  await expectStatus(page, 'awaiting_acceptance');
  const assignee = page.getByText(chosen!.split(' (')[0], { exact: false }).first();
  await expect(assignee).toBeVisible();

  const history = page.locator('#history');
  await expect(history.getByText('Stale result ignored')).toBeVisible();
  await expect(page.getByText(/late result arrived and was ignored/i)).toBeVisible();
});
