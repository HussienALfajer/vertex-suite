import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { newId } from '@vertex/kernel';
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

async function fixture() {
  if (!database) throw new Error('A PostgreSQL test URL is required.');
  const schema = `vertex_test_${newId<'schema'>().replaceAll('-', '')}`;
  const attachmentsDirectory = await mkdtemp(join(tmpdir(), 'vertex-u07-attachments-'));
  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  const options = { connectionString: database, schema, attachmentsDirectory };
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

async function startProcess(
  options: { connectionString: string; schema: string; attachmentsDirectory: string },
  tenant: string,
): Promise<{ base: string; stop(): Promise<void> }> {
  const child: ChildProcess = spawn(
    process.execPath,
    [fileURLToPath(new URL('../dist/main.js', import.meta.url))],
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
