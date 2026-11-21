import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../backend', import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://taskflow:taskflow@localhost:5432/taskflow_development',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  ALLOW_SIMULATION_CONTROLS: 'true',
  PORT: '3000',
} as Record<string, string>;

export default defineConfig({
  testDir: './e2e',
  // Scenarios share one database and real background timing, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Use the Chrome installed on this machine when Playwright's bundled browser is unavailable.
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' },
  },
  webServer: [
    { command: 'npx tsx src/server.ts', cwd: backend, url: 'http://localhost:3000/api/v1/health', reuseExistingServer: true, env, timeout: 60_000 },
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
});
