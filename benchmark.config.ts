import { defineConfig } from '@playwright/test'

if (process.env.PLAYWRIGHT_BASE_URL) throw new Error('Photo benchmarks only run on the local server.')
export default defineConfig({
  testDir: './benchmarks', workers: 1, timeout: 120000,
  use: { baseURL: 'http://127.0.0.1:4190/find-it/', browserName: 'chromium', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4190 --strictPort', url: 'http://127.0.0.1:4190/find-it/', reuseExistingServer: false },
})
