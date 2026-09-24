import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    // `revisions.test.ts` proves a revision lets go of the ones before it,
    // which only a collection it can ask for can show.
    execArgv: ['--expose-gc'],
  },
});
