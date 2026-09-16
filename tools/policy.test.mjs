import { describe, expect, it } from 'vitest';

import { findPolicyViolations, isCatalogue } from './policy.mjs';

function violations(file, source) {
  return findPolicyViolations({ files: [{ file, source }] });
}

function rules(findings) {
  return findings.map((one) => one.rule);
}

const SCREEN = 'apps/back-office/src/screens/Branches.tsx';

describe('§12 — no user-facing string is a literal in code', () => {
  it('refuses an Arabic literal in a screen', () => {
    expect(rules(violations(SCREEN, "const title = 'الفروع';"))).toEqual(['§12']);
  });

  it('refuses an English literal handed to a prop a person reads', () => {
    const found = violations(SCREEN, '<Button label="Save branch" />');
    expect(rules(found)).toEqual(['§12']);
    expect(found[0].message).toContain('label="Save branch"');
  });

  it('leaves a prop value that is an identifier rather than a sentence alone', () => {
    // A key, a test id or a token is not read by a person, and a check that
    // cannot tell the difference is a check that cries wolf.
    expect(violations(SCREEN, '<Icon title="branch.title" />')).toEqual([]);
  });

  it('lets the catalogue hold every string, which is what it is for', () => {
    expect(violations('apps/back-office/src/catalogue.ts', "'x.y': 'الفروع',")).toEqual([]);
    expect(violations('apps/back-office/src/catalogue/sys.ts', "'x.y': 'الفروع',")).toEqual([]);
  });

  it('does not exempt a file merely because its path mentions messages or strings', () => {
    // The exemption once matched any substring of the path, so a module file
    // named for its messages could carry Arabic past §12 without anybody
    // deciding it should.
    for (const file of [
      'packages/modules/sal/src/customer-messages.ts',
      'packages/ui/src/strings/Label.tsx',
      'apps/back-office/src/catalogue-picker.tsx',
    ]) {
      expect(isCatalogue(file)).toBe(false);
      expect(rules(violations(file, "const text = 'مرحبا';"))).toEqual(['§12']);
    }
  });

  it('does not read a comment as a literal', () => {
    expect(
      violations(SCREEN, "// the heading reads 'الفروع'\n * or 'فرع' in the singular"),
    ).toEqual([]);
  });

  it('takes an exemption written in place, with a reason', () => {
    const source = "symbol: 'ل.س', // policy-exempt: §12 — a currency symbol is data, not a label";
    expect(violations(SCREEN, source)).toEqual([]);
  });
});

describe('an exemption is a reason, not a marker', () => {
  it('refuses a marker with nothing after the dash', () => {
    expect(rules(violations(SCREEN, "// policy-exempt: §12 —\nconst a = 'نص';"))).toEqual(['§12']);
  });

  it('does not read the next line of code as the reason', () => {
    // The pattern once let its whitespace run across the newline, so the line
    // below a bare marker became the justification for itself.
    const source = "// policy-exempt: §12 —\nconst title = 'الفروع'; const other = 1;";
    expect(rules(violations(SCREEN, source))).toEqual(['§12']);
  });

  it('refuses a comment closer where the words should be', () => {
    const source = "{/* policy-exempt: §7.3 — */}\n<div className='outline-none' />";
    expect(rules(violations(SCREEN, source))).toEqual(['§7.3']);
  });

  it('excuses only the rule it names', () => {
    const source = "// policy-exempt: §7.3 — a reason\nconst title = 'الفروع';";
    expect(rules(violations(SCREEN, source))).toEqual(['§12']);
  });
});

describe('§7.3 — focus is always visible', () => {
  it('refuses outline-none with no ring nearby', () => {
    expect(rules(violations(SCREEN, "<div className='outline-none' />"))).toEqual(['§7.3']);
  });

  it('accepts outline-none beside a focus-visible ring', () => {
    const source = "<div className='outline-none focus-visible:ring-2' />";
    expect(violations(SCREEN, source)).toEqual([]);
  });

  it('accepts the ring React Aria draws on the item holding virtual focus', () => {
    const source = "<div className='outline-none data-[focused]:bg-surface-2' />";
    expect(violations(SCREEN, source)).toEqual([]);
  });
});

describe('§9 — logical properties only', () => {
  it('refuses each physical utility and names its logical replacement', () => {
    const cases = [
      ['ml-2', 'ms-'],
      ['pr-4', 'pe-'],
      ['left-0', 'start-'],
      ['text-right', 'text-end'],
      ['float-left', 'float-start'],
      ['border-l-2', 'border-s'],
      ['border-l', 'border-s'],
      ['rounded-r', 'rounded-e'],
      ['rounded-tl-lg', 'rounded-ss'],
      ['hover:mr-auto', 'me-'],
      ['scroll-pl-4', 'scroll-ps-'],
    ];
    for (const [utility, replacement] of cases) {
      const found = violations(SCREEN, `<div className="${utility}" />`);
      expect(rules(found), utility).toEqual(['§9']);
      expect(found[0].message).toContain(`"${replacement}"`);
    }
  });

  it('sees the forms that once slipped past it', () => {
    // A negative margin, a named radius and a border colour: each is as
    // physical as the forms the check caught, and none of them was seen.
    for (const utility of ['-ml-4', '-right-2', 'rounded-l-md', 'border-r-neutral-200']) {
      const found = violations(SCREEN, `<div className="p-2 ${utility}" />`);
      expect(rules(found), utility).toEqual(['§9']);
    }
  });

  it('does not read prose about direction as a utility', () => {
    const source = [
      "const reading = 'right-to-left';",
      "const heading = 'left-aligned figures';",
      "const css = 'border-left and border-radius';",
    ].join('\n');
    expect(violations(SCREEN, source)).toEqual([]);
  });

  it('does not read a named radius as a side', () => {
    // `rounded-lg` begins with `rounded-l`, and is the most common radius there is.
    expect(violations(SCREEN, '<div className="rounded-lg rounded-md border-2" />')).toEqual([]);
  });

  it('accepts the logical forms', () => {
    const source = '<div className="ms-2 -me-1 pe-4 start-0 text-end rounded-s-md border-e-2" />';
    expect(violations(SCREEN, source)).toEqual([]);
  });
});

describe('process.env is reached by name, never by bracket', () => {
  it('refuses the bracketed form in shipped source', () => {
    const source = "const dev = process.env['NODE_ENV'] !== 'production';";
    expect(rules(violations('packages/ui/src/providers/Density.tsx', source))).toEqual(['env']);
  });

  it('leaves a config beside the source alone, which runs in Node by definition', () => {
    const source = "const port = Number(process.env['PORT']);";
    expect(violations('apps/back-office/vite.config.ts', source)).toEqual([]);
  });
});

describe('what counts as shipped', () => {
  it('leaves tests and journeys alone', () => {
    for (const file of [
      'apps/back-office/src/branches.test.tsx',
      'apps/back-office/e2e/organisation.spec.ts',
    ]) {
      expect(violations(file, "const title = 'الفروع';")).toEqual([]);
    }
  });
});
