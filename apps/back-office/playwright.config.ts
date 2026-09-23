import { defineConfig, devices } from '@playwright/test';

/**
 * The journeys of `design-system.md` §13, extended to this unit's screens.
 *
 * Two projects rather than one: a focus ring invisible in the dark theme is a
 * focus ring that does not exist for half the day, and §2 has the two themes as
 * equals rather than one being a filter over the other.
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: 'real-store.spec.ts',
  globalSetup: './playwright.fixture.setup.ts',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['github']],
  use: {
    baseURL: 'http://localhost:5181',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
  ],
});
