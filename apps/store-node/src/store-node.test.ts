import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { newId } from '@vertex/kernel';
import { openPostgresStore, openSqliteStore } from '@vertex/storage';
import {
  commandContext,
  createEventBus,
  createTransactor,
  deliverOutbox,
  operationMailboxMigrations,
  outboxEntries,
  runMigrations,
  stageOperation,
  type MemorySession,
  type Receipt,
} from '@vertex/platform';
import { systemClock } from '@vertex/kernel';
import { SYS_PERMISSIONS } from '@vertex/sys';
import { afterEach, describe, expect, it } from 'vitest';

import { composeStoreNode } from './store-node.js';

const database = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !database)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for SYN-01 HTTP tests.');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe.skipIf(!database)('CAT-15 authenticated catalogue search', () => {
  it('finds an item by any spelling of its name for its own tenant, and answers no one else', async () => {
    const shop = await fixture();
    const token = await shop.signIn();
    const rootPath = `/v1/tenants/${shop.tenant}/catalogue`;
    const post = async (path: string, args: unknown[]) => {
      const response = await shop.request(`${rootPath}.${path}`, token, { args }, 'POST');
      expect(response.status, path).toBe(200);
      return ((await response.json()) as { value: { value: { id: string } } }).value.value;
    };
    const category = await post('createCategory', [
      { name: 'ألبان', parent: null, defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 } },
    ]);
    const item = await post('createItem', [
      { name: 'حَلِيبٌ طَازَجٌ', category: category.id, code: 'MLK-1' },
    ]);
    const search = (args: unknown[], as?: string, tenant = shop.tenant) =>
      shop.request(
        `/v1/tenants/${tenant}/catalogue.search?args=${encodeURIComponent(JSON.stringify(args))}`,
        as,
      );
    for (const term of ['حليب', 'الحليب', 'mlk-1', 'البان']) {
      const response = await search([term], token);
      expect(response.status, term).toBe(200);
      const body = (await response.json()) as {
        value: { ok: true; value: { items: { id: string }[]; total: number } };
      };
      expect(
        body.value.value.items.map((one) => one.id),
        term,
      ).toEqual([item.id]);
    }
    const refused = await search(['', 500], token);
    expect(((await refused.json()) as { value: unknown }).value).toMatchObject({
      ok: false,
      error: { code: 'cat.search-limit-invalid' },
    });
    expect((await search(['حليب'])).status).toBe(401);
    expect((await search(['حليب'], token, shop.otherTenant)).status).toBe(403);
    // Signed in to the other shop, its owner finds nothing of this one's.
    const theirs = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
    const elsewhere = await search(['حليب'], theirs, shop.otherTenant);
    expect(
      ((await elsewhere.json()) as { value: { value: { total: number } } }).value.value.total,
    ).toBe(0);
  });
});

describe.skipIf(!database)('CAT-01 authenticated catalogue transport', () => {
  it('creates and reads an item for its tenant, and refuses another tenant or an unsigned read', async () => {
    const shop = await fixture();
    const token = await shop.signIn();
    const rootPath = `/v1/tenants/${shop.tenant}/catalogue`;
    const created = await shop.request(
      `${rootPath}.createCategory`,
      token,
      {
        args: [
          {
            name: 'مشروبات',
            parent: null,
            defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
          },
        ],
      },
      'POST',
    );
    expect(created.status).toBe(200);
    const category = ((await created.json()) as { value: { value: { id: string } } }).value.value;
    const itemResponse = await shop.request(
      `${rootPath}.createItem`,
      token,
      { args: [{ name: 'ماء', category: category.id }] },
      'POST',
    );
    expect(itemResponse.status).toBe(200);
    const item = (
      (await itemResponse.json()) as { value: { value: { id: string; category: string } } }
    ).value.value;
    expect(item.category).toBe(category.id);
    const listed = await shop.request(`${rootPath}.items?args=%5B%5D`, token);
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { value: { id: string }[] }).value.map((one) => one.id),
    ).toContain(item.id);
    expect((await shop.request(`${rootPath}.items?args=%5B%5D`)).status).toBe(401);
    expect(
      (await shop.request(`/v1/tenants/${shop.otherTenant}/catalogue.items?args=%5B%5D`, token))
        .status,
    ).toBe(403);
  });
});

describe.skipIf(!database)(
  'CAT-01 CAT-08 CAT-15 SEC-04 the catalogue over PostgreSQL for a manager confined to a branch',
  () => {
    it('answers the manager of Damascus every catalogue read, and still refuses them writes and Aleppo', async () => {
      const shop = await fixture();
      const owner = await shop.signIn();
      const root = `/v1/tenants/${shop.tenant}`;
      const post = async (path: string, args: unknown[], token = owner) => {
        const response = await shop.request(`${root}/${path}`, token, { args }, 'POST');
        expect(response.status, path).toBe(200);
        return (
          (await response.json()) as {
            value: { ok: boolean; value: { id: string }; error: { code: string } };
          }
        ).value;
      };
      const get = (path: string, args: unknown[], token: string) =>
        shop.request(`${root}/${path}?args=${encodeURIComponent(JSON.stringify(args))}`, token);
      const company = (await post('companies.register', [{ name: 'Shop' }])).value.id;
      const damascus = (await post('branches.open', [{ company, name: 'دمشق' }])).value.id;
      const aleppo = (await post('branches.open', [{ company, name: 'حلب' }])).value.id;
      const category = (
        await post('catalogue.createCategory', [
          {
            name: 'ألبان',
            parent: null,
            defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
          },
        ])
      ).value.id;
      const item = (await post('catalogue.createItem', [{ name: 'حليب', category }])).value.id;
      const user = (
        await post('users.enrol', [
          { handle: 'damascus', name: 'مدير دمشق', password: 'till-morning-5' },
        ])
      ).value.id;
      const roles = await shop.request(`${root}/users.roles.list`, owner);
      const manager = (
        (await roles.json()) as { value: { id: string; seeded: string }[] }
      ).value.find((one) => one.seeded === 'manager')!;
      expect(
        (
          await post('users.assignments.assign', [
            {
              user,
              role: manager.id,
              confinement: { kind: 'branches', branches: [damascus], locations: [] },
            },
          ])
        ).ok,
      ).toBe(true);
      const them = await shop.signIn(shop.tenant, 'damascus', 'till-morning-5');

      // The item is the same record in every branch, so the manager of one
      // reads it as the owner does — through the route's gate and CAT's alike.
      const read = await get('catalogue.item', [item], them);
      expect(read.status).toBe(200);
      expect(((await read.json()) as { value: { id: string } }).value.id).toBe(item);
      const listed = await get('catalogue.items', [], them);
      expect(
        ((await listed.json()) as { value: { id: string }[] }).value.map((one) => one.id),
      ).toEqual([item]);
      const units = await get('catalogue.units', [item], them);
      expect(((await units.json()) as { value: { ok: boolean } }).value.ok).toBe(true);
      const found = await get('catalogue.search', ['حليب'], them);
      expect(
        (
          (await found.json()) as { value: { value: { items: { id: string }[] } } }
        ).value.value.items.map((one) => one.id),
      ).toEqual([item]);

      // Writing it would change it for every branch, which is not the act of
      // somebody who runs one: refused by CAT, and by the route's own gate.
      expect(await post('catalogue.createItem', [{ name: 'جبن', category }], them)).toMatchObject({
        ok: false,
        error: { code: 'cat.not-permitted' },
      });
      expect(
        (
          await shop.request(
            `${root}/catalogue.changeItemStatus`,
            them,
            { args: [item, 'suspended', 'تجربة'] },
            'POST',
          )
        ).status,
      ).toBe(403);

      // And the confinement still confines: a branch-scoped read answers in
      // Damascus and not in Aleppo.
      expect((await get('registers.list', [damascus], them)).status).toBe(200);
      expect((await get('registers.list', [aleppo], them)).status).toBe(403);
    });
  },
);

describe.skipIf(!database)('CAT-02 CAT-12 authenticated catalogue transport', () => {
  it('serves tracking, status and eligibility through signed tenant-scoped routes', async () => {
    const shop = await fixture();
    const token = await shop.signIn();
    const root = `/v1/tenants/${shop.tenant}/catalogue`;
    const post = (route: string, args: unknown[]) =>
      shop.request(`${root}.${route}`, token, { args }, 'POST');
    const created = await post('createCategory', [
      { name: 'Goods', parent: null, defaultBaseUnit: { code: 'kg', kind: 'weight', decimals: 3 } },
    ]);
    const category = ((await created.json()) as { value: { value: { id: string } } }).value.value;
    const response = await post('createItem', [
      { name: 'Apples', category: category.id, kind: 'weighed' },
    ]);
    const item = ((await response.json()) as { value: { value: { id: string; kind: string } } })
      .value.value;
    expect(item.kind).toBe('weighed');
    const changed = await post('changeItemStatus', [item.id, 'suspended', 'Inspect']);
    expect(
      ((await changed.json()) as { value: { value: { status: string } } }).value.value.status,
    ).toBe('suspended');
    const eligibility = await shop.request(
      `${root}.eligibility?args=${encodeURIComponent(JSON.stringify([item.id, 'sale']))}`,
      token,
    );
    expect(
      ((await eligibility.json()) as { value: { ok: boolean; error: { code: string } } }).value
        .error.code,
    ).toBe('cat.item-suspended');
    const foreign = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
    expect(
      (
        await shop.request(
          `${root}.item?args=${encodeURIComponent(JSON.stringify([item.id]))}`,
          foreign,
        )
      ).status,
    ).toBe(403);
    await expect(
      (
        await shop.request(
          `/v1/tenants/${shop.otherTenant}/catalogue.item?args=${encodeURIComponent(JSON.stringify([item.id]))}`,
          foreign,
        )
      ).json(),
    ).resolves.toMatchObject({ value: null });
    const foreignWrite = await shop.request(
      `/v1/tenants/${shop.otherTenant}/catalogue.changeItemStatus`,
      foreign,
      { args: [item.id, 'active', 'No'] },
      'POST',
    );
    expect(
      ((await foreignWrite.json()) as { value: { error: { code: string } } }).value.error.code,
    ).toBe('cat.item-not-found');
    const invalid = await post('changeItemStatus', ['bad-id', 'active', 'No']);
    expect(invalid.status).toBe(200);
    expect(
      ((await invalid.json()) as { value: { error: { code: string } } }).value.error.code,
    ).toBe('cat.item-not-found');
    const enrolled = await shop.request(
      `/v1/tenants/${shop.tenant}/users.enrol`,
      token,
      { args: [{ handle: 'cashier-cat', name: 'Cashier', password: 'till-morning-3' }] },
      'POST',
    );
    const person = ((await enrolled.json()) as { value: { value: { id: string } } }).value.value;
    const roles = await shop.request(`/v1/tenants/${shop.tenant}/users.roles.list`, token);
    const cashier = (
      (await roles.json()) as { value: { id: string; seeded: string }[] }
    ).value.find((one) => one.seeded === 'cashier');
    expect(cashier).toBeDefined();
    const assigned = await shop.request(
      `/v1/tenants/${shop.tenant}/users.assignments.assign`,
      token,
      { args: [{ user: person.id, role: cashier!.id, confinement: { kind: 'tenant' } }] },
      'POST',
    );
    expect(((await assigned.json()) as { value: { ok: boolean } }).value.ok).toBe(true);
    const cashierToken = await shop.signIn(shop.tenant, 'cashier-cat', 'till-morning-3');
    expect(
      (
        await shop.request(
          `${root}.item?args=${encodeURIComponent(JSON.stringify([item.id]))}`,
          cashierToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await shop.request(
          `${root}.changeItemStatus`,
          cashierToken,
          { args: [item.id, 'active', 'Denied'] },
          'POST',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await shop.request(
          `${root}.addUnit`,
          cashierToken,
          {
            args: [
              item.id,
              { unit: { code: 'bag', kind: 'count', decimals: 0 }, basePerUnit: '2.5' },
            ],
          },
          'POST',
        )
      ).status,
    ).toBe(403);
  });
});

describe.skipIf(!database)('CAT-08 authenticated item-unit transport', () => {
  it('normalises to the base unit and guards signed, tenant-scoped unit routes', async () => {
    const shop = await fixture();
    const token = await shop.signIn();
    const root = `/v1/tenants/${shop.tenant}/catalogue`;
    const categoryResponse = await shop.request(
      `${root}.createCategory`,
      token,
      {
        args: [
          {
            name: 'Goods',
            parent: null,
            defaultBaseUnit: { code: 'kg', kind: 'weight', decimals: 3 },
          },
        ],
      },
      'POST',
    );
    const category = ((await categoryResponse.json()) as { value: { value: { id: string } } }).value
      .value;
    const itemResponse = await shop.request(
      `${root}.createItem`,
      token,
      {
        args: [{ name: 'Rice', category: category.id, kind: 'weighed' }],
      },
      'POST',
    );
    const item = ((await itemResponse.json()) as { value: { value: { id: string } } }).value.value;
    const added = await shop.request(
      `${root}.addUnit`,
      token,
      {
        args: [item.id, { unit: { code: 'bag', kind: 'count', decimals: 0 }, basePerUnit: '2.5' }],
      },
      'POST',
    );
    expect(added.status).toBe(200);
    const bag = ((await added.json()) as { value: { value: { id: string } } }).value.value;
    const query = (route: string, args: unknown[]) =>
      `${root}.${route}?args=${encodeURIComponent(JSON.stringify(args))}`;
    const units = await shop.request(query('units', [item.id]), token);
    const base = ((await units.json()) as { value: { value: { id: string }[] } }).value.value[0]!;
    const conversion = await shop.request(query('convert', [item.id, '2', bag.id, base.id]), token);
    expect(await conversion.json()).toMatchObject({
      value: { value: { amount: '5', unit: { id: base.id } } },
    });
    expect((await shop.request(query('units', [item.id]))).status).toBe(401);
    expect((await shop.request(query('convert', [item.id, '2', bag.id, base.id]))).status).toBe(
      401,
    );
    const foreign = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
    expect((await shop.request(query('units', [item.id]), foreign)).status).toBe(403);
    const otherRoot = `/v1/tenants/${shop.otherTenant}/catalogue`;
    const foreignWrite = await shop.request(
      `${otherRoot}.addUnit`,
      foreign,
      {
        args: [item.id, { unit: { code: 'crate', kind: 'count', decimals: 0 }, basePerUnit: '5' }],
      },
      'POST',
    );
    expect(await foreignWrite.json()).toMatchObject({
      value: { error: { code: 'cat.item-not-found' } },
    });
  });
});

describe.skipIf(!database)('CAT-04 authenticated barcode transport', () => {
  it('registers, scans and withdraws codes through signed, tenant-scoped routes', async () => {
    const shop = await fixture();
    const token = await shop.signIn();
    const root = `/v1/tenants/${shop.tenant}/catalogue`;
    const post = (route: string, args: unknown[]) =>
      shop.request(`${root}.${route}`, token, { args }, 'POST');
    const query = (route: string, args: unknown[]) =>
      `${root}.${route}?args=${encodeURIComponent(JSON.stringify(args))}`;
    const created = await post('createCategory', [
      { name: 'Goods', parent: null, defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 } },
    ]);
    const category = ((await created.json()) as { value: { value: { id: string } } }).value.value;
    const itemResponse = await post('createItem', [{ name: 'Tea', category: category.id }]);
    const item = ((await itemResponse.json()) as { value: { value: { id: string } } }).value.value;
    const unitResponse = await post('addUnit', [
      item.id,
      { unit: { code: 'carton', kind: 'count', decimals: 0 }, basePerUnit: '24' },
    ]);
    const carton = ((await unitResponse.json()) as { value: { value: { id: string } } }).value
      .value;

    const added = await post('addBarcode', [item.id, { code: '036000291452', unit: carton.id }]);
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ value: { ok: true, value: { active: true } } });
    const scanned = await shop.request(query('scan', ['0036000291452']), token);
    expect(await scanned.json()).toMatchObject({
      value: { ok: true, value: { item: { id: item.id }, unit: { id: carton.id } } },
    });
    expect(
      await (await post('addBarcode', [item.id, { code: '036000291452' }])).json(),
    ).toMatchObject({ value: { ok: false, error: { code: 'cat.barcode-taken' } } });

    expect((await post('deactivateBarcode', ['036000291452', 'Relabelled'])).status).toBe(200);
    expect(await (await shop.request(query('scan', ['036000291452']), token)).json()).toMatchObject(
      { value: { ok: false, error: { code: 'cat.barcode-inactive' } } },
    );
    expect(
      await (await shop.request(query('barcode', ['036000291452']), token)).json(),
    ).toMatchObject({ value: { ok: true, value: { unit: { id: carton.id } } } });

    expect((await shop.request(query('scan', ['036000291452']))).status).toBe(401);
    expect(
      (
        await shop.request(
          `${root}.addBarcode`,
          undefined,
          { args: [item.id, { code: 'X-1' }] },
          'POST',
        )
      ).status,
    ).toBe(401);
    const foreign = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
    expect((await shop.request(query('barcode', ['036000291452']), foreign)).status).toBe(403);
    const otherRoot = `/v1/tenants/${shop.otherTenant}/catalogue`;
    expect(
      await (
        await shop.request(
          `${otherRoot}.barcode?args=${encodeURIComponent(JSON.stringify(['036000291452']))}`,
          foreign,
        )
      ).json(),
    ).toMatchObject({ value: { ok: false, error: { code: 'cat.barcode-not-found' } } });
    expect(
      await (
        await shop.request(
          `${otherRoot}.reactivateBarcode`,
          foreign,
          { args: ['036000291452', 'Theirs'] },
          'POST',
        )
      ).json(),
    ).toMatchObject({ value: { ok: false, error: { code: 'cat.barcode-not-found' } } });
  });
});

async function fixture(enableSyn02Fixture = false) {
  if (!database) throw new Error('A PostgreSQL test URL is required.');
  const schema = `vertex_test_${newId<'schema'>().replaceAll('-', '')}`;
  const attachmentsDirectory = await mkdtemp(join(tmpdir(), 'vertex-u07-attachments-'));
  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  const options = { connectionString: database, schema, attachmentsDirectory, enableSyn02Fixture };
  cleanup.push(async () => {
    const admin = new Pool({ connectionString: database });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
      await rm(attachmentsDirectory, { recursive: true, force: true });
    }
  });
  const node = await composeStoreNode(options);
  cleanup.push(() => node.close());
  await node.provisionTenant(tenant, 'owner', 'till-morning-1');
  await node.provisionTenant(otherTenant, 'other-owner', 'till-morning-2');
  const server = await node.listen(0);
  cleanup.push(() => server.close());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address.');
  const base = `http://127.0.0.1:${String(address.port)}`;
  const request = (path: string, token?: string, body?: unknown, method = 'GET') =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const signIn = async (forTenant = tenant, handle = 'owner', password = 'till-morning-1') => {
    const response = await request(
      '/v1/sign-in',
      undefined,
      { tenant: forTenant, handle, password },
      'POST',
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { token: string }).token;
  };
  return {
    tenant,
    otherTenant,
    options,
    request,
    signIn,
    base,
    close: async () => {
      await server.close();
      await node.close();
    },
  };
}

describe.skipIf(!database)('PRC-01 price lists over authenticated PostgreSQL transport', () => {
  it('keeps seeded identities and a fourth list across restart, with tenant and permission boundaries', async () => {
    const shop = await fixture();
    const owner = await shop.signIn();
    const root = `/v1/tenants/${shop.tenant}/priceLists`;
    const list = async (base: string, token: string, tenant = shop.tenant) => {
      const response = await fetch(`${base}/v1/tenants/${tenant}/priceLists.list?args=%5B%5D`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      return (
        (await response.json()) as {
          value: { id: string; code: string | null; name: string; active: boolean }[];
        }
      ).value;
    };
    const initial = await list(shop.base, owner);
    expect(initial.map((one) => one.code)).toEqual(['retail', 'half-wholesale', 'wholesale']);
    const create = (name: string) =>
      shop.request(`${root}.create`, owner, { args: [name] }, 'POST');
    const made = await create('شركاء');
    expect(made.status).toBe(200);
    const fourth = ((await made.json()) as { value: { value: { id: string } } }).value.value;
    expect((await list(shop.base, owner)).map((one) => one.id)).toContain(fourth.id);
    const categoryResponse = await shop.request(
      `/v1/tenants/${shop.tenant}/catalogue.createCategory`,
      owner,
      {
        args: [
          {
            name: 'Goods',
            parent: null,
            defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
          },
        ],
      },
      'POST',
    );
    const category = ((await categoryResponse.json()) as { value: { value: { id: string } } }).value
      .value;
    const item = async (name: string) => {
      const response = await shop.request(
        `/v1/tenants/${shop.tenant}/catalogue.createItem`,
        owner,
        { args: [{ name, category: category.id }] },
        'POST',
      );
      return (
        (await response.json()) as { value: { value: { id: string; units: { id: string }[] } } }
      ).value.value;
    };
    const firstItem = await item('Pencil');
    const secondItem = await item('Notebook');
    const subject = (unit: string) =>
      shop.request(
        `${root}.subject?args=${encodeURIComponent(JSON.stringify([{ list: fourth.id, item: firstItem.id, unit }]))}`,
        owner,
      );
    expect(await (await subject(firstItem.units[0]!.id)).json()).toMatchObject({
      value: { ok: true },
    });
    expect(await (await subject(secondItem.units[0]!.id)).json()).toMatchObject({
      value: { ok: false, error: { code: 'prc.unit-not-on-item' } },
    });
    const duplicates = await Promise.all([create('موزعون'), create('موزعون')]);
    const outcomes = await Promise.all(
      duplicates.map(async (response) => (await response.json()) as { value: { ok: boolean } }),
    );
    expect(outcomes.filter((one) => one.value.ok)).toHaveLength(1);
    expect(outcomes.filter((one) => !one.value.ok)).toHaveLength(1);
    const renamed = await shop.request(
      `${root}.rename`,
      owner,
      { args: [fourth.id, 'شركاء مميزون'] },
      'POST',
    );
    expect(((await renamed.json()) as { value: { value: { id: string } } }).value.value.id).toBe(
      fourth.id,
    );
    const inactive = await shop.request(`${root}.deactivate`, owner, { args: [fourth.id] }, 'POST');
    expect(
      ((await inactive.json()) as { value: { value: { active: boolean } } }).value.value.active,
    ).toBe(false);
    const foreign = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
    expect((await shop.request(`${root}.list?args=%5B%5D`, foreign)).status).toBe(403);
    const foreignRead = await shop.request(
      `/v1/tenants/${shop.otherTenant}/priceLists.get?args=${encodeURIComponent(JSON.stringify([fourth.id]))}`,
      foreign,
    );
    expect(await foreignRead.json()).toMatchObject({ value: null });
    expect(
      (await shop.request(`${root}.create`, undefined, { args: ['Unsigned'] }, 'POST')).status,
    ).toBe(401);
    const enrolled = await shop.request(
      `/v1/tenants/${shop.tenant}/users.enrol`,
      owner,
      { args: [{ handle: 'cashier-prc', name: 'Cashier', password: 'till-morning-3' }] },
      'POST',
    );
    const user = ((await enrolled.json()) as { value: { value: { id: string } } }).value.value;
    const roles = await shop.request(`/v1/tenants/${shop.tenant}/users.roles.list`, owner);
    const cashier = (
      (await roles.json()) as { value: { id: string; seeded: string }[] }
    ).value.find((one) => one.seeded === 'cashier')!;
    await shop.request(
      `/v1/tenants/${shop.tenant}/users.assignments.assign`,
      owner,
      { args: [{ user: user.id, role: cashier.id, confinement: { kind: 'tenant' } }] },
      'POST',
    );
    const cashierToken = await shop.signIn(shop.tenant, 'cashier-prc', 'till-morning-3');
    expect(
      (await shop.request(`${root}.create`, cashierToken, { args: ['Denied'] }, 'POST')).status,
    ).toBe(403);
    await shop.close();
    const restarted = await startProcess(shop.options, shop.tenant);
    const login = await fetch(`${restarted.base}/v1/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: shop.tenant, handle: 'owner', password: 'till-morning-1' }),
    });
    const token = ((await login.json()) as { token: string }).token;
    const after = await list(restarted.base, token);
    expect(after.slice(0, 3).map((one) => one.id)).toEqual(initial.map((one) => one.id));
    expect(after.find((one) => one.id === fourth.id)).toMatchObject({
      id: fourth.id,
      name: 'شركاء مميزون',
      active: false,
    });
    expect(after).toHaveLength(5);
    await restarted.stop();
  });
});

describe.skipIf(!database)(
  'PRC-01 PRC-02 PRC-11 USD prices over authenticated PostgreSQL transport',
  () => {
    it('commits prices and audit together, survives restart, and enforces tenant and HTTP rights', async () => {
      const shop = await fixture();
      const owner = await shop.signIn();
      const root = `/v1/tenants/${shop.tenant}`;
      const post = async (method: string, args: unknown[]) => {
        const response = await shop.request(`${root}/${method}`, owner, { args }, 'POST');
        expect(response.status).toBe(200);
        return (await response.json()) as {
          value: { ok: boolean; value: Record<string, unknown>; error: { code: string } };
        };
      };
      const listsResponse = await shop.request(`${root}/priceLists.list`, owner);
      const lists = ((await listsResponse.json()) as { value: { id: string }[] }).value;
      const category = (
        await post('catalogue.createCategory', [
          {
            name: 'Goods',
            parent: null,
            defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
          },
        ])
      ).value.value;
      const item = (await post('catalogue.createItem', [{ name: 'Box', category: category['id'] }]))
        .value.value as { id: string; units: { id: string }[] };
      const subject = { list: lists[0]!.id, item: item.id, unit: item.units[0]!.id };
      const command = {
        subject,
        amount: { amount: '1.25', currency: 'USD' },
        expectedRevision: 0,
        reason: 'Initial',
        operation: newId<'price-operation'>(),
      };
      expect((await post('usdPrices.set', [command])).value.value).toMatchObject({
        revision: 1,
        amount: '1.25',
      });
      expect((await post('usdPrices.set', [command])).value.value).toMatchObject({ revision: 1 });
      expect(
        (await post('usdPrices.set', [{ ...command, amount: { amount: '2.00', currency: 'USD' } }]))
          .value.error.code,
      ).toBe('prc.operation-reused');
      expect(
        (
          await post('usdPrices.set', [
            {
              ...command,
              amount: { amount: '0', currency: 'USD' },
              operation: newId<'price-operation'>(),
            },
          ])
        ).value.error.code,
      ).toBe('prc.amount-invalid');
      const get = async (token: string, method: string, args: unknown[], tenant = shop.tenant) =>
        shop.request(
          `/v1/tenants/${tenant}/${method}?args=${encodeURIComponent(JSON.stringify(args))}`,
          token,
        );
      expect(await (await get(owner, 'usdPrices.get', [subject])).json()).toMatchObject({
        value: { value: { amount: '1.25', revision: 1 } },
      });
      expect(
        await (await get(owner, 'usdPrices.history', [{ item: item.id }])).json(),
      ).toMatchObject({ value: { value: { entries: [{ newAmount: '1.25', oldAmount: null }] } } });
      const competing = await Promise.all([
        post('usdPrices.set', [
          {
            ...command,
            amount: { amount: '2.00', currency: 'USD' },
            expectedRevision: 1,
            reason: 'First revision',
            operation: newId<'price-operation'>(),
          },
        ]),
        post('usdPrices.set', [
          {
            ...command,
            amount: { amount: '3.00', currency: 'USD' },
            expectedRevision: 1,
            reason: 'Second revision',
            operation: newId<'price-operation'>(),
          },
        ]),
      ]);
      expect(competing.filter((one) => one.value.ok)).toHaveLength(1);
      expect(
        competing.filter((one) => !one.value.ok && one.value.error.code === 'prc.revision-stale'),
      ).toHaveLength(1);
      expect(
        await (await get(owner, 'usdPrices.history', [{ item: item.id }])).json(),
      ).toMatchObject({
        value: { value: { entries: [{ revision: 2 }, { revision: 1 }] } },
      });
      const other = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
      expect((await get(other, 'usdPrices.get', [subject], shop.otherTenant)).status).toBe(200);
      expect(
        await (await get(other, 'usdPrices.get', [subject], shop.otherTenant)).json(),
      ).toMatchObject({ value: { error: { code: 'prc.list-not-found' } } });
      expect(
        (await shop.request(`${root}/usdPrices.set`, undefined, { args: [command] }, 'POST'))
          .status,
      ).toBe(401);
      const enrolled = await post('users.enrol', [
        { handle: 'price-cashier', name: 'Cashier', password: 'till-morning-3' },
      ]);
      const rolesResponse = await shop.request(`${root}/users.roles.list`, owner);
      const cashier = (
        (await rolesResponse.json()) as { value: { id: string; seeded: string }[] }
      ).value.find((one) => one.seeded === 'cashier');
      if (!cashier) throw new Error('Cashier role missing.');
      await post('users.assignments.assign', [
        { user: enrolled.value.value['id'], role: cashier.id, confinement: { kind: 'tenant' } },
      ]);
      const cashierToken = await shop.signIn(shop.tenant, 'price-cashier', 'till-morning-3');
      expect((await get(cashierToken, 'usdPrices.get', [subject])).status).toBe(403);
      expect((await get(cashierToken, 'usdPrices.history', [{ item: item.id }])).status).toBe(403);
      expect(
        (await shop.request(`${root}/usdPrices.set`, cashierToken, { args: [command] }, 'POST'))
          .status,
      ).toBe(403);
      await shop.close();
      const restarted = await startProcess(shop.options, shop.tenant);
      const login = await fetch(`${restarted.base}/v1/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: shop.tenant, handle: 'owner', password: 'till-morning-1' }),
      });
      const token = ((await login.json()) as { token: string }).token;
      const persisted = await fetch(
        `${restarted.base}${root}/usdPrices.history?args=${encodeURIComponent(JSON.stringify([{ item: item.id }]))}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(await persisted.json()).toMatchObject({
        value: { value: { entries: [{ revision: 2 }, { revision: 1, newAmount: '1.25' }] } },
      });
      await restarted.stop();
    });
  },
);

describe.skipIf(!database)(
  'PRC-03 SEC-04 a display price approved by a manager confined to their branch, over PostgreSQL',
  () => {
    it('lets the manager of Damascus freeze a Damascus price, and refuses them Aleppo', async () => {
      const shop = await fixture();
      const owner = await shop.signIn();
      const root = `/v1/tenants/${shop.tenant}`;
      interface Answer {
        value: { ok: boolean; value: Record<string, unknown>; error: { code: string } };
      }
      const post = async (method: string, args: unknown[], token = owner) => {
        const response = await shop.request(`${root}/${method}`, token, { args }, 'POST');
        expect(response.status, method).toBe(200);
        return ((await response.json()) as Answer).value;
      };
      const made = async (method: string, args: unknown[]) => {
        const answer = await post(method, args);
        expect(answer.ok, `${method} ${JSON.stringify(answer)}`).toBe(true);
        return answer.value;
      };
      const get = (method: string, args: unknown[], token: string) =>
        shop.request(`${root}/${method}?args=${encodeURIComponent(JSON.stringify(args))}`, token);

      const company = (await made('companies.register', [{ name: 'Shop' }]))['id'] as string;
      const damascus = (await made('branches.open', [{ company, name: 'Damascus' }]))[
        'id'
      ] as string;
      const aleppo = (await made('branches.open', [{ company, name: 'Aleppo' }]))['id'] as string;
      for (const branch of [damascus, aleppo]) {
        await made('rates.record', [
          branch,
          'SYP',
          { form: 'units-per-functional', buy: '13300', sell: '12900' },
        ]);
      }
      const lists = (
        (await (await get('priceLists.list', [], owner)).json()) as { value: { id: string }[] }
      ).value;
      const category = await made('catalogue.createCategory', [
        {
          name: 'Goods',
          parent: null,
          defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
        },
      ]);
      const item = (await made('catalogue.createItem', [
        { name: 'Box', category: category['id'] },
      ])) as unknown as { id: string; units: { id: string }[] };
      const subject = { list: lists[0]!.id, item: item.id, unit: item.units[0]!.id };
      await made('usdPrices.set', [
        {
          subject,
          amount: { amount: '1.25', currency: 'USD' },
          expectedRevision: 0,
          reason: 'Initial',
          operation: newId<'price-operation'>(),
        },
      ]);

      const user = (
        await made('users.enrol', [
          { handle: 'damascus', name: 'Damascus manager', password: 'till-morning-6' },
        ])
      )['id'] as string;
      const roles = await shop.request(`${root}/users.roles.list`, owner);
      const manager = (
        (await roles.json()) as { value: { id: string; seeded: string }[] }
      ).value.find((one) => one.seeded === 'manager')!;
      await made('users.assignments.assign', [
        {
          user,
          role: manager.id,
          confinement: { kind: 'branches', branches: [damascus], locations: [] },
        },
      ]);
      const them = await shop.signIn(shop.tenant, 'damascus', 'till-morning-6');

      // At their own branch: the preview reads the item through CAT, which
      // once answered this manager that the item did not exist.
      const here = { branch: damascus, subject };
      const previewed = await get('displayPrices.preview', [here], them);
      expect(previewed.status).toBe(200);
      const preview = ((await previewed.json()) as Answer).value;
      expect(preview, JSON.stringify(preview)).toMatchObject({ ok: true });
      const basis = preview.value as {
        proposed: string;
        basis: { usdRevision: number; rate: { revision: string } };
      };
      const approval = (branch: string) => ({
        branch,
        subject,
        expectedRevision: 0,
        proposed: basis.proposed,
        usdRevision: basis.basis.usdRevision,
        rateRevision: basis.basis.rate.revision,
        reason: 'Shelf price',
        operation: newId<'price-operation'>(),
      });
      expect(await post('displayPrices.approve', [approval(damascus)], them)).toMatchObject({
        ok: true,
        value: { amount: basis.proposed, revision: 1 },
      });

      // At another branch the confinement still confines, at the route's gate
      // and at PRC's own, before anything about Aleppo is read.
      expect((await get('displayPrices.preview', [{ branch: aleppo, subject }], them)).status).toBe(
        403,
      );
      expect(
        (
          await shop.request(
            `${root}/displayPrices.approve`,
            them,
            { args: [approval(aleppo)] },
            'POST',
          )
        ).status,
      ).toBe(403);
      expect(
        (
          (await (
            await get('displayPrices.get', [{ branch: aleppo, subject }], owner)
          ).json()) as Answer
        ).value,
      ).toMatchObject({ value: { price: null, status: 'not-frozen' } });
    });
  },
);

describe.skipIf(!database)(
  'PRC-02 PRC-03 PRC-11 frozen SYP display prices over authenticated PostgreSQL transport',
  () => {
    it('freezes a reviewed SYP price that neither a rate correction nor a restart re-derives, atomically with its audit', async () => {
      const shop = await fixture();
      const owner = await shop.signIn();
      const root = `/v1/tenants/${shop.tenant}`;
      interface Answer {
        value: { ok: boolean; value: Record<string, unknown>; error: { code: string } };
      }
      const post = async (method: string, args: unknown[], token = owner) => {
        const response = await shop.request(`${root}/${method}`, token, { args }, 'POST');
        expect(response.status, method).toBe(200);
        return (await response.json()) as Answer;
      };
      const made = async (method: string, args: unknown[]) => {
        const answer = await post(method, args);
        expect(answer.value.ok, `${method} ${JSON.stringify(answer)}`).toBe(true);
        return answer.value.value;
      };
      const get = (method: string, args: unknown[], token = owner, tenant = shop.tenant) =>
        shop.request(
          `/v1/tenants/${tenant}/${method}?args=${encodeURIComponent(JSON.stringify(args))}`,
          token,
        );
      const read = async (method: string, args: unknown[], token = owner) => {
        const response = await get(method, args, token);
        expect(response.status, method).toBe(200);
        return ((await response.json()) as Answer).value;
      };

      const company = await made('companies.register', [{ name: 'Shop' }]);
      const aleppo = (await made('branches.open', [{ company: company['id'], name: 'Aleppo' }]))[
        'id'
      ] as string;
      const damascus = (
        await made('branches.open', [{ company: company['id'], name: 'Damascus' }])
      )['id'] as string;
      const quote = (buy: string) => ({ form: 'units-per-functional', buy, sell: '12900' });
      const first = await made('rates.record', [aleppo, 'SYP', quote('13100')]);
      await made('rates.record', [damascus, 'SYP', quote('13300')]);
      const lists = (
        (await (await get('priceLists.list', [])).json()) as { value: { id: string }[] }
      ).value;
      const category = await made('catalogue.createCategory', [
        {
          name: 'Goods',
          parent: null,
          defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
        },
      ]);
      const item = (await made('catalogue.createItem', [
        { name: 'Box', category: category['id'] },
      ])) as unknown as { id: string; units: { id: string }[] };
      const subject = { list: lists[0]!.id, item: item.id, unit: item.units[0]!.id };
      const target = { branch: aleppo, subject };

      // No dollar price yet: nothing to derive from.
      expect(await read('displayPrices.preview', [target])).toMatchObject({
        ok: false,
        error: { code: 'prc.usd-price-missing' },
      });
      await made('usdPrices.set', [
        {
          subject,
          amount: { amount: '1.25', currency: 'USD' },
          expectedRevision: 0,
          reason: 'Initial',
          operation: newId<'price-operation'>(),
        },
      ]);

      // The real FX: 1.25 × 13,100 = 16,375 at the buy side, settled half-up
      // onto the seeded ten-pound note.
      const preview = (await read('displayPrices.preview', [target])).value as {
        proposed: string;
        basis: { usdRevision: number; exact: string; rate: { revision: string; rate: string } };
      };
      expect(preview).toMatchObject({
        proposed: '16380',
        currency: 'SYP',
        current: null,
        basis: { usdRevision: 1, exact: '16375', rate: { revision: first['id'], side: 'buy' } },
      });
      expect(await read('displayPrices.get', [target])).toMatchObject({
        value: { price: null, status: 'not-frozen' },
      });
      const approval = (overrides: Record<string, unknown> = {}) => ({
        ...target,
        expectedRevision: 0,
        proposed: preview.proposed,
        usdRevision: preview.basis.usdRevision,
        rateRevision: preview.basis.rate.revision,
        reason: 'First shelf price',
        operation: newId<'price-operation'>(),
        ...overrides,
      });
      const command = approval();
      expect((await post('displayPrices.approve', [command])).value).toMatchObject({
        ok: true,
        value: { amount: '16380', revision: 1 },
      });
      expect((await post('displayPrices.approve', [command])).value.value).toMatchObject({
        revision: 1,
      });
      expect(
        (await post('displayPrices.approve', [{ ...command, reason: 'Different' }])).value.error
          .code,
      ).toBe('prc.operation-reused');
      expect((await post('displayPrices.approve', [approval()])).value.error.code).toBe(
        'prc.revision-stale',
      );

      // A correction of today's rate, and a new dollar price: the frozen figure
      // stays, and says it was frozen from an older dollar revision.
      const corrected = await made('rates.record', [aleppo, 'SYP', quote('15000')]);
      await made('usdPrices.set', [
        {
          subject,
          amount: { amount: '2.00', currency: 'USD' },
          expectedRevision: 1,
          reason: 'Supplier price',
          operation: newId<'price-operation'>(),
        },
      ]);
      expect(await read('displayPrices.get', [target])).toMatchObject({
        value: {
          price: {
            amount: '16380',
            revision: 1,
            basis: { usdRevision: 1, rate: { rate: '13100' } },
          },
          usd: { revision: 2 },
          status: 'usd-changed',
        },
      });

      // The audit is refused at the database mid-commit: the price must not
      // move without its entry.
      const admin = new Pool({ connectionString: database });
      cleanup.push(() => admin.end());
      const schema = `"${shop.options.schema}"`;
      await admin.query(
        `CREATE FUNCTION ${schema}.refuse_display_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key LIKE 'prc/display/%/history/%' THEN RAISE EXCEPTION 'audit refused'; END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER refuse_display_audit BEFORE INSERT ON ${schema}.vertex_records FOR EACH ROW EXECUTE FUNCTION ${schema}.refuse_display_audit()`,
      );
      const reviewed = (await read('displayPrices.preview', [target])).value as typeof preview;
      expect(reviewed).toMatchObject({ proposed: '30000', basis: { usdRevision: 2 } });
      const recalculation = approval({
        expectedRevision: 1,
        proposed: reviewed.proposed,
        usdRevision: reviewed.basis.usdRevision,
        rateRevision: corrected['id'],
        reason: 'Dollar price moved',
      });
      const failed = await shop.request(
        `${root}/displayPrices.approve`,
        owner,
        { args: [recalculation] },
        'POST',
      );
      expect(failed.status).not.toBe(200);
      expect(await read('displayPrices.get', [target])).toMatchObject({
        value: { price: { amount: '16380', revision: 1 } },
      });
      expect(await read('displayPrices.history', [{ branch: aleppo }])).toMatchObject({
        value: { entries: [{ revision: 1 }] },
      });
      await admin.query(`DROP TRIGGER refuse_display_audit ON ${schema}.vertex_records`);
      expect((await post('displayPrices.approve', [recalculation])).value).toMatchObject({
        ok: true,
        value: { amount: '30000', revision: 2 },
      });

      // Damascus has its own rate and its own frozen price for the same subject.
      const there = (await read('displayPrices.preview', [{ branch: damascus, subject }]))
        .value as typeof preview;
      expect(there.proposed).toBe('26600');

      // Tenant and HTTP boundaries.
      expect((await get('displayPrices.get', [target], '')).status).toBe(401);
      const other = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
      const foreign = await get('displayPrices.get', [target], other, shop.otherTenant);
      expect(foreign.status).toBe(200);
      expect(await foreign.json()).toMatchObject({
        value: { ok: false, error: { code: 'prc.branch-not-found' } },
      });
      const enrol = async (handle: string, seeded: string, confinement: unknown) => {
        const user = await made('users.enrol', [
          { handle, name: handle, password: 'till-morning-5' },
        ]);
        const roles = (
          (await (await get('users.roles.list', [])).json()) as {
            value: { id: string; seeded: string }[];
          }
        ).value;
        await made('users.assignments.assign', [
          { user: user['id'], role: roles.find((one) => one.seeded === seeded)!.id, confinement },
        ]);
        return shop.signIn(shop.tenant, handle, 'till-morning-5');
      };
      const cashier = await enrol('display-cashier', 'cashier', { kind: 'tenant' });
      expect((await get('displayPrices.get', [target], cashier)).status).toBe(403);
      expect((await get('displayPrices.preview', [target], cashier)).status).toBe(403);
      expect(
        (
          await shop.request(
            `${root}/displayPrices.approve`,
            cashier,
            { args: [approval({ expectedRevision: 2 })] },
            'POST',
          )
        ).status,
      ).toBe(403);
      // A manager of Damascus reads and approves Damascus, and not Aleppo.
      const manager = await enrol('damascus-manager', 'manager', {
        kind: 'branches',
        branches: [damascus],
        locations: [],
      });
      expect((await get('displayPrices.get', [target], manager)).status).toBe(403);
      expect((await get('displayPrices.history', [{}], manager)).status).toBe(403);
      expect(
        (
          await shop.request(
            `${root}/displayPrices.approve`,
            manager,
            { args: [approval({ expectedRevision: 2 })] },
            'POST',
          )
        ).status,
      ).toBe(403);
      // The HTTP gate admits Damascus for them. What CAT then shows a
      // branch-confined person is CAT's own tenant-wide guard, outside this slice.
      expect(
        (await get('displayPrices.get', [{ branch: damascus, subject }], manager)).status,
      ).toBe(200);
      expect(
        (
          await post('displayPrices.approve', [
            {
              branch: damascus,
              subject,
              expectedRevision: 0,
              proposed: there.proposed,
              usdRevision: there.basis.usdRevision,
              rateRevision: there.basis.rate.revision,
              reason: 'Damascus shelf price',
              operation: newId<'price-operation'>(),
            },
          ])
        ).value,
      ).toMatchObject({ ok: true, value: { branch: damascus, amount: '26600' } });

      // After a restart the stored figures come back as they were written:
      // today's rate is 15,000, and nothing re-derives 16,380 or 30,000 from it.
      await shop.close();
      const restarted = await startProcess(shop.options, shop.tenant);
      const login = await fetch(`${restarted.base}/v1/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: shop.tenant, handle: 'owner', password: 'till-morning-1' }),
      });
      const token = ((await login.json()) as { token: string }).token;
      const after = async (method: string, args: unknown[]) =>
        (
          (await (
            await fetch(
              `${restarted.base}${root}/${method}?args=${encodeURIComponent(JSON.stringify(args))}`,
              { headers: { authorization: `Bearer ${token}` } },
            )
          ).json()) as Answer
        ).value;
      expect(await after('displayPrices.get', [target])).toMatchObject({
        value: {
          price: {
            amount: '30000',
            revision: 2,
            basis: { usdAmount: '2', usdRevision: 2, rate: { revision: corrected['id'] } },
          },
          status: 'frozen',
        },
      });
      expect(await after('displayPrices.history', [{ item: item.id }])).toMatchObject({
        value: {
          entries: [
            { branch: damascus, newAmount: '26600' },
            {
              branch: aleppo,
              revision: 2,
              oldAmount: '16380',
              newAmount: '30000',
              oldBasis: { usdRevision: 1, rate: { revision: first['id'] } },
              reason: 'Dollar price moved',
            },
            { branch: aleppo, revision: 1, oldAmount: null, newAmount: '16380' },
          ],
        },
      });
      await restarted.stop();
    });
  },
);

async function startProcess(
  options: { connectionString: string; schema: string; attachmentsDirectory: string },
  tenant: string,
  syn02Fixture = false,
): Promise<{ base: string; stop(): Promise<void> }> {
  const fixtureProgram = [
    `import { composeStoreNode } from ${JSON.stringify(new URL('../dist/store-node.js', import.meta.url).href)};`,
    'const node = await composeStoreNode({ connectionString: process.env.VERTEX_POSTGRES_URL, schema: process.env.VERTEX_SCHEMA, attachmentsDirectory: process.env.VERTEX_ATTACHMENTS_DIR, enableSyn02Fixture: true });',
    'const listener = await node.listen(0);',
    'const address = listener.address();',
    "if (!address || typeof address === 'string') throw new Error('Missing test port.');",
    "console.log('STORE_NODE_PORT=' + String(address.port));",
    "process.once('SIGTERM', () => { void node.close(); });",
  ].join('\n');
  const child: ChildProcess = spawn(
    process.execPath,
    syn02Fixture
      ? ['--input-type=module', '-e', fixtureProgram]
      : [fileURLToPath(new URL('../dist/main.js', import.meta.url))],
    {
      env: {
        ...process.env,
        VERTEX_POSTGRES_URL: options.connectionString,
        VERTEX_SCHEMA: options.schema,
        VERTEX_ATTACHMENTS_DIR: options.attachmentsDirectory,
        VERTEX_TENANT: tenant,
        VERTEX_OWNER_HANDLE: 'owner',
        VERTEX_OWNER_PASSWORD: 'till-morning-1',
        PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const port = await new Promise<number>((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /STORE_NODE_PORT=(\d+)/u.exec(output);
      if (match?.[1]) resolve(Number(match[1]));
    });
    child.once('exit', (code) => {
      reject(new Error(`Store-node exited before listening: ${String(code)}: ${output}`));
    });
    child.once('error', reject);
  });
  let stopped = false;
  const stop = async () => {
    if (stopped || child.exitCode !== null || child.signalCode !== null) return;
    stopped = true;
    const ended = new Promise<void>((resolve) =>
      child.once('exit', () => {
        resolve();
      }),
    );
    child.kill();
    await ended;
  };
  cleanup.push(stop);
  return { base: `http://127.0.0.1:${String(port)}`, stop };
}

describe.skipIf(!database)('SYN-01 store-node HTTP and PostgreSQL', () => {
  it('signs in, creates a branch, stops the process, and reads it from a new process', async () => {
    const shop = await fixture();
    await shop.close();
    const first = await startProcess(shop.options, shop.tenant);
    const sign = async (base: string) => {
      const response = await fetch(`${base}/v1/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: shop.tenant, handle: 'owner', password: 'till-morning-1' }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { token: string }).token;
    };
    const token = await sign(first.base);
    const companyResponse = await fetch(
      `${first.base}/v1/tenants/${shop.tenant}/companies.register`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ args: [{ name: 'الشام' }] }),
      },
    );
    expect(companyResponse.status).toBe(200);
    const company = ((await companyResponse.json()) as { value: { value: { id: string } } }).value
      .value;
    const branchResponse = await fetch(`${first.base}/v1/tenants/${shop.tenant}/branches.open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ args: [{ company: company.id, name: 'حلب' }] }),
    });
    expect(branchResponse.status).toBe(200);
    const branch = (
      (await branchResponse.json()) as { value: { value: { id: string; name: string } } }
    ).value.value;
    expect(branch.id).toMatch(/^[0-9a-f-]{36}$/u);

    await first.stop();
    const second = await startProcess(shop.options, shop.tenant);
    const newToken = await sign(second.base);
    const read = await fetch(`${second.base}/v1/tenants/${shop.tenant}/branches.list`, {
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(((await read.json()) as { value: { id: string }[] }).value).toContainEqual(
      expect.objectContaining({ id: branch.id, name: 'حلب' }),
    );
  });

  it('refuses missing, invalid, and cross-tenant authority on reads and writes without storing rejected data', async () => {
    const shop = await fixture();
    const token = await shop.signIn();
    const foreign = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
    const wrongPassword = await shop.request(
      '/v1/sign-in',
      undefined,
      { tenant: shop.tenant, handle: 'owner', password: 'wrong' },
      'POST',
    );
    expect(wrongPassword.status).toBe(401);
    const unknown = await shop.request(
      '/v1/sign-in',
      undefined,
      { tenant: shop.tenant, handle: 'nobody', password: 'wrong' },
      'POST',
    );
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      ((await wrongPassword.json()) as { error: { code: string } }).error.code,
    );

    const theirCompany = await shop.request(
      `/v1/tenants/${shop.otherTenant}/companies.register`,
      foreign,
      { args: [{ name: 'Other shop' }] },
      'POST',
    );
    const theirCompanyId = ((await theirCompany.json()) as { value: { value: { id: string } } })
      .value.value.id;
    const theirBranch = await shop.request(
      `/v1/tenants/${shop.otherTenant}/branches.open`,
      foreign,
      { args: [{ company: theirCompanyId, name: 'Private branch' }] },
      'POST',
    );
    expect(((await theirBranch.json()) as { value: { ok: boolean } }).value.ok).toBe(true);
    for (const candidate of [undefined, 'invalid', foreign]) {
      const read = await shop.request(`/v1/tenants/${shop.tenant}/branches.list`, candidate);
      expect(read.status).toBe(candidate === undefined || candidate === 'invalid' ? 401 : 403);
      const write = await shop.request(
        `/v1/tenants/${shop.tenant}/branches.open`,
        candidate,
        { args: [{ company: newId<'company'>(), name: 'Forbidden' }] },
        'POST',
      );
      expect(write.status).toBe(candidate === undefined || candidate === 'invalid' ? 401 : 403);
    }
    expect(
      (await shop.request(`/v1/tenants/${shop.otherTenant}/branches.list`, token)).status,
    ).toBe(403);
    expect(
      (
        await shop.request(
          `/v1/tenants/${shop.otherTenant}/branches.open`,
          token,
          { args: [{ company: theirCompanyId, name: 'Injected' }] },
          'POST',
        )
      ).status,
    ).toBe(403);
    const list = await shop.request(`/v1/tenants/${shop.tenant}/branches.list`, token);
    expect(((await list.json()) as { value: unknown[] }).value).toEqual([]);
    const foreignList = await shop.request(
      `/v1/tenants/${shop.otherTenant}/branches.list`,
      foreign,
    );
    expect(
      ((await foreignList.json()) as { value: { name: string }[] }).value.map((one) => one.name),
    ).toEqual(['Private branch']);
  });

  it('refuses a signed-in cashier branch creation and leaves no branch behind', async () => {
    const shop = await fixture();
    const owner = await shop.signIn();
    const companyResponse = await shop.request(
      `/v1/tenants/${shop.tenant}/companies.register`,
      owner,
      { args: [{ name: 'Shop' }] },
      'POST',
    );
    const company = ((await companyResponse.json()) as { value: { value: { id: string } } }).value
      .value;
    const personResponse = await shop.request(
      `/v1/tenants/${shop.tenant}/users.enrol`,
      owner,
      { args: [{ handle: 'cashier', name: 'Cashier', password: 'till-morning-3' }] },
      'POST',
    );
    const person = ((await personResponse.json()) as { value: { value: { id: string } } }).value
      .value;
    const roles = await shop.request(`/v1/tenants/${shop.tenant}/users.roles.list`, owner);
    const cashier = (
      (await roles.json()) as { value: { id: string; seeded: string }[] }
    ).value.find((one) => one.seeded === 'cashier');
    expect(cashier).toBeDefined();
    const assignment = await shop.request(
      `/v1/tenants/${shop.tenant}/users.assignments.assign`,
      owner,
      { args: [{ user: person.id, role: cashier!.id, confinement: { kind: 'tenant' } }] },
      'POST',
    );
    expect(((await assignment.json()) as { value: { ok: boolean } }).value.ok).toBe(true);
    const token = await shop.signIn(shop.tenant, 'cashier', 'till-morning-3');
    const rejected = await shop.request(
      `/v1/tenants/${shop.tenant}/branches.open`,
      token,
      {
        actor: newId<'user'>(),
        tenant: shop.otherTenant,
        args: [{ company: company.id, name: 'Unauthorized' }],
      },
      'POST',
    );
    expect(
      ((await rejected.json()) as { value: { ok: boolean; error: { code: string } } }).value,
    ).toMatchObject({ ok: false, error: { code: 'sys.not-permitted' } });
    const list = await shop.request(`/v1/tenants/${shop.tenant}/branches.list`, owner);
    expect(((await list.json()) as { value: unknown[] }).value).toEqual([]);
  });

  it('filters a location read to the signed-in actor’s SEC confinement', async () => {
    const shop = await fixture();
    const owner = await shop.signIn();
    const write = async (path: string, input: unknown) => {
      const response = await shop.request(
        `/v1/tenants/${shop.tenant}/${path}`,
        owner,
        { args: [input] },
        'POST',
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as { value: { ok: boolean; value: { id: string } } };
      expect(result.value.ok).toBe(true);
      return result.value.value.id;
    };
    const company = await write('companies.register', { name: 'Shop' });
    const branch = await write('branches.open', { company, name: 'Aleppo' });
    const allowed = await write('locations.open', { branch, name: 'Floor', kind: 'shop-floor' });
    await write('locations.open', { branch, name: 'Store room', kind: 'store-room' });
    const role = await write('users.roles.define', {
      name: 'Floor viewer',
      rights: [SYS_PERMISSIONS.location.view],
    });
    const user = await write('users.enrol', {
      handle: 'floor',
      name: 'Floor viewer',
      password: 'till-morning-4',
    });
    await write('users.assignments.assign', {
      user,
      role,
      confinement: { kind: 'branches', branches: [branch], locations: [allowed] },
    });
    const floor = await shop.signIn(shop.tenant, 'floor', 'till-morning-4');
    const visible = await shop.request(
      `/v1/tenants/${shop.tenant}/locations.list?args=${encodeURIComponent(JSON.stringify([branch]))}`,
      floor,
    );
    expect(visible.status).toBe(200);
    expect(
      ((await visible.json()) as { value: { id: string }[] }).value.map((one) => one.id),
    ).toEqual([allowed]);
  });
});

describe.skipIf(!database)('SYN-02 authenticated transactional delivery', () => {
  it('replays after server restart without another document or balance change, and rejects forged authority', async () => {
    const shop = await fixture(true);
    const sign = await shop.request(
      '/v1/sign-in',
      undefined,
      { tenant: shop.tenant, handle: 'owner', password: 'till-morning-1' },
      'POST',
    );
    const identity = (await sign.json()) as { token: string; authenticated: { user: string } };
    const token = identity.token;
    const write = async (route: string, args: unknown[]) => {
      const response = await shop.request(
        `/v1/tenants/${shop.tenant}/${route}`,
        token,
        { args },
        'POST',
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as { value: { ok: boolean; value: { id: string } } };
      expect(result.value.ok).toBe(true);
      return result.value.value.id;
    };
    const company = await write('companies.register', [{ name: 'Shop' }]);
    const branch = await write('branches.open', [{ company, name: 'Aleppo' }]);
    const register = await write('registers.open', [{ branch, name: 'Till', prefix: 'AL1' }]);
    const device = newId<'device'>();
    await write('registers.assignDevice', [register, device]);
    const pairing = await shop.request(
      `/v1/tenants/${shop.tenant}/devices.pair`,
      token,
      { register, device },
      'POST',
    );
    expect(pairing.status).toBe(200);
    let credential = ((await pairing.json()) as { credential: string }).credential;

    const directory = await mkdtemp(join(tmpdir(), 'vertex-syn02-terminal-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'terminal.sqlite');
    let terminal = await openSqliteStore(path);
    cleanup.push(() => terminal.close());
    const by = commandContext({
      tenant: shop.tenant,
      actor: identity.authenticated.user as Parameters<typeof commandContext>[0]['actor'],
      device,
    });
    const tx = () =>
      createTransactor({
        driver: terminal.driver,
        bus: createEventBus({
          onHandlerFailure: (failure) => {
            throw failure.cause;
          },
        }),
        clock: systemClock,
        onEffectFailure: (failure) => {
          throw failure.cause;
        },
      });
    await runMigrations({
      plan: operationMailboxMigrations<MemorySession>(),
      transactor: tx(),
      context: by,
      journal: terminal.journal,
    });
    const document = newId<'document'>();
    await expect(
      tx().run(by, (uow) => {
        uow.session.put('local.aborted', { document });
        stageOperation(uow, 'syn02.fixture-post', { document, amount: '12.3400' });
        return Promise.reject(new Error('interrupted before commit'));
      }),
    ).rejects.toThrow('interrupted before commit');
    const envelope = await tx().run(by, (uow) => {
      uow.session.put('local.document', { document, amount: '12.3400' });
      return Promise.resolve(
        stageOperation(uow, 'syn02.fixture-post', { document, amount: '12.3400' }),
      );
    });
    await terminal.close(); // Committed locally; delivery has not begun.
    terminal = await openSqliteStore(path);
    const entries = await tx().run(by, (uow) =>
      Promise.resolve(outboxEntries(uow.session, shop.tenant, device)),
    );
    expect(entries).toEqual([{ envelope, acknowledged: false }]);

    const deliver = (
      candidate: unknown,
      bearer = token,
      tenant = shop.tenant,
      machine = register,
      deviceToken = credential,
    ) =>
      fetch(`${shop.base}/v1/tenants/${tenant}/operations.deliver`, {
        method: 'POST',
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          'content-type': 'application/json',
          'x-vertex-device-token': deviceToken,
        },
        body: JSON.stringify({ register: machine, envelope: candidate }),
      });
    expect((await deliver(envelope, '')).status).toBe(401);
    expect((await deliver(envelope, token, shop.tenant, register, 'wrong')).status).toBe(403);
    const foreign = await shop.signIn(shop.otherTenant, 'other-owner', 'till-morning-2');
    expect(
      (
        await shop.request(
          `/v1/tenants/${shop.tenant}/devices.pair`,
          foreign,
          { register, device },
          'POST',
        )
      ).status,
    ).toBe(403);
    expect((await deliver(envelope, foreign)).status).toBe(403);
    expect((await deliver(envelope, token, shop.otherTenant)).status).toBe(403);
    expect((await deliver({ ...envelope, actor: newId<'user'>() })).status).toBe(403);
    expect((await deliver({ ...envelope, device: newId<'device'>() })).status).toBe(403);
    expect((await deliver(envelope, token, shop.tenant, newId<'register'>())).status).toBe(403);

    await shop.close();
    const first = await startProcess(shop.options, shop.tenant, true);
    const processToken = async (base: string) => {
      const login = await fetch(`${base}/v1/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: shop.tenant, handle: 'owner', password: 'till-morning-1' }),
      });
      expect(login.status).toBe(200);
      return ((await login.json()) as { token: string }).token;
    };
    const postTo = (base: string, bearer: string, candidate: unknown, deviceToken = credential) =>
      fetch(`${base}/v1/tenants/${shop.tenant}/operations.deliver`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          'x-vertex-device-token': deviceToken,
        },
        body: JSON.stringify({ register, envelope: candidate }),
      });
    const firstToken = await processToken(first.base);
    const accepted = await postTo(first.base, firstToken, envelope);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ status: 'applied' });
    const oldCredential = credential;
    const rotated = await fetch(`${first.base}/v1/tenants/${shop.tenant}/devices.pair`, {
      method: 'POST',
      headers: { authorization: `Bearer ${firstToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ register, device }),
    });
    expect(rotated.status).toBe(200);
    credential = ((await rotated.json()) as { credential: string }).credential;
    expect((await postTo(first.base, firstToken, envelope, oldCredential)).status).toBe(403);
    await first.stop(); // Server committed but client did not record acknowledgement.
    const second = await startProcess(shop.options, shop.tenant, true);
    const newToken = await processToken(second.base);
    const replay = (candidate: unknown) => postTo(second.base, newToken, candidate);
    expect((await replay(envelope)).status).toBe(200);
    expect((await replay(envelope)).status).toBe(200);
    expect(
      (await Promise.all([replay(envelope), replay(envelope)])).map((one) => one.status),
    ).toEqual([200, 200]);
    expect((await replay({ ...envelope, payload: { document, amount: '99.00' } })).status).toBe(
      409,
    );
    expect((await replay({ ...envelope, key: newId<'operation'>(), sequence: 3 })).status).toBe(
      409,
    );
    expect(
      await deliverOutbox(tx(), by, async (candidate) => {
        const response = await replay(candidate);
        return (await response.json()) as Receipt;
      }),
    ).toEqual({ acknowledged: 1, halted: null });
    await terminal.close();
    terminal = await openSqliteStore(path);
    expect(
      await tx().run(by, (uow) => Promise.resolve(outboxEntries(uow.session, shop.tenant, device))),
    ).toEqual([{ envelope, acknowledged: true }]);
    for (const entry of await tx().run(by, (uow) =>
      Promise.resolve(outboxEntries(uow.session, shop.tenant, device)),
    ))
      expect((await replay(entry.envelope)).status).toBe(200);

    const store = await openPostgresStore(shop.options);
    try {
      const session = await store.driver.begin(by);
      try {
        expect(session.get(`syn02.fixture.document.${shop.tenant}.${document}`)).toEqual({
          document,
          amount: '12.3400',
        });
        expect(session.get(`syn02.fixture.balance.${shop.tenant}`)).toBe('12.34');
        expect(
          session.keys().filter((key) => key.startsWith(`syn02.fixture.document.${shop.tenant}.`)),
        ).toHaveLength(1);
      } finally {
        await store.driver.rollback(session);
      }
    } finally {
      await store.close();
    }
  });
});
