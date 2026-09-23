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
 *
 * The rules live here as a function of file contents, and `check-policy.mjs`
 * only walks the tree and prints — the same split as `boundaries.mjs`, and for
 * the same reason: a check nobody tests is a check that stops catching things
 * without saying so, and a check welded to the file system cannot be tested
 * without one.
 */

/** @typedef {{ file: string, source: string }} SourceFile */
/** @typedef {{ file: string, line: number, rule: string, message: string }} Finding */

/**
 * Tests and journeys are not shipped interface: a spec that names a rule in
 * prose is not a screen breaking it.
 */
export const isShippedSource = (name) => /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name);

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

/**
 * §9: a physical-direction utility wherever a logical one exists, and what
 * replaces it.
 *
 * Three shapes, because the utilities come in three, and each is matched as
 * tightly as its shape allows:
 *
 * - **A spacing or inset prefix** — `ml-`, `left-` — counts only when a real
 *   Tailwind *value* follows it. Without that, the phrase "right-to-left" in a
 *   string reads as the `right-` utility, and a check that cries wolf is a
 *   check that gets switched off.
 * - **A border or radius side** — `border-l`, `rounded-tr` — is complete on its
 *   own (`border-l` is one pixel) and takes any value after a dash, a colour as
 *   readily as a width. It must not be followed by a letter, which is what keeps
 *   `rounded-lg` from reading as `rounded-l`.
 * - **A keyword** — `text-left`, `float-right` — is the whole utility.
 *
 * Every shape may be negated (`-ml-2`) and carry variants (`hover:`), and both
 * are how a physical margin used to slip past: the check once saw `ml-2` but not
 * `-ml-2`, `rounded-l-` but not `rounded-l-md`, and `border-r-2` but not
 * `border-r-neutral-200`.
 */
const VALUE = '(?=[\\d[(]|auto\\b|full\\b|px\\b|screen\\b|-)';
const SIDE = '(?=$|[-\\s\'"`/])';
const WHOLE = '(?![\\w-])';

const PHYSICAL = [
  ...[
    ['ml-', 'ms-'],
    ['mr-', 'me-'],
    ['pl-', 'ps-'],
    ['pr-', 'pe-'],
    ['scroll-ml-', 'scroll-ms-'],
    ['scroll-mr-', 'scroll-me-'],
    ['scroll-pl-', 'scroll-ps-'],
    ['scroll-pr-', 'scroll-pe-'],
    ['left-', 'start-'],
    ['right-', 'end-'],
  ].map(([banned, replacement]) => ({ banned, replacement, shape: VALUE })),
  ...[
    ['border-l', 'border-s'],
    ['border-r', 'border-e'],
    ['rounded-l', 'rounded-s'],
    ['rounded-r', 'rounded-e'],
    ['rounded-tl', 'rounded-ss'],
    ['rounded-tr', 'rounded-se'],
    ['rounded-bl', 'rounded-es'],
    ['rounded-br', 'rounded-ee'],
  ].map(([banned, replacement]) => ({ banned, replacement, shape: SIDE })),
  ...[
    ['text-left', 'text-start'],
    ['text-right', 'text-end'],
    ['float-left', 'float-start'],
    ['float-right', 'float-end'],
    ['clear-left', 'clear-start'],
    ['clear-right', 'clear-end'],
  ].map(([banned, replacement]) => ({ banned, replacement, shape: WHOLE })),
].map((rule) => ({
  ...rule,
  pattern: new RegExp(`(?:^|['"\`\\s:])-?${rule.banned}${rule.shape}`),
}));

/** Any run of Arabic letters is, by construction, meant for a person. */
const ARABIC = /[؀-ۿ]/u;

/**
 * The one place a user-facing string is supposed to live: a file named
 * `catalogue`, or a `catalogue/` directory once one file is not enough.
 *
 * Matched on the name and not on any substring of the path. A substring match
 * once exempted every path containing "messages" or "strings" — so a module
 * file called `customer-messages.ts` would have carried Arabic literals past §12
 * without anybody deciding it should.
 */
export function isCatalogue(file) {
  return /(?:^|\/)catalogue(?:\.tsx?$|\/)/.test(file);
}

/**
 * An exemption, written where the exception is:
 *
 *   // policy-exempt: §7.3 — the reason
 *
 * Every one is justified in place and greppable. That is the difference between
 * a rule with known exceptions and a rule quietly widened until it catches
 * nothing — and a reason is required, so an exemption cannot be a shrug.
 *
 * The marker may sit up to three lines above what it excuses, but the reason
 * has to begin on the marker's own line. A pattern whose whitespace could run
 * across a newline read the next line of code as the justification, which is a
 * shrug that happens to be followed by a statement; `boundaries.mjs` had the
 * same flaw and the same fix.
 */
function isExempt(lines, index, rule) {
  for (const line of lines.slice(Math.max(0, index - 3), index + 1)) {
    const match = /policy-exempt:[^\S\n]*(\S+)[^\S\n]*—[^\S\n]*(.*)$/.exec(line);
    if (match !== null && match[1] === rule && /\p{L}/u.test(match[2])) return true;
  }
  return false;
}

/**
 * Every policy violation in a set of files.
 *
 * @param {{ files: readonly SourceFile[] }} input
 * @returns {Finding[]}
 */
export function findPolicyViolations({ files }) {
  /** @type {Finding[]} */
  const findings = [];
  const report = (file, line, rule, message) => findings.push({ file, line, rule, message });

  for (const { file, source } of files) {
    if (!isShippedSource(file)) continue;
    const lines = source.split('\n');
    const catalogue = isCatalogue(file);

    lines.forEach((text, index) => {
      const lineNumber = index + 1;
      const code = text.replace(/\/\/.*$/, '');
      if (code.trim().startsWith('*') || code.trim().startsWith('/*')) return;

      // 1. §12 — a user-facing literal.
      if (!catalogue && ARABIC.test(code) && !isExempt(lines, index, '§12')) {
        report(
          file,
          lineNumber,
          '§12',
          'An Arabic literal in code. Every label lives in @vertex/i18n.',
        );
      }
      if (!catalogue) {
        for (const prop of USER_FACING_PROPS) {
          const match = new RegExp(`\\b${prop}=(["'])((?:(?!\\1).){2,})\\1`).exec(code);
          if (match && !/^[a-z0-9._-]+$/i.test(match[2]) && !isExempt(lines, index, '§12')) {
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

      // 3. §9 — logical properties only.
      for (const { banned, replacement, pattern } of PHYSICAL) {
        if (pattern.test(code)) {
          report(
            file,
            lineNumber,
            '§9',
            `"${banned}" is a physical-direction utility. Use "${replacement}" — RTL is the default, not a mode.`,
          );
        }
      }

      // 4. A bundler replaces `process.env.NODE_ENV` and leaves
      //    `process.env['NODE_ENV']` alone, so the bracketed form survives into a
      //    browser bundle where `process` does not exist and throws. This crashed
      //    the register: on a touch surface a nested compact table took a
      //    development-only branch and brought the whole tree down.
      //    Scoped to browser source. The store node also has `src/`, but runs
      //    in Node and must read bracketed environment variables under the
      //    workspace's noPropertyAccessFromIndexSignature TypeScript rule.
      if (
        file.includes('/src/') &&
        !file.startsWith('apps/store-node/') &&
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
    });
  }

  return findings;
}
