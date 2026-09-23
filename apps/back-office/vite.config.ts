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
     * and that one entry point *is* below, because the keys are values built
     * when the file loads, and a seed revised in it is otherwise a seed the
     * role editor goes on showing the old way until the package is rebuilt.
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
       * The subpaths have to come first: the exact-match patterns below would
       * not catch one, but a future loosened one would.
       *
       * Held by `src/resolution.test.ts`, which reads this list against what
       * the shipped source imports: the rule was broken a second time, without
       * a sound, by a contract entry point left off while its package was on.
       */
      { find: /^@vertex\/ui\/map$/, replacement: source('ui', 'geo/index.ts') },
      { find: /^@vertex\/ui$/, replacement: source('ui') },
      { find: /^@vertex\/kernel$/, replacement: source('kernel') },
      { find: /^@vertex\/i18n$/, replacement: source('i18n') },
      { find: /^@vertex\/contracts$/, replacement: source('contracts') },
      // `SYS` and `FX` are the real modules, hosted here (`dev-system.ts`)
      // rather than stood in for — nothing in either needs a machine. Left off
      // this list they resolve through the package's `dist/` exports instead of
      // `src/`, and an edit to a rule in `packages/modules/sys` or `fx` looks
      // like it did nothing until the package is rebuilt: the same stale-copy
      // trap `@vertex/ui/map` fell into above. Their `/contract` entries come
      // with them, by the rule at the top of this list — `@vertex/sys/contract`
      // once resolved to `dist/` while `@vertex/sys` resolved to `src/`, which
      // was two copies of `SYS_PERMISSIONS` in one page. `@vertex/platform`
      // composes them and needs the same fix for the same reason.
      { find: /^@vertex\/sys\/contract$/, replacement: source('modules/sys', 'contract.ts') },
      { find: /^@vertex\/sys$/, replacement: source('modules/sys') },
      { find: /^@vertex\/fx\/contract$/, replacement: source('modules/fx', 'contract.ts') },
      { find: /^@vertex\/fx$/, replacement: source('modules/fx') },
      { find: /^@vertex\/fin\/contract$/, replacement: source('modules/fin', 'contract.ts') },
      { find: /^@vertex\/fin$/, replacement: source('modules/fin') },
      { find: /^@vertex\/sec\/contract$/, replacement: source('modules/sec', 'contract.ts') },
      { find: /^@vertex\/platform$/, replacement: source('platform') },
    ],
  },
  /**
   * 5181 is the port `playwright.config.ts` and `.claude/launch.json` both
   * name; `PORT` overrides it so a second instance can be started beside a
   * running one.
   *
   * Bracketed because `process.env` is an index signature and the dotted form
   * does not compile under `noPropertyAccessFromIndexSignature` — which is what
   * this line was, until a forced type-check found it behind a warm cache. The
   * form a bundler cannot substitute is harmless here: this file is read by
   * Node, never bundled into a browser, which is why `check:policy` scopes that
   * rule to `src/`.
   */
  server: {
    port: Number(process.env['PORT']) || 5181,
    proxy: {
      '/api': {
        target: process.env['VERTEX_STORE_NODE_URL'] ?? 'http://127.0.0.1:5182',
        rewrite: (path) => path.replace(/^\/api/u, ''),
      },
    },
  },
});
