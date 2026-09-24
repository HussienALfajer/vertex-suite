import type { TenantId } from '@vertex/contracts';
import { isId, newId, ok, refuse, type Result } from '@vertex/kernel';
import type { PriceList, PriceListId, PrcRefusal } from './contract.js';

export interface RecordSession {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
  remove(key: string): void;
  keys(): readonly string[];
}

type Outcome<T> = Result<T, PrcRefusal>;
const prefix = (tenant: TenantId): string => `prc/list/${encodeURIComponent(tenant)}/`;
const key = (tenant: TenantId, id: PriceListId): string => `${prefix(tenant)}${id}`;

/** Codes are stable seed identities. The record's UUID is generated for each tenant. */
const STANDARD = [
  // policy-exempt: §12 — initial price-list names are tenant seed data, editable by the owner
  { code: 'retail', name: 'تجزئة' },
  { code: 'half-wholesale', name: 'نصف جملة' },
  { code: 'wholesale', name: 'جملة' },
] as const;

export function listsIn(session: RecordSession, tenant: TenantId): readonly PriceList[] {
  return session
    .keys()
    .filter((one) => one.startsWith(prefix(tenant)))
    .map((one) => session.get(one) as PriceList)
    .filter((one) => one.tenant === tenant)
    .sort((a, b) => {
      const order = (list: PriceList): number =>
        list.code === null ? STANDARD.length : STANDARD.findIndex((one) => one.code === list.code);
      return order(a) - order(b) || a.id.localeCompare(b.id);
    });
}

export function listIn(
  session: RecordSession,
  tenant: TenantId,
  id: PriceListId,
): PriceList | null {
  if (typeof id !== 'string' || !isId(id)) return null;
  const found = session.get(key(tenant, id)) as PriceList | undefined;
  return found?.tenant === tenant ? found : null;
}

function fold(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\p{Cf}\u0640]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function named(value: unknown): Outcome<string> {
  if (typeof value !== 'string') return refuse('prc.name-invalid');
  const name = value.trim();
  if (name === '') return refuse('prc.name-required');
  if (name.length > 100 || /[\p{Cc}]/u.test(name) || fold(name) === '')
    return refuse('prc.name-invalid');
  return ok(name);
}

function taken(
  session: RecordSession,
  tenant: TenantId,
  name: string,
  except?: PriceListId,
): boolean {
  return listsIn(session, tenant).some((one) => one.id !== except && fold(one.name) === fold(name));
}

export function seedLists(session: RecordSession, tenant: TenantId): Outcome<readonly PriceList[]> {
  const seeded: PriceList[] = [];
  for (const standard of STANDARD) {
    const existing = listsIn(session, tenant).find((one) => one.code === standard.code);
    if (existing !== undefined) {
      seeded.push(existing);
      continue;
    }
    const list: PriceList = { tenant, id: newId<'price-list'>(), ...standard, active: true };
    session.put(key(tenant, list.id), list);
    seeded.push(list);
  }
  return ok(seeded);
}

export function createList(
  session: RecordSession,
  tenant: TenantId,
  input: unknown,
): Outcome<PriceList> {
  const name = named(input);
  if (!name.ok) return name;
  if (taken(session, tenant, name.value)) return refuse('prc.name-taken', { name: name.value });
  const list: PriceList = {
    tenant,
    id: newId<'price-list'>(),
    code: null,
    name: name.value,
    active: true,
  };
  session.put(key(tenant, list.id), list);
  return ok(list);
}

export function renameList(
  session: RecordSession,
  tenant: TenantId,
  id: PriceListId,
  input: unknown,
): Outcome<PriceList> {
  const list = listIn(session, tenant, id);
  if (list === null) return refuse('prc.list-not-found');
  if (!list.active) return refuse('prc.list-inactive');
  const name = named(input);
  if (!name.ok) return name;
  if (taken(session, tenant, name.value, id)) return refuse('prc.name-taken', { name: name.value });
  if (list.name === name.value) return ok(list);
  const revised = { ...list, name: name.value };
  session.put(key(tenant, id), revised);
  return ok(revised);
}

export function deactivateList(
  session: RecordSession,
  tenant: TenantId,
  id: PriceListId,
): Outcome<PriceList> {
  const list = listIn(session, tenant, id);
  if (list === null) return refuse('prc.list-not-found');
  if (!list.active) return ok(list);
  const revised = { ...list, active: false };
  session.put(key(tenant, id), revised);
  return ok(revised);
}
