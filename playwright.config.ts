import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:43127',
    viewport: { width: 1180, height: 820 },
    launchOptions: {
      executablePath: '/usr/local/bin/google-chrome',
    },
  },
  reporter: 'line',
})
