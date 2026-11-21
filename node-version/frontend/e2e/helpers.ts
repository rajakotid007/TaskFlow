import { expect, type Page } from '@playwright/test';

export type Outcome = 'success' | 'delayed' | 'never';

/** Creates and submits a task through the real form, using a dev-only forced outcome. */
export async function createRoutedTask(page: Page, title: string, expertise: string, outcome: Outcome) {
  await page.goto('/tasks/new');
  await page.getByLabel('Task title').fill(title);
  await page.getByLabel('Required expertise').selectOption({ label: expertise });
  await page.getByLabel('Priority').selectOption('high');
  await page.getByLabel('Forced routing outcome').selectOption(outcome);
  await page.getByRole('button', { name: 'Create and submit for routing' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const taskId = Number(new URL(page.url()).pathname.split('/').pop());
  return taskId;
}

export async function expectStatus(page: Page, status: string, timeout = 45_000) {
  await expect(page.getByTestId('status-badge').first()).toHaveAttribute('data-status', status, { timeout });
}
