import { isOk, orThrow, type Refusal, type Result } from '@vertex/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYS_PERMISSIONS, type Branch, type Company, type Location } from './contract.js';
import { installSys, type Installed } from './edition.fixture.js';
import { normalisePoint } from './place.js';

function taken<T>(result: Result<T, Refusal>): T {
  return orThrow(result, (refusal) => new Error(`refused: ${refusal.code}`));
}

function refusalOf<T>(result: Result<T, Refusal>): string {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error.code;
}

let sys: Installed;

beforeEach(() => {
  sys = installSys();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function aCompany(): Promise<Company> {
  return taken(await sys.admin.companies.register(sys.by, { name: 'Vertex Retail' }));
}

async function aBranch(name = 'Aleppo'): Promise<Branch> {
  const company = await aCompany();
  return taken(await sys.admin.branches.open(sys.by, { company: company.id, name }));
}

async function aLocation(branch: Branch, kind: Location['kind']): Promise<Location> {
  return taken(
    await sys.admin.locations.open(sys.by, { branch: branch.id, name: `A ${kind}`, kind }),
  );
}

/** The old city of Aleppo, and a warehouse an hour down the Damascus road. */
const SHOP = { lat: '36.199700', lng: '37.163700' };
const WAREHOUSE = { lat: '35.931000', lng: '36.633900' };

describe('Addresses and places on a map — SYS-14', () => {
  it('places a branch and reads it back with no way out to the network', async () => {
    // The acceptance criterion says "with all network interfaces disabled", and
    // this is that claim made to fail loudly instead of being asserted in
    // prose: every way a module in this runtime could ask a service anything is
    // replaced by one that throws, so geocoding an address, fetching a tile or
    // asking a map provider where this is would land here.
    const offline = (): never => {
      throw new Error('SYS-14 reached the network.');
    };
    vi.stubGlobal('fetch', offline);
    vi.stubGlobal('XMLHttpRequest', offline);
    vi.stubGlobal('WebSocket', offline);

    const branch = await aBranch();
    const placed = taken(await sys.admin.branches.locate(sys.by, branch.id, SHOP));
    const addressed = taken(
      await sys.admin.branches.readdress(sys.by, branch.id, '  شارع التلل، حلب  '),
    );

    expect(placed.point).toEqual(SHOP);
    expect(addressed.address).toBe('شارع التلل، حلب');
    expect((await sys.read.branch(sys.by, branch.id))?.point).toEqual(SHOP);
  });

  it('opens a branch already placed, so knowing where it is costs no second command', async () => {
    const company = await aCompany();
    const branch = taken(
      await sys.admin.branches.open(sys.by, {
        company: company.id,
        name: 'Aleppo',
        address: 'شارع التلل',
        point: SHOP,
      }),
    );

    expect(branch.point).toEqual(SHOP);
    expect(branch.address).toBe('شارع التلل');
  });

  it('stores a point as written, so one doorstep saved twice is one value', async () => {
    const branch = await aBranch();

    // The same place from a pasted maps link and from a hand-typed field:
    // different strings, different trailing precision, one stored answer.
    // Without this, two store nodes syncing find a difference nobody made.
    const fromLink = taken(
      await sys.admin.branches.locate(sys.by, branch.id, {
        lat: '36.1997',
        lng: '37.16370049',
      }),
    );
    const typed = taken(
      await sys.admin.branches.locate(sys.by, branch.id, { lat: ' +36.199700 ', lng: '37.1637' }),
    );

    expect(fromLink.point).toEqual(typed.point);
    expect(typed.point).toEqual(SHOP);
  });

  it('never writes a negative zero, which is a different string to everything downstream', () => {
    expect(taken(normalisePoint({ lat: '-0', lng: '-0.0000001' }))).toEqual({
      lat: '0.000000',
      lng: '0.000000',
    });
  });

  it('writes the meridian opposite Greenwich one way, whichever side it was reached from', () => {
    for (const lng of ['-180', '180', '-179.9999996']) {
      const normalised = normalisePoint({ lat: '0', lng });
      expect(isOk(normalised) ? normalised.value.lng : null, lng).toBe('180.000000');
    }
  });

  it('refuses a point that did not arrive as text, rather than failing on it', () => {
    // A request body or a replayed command, where the type does not reach.
    const numbers = { lat: 36.2, lng: 37.1 } as unknown as { lat: string; lng: string };
    const refused = normalisePoint(numbers);
    expect(isOk(refused) ? null : refused.error.code).toBe('sys.point-out-of-range');
  });

  it('refuses more degrees than the Earth has, and says what was typed', async () => {
    const branch = await aBranch();

    // A digit too many in the latitude field: ordinary bad input, so it comes
    // back as a refusal carrying the value the person actually typed — which is
    // what they are looking at while they hunt for the mistake.
    const refused = await sys.admin.branches.locate(sys.by, branch.id, {
      lat: '336.1997',
      lng: '37.1637',
    });
    expect(refusalOf(refused)).toBe('sys.point-out-of-range');
    expect(isOk(refused) ? null : refused.error.values).toMatchObject({ lat: '336.1997' });

    for (const lat of ['NaN', '1e2', '', 'شمال']) {
      expect(
        refusalOf(await sys.admin.branches.locate(sys.by, branch.id, { lat, lng: '37.1637' })),
      ).toBe('sys.point-out-of-range');
    }

    // Nothing was written. The checks run before the write, so a refusal costs
    // nothing and leaves no half-applied command behind it.
    expect((await sys.read.branch(sys.by, branch.id))?.point).toBeNull();
  });

  it('leaves a location at its branch rather than copying the branch point onto it', async () => {
    const branch = await aBranch();
    taken(await sys.admin.branches.locate(sys.by, branch.id, SHOP));
    const floor = await aLocation(branch, 'shop-floor');

    // Null here is "at the branch", not "unknown". Copying the doorstep onto
    // every location inside it would stack markers on one spot and turn moving
    // the shop into an edit of several records that must not disagree.
    expect(floor.point).toBeNull();
  });

  it('gives a location its own place when it is somewhere else', async () => {
    const branch = await aBranch();
    const store = await aLocation(branch, 'store-room');

    const placed = taken(await sys.admin.locations.locate(sys.by, store.id, WAREHOUSE));
    expect(placed.point).toEqual(WAREHOUSE);

    // And returns it to its branch when it is not.
    expect(taken(await sys.admin.locations.locate(sys.by, store.id, null)).point).toBeNull();
  });

  it('refuses a point for a vehicle, whose place does not hold still', async () => {
    const branch = await aBranch();
    const van = await aLocation(branch, 'vehicle');

    expect(refusalOf(await sys.admin.locations.locate(sys.by, van.id, WAREHOUSE))).toBe(
      'sys.location-kind-has-no-place',
    );
    expect((await sys.read.location(sys.by, van.id))?.point).toBeNull();

    // Refused at the door as well, so there is no way in.
    expect(
      refusalOf(
        await sys.admin.locations.open(sys.by, {
          branch: branch.id,
          name: 'Delivery van',
          kind: 'vehicle',
          point: WAREHOUSE,
        }),
      ),
    ).toBe('sys.location-kind-has-no-place');
  });

  it('lets a vehicle be cleared, so a replayed command is not a failure', async () => {
    // SYN-02 replays commands; this is the half of that SYS owns.
    const branch = await aBranch();
    const van = await aLocation(branch, 'vehicle');

    // Clearing a point a van does not have is a no-op rather than a mistake. A
    // command that refused its own second application would turn a sync that
    // replayed it into a failure.
    expect(taken(await sys.admin.locations.locate(sys.by, van.id, null)).point).toBeNull();
  });

  it('takes a point off when asked, because a place wrongly marked is worse than unmarked', async () => {
    const branch = await aBranch();
    taken(await sys.admin.branches.locate(sys.by, branch.id, SHOP));

    expect(taken(await sys.admin.branches.locate(sys.by, branch.id, null)).point).toBeNull();
  });

  it('keeps the place of a withdrawn branch, because a report by branch is about places', async () => {
    const branch = await aBranch();
    taken(await sys.admin.branches.locate(sys.by, branch.id, SHOP));
    taken(await sys.admin.branches.deactivate(sys.by, branch.id));

    // `SYS-09` deactivates rather than deletes so that the documents naming it
    // stay readable. A shop that closed is still a shop that was somewhere.
    const withdrawn = await sys.read.branch(sys.by, branch.id);
    expect(withdrawn?.active).toBe(false);
    expect(withdrawn?.point).toEqual(SHOP);
  });

  it('refuses to place a branch the grant does not reach — SEC-04', async () => {
    const company = await aCompany();
    const aleppo = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );
    const damascus = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Damascus' }),
    );

    // A manager confined to Aleppo. Where a branch is is an edit to that
    // branch, judged at that branch — so the confinement reaches it without
    // `SYS-14` carrying any scoping rule of its own.
    sys.answers((_by, right, where) =>
      right === SYS_PERMISSIONS.branch.edit ? where?.branch === aleppo.id : true,
    );

    expect(refusalOf(await sys.admin.branches.locate(sys.by, damascus.id, SHOP))).toBe(
      'sys.not-permitted',
    );
    expect(taken(await sys.admin.branches.locate(sys.by, aleppo.id, SHOP)).point).toEqual(SHOP);
    expect((await sys.read.branch(sys.by, damascus.id))?.point).toBeNull();
  });

  it('takes an address as free text, because that is what an address here is', async () => {
    const branch = await aBranch();
    const store = await aLocation(branch, 'store-room');

    // "Opposite the Rahman mosque, above the Noor pharmacy" is a truthful
    // address in the places this product is sold. A form insisting on a street
    // and a postcode is a form nobody can fill in honestly.
    const written = taken(
      await sys.admin.locations.readdress(
        sys.by,
        store.id,
        ' مقابل جامع الرحمن، فوق صيدلية النور ',
      ),
    );
    expect(written.address).toBe('مقابل جامع الرحمن، فوق صيدلية النور');

    // And clearing it is how a shop that moved says it no longer knows.
    expect(taken(await sys.admin.locations.readdress(sys.by, store.id, '   ')).address).toBe('');
  });
});
