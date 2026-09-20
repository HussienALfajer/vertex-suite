import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The rule `vite.config.ts` states about itself, checked rather than trusted:
 * **every entry point of a package resolves the same way, or none do.**
 *
 * The config's own comment records what breaking it cost — `@vertex/ui/map`
 * resolving to `dist/` beside `@vertex/ui` resolving to `src/` was two module
 * graphs and two React contexts, thrown at from inside a provider that was
 * plainly there. It was then broken again without anybody noticing:
 * `@vertex/sys/contract` sat on `dist/` for a whole unit while `@vertex/sys`
 * sat on `src/`, and nothing failed, because the two copies happened to agree.
 * A rule that only holds while its copies agree is not a rule; this is what
 * makes it one.
 *
 * Read from the files rather than by resolving anything: what is being held
 * is the *statement* in the config against the imports the shipped source
 * actually makes, and both are text.
 */

const app = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(join(app, '..', 'vite.config.ts'), 'utf8');

/** What the config aliases, read off its `find` patterns: `@vertex/sys/contract`, `@vertex/ui`. */
function aliased(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const match of config.matchAll(/find:\s*\/\^(@vertex\\\/[^$]+)\$\//g)) {
    found.add((match[1] ?? '').replaceAll('\\/', '/'));
  }
  return found;
}

/** Every `@vertex/…` specifier the shipped source imports, and the files that import it. */
function imported(): ReadonlyMap<string, readonly string[]> {
  const byPackage = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // Shipped source only. A test imports `@vertex/sec` itself to host the
      // real module in Node, which a browser never does and the config never
      // sees.
      if (!/\.tsx?$/.test(entry) || /\.(test|spec|fixture)\.tsx?$/.test(entry)) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/from\s+'(@vertex\/[^']+)'/g)) {
        const specifier = match[1] ?? '';
        byPackage.set(specifier, [...(byPackage.get(specifier) ?? []), relative(app, full)]);
      }
    }
  };
  walk(app);
  return byPackage;
}

const packageOf = (specifier: string): string => specifier.split('/').slice(0, 2).join('/');

describe('the development resolution of the workspace', () => {
  const aliases = aliased();
  const imports = imported();

  it('reads the aliases off the config, so the rule below is about something', () => {
    expect(aliases.size).toBeGreaterThan(0);
    expect([...imports.keys()].length).toBeGreaterThan(0);
  });

  it('resolves every entry point of a package the same way, or none of them', () => {
    const packages = new Set([...imports.keys()].map(packageOf));
    for (const pkg of packages) {
      const entries = [...imports.keys()].filter((one) => packageOf(one) === pkg);
      const onSource = entries.filter((one) => aliases.has(one));
      // `@vertex/sec` is the one package whose root may never be aliased —
      // it cannot run in a browser — and whose contract still is; the root
      // is not imported by the shipped source at all, so the rule holds by
      // there being nothing to compare it against.
      expect(
        onSource.length === 0 || onSource.length === entries.length,
        `${pkg} is imported as ${entries.join(', ')} and only ${onSource.join(', ') || 'none'} ` +
          'resolve to source. Two copies of one package are two module graphs, and the day ' +
          'they disagree nothing says so — see the comment on `alias` in vite.config.ts.',
      ).toBe(true);
    }
  });

  it('never resolves the module that hashes passwords into the browser', () => {
    expect(aliases.has('@vertex/sec')).toBe(false);
    expect(imports.has('@vertex/sec')).toBe(false);
  });

  it('aliases only entry points that are actually imported', () => {
    // A stale alias is one that will silently start resolving a future import
    // to a path nobody checked — CSS subpaths are the config's own business.
    for (const alias of aliases) {
      expect(imports.has(alias), `${alias} is aliased and nothing imports it.`).toBe(true);
    }
  });
});
