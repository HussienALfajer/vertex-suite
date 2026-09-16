import { describe, expect, it } from 'vitest';

import { featureIdsIn, proofsIn, readSpec } from './spec.mjs';

/**
 * A specification small enough to hold in mind, in the exact shapes the real
 * documents use: bold headings with the identifier in backticks, a trailing
 * star on some, an acceptance line, the §7 build tables with en-dash ranges,
 * and the §8 coverage table.
 */
const FEATURES = `# Features

4 features across 2 modules.

## 1. \`FX\` — Currencies

**\`FX-01\` Four currencies**
SYP, USD, TRY, EUR.

**\`FX-02\` Functional currency** ⭐
All cost is stored in USD.
_Acceptance:_ a report run twice returns the same figures.

**\`FX-03\` Presentation currency**
Any screen, any currency.

---

## 2. \`SYS\` — System

**\`SYS-01\` Arabic first**
The interface is Arabic.
`;

const MODULES = `# Modules

The 4 features of \`core-features.md\` in two modules.

## 3. The modules

| Code  | Module     | Feat. |
| ----- | ---------- | ----- |
| \`FX\`  | Currencies | 3     |
| \`SYS\` | System     | 1     |

## 7. Build order

| Unit  | Delivers   | Features                |
| ----- | ---------- | ----------------------- |
| \`U01\` | Workspace  | —                       |
| \`U02\` | Interface  | \`SYS-01\`                |
| \`U03\` | Currencies | \`FX-01\`–\`FX-03\`         |

## 8. Coverage

Every one of the 4 features appears in exactly one unit.

| Module | Units                      |
| ------ | -------------------------- |
| \`FX\`   | \`U03\` (01–03)              |
| \`SYS\`  | \`U02\` (01)                 |
`;

const spec = (overrides = {}) =>
  readSpec({ features: FEATURES, modules: MODULES, delivered: [], ...overrides });

const messages = (result) => result.problems.map((one) => one.message);

describe('reading the features', () => {
  it('reads every heading, including one that carries a trailing mark', () => {
    // The parser once insisted on the line ending at the closing `**`, and
    // three starred features vanished from the product without a sound.
    const { features, problems } = spec();
    expect([...features.keys()]).toEqual(['FX-01', 'FX-02', 'FX-03', 'SYS-01']);
    expect(problems).toEqual([]);
  });

  it('keeps the title, the description and the acceptance criterion apart', () => {
    const feature = spec().features.get('FX-02');
    expect(feature).toEqual({
      id: 'FX-02',
      title: 'Functional currency',
      description: 'All cost is stored in USD.',
      acceptance: 'a report run twice returns the same figures.',
    });
    expect(spec().features.get('FX-01')?.acceptance).toBeNull();
  });

  it('stops a description at the next heading, rule or section', () => {
    expect(spec().features.get('FX-03')?.description).toBe('Any screen, any currency.');
  });

  it('refuses a feature defined twice', () => {
    const doubled = `${FEATURES}\n**\`FX-01\` Four currencies again**\nText.\n`;
    expect(messages(spec({ features: doubled }))).toContain('FX-01 is defined twice.');
  });
});

describe('reading the build order', () => {
  it('keeps the units in the order they are written, which is the order of work', () => {
    expect([...spec().units.keys()]).toEqual(['U01', 'U02', 'U03']);
  });

  it('expands an en-dash range and a hand-typed hyphen alike', () => {
    expect(spec().units.get('U03')?.claimed).toEqual(['FX-01', 'FX-02', 'FX-03']);

    const hyphen = MODULES.replace('`FX-01`–`FX-03`', '`FX-01`-`FX-03`').replace(
      '(01–03)',
      '(01-03)',
    );
    const result = spec({ modules: hyphen });
    expect(result.units.get('U03')?.claimed).toEqual(['FX-01', 'FX-02', 'FX-03']);
    expect(result.problems).toEqual([]);
  });

  it('refuses a range that runs from one module into another', () => {
    const across = MODULES.replace('`FX-01`–`FX-03`', '`FX-01`–`SYS-03`');
    expect(messages(spec({ modules: across }))).toContain(
      'U03 ranges from FX to SYS, across two modules.',
    );
  });
});

describe('the two tables of modules.md, against each other and the features', () => {
  it('assigns every feature to the unit §8 names', () => {
    const { owner } = spec();
    expect(Object.fromEntries(owner)).toEqual({
      'FX-01': 'U03',
      'FX-02': 'U03',
      'FX-03': 'U03',
      'SYS-01': 'U02',
    });
  });

  it('refuses a feature nobody builds', () => {
    const unowned = MODULES.replace('`U03` (01–03)', '`U03` (01–02)').replace(
      '`FX-01`–`FX-03`',
      '`FX-01`–`FX-02`',
    );
    expect(messages(spec({ modules: unowned }))).toContain(
      'FX-03 is specified but no unit builds it.',
    );
  });

  it('refuses a feature two units claim', () => {
    const twice = MODULES.replace('`U02` (01)', '`U02` (01) · `U03` (01)');
    expect(messages(spec({ modules: twice }))).toContain('SYS-01 is claimed by U02 and by U03.');
  });

  it('refuses an ownership §8 grants to a feature that is not specified', () => {
    const phantom = MODULES.replace('`U03` (01–03)', '`U03` (01–04)');
    expect(messages(spec({ modules: phantom }))).toContain(
      '§8 assigns FX-04 to U03, but it is not specified.',
    );
  });

  it('refuses §7 and §8 disagreeing about who builds a feature', () => {
    const drifted = MODULES.replace('`FX-01`–`FX-03`', '`FX-01`–`FX-02`');
    expect(messages(spec({ modules: drifted }))).toContain(
      "§8 gives FX-03 to U03; §7's row does not list it.",
    );
  });

  it('refuses §8 naming a unit §7 does not list', () => {
    const ghost = MODULES.replace('`U02` (01)', '`U09` (01)');
    expect(messages(spec({ modules: ghost }))).toContain('SYS names U09, which §7 does not list.');
  });

  it('refuses a delivered unit the build order does not contain', () => {
    expect(messages(spec({ delivered: ['U02', 'U42'] }))).toEqual([
      'DELIVERED names U42, which modules.md §7 does not.',
    ]);
  });
});

describe('the counts the prose states', () => {
  it('agree with the features specified, or the specification says so', () => {
    // Written as 182 in three places and 183 in two, and nothing noticed,
    // because nothing read them.
    const drifted = spec({
      features: FEATURES.replace('4 features across', '3 features across'),
      modules: MODULES.replace('The 4 features of', 'The 5 features of')
        .replace('Every one of the 4 features', 'Every one of the 6 features')
        .replace('| Currencies | 3     |', '| Currencies | 2     |'),
    });
    expect(messages(drifted)).toEqual([
      'states 3 features; 4 are specified.',
      'states 5 features; 4 are specified.',
      'states 6 features; 4 are specified.',
      'FX states 2 features; 3 are specified.',
    ]);
  });

  it('say nothing when they agree', () => {
    expect(spec().problems).toEqual([]);
  });
});

describe('featureIdsIn', () => {
  it('finds identifiers of the sixteen modules only, once each, in order', () => {
    expect(featureIdsIn('SYS-02 then FX-07, SYS-02 again, and ABC-01 and U04')).toEqual([
      'SYS-02',
      'FX-07',
    ]);
  });

  it('does not read a longer token as an identifier', () => {
    expect(featureIdsIn('XSYS-02 and SYS-021')).toEqual([]);
  });
});

describe('proofsIn — what counts as proof of a feature', () => {
  const proofs = (source) => proofsIn([{ file: 'packages/x/src/a.test.ts', source }]);

  it('counts an identifier in the name of a describe, an it or a test', () => {
    const found = proofs(
      "describe('VertexProvider — SYS-01', () => {\n" +
        "  it('stamps a revision — FX-04', () => {});\n" +
        '  test(`FX-05 keeps it`, () => {});\n' +
        '});',
    );
    expect([...found.keys()]).toEqual(['SYS-01', 'FX-04', 'FX-05']);
    expect(found.get('FX-04')).toEqual([
      { file: 'packages/x/src/a.test.ts', line: 2, name: 'stamps a revision — FX-04' },
    ]);
  });

  it('does not count a feature named in a comment or in the body of a test', () => {
    const found = proofs(
      '// SYS-02 is what this file is for\n' +
        "it('stores a branch', () => { expect(code).toBe('SYS-02'); });",
    );
    expect(found.size).toBe(0);
  });

  it('does not count a test that is skipped, unwritten, or expected to fail', () => {
    // Each of these is green in a passing run, and none of them is an
    // assertion that the feature behaves as specified.
    const found = proofs(
      "it.skip('SYS-02 stores a branch', () => {});\n" +
        "it.todo('SYS-05 business profile');\n" +
        "it.fails('SYS-09 numbers never collide', () => {});\n" +
        "describe.skip('SEC-01 roles', () => {});\n" +
        "describe.concurrent.skip('SEC-02 grants', () => {});",
    );
    expect(found.size).toBe(0);
  });

  it('counts a test under a modifier that still runs it', () => {
    const found = proofs(
      "it.concurrent('SYS-02 stores a branch', () => {});\ntest.sequential('SYS-05 profile', () => {});",
    );
    expect([...found.keys()]).toEqual(['SYS-02', 'SYS-05']);
  });

  it('reads a name through an escaped quote to its real end', () => {
    const found = proofs("it('the tenant\\'s own term — SYS-08', () => {});");
    expect(found.get('SYS-08')?.[0]?.name).toBe("the tenant\\'s own term — SYS-08");
  });
});
