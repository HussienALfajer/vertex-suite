/**
 * The module boundary of `modules.md` §4, checked rather than trusted.
 *
 * §4 states four rules and then says the thing that matters about two of them:
 * they **decay silently**. Nothing fails when a module reaches past another
 * module's contract. The code compiles, the tests pass, and the cost arrives
 * years later as an edition that cannot drop a module a customer never bought,
 * because eleven files quietly came to depend on it.
 *
 * So rule 1 is checked here, in three forms, because it can be broken in three
 * ways and only the first is visible in review:
 *
 *   - by package name, at the root entry — the module itself rather than its
 *     contract;
 *   - by package name, at a deeper path than the exports map publishes;
 *   - by relative path, which resolves straight across the tree on disk and
 *     which neither the exports map nor the dependency list can see at all.
 *
 * And one thing that makes rule 1 possible in the first place: a contract that
 * imports the implementation behind it is not a contract. Importing it pulls in
 * everything it was supposed to stand in front of, so `CAT-16`'s item card
 * would drag `PUR` into an edition that never bought it.
 *
 * Rule 3 — no query joins across a module boundary — is **not** checked here,
 * and its absence is a decision rather than an oversight. It cannot decay until
 * a module owns a table, no module does yet, and a check written now would have
 * to guess at how those tables come to exist. A guess that guesses wrong is
 * worse than nothing: it sits in the list looking like cover. It belongs to the
 * slice that writes the first schema, which is where what to look for is known.
 *
 * There is deliberately no exemption comment. `check-policy.mjs` has one
 * because its rules have genuine local exceptions. These do not: an exempted
 * breach is a module that can no longer be left out of an edition, and that is
 * not a decision one file gets to make on behalf of the product line.
 */
import { posix } from 'node:path';

/** @typedef {{ name: string, dir: string, exported: readonly string[] }} WorkspacePackage */
/** @typedef {{ file: string, source: string }} SourceFile */
/** @typedef {{ file: string, line: number, rule: string, message: string }} Finding */

const MODULE_ROOT = 'packages/modules/';
const APP_ROOT = 'apps/';
const CONTRACT = './contract';

/** A package under `packages/modules/` is one of the sixteen (modules.md §2). */
function isModule(pkg) {
  return pkg.dir.startsWith(MODULE_ROOT);
}

/** An app composes an edition, so it is the one thing allowed to name modules. */
function isApp(pkg) {
  return pkg.dir.startsWith(APP_ROOT);
}

function contains(dir, path) {
  return path === dir || path.startsWith(`${dir}/`);
}

/** The package a path belongs to; the longest match, so nesting cannot mislead. */
function ownerOf(packages, path) {
  let owner = null;
  for (const pkg of packages) {
    if (contains(pkg.dir, path) && (owner === null || pkg.dir.length > owner.dir.length)) {
      owner = pkg;
    }
  }
  return owner;
}

/**
 * The contract surface: `src/contract.ts`, and `src/contract/` when one file is
 * not enough for a module the size of `POS`.
 */
function isContractFile(pkg, path) {
  return path === `${pkg.dir}/src/contract.ts` || contains(`${pkg.dir}/src/contract`, path);
}

const PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s*['"]([^'"]+)['"]/g,
];

/**
 * Every import specifier in a file, with the line it sits on.
 *
 * Line by line, and comments stripped first, for the same reason
 * `check-policy.mjs` works that way: a checker that reads prose as code reports
 * a violation nobody can fix, and a checker like that gets switched off.
 */
function* specifiersIn(source) {
  const lines = source.split('\n');
  for (const [index, text] of lines.entries()) {
    const code = text.replace(/\/\/.*$/, '');
    const trimmed = code.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const pattern of PATTERNS) {
      // Every match on the line, not the first. Two import statements share a
      // line only when the formatter has not run, and a check that can be
      // slipped past by skipping a step is one somebody skips a step to pass.
      for (const match of code.matchAll(pattern)) {
        yield { specifier: match[1], line: index + 1 };
      }
    }
  }
}

/** Splits `@vertex/sys/contract` into its package and the subpath an exports map spells. */
function resolveBare(packages, specifier) {
  for (const pkg of packages) {
    if (specifier === pkg.name) return { target: pkg, subpath: '.' };
    if (specifier.startsWith(`${pkg.name}/`)) {
      return { target: pkg, subpath: `./${specifier.slice(pkg.name.length + 1)}` };
    }
  }
  return null;
}

/**
 * @param {{ packages: readonly WorkspacePackage[], files: readonly SourceFile[] }} input
 * @returns {Finding[]}
 */
export function findBoundaryBreaches(input) {
  const { packages, files } = input;
  /** @type {Finding[]} */
  const findings = [];
  const report = (file, line, rule, message) => findings.push({ file, line, rule, message });

  // §2: a module that publishes no contract cannot be depended on at all, so
  // the first module that needs it would have no correct way to reach it and
  // would take the incorrect one.
  for (const pkg of packages) {
    if (!isModule(pkg)) continue;
    for (const required of ['.', CONTRACT]) {
      if (!pkg.exported.includes(required)) {
        report(
          `${pkg.dir}/package.json`,
          1,
          '§2',
          `${pkg.name} does not publish "${required}". A module publishes exactly two entries: ` +
            'its definition, which an app composes an edition from, and its contract, which ' +
            'is all any other module may see.',
        );
      }
    }
  }

  for (const { file, source } of files) {
    const home = ownerOf(packages, file);
    if (home === null) continue;
    const contractFile = isModule(home) && isContractFile(home, file);

    for (const { specifier, line } of specifiersIn(source)) {
      if (specifier.startsWith('.')) {
        const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
        const target = ownerOf(packages, resolved);

        if (target === null || target.dir !== home.dir) {
          report(
            file,
            line,
            '§4.1',
            `"${specifier}" resolves to ${resolved}, outside ${home.name}. A relative path ` +
              'walks straight past the exports map and the dependency list, so nothing but ' +
              'this check stands between it and another package’s internals. Import the ' +
              'package by name.',
          );
          continue;
        }

        if (contractFile && !isContractFile(home, resolved)) {
          report(
            file,
            line,
            'contract',
            `The contract of ${home.name} imports ${resolved}, which is the implementation ` +
              'behind it. Importing the contract would then pull in what the contract exists ' +
              'to stand in front of, and an edition without this module could no longer ' +
              'build. Move what is shared into src/contract/.',
          );
        }
        continue;
      }

      const bare = resolveBare(packages, specifier);
      if (bare === null) continue;
      const { target, subpath } = bare;
      if (target.dir === home.dir) continue;

      if (!target.exported.includes(subpath)) {
        report(
          file,
          line,
          '§4.1',
          `"${specifier}" reaches past what ${target.name} publishes. Only its exports map is ` +
            'importable; everything else is internals, and internals are what §4 forbids a ' +
            'neighbour to depend on.',
        );
        continue;
      }

      if (!isModule(target)) continue;

      if (isModule(home)) {
        if (subpath !== CONTRACT) {
          report(
            file,
            line,
            '§4.1',
            `${home.name} imports ${target.name} itself. A module may import another module’s ` +
              `contract and nothing else — "${target.name}/contract" — because the contract ` +
              'is what an edition can replace with absence.',
          );
        }
        continue;
      }

      if (!isApp(home)) {
        report(
          file,
          line,
          '§4.1',
          `${home.name} imports ${target.name}, and it sits below the modules. The platform ` +
            'hosts a module without knowing what it does, and the kernel and the shared ' +
            'vocabulary do not know that modules exist at all; a name here inverts that and ' +
            'makes the lower layer unbuildable without the higher one.',
        );
      }
    }
  }

  return findings;
}
