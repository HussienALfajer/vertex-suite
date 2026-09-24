import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { newId } from '@vertex/kernel';
import { Pool } from 'pg';

const database = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !database)
  throw new Error('CI needs VERTEX_TEST_POSTGRES_URL for the SYN-01 browser journey.');
const tenant = process.env['VERTEX_REAL_TEST_TENANT'];
if (!tenant) throw new Error('The real browser journey needs a tenant from its Playwright config.');
const schema = `vertex_test_${newId<'schema'>().replaceAll('-', '')}`;
let attachmentsDirectory: string;
let node: ChildProcess | null = null;
let vite: ChildProcess | null = null;

async function start(): Promise<void> {
  if (!database) throw new Error('The real browser journey needs PostgreSQL.');
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../store-node/dist/main.js', import.meta.url))],
    {
      env: {
        ...process.env,
        VERTEX_POSTGRES_URL: database,
        VERTEX_SCHEMA: schema,
        VERTEX_ATTACHMENTS_DIR: attachmentsDirectory,
        VERTEX_TENANT: tenant,
        VERTEX_OWNER_HANDLE: 'owner',
        VERTEX_OWNER_PASSWORD: 'till-morning-1',
        PORT: '5182',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  node = child;
  let output = '';
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('STORE_NODE_PORT=5182')) resolve();
    });
    child.once('exit', (code) => {
      reject(new Error(`Store-node failed to start (${String(code)}): ${output}`));
    });
    child.once('error', reject);
  });
}

async function stop(): Promise<void> {
  const child = node;
  node = null;
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((resolve) =>
    child.once('exit', () => {
      resolve();
    }),
  );
  child.kill();
  const graceful = await Promise.race([
    ended.then(() => true),
    new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 5_000);
    }),
  ]);
  if (!graceful) {
    child.kill('SIGKILL');
    await ended;
  }
}

async function startVite(): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      '--mode',
      'real',
      '--port',
      '5183',
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, VITE_VERTEX_TENANT: tenant },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  vite = child;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch('http://localhost:5183')).ok) return;
    } catch {
      /* starting */
    }
    if (child.exitCode !== null) throw new Error(`Vite exited: ${String(child.exitCode)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite did not start.');
}

async function stopVite(): Promise<void> {
  const child = vite;
  vite = null;
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((resolve) =>
    child.once('exit', () => {
      resolve();
    }),
  );
  child.kill();
  const graceful = await Promise.race([
    ended.then(() => true),
    new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 5_000);
    }),
  ]);
  if (!graceful) {
    child.kill('SIGKILL');
    await ended;
  }
}

test.beforeAll(async () => {
  attachmentsDirectory = await mkdtemp(join(tmpdir(), 'vertex-u07-browser-'));
  await start();
  await startVite();
});

test.afterAll(async () => {
  await stopVite();
  await stop();
  if (database) {
    const pool = new Pool({ connectionString: database });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
  if (attachmentsDirectory) await rm(attachmentsDirectory, { recursive: true, force: true });
});

test('SYN-01 signs in, opens a branch, restarts the store-node process and reads it back', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByLabel('اسم المستخدم').fill('owner');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('till-morning-1');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
  await page.getByRole('button', { name: 'تسجيل شركة' }).first().click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مؤسسة الشام');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();
  await page.getByRole('link', { name: 'الفروع' }).click();
  await page.getByRole('button', { name: 'فتح فرع' }).first().click();
  await page.getByLabel('اسم الفرع', { exact: true }).fill('حلب');
  await page.getByRole('button', { name: 'فتح', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeVisible();
  await stop();
  await start();
  await page.reload();
  await page.getByLabel('اسم المستخدم').fill('owner');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('till-morning-1');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByRole('link', { name: 'الفروع' }).click();
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeVisible();
});

test('PRC-01 creates a price list through the back-office port and reads it after PostgreSQL restart', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const name = test.info().project.name === 'real-dark' ? 'شركاء ليلي' : 'شركاء نهاري';
  await page.goto('/');
  await page.getByLabel('اسم المستخدم').fill('owner');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('till-morning-1');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByRole('link', { name: 'قوائم الأسعار' }).click();
  await expect(page.getByRole('rowheader', { name: 'تجزئة' })).toBeVisible();
  await page.getByLabel('اسم القائمة').fill(name);
  await page.getByRole('button', { name: 'إنشاء قائمة' }).click();
  await expect(page.getByRole('rowheader', { name })).toBeVisible();
  await stop();
  await start();
  await page.reload();
  await page.getByLabel('اسم المستخدم').fill('owner');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('till-morning-1');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByRole('link', { name: 'قوائم الأسعار' }).click();
  await expect(page.getByRole('rowheader', { name })).toBeVisible();
});
