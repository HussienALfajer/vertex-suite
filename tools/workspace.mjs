/**
 * The workspace, read from the one place that defines it.
 *
 * Every check here has to know which directories are packages. Each of them
 * once knew it as a hand-written list, which is a list that is correct until
 * somebody adds a package — and the failure is silent in the worst direction:
 * the new package is simply never checked, and nobody finds out from a check
 * that keeps passing.
 *
 * `pnpm-workspace.yaml` already states it, and it has to be right for anything
 * to install at all, so it is read rather than repeated. The globs it uses are
 * one trailing `*` per line, which is the whole of the YAML understood here; a
 * dependency on a parser would have to be pinned, audited and updated for a
 * file of five lines.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** @typedef {{ name: string, dir: string, exported: string[], manifest: object }} WorkspacePackage */

function posixPath(full) {
  return relative(ROOT, full).split(sep).join('/');
}

function readGlobs() {
  const source = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [];
  let inPackages = false;
  for (const line of source.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    // A key at column zero ends the list; anything else at that level is not ours.
    if (inPackages && /^\S/.test(line)) break;
    const entry = inPackages ? /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line) : null;
    if (entry !== null) globs.push(entry[1]);
  }
  return globs;
}

function directoriesIn(dir) {
  try {
    return readdirSync(dir).filter((entry) => {
      if (entry === 'node_modules' || entry.startsWith('.')) return false;
      return statSync(join(dir, entry)).isDirectory();
    });
  } catch {
    return [];
  }
}

function expand(glob) {
  let candidates = [ROOT];
  for (const segment of glob.split('/')) {
    candidates =
      segment === '*'
        ? candidates.flatMap((dir) => directoriesIn(dir).map((entry) => join(dir, entry)))
        : candidates.map((dir) => join(dir, segment));
  }
  return candidates;
}

/**
 * Every package in the workspace, in the order the globs list them.
 *
 * `exported` is what the package's own exports map publishes, which is the only
 * thing another package may reach — `check-boundaries.mjs` holds it to that.
 *
 * @returns {WorkspacePackage[]}
 */
export function workspacePackages() {
  /** @type {WorkspacePackage[]} */
  const packages = [];
  const seen = new Set();

  for (const glob of readGlobs()) {
    for (const dir of expand(glob)) {
      const manifestPath = join(dir, 'package.json');
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        continue;
      }
      const posix = posixPath(dir);
      if (seen.has(posix)) continue;
      seen.add(posix);

      // An exports map is either a list of subpaths or, in the shorthand, the
      // conditions of the package's own entry. Reading the second as a list of
      // subpaths would report a package as publishing "types" and "default"
      // but not itself, which is a confusing way of saying nothing is wrong.
      const exports = manifest.exports;
      const keys = typeof exports === 'object' && exports !== null ? Object.keys(exports) : [];
      packages.push({
        name: manifest.name,
        dir: posix,
        exported: keys.some((key) => key.startsWith('.')) ? keys : ['.'],
        manifest,
      });
    }
  }

  return packages;
}

const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'test-results']);

/** Every file under `dir` whose name matches, with `node_modules` and build output left out. */
export function* filesUnder(dir, matches) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* filesUnder(full, matches);
    } else if (matches(entry)) {
      yield full;
    }
  }
}

export { posixPath };
