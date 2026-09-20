import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Component tests need a document. The token and palette suites do not, and
    // run in the same environment rather than in a second configuration.
    environment: 'happy-dom',
    // happy-dom announces a selection that has not moved, and React Aria's date
    // segments move it on every announcement — see the file for the loop.
    setupFiles: ['../../tools/happy-dom-selection.mjs'],
  },
});
