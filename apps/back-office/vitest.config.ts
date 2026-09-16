import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The screen tests need a document. The composition test does not and does
    // not mind one — it runs in Node either way, which is what lets it host the
    // real `SEC` that no browser could.
    environment: 'happy-dom',
    /**
     * Longer than the default five seconds, because nothing here is a unit.
     *
     * Every test in this package mounts the whole application, signs in, and
     * then sets a shop up through its own screens — a company, a branch, a
     * till, a machine — before it asserts anything, and the slowest of them sit
     * a little over four seconds on a developer's machine. CI runs them on
     * Windows and on Linux (`README.md`), where slower is ordinary, so the
     * default would fail a suite that is working rather than report one that is
     * not. A genuine hang still fails, twenty seconds later.
     */
    testTimeout: 20_000,
  },
});
