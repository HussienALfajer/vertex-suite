import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const source = (pkg: string, entry = 'index.ts'): string =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/${entry}`, import.meta.url));

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
      /**
       * **Every entry point of a package resolves the same way, or none do.**
       *
       * `@vertex/ui/map` left off this list resolved through the package's
       * exports to its `dist/`, while `@vertex/ui` resolved to `src/` — two
       * module graphs, two copies of `providers/context.js`, and therefore two
       * React contexts. The map's own components then read the second one,
       * found it empty, and threw *"a Vertex component was rendered outside
       * `<VertexProvider>`"* from inside a provider that was plainly there.
       *
       * It has to come first: the exact-match pattern below would not catch a
       * subpath, but a future loosened one would.
       */
      { find: /^@vertex\/ui\/map$/, replacement: source('ui', 'geo/index.ts') },
      { find: /^@vertex\/ui$/, replacement: source('ui') },
      { find: /^@vertex\/kernel$/, replacement: source('kernel') },
      { find: /^@vertex\/i18n$/, replacement: source('i18n') },
      // `SYS` is the real module, hosted here (`dev-system.ts`) rather than
      // stood in for — nothing in it needs a machine. Left off this list it
      // resolves through the package's `dist/` exports instead of `src/`, and
      // an edit to a rule in `packages/modules/sys` looks like it did nothing
      // until the package is rebuilt: the same stale-copy trap `@vertex/ui/map`
      // fell into above. `@vertex/platform` composes it and needs the same fix
      // for the same reason.
      { find: /^@vertex\/sys$/, replacement: source('modules/sys') },
      { find: /^@vertex\/platform$/, replacement: source('platform') },
    ],
  },
  server: { port: Number(process.env.PORT) || 5181 },
});
