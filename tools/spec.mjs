/**
 * The specification as data, and what the suite claims about it.
 *
 * `docs/core-features.md` and `docs/modules.md` are the only statement of what
 * this product is and in what order it is built. Every tool that needs to know
 * reads them through this file, so that a parser can never drift from a second
 * copy of itself — which is the same failure the checks built on top of it
 * exist to catch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * The units whose work is claimed to be complete.
 *
 * Deliberately a hand-edited line rather than something derived from git. A
 * unit being finished is an assertion a person makes; deriving it from a commit
 * message would let the same act both make the claim and audit it. Add a unit
 * here at the moment you believe it is done — `pnpm check:coverage` then tells
 * you immediately whether that is true.
 */
export const DELIVERED = ['U01', 'U02', 'U03'];

export const MODULES = [
  'SYS',
  'SEC',
  'FX',
  'FIN',
  'CAT',
  'PRC',
  'STK',
  'SYN',
  'PUR',
  'SAL',
  'CSH',
  'POS',
  'CNT',
  'HW',
  'MIG',
  'RPT',
];

const ID = `(?:${MODULES.join('|')})-\\d{2}`;

/** Every feature identifier in a piece of text, in order, without repeats. */
export function featureIdsIn(text) {
  return [...new Set(text.match(new RegExp(`\\b${ID}\\b`, 'g')) ?? [])];
}

function featureId(module, number) {
  return `${module}-${String(number).padStart(2, '0')}`;
}

/**
 * Expands `01`, `01–07` and `01-07` into identifiers.
 *
 * The en dash is what the tables actually use; the hyphen is accepted so that a
 * hand-typed range does not silently expand to nothing.
 */
function expand(module, numbers, onProblem) {
  const ids = [];
  for (const token of numbers.split(',')) {
    const range = /^\s*(\d{2})\s*[–-]\s*(\d{2})\s*$/.exec(token);
    const single = /^\s*(\d{2})\s*$/.exec(token);
    if (range === null && single === null) {
      onProblem(`${module}: "${token.trim()}" is not a feature number.`);
      continue;
    }
    const from = Number(range ? range[1] : single[1]);
    const to = Number(range ? range[2] : single[1]);
    for (let n = from; n <= to; n += 1) ids.push(featureId(module, n));
  }
  return ids;
}

/**
 * Reads both documents and checks them against each other.
 *
 * Returns the features, the units in build order, who owns what, and every
 * disagreement found on the way. The disagreements matter as much as the data:
 * two tables in `modules.md` state the same mapping, and a specification whose
 * halves have drifted is worse than one that says nothing.
 */
export function readSpec() {
  const problems = [];
  const problem = (where, message) => problems.push({ where, message });

  const featureSource = readFileSync(join(ROOT, 'docs/core-features.md'), 'utf8');
  const featureLines = featureSource.split('\n');
  const features = new Map();

  featureLines.forEach((line, index) => {
    // The trailing group absorbs the star some headings carry. A parser that
    // insisted on the line ending at the closing `**` silently lost three
    // features, which is the failure this whole file exists to prevent.
    const heading = /^\*\*`([A-Z]{2,3}-\d{2})`\s+(.+?)\*\*\s*\S*\s*$/.exec(line);
    if (heading === null) return;
    const [, id, title] = heading;
    if (features.has(id)) {
      problem('docs/core-features.md', `${id} is defined twice.`);
      return;
    }

    const body = [];
    let acceptance = null;
    for (const next of featureLines.slice(index + 1)) {
      if (/^(\*\*`|---|## )/.test(next)) break;
      if (next.startsWith('_Acceptance:_')) {
        acceptance = next.slice('_Acceptance:_'.length).trim();
        continue;
      }
      if (next.trim() !== '') body.push(next.trim());
    }

    features.set(id, { id, title, description: body.join(' '), acceptance });
  });

  const moduleSource = readFileSync(join(ROOT, 'docs/modules.md'), 'utf8');

  // §7: the build order. Order of appearance is the order of work.
  const units = new Map();
  for (const line of moduleSource.split('\n')) {
    const row = /^\|\s*`(U\d{2})`\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (row === null) continue;
    const [, id, delivers, listed] = row;

    const claimed = [];
    for (const span of listed.matchAll(/`([A-Z]{2,3})-(\d{2})`\s*[–-]\s*`([A-Z]{2,3})-(\d{2})`/g)) {
      const [, from, first, to, last] = span;
      if (from !== to) {
        problem('docs/modules.md §7', `${id} ranges from ${from} to ${to}, across two modules.`);
        continue;
      }
      claimed.push(...expand(from, `${first}–${last}`, (m) => problem('docs/modules.md §7', m)));
    }
    // Anything not already taken by a range is a single identifier.
    for (const one of featureIdsIn(listed)) {
      if (!claimed.includes(one)) claimed.push(one);
    }

    units.set(id, { id, delivers: delivers.trim(), claimed });
  }

  // §8: the coverage table, which is the one statement of who owns what.
  const coverage = moduleSource.slice(moduleSource.indexOf('## 8. Coverage'));
  const owner = new Map();
  for (const line of coverage.split('\n')) {
    const row = /^\|\s*`([A-Z]{2,3})`\s*\|(.+)\|\s*$/.exec(line);
    if (row === null) continue;
    const [, module, cell] = row;
    if (!MODULES.includes(module)) continue;

    for (const entry of cell.matchAll(/`(U\d{2})`\s*\(([^)]*)\)/g)) {
      const [, unit, numbers] = entry;
      if (!units.has(unit)) {
        problem('docs/modules.md §8', `${module} names ${unit}, which §7 does not list.`);
      }
      for (const id of expand(module, numbers, (m) => problem('docs/modules.md §8', m))) {
        if (owner.has(id)) {
          problem('docs/modules.md §8', `${id} is claimed by ${owner.get(id)} and by ${unit}.`);
          continue;
        }
        owner.set(id, unit);
      }
    }
  }

  for (const id of features.keys()) {
    if (!owner.has(id)) problem('docs/modules.md §8', `${id} is specified but no unit builds it.`);
  }
  for (const [id, unit] of owner) {
    if (!features.has(id)) {
      problem('docs/core-features.md', `§8 assigns ${id} to ${unit}, but it is not specified.`);
    }
  }

  // The two tables of modules.md against each other. They state the same
  // mapping twice, so they are two chances to be wrong about it.
  for (const unit of units.values()) {
    for (const id of unit.claimed) {
      if (owner.get(id) !== unit.id) {
        problem(
          'docs/modules.md',
          `§7 gives ${id} to ${unit.id}; §8 gives it to ${owner.get(id) ?? 'nobody'}.`,
        );
      }
    }
    for (const [id, owning] of owner) {
      if (owning === unit.id && !unit.claimed.includes(id)) {
        problem('docs/modules.md', `§8 gives ${id} to ${unit.id}; §7's row does not list it.`);
      }
    }
  }

  for (const unit of DELIVERED) {
    if (!units.has(unit)) {
      problem('tools/spec.mjs', `DELIVERED names ${unit}, which modules.md §7 does not.`);
    }
  }

  return { features, units, owner, problems };
}

const SCANNED = ['packages', 'apps'];
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'test-results']);

function* testFiles(dir) {
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
      yield* testFiles(full);
    } else if (/\.(test|spec)\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

/**
 * Every feature identifier that appears in the **name** of a test.
 *
 * The name, and not the file: a comment mentioning a feature explains why the
 * code is shaped as it is, which is a different and much lesser claim than
 * "this feature behaves as specified". Only an assertion that fails when the
 * feature breaks may count as proof of it.
 */
export function readProofs() {
  const proofs = new Map();
  const named = /\b(?:it|test|describe)(?:\.\w+)*\s*\(\s*(['"`])((?:\.|(?!\1)[\s\S])*?)\1/g;

  for (const dir of SCANNED) {
    for (const full of testFiles(join(ROOT, dir))) {
      const file = relative(ROOT, full).split(sep).join('/');
      const source = readFileSync(full, 'utf8');

      for (const match of source.matchAll(named)) {
        const name = match[2];
        const line = source.slice(0, match.index).split('\n').length;
        for (const id of featureIdsIn(name)) {
          proofs.set(id, [...(proofs.get(id) ?? []), { file, line, name }]);
        }
      }
    }
  }

  return proofs;
}
