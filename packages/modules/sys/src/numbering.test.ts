import { newId, orThrow, type Id, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Branch, IssuedNumber, Register, SeriesScope } from './contract.js';
import { installSys, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  return orThrow(result, (refusal) => new Error(`refused: ${refusal.code}`));
}

function refusalOf<T>(result: Result<T, Refusal>): string {
  if (result.ok) throw new Error('Expected a refusal; the command succeeded.');
  return result.error.code;
}

let sys: Installed;

beforeEach(() => {
  sys = installSys();
});

async function aBranch(): Promise<Branch> {
  const company = taken(await sys.admin.companies.register(sys.by, { name: 'Al Sham' }));
  return taken(await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }));
}

/** A till with a machine standing at it, which is the only kind that can print. */
async function aWorkingRegister(
  branch: Branch,
  prefix: string,
): Promise<{ register: Register; device: Id<'device'> }> {
  const opened = taken(
    await sys.admin.registers.open(sys.by, { branch: branch.id, name: prefix, prefix }),
  );
  const device = newId<'device'>();
  const register = taken(await sys.admin.registers.assignDevice(sys.by, opened.id, device));
  return { register, device };
}

function scopeFor(register: Register, documentType = 'pos.sale'): SeriesScope {
  return {
    documentType,
    branch: register.branch,
    register: register.id,
    fiscalYear: '2026',
  };
}

/** Numbering joins the caller's transaction, so a test has to open one first. */
async function issue(scope: SeriesScope, document: string): Promise<Result<IssuedNumber, Refusal>> {
  return sys.inTransaction((uow) => sys.numbering.next(uow, scope, document));
}

describe('Document numbering series — SYS-02', () => {
  it('runs an independent series per document type, per branch, per register and per fiscal year', async () => {
    const branch = await aBranch();
    const other = taken(
      await sys.admin.branches.open(sys.by, {
        company: branch.company,
        name: 'Homs',
      }),
    );
    const here = await aWorkingRegister(branch, 'AL1');
    const alongside = await aWorkingRegister(branch, 'AL2');
    const away = await aWorkingRegister(other, 'HO1');

    const sale = scopeFor(here.register);
    const refund = scopeFor(here.register, 'pos.refund');
    const nextYear: SeriesScope = { ...sale, fiscalYear: '2027' };

    // Four dimensions, four counters. Each one starts at its own beginning.
    for (const scope of [
      sale,
      refund,
      nextYear,
      scopeFor(alongside.register),
      scopeFor(away.register),
    ]) {
      expect(taken(await issue(scope, newId<'document'>())).sequence).toBe(1);
    }

    expect(taken(await issue(sale, newId<'document'>())).sequence).toBe(2);
    expect(taken(await issue(refund, newId<'document'>())).sequence).toBe(2);
  });

  it('carries the register prefix and the device generation in every number', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');

    const issued = taken(await issue(scopeFor(register), newId<'document'>()));

    expect(issued.generation).toBe(1);
    expect(issued.number).toContain('AL1');
    expect(issued.number).toBe('AL1-1-2026-000001');
  });

  it('never lets a replacement device reissue a number the machine it replaced had used', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    const printed: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      printed.push(taken(await issue(scope, newId<'document'>())).number);
    }

    // The machine dies. Nobody knows which of its numbers reached the store
    // node — that is the whole difficulty — so the replacement is told nothing
    // about them and simply counts from one again.
    taken(await sys.admin.registers.assignDevice(sys.by, register.id, newId<'device'>()));

    const afterwards: IssuedNumber[] = [];
    for (let i = 0; i < 3; i += 1) {
      afterwards.push(taken(await issue(scope, newId<'document'>())));
    }

    expect(afterwards.map((one) => one.sequence)).toEqual([1, 2, 3]);
    expect(afterwards.every((one) => one.generation === 2)).toBe(true);
    // Same till, same sequence numbers, and not one collision.
    expect(new Set([...printed, ...afterwards.map((one) => one.number)]).size).toBe(6);
  });

  it('spends no generation when the same machine is named again', async () => {
    const branch = await aBranch();
    const { register, device } = await aWorkingRegister(branch, 'AL1');

    const again = taken(await sys.admin.registers.assignDevice(sys.by, register.id, device));

    expect(again.generation).toBe(1);
    expect(taken(await issue(scopeFor(register), newId<'document'>())).generation).toBe(1);
  });

  it('cannot be configured into a format that drops the prefix or the generation', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    for (const format of [
      '{year}-{sequence:6}',
      '{prefix}-{sequence:6}',
      '{generation}-{sequence}',
    ]) {
      expect(refusalOf(await sys.admin.numbering.define(sys.by, scope, format))).toBe(
        'sys.series-format-must-carry-register',
      );
    }

    // And a format with no counter at all would give every sale of the day the
    // same number, which is worse than any of the above.
    expect(
      refusalOf(await sys.admin.numbering.define(sys.by, scope, '{prefix}-{generation}-{year}')),
    ).toBe('sys.series-format-invalid');
  });

  it('honours a format an administrator did choose', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    taken(
      await sys.admin.numbering.define(
        sys.by,
        scope,
        'INV/{year}/{prefix}g{generation}/{sequence:4}',
      ),
    );

    expect(taken(await issue(scope, newId<'document'>())).number).toBe('INV/2026/AL1g1/0001');
  });

  it('issues from the first sale onwards without anyone having defined a series', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');

    // A shop that opened this morning sells before it configures anything, and
    // the default it gets already carries what SYS-02 requires.
    expect(await sys.numbering.series(sys.by, scopeFor(register))).toBeNull();
    expect(taken(await issue(scopeFor(register), newId<'document'>())).number).toBe(
      'AL1-1-2026-000001',
    );
  });

  it('gives the same number back when one document is numbered twice', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);
    const document = newId<'document'>();

    const first = taken(await issue(scope, document));
    // SYN-02 delivers at least once and applies exactly once. A replay that
    // took a fresh number would print a second document for one sale.
    const replayed = taken(await issue(scope, document));

    expect(replayed).toEqual(first);
    expect(taken(await issue(scope, newId<'document'>())).sequence).toBe(2);
  });

  it('takes the number back when the transaction that asked for it rolls back', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    await expect(
      sys.inTransaction(async (uow) => {
        taken(await sys.numbering.next(uow, scope, newId<'document'>()));
        // The sale fails after its number was taken. A gap here is a question a
        // tax inspector asks and nobody can answer.
        throw new Error('the sale failed');
      }),
    ).rejects.toThrow('the sale failed');

    expect(taken(await issue(scope, newId<'document'>())).sequence).toBe(1);
  });

  it('refuses to print from a till nobody is standing at, or one taken out of use', async () => {
    const branch = await aBranch();
    const bare = taken(
      await sys.admin.registers.open(sys.by, { branch: branch.id, name: '2', prefix: 'AL2' }),
    );
    expect(refusalOf(await issue(scopeFor(bare), newId<'document'>()))).toBe(
      'sys.register-has-no-device',
    );

    const { register } = await aWorkingRegister(branch, 'AL1');
    taken(await sys.admin.registers.deactivate(sys.by, register.id));
    expect(refusalOf(await issue(scopeFor(register), newId<'document'>()))).toBe(
      'sys.register-inactive',
    );
  });

  it('refuses a document type that names no module, and a year that names nothing', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');

    for (const documentType of ['sale', '.', 'POS.Sale', 'pos.sale ']) {
      expect(
        refusalOf(await issue({ ...scopeFor(register), documentType }, newId<'document'>())),
      ).toBe('sys.document-type-unowned');
    }
    for (const fiscalYear of ['  ', '', ' 2026', '2026/27']) {
      expect(
        refusalOf(await issue({ ...scopeFor(register), fiscalYear }, newId<'document'>())),
      ).toBe('sys.fiscal-year-required');
    }
  });

  it('cannot be tricked into two series that print the same numbers', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    // The type and the year tell counters apart but appear nowhere in the
    // printed number, so a pair differing only in whitespace would count
    // separately and print identically. Both spellings cannot exist.
    taken(await issue(scope, newId<'document'>()));
    expect(
      refusalOf(await issue({ ...scope, documentType: ' pos.sale' }, newId<'document'>())),
    ).toBe('sys.document-type-unowned');
    expect(refusalOf(await issue({ ...scope, fiscalYear: '2026 ' }, newId<'document'>()))).toBe(
      'sys.fiscal-year-required',
    );
  });

  it('refuses to number a document that has no reference of its own', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');

    // Two documents that both passed nothing would be taken for one document
    // and would share a number between them.
    expect(refusalOf(await issue(scopeFor(register), ''))).toBe('sys.document-reference-required');
  });

  it('refuses a register that belongs to another branch than the series names', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const elsewhere = taken(
      await sys.admin.branches.open(sys.by, {
        company: branch.company,
        name: 'Homs',
      }),
    );

    expect(
      refusalOf(await issue({ ...scopeFor(register), branch: elsewhere.id }, newId<'document'>())),
    ).toBe('sys.register-outside-branch');
  });

  it('numbers a document that no till issues, and refuses register marks in its format', async () => {
    const branch = await aBranch();
    const scope: SeriesScope = {
      documentType: 'pur.invoice',
      branch: branch.id,
      register: null,
      fiscalYear: '2026',
    };

    const issued = taken(await issue(scope, newId<'document'>()));
    expect(issued.number).toBe('2026-000001');
    expect(issued.generation).toBe(0);

    expect(
      refusalOf(await sys.admin.numbering.define(sys.by, scope, '{prefix}-{year}-{sequence:6}')),
    ).toBe('sys.series-format-carries-absent-register');
  });

  it('shows what a format would print before a document is printed under it', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);
    const format = 'INV/{year}/{prefix}g{generation}/{sequence:4}';

    const specimen = taken(await sys.numbering.preview(sys.by, scope, format));
    expect(specimen.specimen).toBe('INV/2026/AL1g1/0001');

    // Asking cost nothing: the counter has not moved, so the first real
    // document still gets the number the specimen showed.
    expect(taken(await sys.numbering.preview(sys.by, scope, format)).sequence).toBe(1);
    taken(await sys.admin.numbering.define(sys.by, scope, format));
    expect(taken(await issue(scope, newId<'document'>())).number).toBe('INV/2026/AL1g1/0001');

    // And afterwards it shows the next one rather than the one just printed.
    expect(taken(await sys.numbering.preview(sys.by, scope, null)).specimen).toBe(
      'INV/2026/AL1g1/0002',
    );
  });

  it('says when a series is printing under a format nobody chose', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    // A shop that has configured nothing is not a shop that is numbering
    // nothing, and an administrator has to be able to see what is printing
    // before deciding whether to change it.
    const before = taken(await sys.numbering.preview(sys.by, scope, null));
    expect(before.isDefault).toBe(true);
    expect(before.format).toBe('{prefix}-{generation}-{year}-{sequence:6}');
    expect(before.specimen).toBe('AL1-1-2026-000001');

    taken(await sys.admin.numbering.define(sys.by, scope, '{prefix}{generation}-{sequence:3}'));
    const after = taken(await sys.numbering.preview(sys.by, scope, null));
    expect(after.isDefault).toBe(false);
    expect(after.specimen).toBe('AL11-001');
  });

  it('refuses a proposed format where it can still be retyped', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');

    // The same judgement `define` makes, asked before anything is stored — so a
    // format that drops the guarantee is refused in front of whoever typed it
    // rather than on a document that cannot be reprinted.
    expect(
      refusalOf(await sys.numbering.preview(sys.by, scopeFor(register), '{year}-{sequence:6}')),
    ).toBe('sys.series-format-must-carry-register');
  });

  it('reads a till that no machine is standing at as generation zero, rather than refusing', async () => {
    const branch = await aBranch();
    const bare = taken(
      await sys.admin.registers.open(sys.by, { branch: branch.id, name: '2', prefix: 'AL2' }),
    );
    const scope = scopeFor(bare);

    // `next` refuses here, and must: there is no generation for the number to
    // carry. A specimen has nothing to lose by answering truthfully, and the
    // zero is what sends somebody to the till rather than to the vendor.
    const specimen = taken(await sys.numbering.preview(sys.by, scope, null));
    expect(specimen.generation).toBe(0);
    expect(specimen.specimen).toBe('AL2-0-2026-000001');
    expect(refusalOf(await issue(scope, newId<'document'>()))).toBe('sys.register-has-no-device');
  });

  it('lists the series configured in one branch, in an order that holds still', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const elsewhere = taken(
      await sys.admin.branches.open(sys.by, { company: branch.company, name: 'Homs' }),
    );

    // A branch with nothing configured is numbering documents perfectly well
    // under the defaults, so an empty listing says "nothing overridden".
    expect(await sys.numbering.configured(sys.by, branch.id)).toEqual([]);

    const typed: SeriesScope = {
      documentType: 'pur.invoice',
      branch: branch.id,
      register: null,
      fiscalYear: '2026',
    };
    taken(
      await sys.admin.numbering.define(
        sys.by,
        scopeFor(register),
        '{prefix}-{generation}-{sequence:5}',
      ),
    );
    taken(await sys.admin.numbering.define(sys.by, typed, 'PUR-{sequence:5}'));
    taken(
      await sys.admin.numbering.define(
        sys.by,
        { ...typed, fiscalYear: '2027' },
        'PUR-{sequence:6}',
      ),
    );
    taken(
      await sys.admin.numbering.define(
        sys.by,
        { documentType: 'pur.invoice', branch: elsewhere.id, register: null, fiscalYear: '2026' },
        'HO-{sequence:5}',
      ),
    );

    const here = await sys.numbering.configured(sys.by, branch.id);
    expect(here.map((one) => [one.scope.documentType, one.scope.fiscalYear])).toEqual([
      ['pos.sale', '2026'],
      ['pur.invoice', '2026'],
      ['pur.invoice', '2027'],
    ]);
    // Homs is not in Aleppo's list, and the order does not depend on the order
    // the four were defined in.
    expect(here.every((one) => one.scope.branch === branch.id)).toBe(true);
    expect(here.map((one) => one.specimen)).toEqual(['AL1-1-00001', 'PUR-00001', 'PUR-000001']);
    expect(here.every((one) => !one.isDefault)).toBe(true);
  });
});
