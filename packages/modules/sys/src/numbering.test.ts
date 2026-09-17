import type { DeviceId } from '@vertex/contracts';
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

/**
 * Numbering joins the caller's transaction, so a test has to open one first —
 * and a till's number is taken on the machine standing at it, so unless a test
 * says otherwise, that is the machine it runs on.
 */
async function issue(
  scope: SeriesScope,
  document: string,
  device?: DeviceId | null,
): Promise<Result<IssuedNumber, Refusal>> {
  const standing =
    device !== undefined || scope.register === null
      ? (device ?? null)
      : ((await sys.read.register(sys.by, scope.register))?.heldBy ?? null);
  return sys.inTransaction((uow) => sys.numbering.next(uow, scope, document), standing);
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

  it('keeps a series per branch, even for a document no till issues', async () => {
    // The dimension the test above cannot isolate: its two branches also have
    // different tills. Here the type, the year and the absent till are the
    // same, and only the branch differs.
    const branch = await aBranch();
    const other = taken(
      await sys.admin.branches.open(sys.by, { company: branch.company, name: 'Homs' }),
    );
    const invoice = (of: Branch): SeriesScope => ({
      documentType: 'pur.invoice',
      branch: of.id,
      register: null,
      fiscalYear: '2026',
    });

    taken(await issue(invoice(branch), newId<'document'>()));
    taken(await issue(invoice(branch), newId<'document'>()));
    expect(taken(await issue(invoice(other), newId<'document'>())).sequence).toBe(1);
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
    const { register, device } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    await expect(
      sys.inTransaction(async (uow) => {
        taken(await sys.numbering.next(uow, scope, newId<'document'>()));
        // The sale fails after its number was taken. A gap here is a question a
        // tax inspector asks and nobody can answer.
        throw new Error('the sale failed');
      }, device),
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

    taken(
      await sys.admin.numbering.define(sys.by, scope, '{prefix}.{generation}/{year}/{sequence:3}'),
    );
    const after = taken(await sys.numbering.preview(sys.by, scope, null));
    expect(after.isDefault).toBe(false);
    expect(after.specimen).toBe('AL1.1/2026/001');
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

  it('numbers a till only from the machine standing at it', async () => {
    // A machine replaced but not dead — set aside, switched on again, synced —
    // reads the new generation and counts from one under it. So would the store
    // node, which stands at no till. Either would print the replacement's
    // numbers a second time.
    const branch = await aBranch();
    const { register, device: first } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);
    const second = newId<'device'>();
    taken(await sys.admin.registers.assignDevice(sys.by, register.id, second));

    expect(taken(await issue(scope, newId<'document'>(), second)).number).toBe('AL1-2-2026-000001');
    expect(refusalOf(await issue(scope, newId<'document'>(), first))).toBe(
      'sys.register-held-elsewhere',
    );
    expect(refusalOf(await issue(scope, newId<'document'>(), null))).toBe(
      'sys.register-held-elsewhere',
    );
    // The machine's identifier as it may arrive from outside: the same machine.
    expect(
      taken(await issue(scope, newId<'document'>(), second.toUpperCase() as DeviceId)).sequence,
    ).toBe(2);
  });

  it('refuses a format whose printed numbers cannot be read back into their parts', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const scope = scopeFor(register);

    for (const format of [
      // Till T1's 23rd and till T12's 3rd.
      '{prefix}{sequence}-{generation}-{year}',
      // Generation 1's 11th and generation 11's 1st.
      '{prefix}-{year}-{generation}{sequence}',
      // AL1's 1001st and AL's 1st.
      '{prefix}1{sequence}-{generation}-{year}',
    ]) {
      expect(refusalOf(await sys.admin.numbering.define(sys.by, scope, format)), format).toBe(
        'sys.series-format-fields-adjacent',
      );
    }

    // Readable from one side is readable: a count holds no dash, and a
    // generation no letter.
    for (const format of [
      '{prefix}g{generation}-{year}-{sequence}',
      '{year}-{prefix}-{generation}-{sequence}',
    ]) {
      taken(await sys.admin.numbering.define(sys.by, scope, format));
    }
  });

  it('refuses a format without the year its series is counted under', async () => {
    // Counted from one each fiscal year, a format without the year prints last
    // year's numbers again.
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    expect(
      refusalOf(
        await sys.admin.numbering.define(
          sys.by,
          scopeFor(register),
          '{prefix}-{generation}-{sequence}',
        ),
      ),
    ).toBe('sys.series-format-must-carry-year');
  });

  it('carries a chosen format into the next fiscal year rather than lapsing to the default', async () => {
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

    const nextYear: SeriesScope = { ...scope, fiscalYear: '2027' };
    expect(taken(await issue(nextYear, newId<'document'>())).number).toBe('INV/2027/AL1g1/0001');
    expect(taken(await sys.numbering.preview(sys.by, nextYear, null)).isDefault).toBe(false);
  });

  it('refuses to number a document for a company taken out of use', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    taken(await sys.admin.companies.deactivate(sys.by, branch.company));

    expect(refusalOf(await issue(scopeFor(register), newId<'document'>()))).toBe(
      'sys.company-inactive',
    );
  });

  it('numbers one document once, however its reference is spelled', async () => {
    const branch = await aBranch();
    const { register } = await aWorkingRegister(branch, 'AL1');
    const document = newId<'document'>();

    const first = taken(await issue(scopeFor(register), document));
    expect(taken(await issue(scopeFor(register), document.toUpperCase()))).toEqual(first);
  });

  it('refuses the second of two overlapping issues rather than printing one number twice', async () => {
    // Two users at the store node numbering purchase invoices at the same moment.
    const branch = await aBranch();
    const scope: SeriesScope = {
      documentType: 'pur.invoice',
      branch: branch.id,
      register: null,
      fiscalYear: '2026',
    };
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow = sys.inTransaction(async (uow) => {
      const issued = await sys.numbering.next(uow, scope, newId<'document'>());
      await held;
      return issued;
    });
    const quick = await issue(scope, newId<'document'>());
    release();

    expect(taken(quick).number).toBe('2026-000001');
    await expect(slow).rejects.toThrow(/committed a change/u);
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
        '{prefix}-{generation}-{year}-{sequence:5}',
      ),
    );
    taken(await sys.admin.numbering.define(sys.by, typed, 'PUR-{year}-{sequence:5}'));
    taken(
      await sys.admin.numbering.define(
        sys.by,
        { ...typed, fiscalYear: '2027' },
        'PUR-{year}-{sequence:6}',
      ),
    );
    taken(
      await sys.admin.numbering.define(
        sys.by,
        { documentType: 'pur.invoice', branch: elsewhere.id, register: null, fiscalYear: '2026' },
        'HO-{year}-{sequence:5}',
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
    expect(here.map((one) => one.specimen)).toEqual([
      'AL1-1-2026-00001',
      'PUR-2026-00001',
      'PUR-2027-000001',
    ]);
    expect(here.every((one) => !one.isDefault)).toBe(true);
  });
});
