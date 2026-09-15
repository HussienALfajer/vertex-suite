#!/usr/bin/env node
/**
 * The definition of finished, made checkable.
 *
 * `modules.md` §7 states it exactly: **a unit is finished when the acceptance
 * criteria of every feature it names are automated and passing.** Until this
 * check existed, nothing verified that. A unit was finished because somebody
 * said so, and with 182 features across 30 units the claim becomes unauditable
 * long before the last one — not through carelessness, but because nobody can
 * hold 182 acceptance criteria in mind and notice the one that was quietly
 * proven by a neighbouring test.
 *
 * Nothing here is maintained by hand except the list of delivered units. The
 * feature list is read from `core-features.md`, the ownership from the coverage
 * table of `modules.md` §8, and the proof from the names of the tests
 * themselves. The two documents are therefore also checked against each other,
 * which is the second thing this catches: a specification that drifts from its
 * own map.
 *
 * It runs **after** the suites in `pnpm verify`, so "proven" means a test that
 * names the feature inside a run that went green, rather than a test that
 * merely exists. The keyboard journeys are a separate job, so the guarantee is
 * a property of the pipeline rather than of any single command — which is also
 * true of every other check here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * The units whose work is claimed to be complete.
 *
 * Deliberately a hand-edited line rather than something derived from git. A
 * unit being finished is an assertion a person makes; deriving it from a commit
 * message would let the assertion be made by the same act that is supposed to
 * be audited. Add a unit here at the moment you believe it is done — this check
 * then immediately tells you whether that is true.
 */
const DELIVERED = ['U01', 'U02', 'U03'];

const MODULES = [
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

const FEATURE_ID = new RegExp(`\\b(${MODULES.join('|')})-(\\d{2})\\b`, 'g');

const SCANNED = ['packages', 'apps'];
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'test-results']);

const findings = [];

function report(where, message) {
  findings.push({ where, message });
}

/** `**\`SYS-01\`** Arabic-first RTL interface` — the heading of every feature. */
function readFeatures() {
  const source = readFileSync(join(ROOT, 'docs/core-features.md'), 'utf8');
  const lines = source.split('\n');
  const features = new Map();

  lines.forEach((line, index) => {
    // The trailing group absorbs the star some headings carry. A parser that
    // insisted on the line ending at the closing `**` silently lost three
    // features, which is the failure this whole file exists to prevent.
    const match = /^\*\*`([A-Z]{2,3}-\d{2})`\s+(.+?)\*\*\s*\S*\s*$/.exec(line);
    if (match === null) return;
    const [, id, title] = match;
    if (features.has(id)) {
      report('docs/core-features.md', `${id} is defined twice.`);
      return;
    }
    // An explicit acceptance criterion is the sentence a test should be able to
    // be written straight from. Counted so the summary can say how many of them
    // the suite is actually standing behind.
    const acceptance = lines
      .slice(index + 1, index + 8)
      .some((next) => next.startsWith('_Acceptance:_'));
    features.set(id, { title, acceptance });
  });

  return features;
}

/** `| \`U01\` | Workspace, build, … |` — the unit rows of §7. */
function readUnits() {
  const source = readFileSync(join(ROOT, 'docs/modules.md'), 'utf8');
  const units = new Set();
  for (const line of source.split('\n')) {
    const match = /^\|\s*`(U\d{2})`\s*\|/.exec(line);
    if (match !== null) units.add(match[1]);
  }
  return units;
}

/**
 * `| \`CAT\` | \`U08\` (01, 02, 04) · \`U13\` (03, 05–07) |` — the coverage
 * table of §8, which is the one statement of who owns what.
 */
function readCoverage(units) {
  const source = readFileSync(join(ROOT, 'docs/modules.md'), 'utf8');
  const section = source.slice(source.indexOf('## 8. Coverage'));
  const owner = new Map();

  for (const line of section.split('\n')) {
    const row = /^\|\s*`([A-Z]{2,3})`\s*\|(.+)\|\s*$/.exec(line);
    if (row === null) continue;
    const [, module, cell] = row;
    if (!MODULES.includes(module)) continue;

    for (const entry of cell.matchAll(/`(U\d{2})`\s*\(([^)]*)\)/g)) {
      const [, unit, numbers] = entry;
      if (!units.has(unit)) {
        report('docs/modules.md §8', `${module} names ${unit}, which §7 does not list.`);
      }
      for (const token of numbers.split(',')) {
        // The en dash is what the table actually uses; the hyphen is accepted
        // so that a hand-typed range does not silently cover nothing.
        const range = /^\s*(\d{2})\s*[–-]\s*(\d{2})\s*$/.exec(token);
        const single = /^\s*(\d{2})\s*$/.exec(token);
        const from = range ? Number(range[1]) : single ? Number(single[1]) : null;
        const to = range ? Number(range[2]) : from;
        if (from === null) {
          report('docs/modules.md §8', `${module}: "${token.trim()}" is not a feature number.`);
          continue;
        }
        for (let n = from; n <= to; n += 1) {
          const id = `${module}-${String(n).padStart(2, '0')}`;
          if (owner.has(id)) {
            report('docs/modules.md §8', `${id} is claimed by ${owner.get(id)} and by ${unit}.`);
            continue;
          }
          owner.set(id, unit);
        }
      }
    }
  }

  return owner;
}

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
 * code is shaped as it is, which is a different and lesser claim than "this
 * feature behaves as specified". Only an assertion that fails when the feature
 * breaks may count as proof of it.
 */
function readProofs() {
  const proofs = new Map();
  const named = /\b(?:it|test|describe)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

  for (const dir of SCANNED) {
    for (const full of testFiles(join(ROOT, dir))) {
      const file = relative(ROOT, full).split(sep).join('/');
      const source = readFileSync(full, 'utf8');

      for (const match of source.matchAll(named)) {
        const name = match[2];
        const line = source.slice(0, match.index).split('\n').length;
        for (const id of new Set([...name.matchAll(FEATURE_ID)].map(([whole]) => whole))) {
          const existing = proofs.get(id);
          const proof = { file, line, name };
          if (existing === undefined) proofs.set(id, [proof]);
          else existing.push(proof);
        }
      }
    }
  }

  return proofs;
}

const features = readFeatures();
const units = readUnits();
const owner = readCoverage(units);
const proofs = readProofs();
const delivered = new Set(DELIVERED);

for (const unit of DELIVERED) {
  if (!units.has(unit)) {
    report('tools/check-coverage.mjs', `DELIVERED names ${unit}, which modules.md §7 does not.`);
  }
}

// The two documents against each other.
for (const id of features.keys()) {
  if (!owner.has(id)) {
    report('docs/modules.md §8', `${id} is specified but no unit builds it.`);
  }
}
for (const id of owner.keys()) {
  if (!features.has(id)) {
    report(
      'docs/core-features.md',
      `§8 assigns ${id} to ${owner.get(id)}, but it is not specified.`,
    );
  }
}

// The claim of completion against the suite.
for (const [id, unit] of owner) {
  if (delivered.has(unit) && !proofs.has(id)) {
    report(
      `${unit}`,
      `${id} is claimed delivered and no test names it. ` +
        `Either a test asserts "${features.get(id)?.title ?? id}" — and says so in its name — or ${unit} is not finished.`,
    );
  }
}

// The suite against the specification.
//
// Only an identifier that is not a feature fails. Naming a feature whose unit
// has not been delivered is not an error — it is how a unit begins, since the
// acceptance tests of a slice are written from the specification before the
// code that satisfies them, and it is also how a lower layer records which
// future feature a primitive was shaped for. Those are reported below instead,
// so the standing work stays visible on every run.
const standing = new Map();
for (const [id, where] of proofs) {
  const at = where.map((one) => `${one.file}:${String(one.line)}`).join(', ');
  if (!features.has(id)) {
    report(at, `A test claims ${id}, which is not a feature. Check the identifier.`);
    continue;
  }
  const unit = owner.get(id);
  if (unit !== undefined && !delivered.has(unit)) {
    standing.set(unit, [...(standing.get(unit) ?? []), id]);
  }
}

if (findings.length > 0) {
  for (const { where, message } of findings) {
    process.stdout.write(`${where}  ${message}\n`);
  }
  process.stdout.write(`\ncheck:coverage found ${String(findings.length)} problem(s).\n`);
  process.exit(1);
}

const owned = [...owner.entries()].filter(([, unit]) => delivered.has(unit));
const withAcceptance = [...features.values()].filter((one) => one.acceptance).length;

process.stdout.write(
  `check:coverage: ${String(features.size)} features across ${String(units.size)} units, ` +
    `${String(withAcceptance)} with a stated acceptance criterion.\n` +
    `  delivered: ${DELIVERED.join(', ')} — ${String(owned.length)} feature(s), every one proven.\n`,
);

for (const unit of [...standing.keys()].sort()) {
  const ids = (standing.get(unit) ?? []).sort();
  process.stdout.write(`  standing:  ${unit} — ${ids.join(', ')}\n`);
}
