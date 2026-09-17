import { describe, expect, it } from 'vitest';

import { findBoundaryBreaches } from './boundaries.mjs';

const PACKAGES = [
  { name: '@vertex/kernel', dir: 'packages/kernel', exported: ['.'] },
  { name: '@vertex/contracts', dir: 'packages/contracts', exported: ['.'] },
  { name: '@vertex/platform', dir: 'packages/platform', exported: ['.'] },
  { name: '@vertex/ui', dir: 'packages/ui', exported: ['.'] },
  { name: '@vertex/sys', dir: 'packages/modules/sys', exported: ['.', './contract'] },
  { name: '@vertex/sec', dir: 'packages/modules/sec', exported: ['.', './contract'] },
  { name: '@vertex/fx', dir: 'packages/modules/fx', exported: ['.', './contract'] },
  { name: '@vertex/store-node', dir: 'apps/store-node', exported: ['.'] },
];

function breaches(file, source, packages = PACKAGES) {
  return findBoundaryBreaches({ packages, files: [{ file, source }] });
}

function rules(findings) {
  return findings.map((one) => one.rule);
}

describe('§4.1 — a module reaches another module only through its contract', () => {
  it('allows the contract subpath', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "import type { Branch } from '@vertex/sys/contract';",
    );
    expect(found).toEqual([]);
  });

  it('refuses the root entry, which is the module itself', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "import { sys } from '@vertex/sys';",
    );
    expect(rules(found)).toEqual(['§4.1']);
    expect(found[0].message).toContain('@vertex/sys/contract');
  });

  it('refuses a deeper subpath, which is its internals by another name', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "import { branches } from '@vertex/sys/dist/branch.js';",
    );
    expect(rules(found)).toEqual(['§4.1']);
  });

  it('refuses a relative path that leaves the package, which no exports map can stop', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "import { branches } from '../../sys/src/branch.js';",
    );
    expect(rules(found)).toEqual(['§4.1']);
    expect(found[0].message).toContain('packages/modules/sys');
  });

  it('leaves a relative path inside the same package alone', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "import { grant } from './grant.js';\nimport { Role } from '../src/role.js';",
    );
    expect(found).toEqual([]);
  });

  it('sees a dynamic import and a side-effect import', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "import '@vertex/sys';\nconst m = await import('@vertex/sys');",
    );
    expect(rules(found)).toEqual(['§4.1', '§4.1']);
  });

  it('finds both breaches when two statements share a line', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "import { a } from './grant.js'; import { b } from '@vertex/sys';",
    );
    expect(rules(found)).toEqual(['§4.1']);
  });

  it('does not read a comment as an import', () => {
    const found = breaches(
      'packages/modules/sec/src/authorisation.ts',
      "// a branch comes from '@vertex/sys' and is only ever held by id\n" +
        " * imported from '@vertex/sys' in an earlier draft\n",
    );
    expect(found).toEqual([]);
  });
});

describe('§4.1 — what may know that a module exists', () => {
  it('refuses the platform importing a module, which is what it hosts and never inspects', () => {
    const found = breaches(
      'packages/platform/src/registry.ts',
      "import { sys } from '@vertex/sys';",
    );
    expect(rules(found)).toEqual(['§4.1']);
  });

  it('refuses the kernel and the shared vocabulary importing a module', () => {
    expect(
      rules(breaches('packages/contracts/src/identity.ts', "import { sys } from '@vertex/sys';")),
    ).toEqual(['§4.1']);
  });

  it('lets an app import a module, because composing an edition is what an app does', () => {
    const found = breaches('apps/store-node/src/edition.ts', "import { sys } from '@vertex/sys';");
    expect(found).toEqual([]);
  });

  it('refuses even an app reaching into a module past its exports', () => {
    const found = breaches(
      'apps/store-node/src/edition.ts',
      "import { table } from '@vertex/sys/dist/schema.js';",
    );
    expect(rules(found)).toEqual(['§4.1']);
  });
});

describe('the contract surface stays importable on its own', () => {
  it('refuses a contract that imports the implementation behind it', () => {
    const found = breaches(
      'packages/modules/sys/src/contract.ts',
      "import { branchRepository } from './branch-repository.js';",
    );
    expect(rules(found)).toEqual(['contract']);
  });

  it('allows a contract split across its own directory', () => {
    const found = breaches(
      'packages/modules/sys/src/contract.ts',
      "import type { BranchView } from './contract/branch.js';",
    );
    expect(found).toEqual([]);
  });

  it('allows a contract to name the vocabulary and another module’s contract', () => {
    const found = breaches(
      'packages/modules/sys/src/contract.ts',
      "import type { BranchId } from '@vertex/contracts';\n" +
        "import { contractKey } from '@vertex/platform';\n" +
        "import type { Role } from '@vertex/sec/contract';",
    );
    expect(found).toEqual([]);
  });
});

describe('§2 — a module publishes a contract or it has none', () => {
  it('refuses a module package whose exports map offers no contract', () => {
    const packages = PACKAGES.map((one) =>
      one.name === '@vertex/sys' ? { ...one, exported: ['.'] } : one,
    );
    const found = findBoundaryBreaches({ packages, files: [] });
    expect(rules(found)).toEqual(['§2']);
    expect(found[0].file).toBe('packages/modules/sys/package.json');
  });

  it('says nothing about a package that is not a module', () => {
    expect(findBoundaryBreaches({ packages: PACKAGES, files: [] })).toEqual([]);
  });
});

describe('altitude — an app may not hold a file that knows nothing about the app', () => {
  const UI = { name: '@vertex/ui', dir: 'packages/ui', exported: ['.'] };
  const withUi = [...PACKAGES, UI];

  it('refuses a control built only from the design system', () => {
    // The case this rule exists for, and the one that happened: a theme switch
    // written inside an app, built from nothing but `@vertex/ui`. It works, it
    // is tested, and it is invisible until the second app copies it.
    const found = breaches(
      'apps/store-node/src/ThemeSwitch.tsx',
      "import type { ReactNode } from 'react';\nimport { IconButton } from '@vertex/ui';",
      withUi,
    );
    expect(rules(found)).toEqual(['altitude']);
    expect(found[0].message).toContain('@vertex/ui');
  });

  it('says nothing about a screen, which names its own app', () => {
    const found = breaches(
      'apps/store-node/src/SignIn.tsx',
      "import { isOk } from '@vertex/kernel';\n" +
        "import { Button } from '@vertex/ui';\n" +
        "import { useSession } from './session.js';",
      withUi,
    );
    expect(found).toEqual([]);
  });

  it('says nothing about a file that imports nothing of this workspace', () => {
    // A leaf built from React alone leaves no trace of what it knows, so the
    // rule has nothing to read and does not guess.
    const found = breaches(
      'apps/store-node/src/useTick.ts',
      "import { useState } from 'react';",
      withUi,
    );
    expect(found).toEqual([]);
  });

  it('says nothing about the same file inside a package', () => {
    // Packages are deliberate homes for concepts; their placement is a decision
    // the package boundary already records. This rule is about apps.
    const found = breaches(
      'packages/ui/src/components/ThemeSwitch.tsx',
      "import { IconButton } from '@vertex/ui';",
      withUi,
    );
    expect(found).toEqual([]);
  });

  it('leaves tests, fixtures and journeys alone', () => {
    for (const file of [
      'apps/store-node/src/sign-in.test.tsx',
      'apps/store-node/src/edition.fixture.ts',
    ]) {
      expect(breaches(file, "import { Button } from '@vertex/ui';", withUi)).toEqual([]);
    }
  });

  it('says nothing about an app own strings, which are app-specific by content', () => {
    // A catalogue reaches only the translator and knows this product by the
    // thousand sentences in it. Exempting it one app at a time would spend a
    // reasoned exception on something true by definition.
    const i18n = { name: '@vertex/i18n', dir: 'packages/i18n', exported: ['.'] };
    const found = breaches(
      'apps/store-node/src/catalogue.ts',
      "import { Translator } from '@vertex/i18n';\nexport const catalogue = { 'a.b': 'نص' };",
      [...PACKAGES, i18n],
    );
    expect(found).toEqual([]);
  });

  it('takes an exemption written in place, and only with a reason', () => {
    const source = "import { Button } from '@vertex/ui';";
    const reasoned =
      '// boundary-exempt: altitude — one fragment of the sign-in screen, never reused\n' + source;
    expect(breaches('apps/store-node/src/Fragment.tsx', reasoned, withUi)).toEqual([]);

    // A shrug is not an exemption, and neither is a shrug with a full stop.
    for (const shrug of [
      '// boundary-exempt: altitude —\n',
      '// boundary-exempt: altitude — .\n',
    ]) {
      expect(rules(breaches('apps/store-node/src/Fragment.tsx', shrug + source, withUi))).toEqual([
        'altitude',
      ]);
    }
  });
});

describe('FX-07 — the kernel rounds money only where FX says it is rounded', () => {
  it('refuses `round` imported from the kernel by a module that is not FX', () => {
    const found = breaches(
      'packages/modules/sec/src/credentials.ts',
      "import { money, round } from '@vertex/kernel';",
    );

    expect(rules(found)).toEqual(['FX-07']);
    expect(found[0].line).toBe(1);
    expect(found[0].message).toContain('@vertex/fx');
  });

  it('refuses it in an app, in the design system, and in the platform alike', () => {
    for (const file of [
      'apps/store-node/src/totals.ts',
      'packages/ui/src/components/Money.tsx',
      'packages/platform/src/unit-of-work.ts',
    ]) {
      const found = breaches(file, "import { round } from '@vertex/kernel';");
      // `toContain`, not `toEqual`: a file in an app that names only the kernel
      // is also the altitude rule's business, and this one is asserting its own.
      expect(rules(found), file).toContain('FX-07');
    }
  });

  it('sees it renamed on the way in, which is the obvious way past a name check', () => {
    const found = breaches(
      'packages/modules/sec/src/credentials.ts',
      "import { round as settle } from '@vertex/kernel';",
    );

    expect(rules(found)).toEqual(['FX-07']);
  });

  it('leaves FX alone, which is the module that owns the rounding rules', () => {
    for (const file of [
      'packages/modules/fx/src/currencies.ts',
      'packages/modules/fx/src/currencies.test.ts',
    ]) {
      const found = breaches(file, "import { round } from '@vertex/kernel';");
      expect(found, file).toEqual([]);
    }
  });

  it('leaves the kernel’s own use of it alone', () => {
    const found = breaches(
      'packages/kernel/src/money.test.ts',
      "import { round } from './money.js';\nimport { allocate } from '@vertex/kernel';",
    );

    expect(found).toEqual([]);
  });

  it('does not read a comment as code, which is the shrug this rule invites', () => {
    // A signpost is the natural thing to write beside the call that does it
    // properly, and a check that failed on one would be a check with nothing to
    // fix but the comment — which is the state every other rule in this file
    // takes pains to avoid.
    const found = breaches(
      'packages/modules/sec/src/credentials.ts',
      [
        "import { money } from '@vertex/kernel';",
        "// Not this: import { round } from '@vertex/kernel'; \u2014 ask FX to settle instead.",
        '/**',
        " * Never `import { round } from '@vertex/kernel'`: FX owns the points.",
        ' */',
      ].join('\n'),
    );

    expect(found).toEqual([]);
  });

  it('points at the line the import is on, comments above it and all', () => {
    // The line is the whole of what makes a finding actionable: taking comments
    // out must not move the code that follows them, or every finding in a file
    // with a licence header points somewhere else.
    const found = breaches(
      'packages/modules/sec/src/credentials.ts',
      [
        '/**',
        ' * A comment of several lines.',
        ' */',
        '',
        '// and a line comment',
        "import { round } from '@vertex/kernel';",
      ].join(String.fromCharCode(10)),
    );

    expect(rules(found)).toEqual(['FX-07']);
    expect(found[0].line).toBe(6);
  });

  it('is about the binding and not about the word', () => {
    // `roundTrip`, a property called `round`, prose in a comment: a check that
    // fired on any of these is a check somebody switches off in a week.
    const found = breaches(
      'packages/modules/sec/src/credentials.ts',
      [
        "import { roundTrip, isRounded, allocate } from '@vertex/kernel';",
        '// the other way round: see round() in FX',
        'const shape = { round: 1 };',
      ].join('\n'),
    );

    expect(found).toEqual([]);
  });
});
