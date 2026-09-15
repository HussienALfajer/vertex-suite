import { defineConfig } from 'vitest/config';

/**
 * The checks in this directory are the build's own conscience, and a check
 * nobody tests is a check that stops catching things without saying so. They
 * are plain Node rather than a workspace package, so they run from here instead
 * of through turbo.
 */
export default defineConfig({
  test: {
    include: ['tools/**/*.test.mjs'],
  },
});
