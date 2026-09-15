import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The screen tests need a document. The composition test does not and does
    // not mind one — it runs in Node either way, which is what lets it host the
    // real `SEC` that no browser could.
    environment: 'happy-dom',
  },
});
