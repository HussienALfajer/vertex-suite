#!/usr/bin/env node
/**
 * The checks of `design-system.md` §13 that a type system cannot make.
 *
 * Deliberately narrow. A policy check that reports a hundred false positives is
 * a policy check somebody disables in a week, and a disabled check is worse
 * than no check because it is still in the table pretending to work.
 *
 *   1. §12  No user-facing string is a literal in code.
 *   2. §7.3 `outline: none` never ships without a replacement focus ring.
 *   3. §9   Physical-direction utilities are banned; logical ones replace them.
 *   4.      `process.env` is never reached by bracket, because a bundler only
 *           replaces the dotted form and the rest throws in a browser.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCANNED = ['packages/ui/src', 'packages/i18n/src', 'apps'];
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

/** Props whose value reaches a person's eyes. */
const USER_FACING_PROPS = [
  'label',
  'placeholder',
  'title',
  'description',
  'errorMessage',
  'message',
  'confirmLabel',
];

/** §9: physical where a logical property exists. */
const PHYSICAL = [
  'ml-',
  'mr-',
  'pl-',
  'pr-',
  'left-',
  'right-',
  'text-left',
  'text-right',
  'border-l-',
  'border-r-',
  'rounded-l-',
  'rounded-r-',
];
const LOGICAL_REPLACEMENT = {
  'ml-': 'ms-',
  'mr-': 'me-',
  'pl-': 'ps-',
  'pr-': 'pe-',
  'left-': 'start-',
  'right-': 'end-',
  'text-left': 'text-start',
  'text-right': 'text-end',
  'border-l-': 'border-s-',
  'border-r-': 'border-e-',
  'rounded-l-': 'rounded-s-',
  'rounded-r-': 'rounded-e-',
};

/** Any run of Arabic letters is, by construction, meant for a person. */
const ARABIC = /[؀-ۿ]/u;

const findings = [];

function report(file, line, rule, message) {
  findings.push({ file, line, rule, message });
}

/**
 * An exemption, written where the exception is:
 *
 *   // policy-exempt: §7.3 — the reason
 *
 * Every one is justified in place and greppable. That is the difference between
 * a rule with known exceptions and a rule quietly widened until it catches
 * nothing — and a reason is required, so an exemption cannot be a shrug.
 */
function isExempt(lines, index, rule) {
  const near = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
  const match = /policy-exempt:\s*(\S+)\s*—\s*(.+)/.exec(near);
  return match !== null && match[1] === rule && match[2].trim().length > 0;
}

function* sourceFiles(dir) {
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
      yield* sourceFiles(full);
      // Tests and journeys are not shipped interface: a spec that names a rule
      // in prose is not a screen breaking it.
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

function checkFile(full) {
  const file = relative(ROOT, full).split(sep).join('/');
  const source = readFileSync(full, 'utf8');
  const lines = source.split('\n');
  // The catalogue is the one place a user-facing string is supposed to live.
  const isCatalogue = /catalogue|messages|strings/i.test(file);

  lines.forEach((text, index) => {
    const lineNumber = index + 1;
    const code = text.replace(/\/\/.*$/, '');
    if (code.trim().startsWith('*') || code.trim().startsWith('/*')) return;

    // 1. §12 — a user-facing literal.
    if (!isCatalogue && ARABIC.test(code) && !isExempt(lines, index, '§12')) {
      report(
        file,
        lineNumber,
        '§12',
        'An Arabic literal in code. Every label lives in @vertex/i18n.',
      );
    }
    if (!isCatalogue) {
      for (const prop of USER_FACING_PROPS) {
        const match = new RegExp(`\\b${prop}=(["'])((?:(?!\\1).){2,})\\1`).exec(code);
        if (match && !/^[a-z0-9._-]+$/i.test(match[2])) {
          report(
            file,
            lineNumber,
            '§12',
            `${prop}="${match[2]}" is a literal. Resolve it through the translator.`,
          );
        }
      }
    }

    // 2. §7.3 — focus is always visible.
    if (/\boutline-none\b/.test(code)) {
      const window = lines.slice(Math.max(0, index - 12), index + 13).join('\n');
      // `data-[focused]` counts: React Aria sets it on the item holding virtual
      // focus while the ring stays on the trigger that owns the tab stop.
      const hasIndicator = /focus-ring|focusRing|focus-visible|data-\[focused\]/.test(window);
      if (!hasIndicator && !isExempt(lines, index, '§7.3')) {
        report(
          file,
          lineNumber,
          '§7.3',
          'outline-none with no replacement ring within the same declaration.',
        );
      }
    }

    // 4. A bundler replaces `process.env.NODE_ENV` and leaves
    //    `process.env['NODE_ENV']` alone, so the bracketed form survives into a
    //    browser bundle where `process` does not exist and throws. This crashed
    //    the register: on a touch surface a nested compact table took a
    //    development-only branch and brought the whole tree down.
    //    Scoped to `src/`, which is what a bundler carries into a browser. A
    //    build or test config runs in Node by definition and is not the hazard.
    if (
      file.includes('/src/') &&
      /\bprocess\s*\.\s*env\s*\[/.test(code) &&
      !isExempt(lines, index, 'env')
    ) {
      report(
        file,
        lineNumber,
        'env',
        "process.env['X'] is not replaced by a bundler and throws in a browser. Probe globalThis instead.",
      );
    }

    // 3. §9 — logical properties only.
    for (const banned of PHYSICAL) {
      // A prefix utility only counts when a real Tailwind *value* follows it.
      // Without this, the phrase "right-to-left" in a comment reads as the
      // `right-` utility, and a check that cries wolf is a check that gets
      // switched off.
      const value = '(?=[\\d[(]|auto\\b|full\\b|px\\b|screen\\b|-)';
      const pattern = banned.endsWith('-')
        ? new RegExp(`(?:^|['"\`\\s:])(?:[a-z-]+:)*${banned}${value}`)
        : new RegExp(`(?:^|['"\`\\s:])${banned}(?![\\w-])`);
      if (pattern.test(code)) {
        report(
          file,
          lineNumber,
          '§9',
          `"${banned}" is a physical-direction utility. Use "${LOGICAL_REPLACEMENT[banned]}" — RTL is the default, not a mode.`,
        );
      }
    }
  });
}

for (const dir of SCANNED) {
  for (const file of sourceFiles(join(ROOT, dir))) {
    checkFile(file);
  }
}

if (findings.length > 0) {
  for (const { file, line, rule, message } of findings) {
    process.stdout.write(`${file}:${line}  ${rule}  ${message}\n`);
  }
  process.stdout.write(`\ncheck:policy found ${findings.length} violation(s).\n`);
  process.exit(1);
}

process.stdout.write('check:policy: clean\n');
