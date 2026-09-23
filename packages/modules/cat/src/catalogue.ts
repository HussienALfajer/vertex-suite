import type { TenantId } from '@vertex/contracts';
import { defineUnit, isId, newId, ok, refuse, type Result, type Unit } from '@vertex/kernel';
import type {
  Category,
  CategoryId,
  CategoryRevision,
  CatRefusal,
  Item,
  ItemId,
  NewCategory,
  NewItem,
  RecordSession,
} from './contract.js';

type Outcome<T> = Result<T, CatRefusal>;
type Stored = Category | Item;
const key = (type: 'category' | 'item', tenant: TenantId, id: string): string =>
  `cat/${type}/${encodeURIComponent(tenant)}/${encodeURIComponent(id)}`;
const prefix = (type: 'category' | 'item', tenant: TenantId): string =>
  `cat/${type}/${encodeURIComponent(tenant)}/`;
function record(
  session: RecordSession,
  type: 'category' | 'item',
  tenant: TenantId,
  id: string,
): Stored | null {
  if (typeof id !== 'string' || !isId(id)) return null;
  const found = session.get(key(type, tenant, id)) as Stored | undefined;
  return found?.tenant === tenant ? found : null;
}
function records(
  session: RecordSession,
  type: 'category' | 'item',
  tenant: TenantId,
): readonly Stored[] {
  return session
    .keys()
    .filter((one) => one.startsWith(prefix(type, tenant)))
    .map((one) => session.get(one) as Stored)
    .filter((one) => one.tenant === tenant);
}
export const categoryIn = (s: RecordSession, t: TenantId, id: CategoryId): Category | null =>
  record(s, 'category', t, id) as Category | null;
export const itemIn = (s: RecordSession, t: TenantId, id: ItemId): Item | null =>
  record(s, 'item', t, id) as Item | null;
export const categoriesIn = (s: RecordSession, t: TenantId): readonly Category[] =>
  records(s, 'category', t) as readonly Category[];
export const itemsIn = (s: RecordSession, t: TenantId): readonly Item[] =>
  records(s, 'item', t) as readonly Item[];
function named(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function unitFrom(value: Unit): Outcome<Unit> {
  try {
    return ok(defineUnit(value));
  } catch {
    return refuse('cat.unit-invalid');
  }
}
export function createCategory(
  s: RecordSession,
  t: TenantId,
  input: NewCategory,
): Outcome<Category> {
  const name = named(input.name);
  if (name === null) return refuse('cat.name-required');
  if (input.parent !== null && categoryIn(s, t, input.parent) === null)
    return refuse('cat.parent-not-found');
  const unit =
    input.defaultBaseUnit === undefined || input.defaultBaseUnit === null
      ? ok(null)
      : unitFrom(input.defaultBaseUnit);
  if (!unit.ok) return unit;
  const category: Category = {
    tenant: t,
    id: newId<'category'>(),
    name,
    parent: input.parent,
    defaultBaseUnit: unit.value,
  };
  s.put(key('category', t, category.id), category);
  return ok(category);
}
export function reviseCategory(
  s: RecordSession,
  t: TenantId,
  id: CategoryId,
  revision: CategoryRevision,
): Outcome<Category> {
  const old = categoryIn(s, t, id);
  if (old === null) return refuse('cat.category-not-found');
  const name = revision.name === undefined ? old.name : named(revision.name);
  if (name === null) return refuse('cat.name-required');
  const unit =
    revision.defaultBaseUnit === undefined
      ? ok(old.defaultBaseUnit)
      : revision.defaultBaseUnit === null
        ? ok(null)
        : unitFrom(revision.defaultBaseUnit);
  if (!unit.ok) return unit;
  const next = { ...old, name, defaultBaseUnit: unit.value };
  s.put(key('category', t, id), next);
  return ok(next);
}
export function moveCategory(
  s: RecordSession,
  t: TenantId,
  id: CategoryId,
  parent: CategoryId | null,
): Outcome<Category> {
  const old = categoryIn(s, t, id);
  if (old === null) return refuse('cat.category-not-found');
  if (parent !== null && categoryIn(s, t, parent) === null) return refuse('cat.parent-not-found');
  const seen = new Set<string>();
  let cursor = parent;
  while (cursor !== null) {
    if (cursor === id || seen.has(cursor)) return refuse('cat.cycle');
    seen.add(cursor);
    cursor = categoryIn(s, t, cursor)?.parent ?? null;
  }
  const next = { ...old, parent };
  s.put(key('category', t, id), next);
  return ok(next);
}
export function createItem(s: RecordSession, t: TenantId, input: NewItem): Outcome<Item> {
  const name = named(input.name);
  if (name === null) return refuse('cat.name-required');
  let cursor = categoryIn(s, t, input.category);
  if (cursor === null) return refuse('cat.category-not-found');
  let inherited: Unit | null = null;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (seen.has(cursor.id)) return refuse('cat.cycle');
    seen.add(cursor.id);
    inherited ??= cursor.defaultBaseUnit;
    cursor = cursor.parent === null ? null : categoryIn(s, t, cursor.parent);
  }
  const baseUnit = input.baseUnit ?? inherited;
  if (baseUnit === null) return refuse('cat.unit-required');
  const unit = unitFrom(baseUnit);
  if (!unit.ok) return unit;
  const item: Item = {
    tenant: t,
    id: newId<'item'>(),
    name,
    category: input.category,
    kind: 'standard',
    baseUnit: unit.value,
  };
  s.put(key('item', t, item.id), item);
  return ok(item);
}
