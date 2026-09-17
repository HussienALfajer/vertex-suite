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
 * The §4 rules above carry deliberately no exemption comment. `check-policy.mjs`
 * has one because its rules have genuine local exceptions. These do not: an
 * exempted breach is a module that can no longer be left out of an edition, and
 * that is not a decision one file gets to make on behalf of the product line.
 *
 * ---
 *
 * **Altitude** is the second rule here, and it answers a different question
 * about the same subject: not *what may this file reach*, but *where does it
 * belong*.
 *
 * A unit's home is the lowest layer that holds everything it knows. That is not
 * a matter of taste — it is derivable from what the file imports, which is why
 * it is checked instead of agreed. The form it takes in practice, and the only
 * form checked here, is the one that costs a product line the most:
 *
 * **An app may not hold a file that knows nothing about that app.** A file
 * under an app's own `src` that reaches into the workspace and never once into its
 * own application is a library component parked in an application. Nothing
 * fails: it works, it is tested, and it is invisible — until the second app
 * needs it, copies it, and the two drift. `modules.md` §1 is the bill for that:
 * one codebase producing per-customer editions cannot ship a component that is
 * welded inside one application.
 *
 * This one **is** exemptible, because unlike a boundary breach it is a judgement
 * with real exceptions — and the exemption is written where the exception is:
 *
 *   // boundary-exempt: altitude — the reason
 *
 * What it does not see: a file that imports nothing at all. A constant table or
 * a pure function leaves no trace of what it knows, so the rule has nothing to
 * read. Those are cheap to move and cheap to notice; this catches the expensive
 * case, which is the one that arrives already wired into a screen.
 *
 * ---
 *
 * **`FX-07`** is the third rule here, and it is about one imported name.
 *
 * "Rounding is applied at defined points only, and the residual is posted to a
 * rounding account so totals never drift." A point is defined by `FX`, which is
 * the only module that knows a tenant's currencies — what each one's step is,
 * which way it leans, and how many places it is stored at, all of it data the
 * owner revises (`FX-01`). `round` in the kernel is the arithmetic those rules
 * are applied *with*, and it takes the currency record as its second argument.
 *
 * Anywhere else, that second argument has to come from somewhere, and the
 * somewhere is a literal: a module that reaches for `round` is a module about to
 * write `'0.01'` into a shop whose smallest note is ten pounds. Nothing fails
 * when it does. The totals simply stop agreeing with the till by a few pounds a
 * day, in a place no report points at, and the residual `FX-07` requires is
 * discarded on the floor instead of being posted anywhere.
 *
 * So `round` from `@vertex/kernel` belongs to `FX` and to the kernel's own
 * suite. Everyone else settles an amount by asking `FX` to, which hands back the
 * residual with the account it goes to.
 *
 * It is matched on the **binding** and not on the word, and it follows a rename
 * (`round as settle`), which is the obvious way past a check that reads names.
 * `allocate` and `isRounded` are deliberately not here: neither invents a
 * rounding point — `allocate` distributes a figure that is already settled and
 * refuses one that is not, and `isRounded` only asks.
 *
 * Like the §4 rules and unlike altitude, it carries **no exemption**. A rounding
 * point nobody can find is not a judgement with local exceptions; it is a figure
 * that stops adding up.
 */
import { posix } from 'node:path';

// An application's own strings, which the policy check knows as "the one place
// a user-facing string is supposed to live". It is the most app-specific file an
// app has and it is invisible to the altitude rule, because what it knows is its
// **content** rather than its imports. One function decides which file that is
// for both checks, so they cannot come to disagree about it.
import { isCatalogue } from './policy.mjs';

/** @typedef {{ name: string, dir: string, exported: readonly string[] }} WorkspacePackage */
/** @typedef {{ file: string, source: string }} SourceFile */
/** @typedef {{ file: string, line: number, rule: string, message: string }} Finding */

const MODULE_ROOT = 'packages/modules/';
const APP_ROOT = 'apps/';
const CONTRACT = './contract';

/** The kernel, and the one export of it that belongs to a single module. */
const KERNEL = '@vertex/kernel';
const ROUNDS_MONEY = 'round';
const ROUNDING_OWNER = 'packages/modules/fx';

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
 * The names a file binds from one import statement, following renames.
 *
 * Only the named form — `import { a, b as c } from 'x'` — because that is the
 * only form that binds a specific export. A namespace import (`import * as k`)
 * is not read here: it binds the whole module and reaches `round` through a
 * property, which no import-line check can see. That is a gap and it is stated
 * rather than papered over; it is also not the shape anybody writes by accident,
 * which is the shape this catches.
 */
function* bindingsFrom(source, from) {
  const pattern = new RegExp(
    String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]` +
      from.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) +
      String.raw`['"]`,
    'g',
  );
  const lineOf = (index) => source.slice(0, index).split('\n').length;

  for (const match of source.matchAll(pattern)) {
    for (const clause of match[1].split(',')) {
      // `round as settle` binds `round`; the name on the left is the export.
      const name = clause
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && name !== '') yield { name, line: lineOf(match.index) };
    }
  }
}

/**
 * `FX-07`: `round` from the kernel, imported by something that is not `FX`.
 *
 * Multi-line import statements are matched as written, so the line reported is
 * the `import` keyword's rather than the clause's — which is the statement a
 * reader has to change, and the same line every other rule here reports.
 */
function findStrayRounding(packages, files) {
  /** @type {Finding[]} */
  const findings = [];

  for (const { file, source } of files) {
    if (contains(ROUNDING_OWNER, file) || contains('packages/kernel', file)) continue;
    const home = ownerOf(packages, file);
    if (home === null) continue;

    for (const { name, line } of bindingsFrom(source, KERNEL)) {
      if (name !== ROUNDS_MONEY) continue;
      findings.push({
        file,
        line,
        rule: 'FX-07',
        message:
          `${home.name} imports "round" from ${KERNEL}. Rounding happens at the points FX ` +
          'defines and nowhere else, because the rules it rounds by — the step, the direction, ' +
          'the precision — are one tenant’s data and not a constant anybody here can supply. ' +
          'A literal increment written beside this call is a till that comes up short every ' +
          'day in a place no report points at, and a residual that FX-07 says must be posted ' +
          'and that this would discard. Ask @vertex/fx to settle the amount: it answers with ' +
          'the figure and with the residual, and with the account the residual goes to.',
      });
    }
  }

  return findings;
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

  findings.push(...findMisplaced(packages, files));
  findings.push(...findStrayRounding(packages, files));
  return findings;
}

/** Ships to a screen: not a test, not a fixture, not a config beside the source. */
function isShippedSource(path) {
  return (
    /\/src\/.*\.tsx?$/.test(path) &&
    !/\.(test|spec)\.tsx?$/.test(path) &&
    !/\.fixture\.tsx?$/.test(path) &&
    !/\.d\.ts$/.test(path)
  );
}

/**
 * An exemption, written where the exception is, and required to carry a reason
 * so that it cannot be a shrug.
 */
function isExempt(source, rule) {
  // Line by line, and the reason has to be on the same line as the marker. A
  // pattern that let whitespace run across the newline would happily read the
  // next line of code as the justification, which is a shrug that type-checks.
  for (const line of source.split('\n')) {
    const match = /boundary-exempt:[^\S\n]*(\S+)[^\S\n]*—[^\S\n]*(.*)$/.exec(line);
    // A reason is words: a dash followed by a full stop is a shrug with punctuation.
    if (match !== null && match[1] === rule && /\p{L}/u.test(match[2])) return true;
  }
  return false;
}

/**
 * The altitude rule: a file in an app that knows nothing about the app.
 *
 * Two facts decide it, and both are read from the imports. Does the file reach
 * into its own application at all — any relative path, which in an app is the
 * app's own code? And does it reach into the workspace, which is what says the
 * file is built from this product rather than from React alone?
 *
 * A file that reaches the workspace and never its own app is the misplacement;
 * a file that reaches neither is a leaf the rule cannot read and does not guess
 * about.
 */
function findMisplaced(packages, files) {
  /** @type {Finding[]} */
  const findings = [];

  for (const { file, source } of files) {
    const home = ownerOf(packages, file);
    if (home === null || !isApp(home) || !isShippedSource(file)) continue;
    if (isCatalogue(file) || isExempt(source, 'altitude')) continue;

    let knowsItsApp = false;
    let usesTheWorkspace = null;
    for (const { specifier } of specifiersIn(source)) {
      if (specifier.startsWith('.')) {
        knowsItsApp = true;
        break;
      }
      const bare = resolveBare(packages, specifier);
      if (bare === null) continue;
      // Naming a module **is** knowing about the app: §4.1 lets nothing but an
      // app do it, because composing an edition is the one thing an app is for.
      // A file that does it is already in the only place it could be.
      if (isModule(bare.target)) {
        knowsItsApp = true;
        break;
      }
      usesTheWorkspace ??= bare.target.name;
    }

    if (knowsItsApp || usesTheWorkspace === null) continue;

    findings.push({
      file,
      line: 1,
      rule: 'altitude',
      message:
        `Nothing in this file names ${home.name}: it is built from ${usesTheWorkspace} and ` +
        'knows nothing about the application it sits in. That is a library component parked ' +
        'in an app, and nothing will fail until the second app needs it, copies it, and the ' +
        `two drift — which a product line cannot afford (modules.md §1). Move it to the ` +
        'package whose knowledge it uses, or write the exception in place: ' +
        '"// boundary-exempt: altitude — the reason".',
    });
  }

  return findings;
}
