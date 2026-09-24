/**
 * The specification as data, and what the suite claims about it.
 *
 * `docs/core-features.md` and `docs/modules.md` are the only statement of what
 * this product is and in what order it is built. Every tool that needs to know
 * reads them through this file, so that a parser can never drift from a second
 * copy of itself — which is the same failure the checks built on top of it
 * exist to catch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { filesUnder, posixPath, workspacePackages } from './workspace.mjs';

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
export const DELIVERED = ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08'];

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
 *
 * The sources default to the documents on disk and can be handed in instead,
 * which is how `spec.test.mjs` holds the parser to its word. This parser once
 * lost three features without a sound, and a parser whose only test is the real
 * specification can notice that only by somebody counting.
 *
 * @param {{ features?: string, modules?: string, delivered?: readonly string[] }} [sources]
 */
export function readSpec(sources = {}) {
  const problems = [];
  const problem = (where, message) => problems.push({ where, message });

  const featureSource =
    sources.features ?? readFileSync(join(ROOT, 'docs/core-features.md'), 'utf8');
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

  const moduleSource = sources.modules ?? readFileSync(join(ROOT, 'docs/modules.md'), 'utf8');

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

  // The counts the prose states, against the features actually specified. Both
  // documents say how many features there are, and §3 says how many each module
  // has; those figures were once written as 182 in three places and 183 in two,
  // and nothing could notice, because nothing read them.
  const perModule = new Map();
  for (const id of features.keys()) {
    const module = id.slice(0, id.indexOf('-'));
    perModule.set(module, (perModule.get(module) ?? 0) + 1);
  }
  const stated = [
    ['docs/core-features.md', featureSource, /^(\d+) features across/m],
    ['docs/modules.md', moduleSource, /^The (\d+) features of/m],
    ['docs/modules.md §8', coverage, /^Every one of the (\d+) features/m],
  ];
  for (const [where, source, pattern] of stated) {
    const count = pattern.exec(source)?.[1];
    if (count !== undefined && Number(count) !== features.size) {
      problem(where, `states ${count} features; ${String(features.size)} are specified.`);
    }
  }
  for (const line of moduleSource.split('\n')) {
    // §3: | `SYS` | System foundations | **core** | Owns | Depends on | 14 |
    const row = /^\|\s*`([A-Z]{2,3})`\s*\|.*\|\s*(\d+)\s*\|\s*$/.exec(line);
    if (row === null || !MODULES.includes(row[1])) continue;
    const [, module, count] = row;
    const actual = perModule.get(module) ?? 0;
    if (Number(count) !== actual) {
      problem(
        'docs/modules.md §3',
        `${module} states ${count} features; ${String(actual)} are specified.`,
      );
    }
  }

  for (const unit of sources.delivered ?? DELIVERED) {
    if (!units.has(unit)) {
      problem('tools/spec.mjs', `DELIVERED names ${unit}, which modules.md §7 does not.`);
    }
  }

  return { features, units, owner, problems };
}

/**
 * Modifiers under which a named test is evidence of nothing.
 *
 * `check:coverage` runs after the suites so that "proven" means a test that
 * passed. A skipped test did not run, a `todo` has no body, and `fails` is green
 * precisely when its assertions do not hold — each of them passes the run, and
 * none of them is an assertion that the feature behaves as specified.
 */
const NOT_EVIDENCE = new Set(['skip', 'todo', 'fails']);

/**
 * Every feature identifier that appears in the **name** of a test, across a set
 * of test files.
 *
 * The name, and not the file: a comment mentioning a feature explains why the
 * code is shaped as it is, which is a different and much lesser claim than
 * "this feature behaves as specified". Only an assertion that fails when the
 * feature breaks may count as proof of it.
 *
 * @param {readonly { file: string, source: string }[]} files
 */
export function proofsIn(files) {
  const proofs = new Map();
  for (const { file, source } of files) {
    for (const { modifiers, name, index } of namedTestsIn(source)) {
      if (modifiers.some((one) => NOT_EVIDENCE.has(one))) continue;
      const line = source.slice(0, index).split('\n').length;
      for (const id of featureIdsIn(name)) {
        proofs.set(id, [...(proofs.get(id) ?? []), { file, line, name }]);
      }
    }
  }
  return proofs;
}

/**
 * Modifiers that take arguments of their own before the test's name:
 * `describe.skipIf(!database)('SYN-02 …')`, `it.each(rows)('…')`.
 *
 * Read past rather than stopped at. A reader that expected the name straight
 * after the modifiers saw an argument list instead and moved on without a
 * word — and the whole of `SYN-02`'s store-node and storage suites, written
 * behind `skipIf` because they need a database, counted as proof of nothing
 * while looking, to anybody reading them, like the proof. A condition on the
 * environment is not `skip`: CI provides the database and those files refuse
 * to run there without it, so the suite runs where the claim is audited.
 */
const TAKES_ARGUMENTS = new Set(['skipIf', 'runIf', 'each', 'for']);

/** The index just past the bracket closing the one at `open`, stepping over strings. */
function pastBalanced(source, open) {
  let depth = 0;
  let quote = null;
  for (let at = open; at < source.length; at += 1) {
    const char = source[at];
    if (quote !== null) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return -1;
}

/**
 * Every call to `it`, `test` or `describe` whose name is a string literal: the
 * modifiers it was called through, the name, and where it begins.
 *
 * The name runs to the closing quote, stepping over an escaped one: a name
 * like 'the tenant\'s own term' is one name, not a name that ends at "tenant".
 */
function* namedTestsIn(source) {
  const head = /\b(?:it|test|describe)\b/g;
  const modifier = /\s*\.\s*(\w+)/y;
  const name = /\s*\(\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/y;
  for (const match of source.matchAll(head)) {
    let at = match.index + match[0].length;
    const modifiers = [];
    for (;;) {
      modifier.lastIndex = at;
      const next = modifier.exec(source);
      if (next === null) break;
      modifiers.push(next[1]);
      at = modifier.lastIndex;
      if (TAKES_ARGUMENTS.has(next[1])) {
        const open = source.slice(at).search(/\S/) + at;
        if (source[open] !== '(') break;
        at = pastBalanced(source, open);
        if (at === -1) break;
      }
    }
    if (at === -1) continue;
    name.lastIndex = at;
    const called = name.exec(source);
    if (called !== null) yield { modifiers, name: called[2], index: match.index };
  }
}

/**
 * Every proof in the workspace's own tests — every package the workspace
 * declares, read from the same place the other checks read it, so a package
 * added tomorrow has its tests counted without anybody remembering to.
 */
export function readProofs() {
  const files = [];
  for (const pkg of workspacePackages()) {
    for (const full of filesUnder(join(ROOT, pkg.dir), (name) =>
      /\.(test|spec)\.tsx?$/.test(name),
    )) {
      files.push({ file: posixPath(full), source: readFileSync(full, 'utf8') });
    }
  }
  return proofsIn(files);
}
