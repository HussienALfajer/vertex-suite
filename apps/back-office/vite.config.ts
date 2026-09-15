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
     * The workspace packages resolve to their **source**, for the reason the
     * sandbox gives: consuming the build means every library edit needs a
     * rebuild and a restart, and a stale pre-bundled copy looks exactly like a
     * fixed bug that has not been fixed.
     *
     * `@vertex/sec` is deliberately **absent** from this list, and its absence
     * is the point. The module is the system of record and runs where the data
     * is; it hashes passwords with scrypt from Node's standard library and
     * cannot be bundled into a browser at all. What this app names is
     * `@vertex/sec/contract`, which is types and keys and nothing that runs —
     * resolved through the package's own exports map, from its build.
     */
    alias: [
      { find: /^@vertex\/ui$/, replacement: source('ui') },
      { find: /^@vertex\/kernel$/, replacement: source('kernel') },
      { find: /^@vertex\/i18n$/, replacement: source('i18n') },
    ],
  },
  server: { port: 5181 },
});
