import { newId } from '@vertex/kernel';
import { defineConfig, devices } from '@playwright/test';

process.env['VERTEX_REAL_TEST_TENANT'] ??= newId<'tenant'>();

export default defineConfig({
  testDir: './e2e',
  testMatch: 'real-store.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['github']],
  use: { baseURL: 'http://localhost:5183', ...devices['Desktop Chrome'] },
  projects: [
    { name: 'real-light', use: { colorScheme: 'light' } },
    { name: 'real-dark', use: { colorScheme: 'dark' } },
  ],
});
