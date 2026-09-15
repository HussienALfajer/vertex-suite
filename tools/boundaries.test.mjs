import { describe, expect, it } from 'vitest';

import { findBoundaryBreaches } from './boundaries.mjs';

const PACKAGES = [
  { name: '@vertex/kernel', dir: 'packages/kernel', exported: ['.'] },
  { name: '@vertex/contracts', dir: 'packages/contracts', exported: ['.'] },
  { name: '@vertex/platform', dir: 'packages/platform', exported: ['.'] },
  { name: '@vertex/sys', dir: 'packages/modules/sys', exported: ['.', './contract'] },
  { name: '@vertex/sec', dir: 'packages/modules/sec', exported: ['.', './contract'] },
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
