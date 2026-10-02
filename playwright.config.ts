import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end checks of Vector Maker's direct editing. They run against the
 * dev server, because they read state through a development-only hook
 * (src/devHook.ts). First time on a machine: `npx playwright install chromium`.
 */
const PORT = 5179

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
})
