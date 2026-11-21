import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against the real stack: Rails API + Sidekiq worker +
 * Postgres + Redis (docker compose up) and the Vite dev server, with
 * SIMULATION_CONTROLS_ENABLED=true so scenarios are deterministic.
 *
 * PW_CHANNEL selects the browser; defaults to the system Microsoft Edge so no
 * browser download is required. Set PW_CHANNEL=chromium after
 * `npx playwright install chromium` to use the bundled build instead.
 */
const channel = process.env.PW_CHANNEL ?? 'msedge'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // The dev API is slow over Windows bind mounts; more workers just queue.
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'edge', use: { ...devices['Desktop Edge'], ...(channel === 'chromium' ? {} : { channel }) } },
  ],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
