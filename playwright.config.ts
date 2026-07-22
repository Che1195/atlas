import { config as loadEnv } from 'dotenv';
import { defineConfig } from '@playwright/test';

loadEnv({ path: '.env.local' });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // suites share two fixed test identities; serial keeps pre-clean sane
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    { name: 'chromium', use: { browserName: 'chromium' }, dependencies: ['setup'] },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true, // never restart a dev server the owner already has running
    timeout: 60_000,
  },
});
