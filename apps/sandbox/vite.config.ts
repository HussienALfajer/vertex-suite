import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const source = (pkg: string): string =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    /**
     * The workspace packages resolve to their **source**, not their `dist/`.
     *
     * Consuming the build meant every library edit needed a rebuild and a
     * server restart, and a stale pre-bundled copy looked exactly like a fixed
     * bug that had not been fixed — which cost real time here. Pointing at
     * source removes the whole class: an edit in `packages/ui` hot-reloads.
     *
     * Anchored with `^…$` so the subpath exports — `@vertex/ui/theme.css` and
     * the rest — still resolve through the package's own `exports` map.
     */
    alias: [
      { find: /^@vertex\/ui$/, replacement: source('ui') },
      { find: /^@vertex\/kernel$/, replacement: source('kernel') },
      { find: /^@vertex\/i18n$/, replacement: source('i18n') },
      { find: /^@vertex\/platform$/, replacement: source('platform') },
      { find: /^@vertex\/contracts$/, replacement: source('contracts') },
    ],
  },
  server: { port: 5180 },
});
