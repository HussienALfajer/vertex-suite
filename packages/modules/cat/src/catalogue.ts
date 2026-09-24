import type { TenantId } from '@vertex/contracts';
import {
  defineUnit,
  isId,
  newId,
  ok,
  refuse,
  type Instant,
  type Result,
  type Unit,
} from '@vertex/kernel';
import type { CommandContext } from '@vertex/platform';
import type {
  Category,
  CategoryId,
  CategoryRevision,
  CatRefusal,
  Item,
  ItemId,
  ItemKind,
  ItemStatus,
  ItemTrade,
  NewCategory,
  NewItem,
  RecordSession,
} from './contract.js';

type Outcome<T> = Result<T, CatRefusal>;
type Stored = Category | Item;
type StoredItem = Omit<Item, 'status' | 'statusReason' | 'statusHistory'> &
  Partial<Pick<Item, 'status' | 'statusReason' | 'statusHistory'>>;
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
  normaliseItem(record(s, 'item', t, id) as StoredItem | null);
export const categoriesIn = (s: RecordSession, t: TenantId): readonly Category[] =>
  records(s, 'category', t) as readonly Category[];
export const itemsIn = (s: RecordSession, t: TenantId): readonly Item[] =>
  (records(s, 'item', t) as readonly StoredItem[]).map((item) => normaliseItem(item));
/** U08.1 rows predate lifecycle fields. Normalize on read without rewriting identity or units. */
function normaliseItem(item: StoredItem): Item;
function normaliseItem(item: StoredItem | null): Item | null;
function normaliseItem(item: StoredItem | null): Item | null {
  return item === null
    ? null
    : {
        ...item,
        kind: item.kind,
        status: item.status ?? 'active',
        statusReason: item.statusReason ?? null,
        statusHistory: item.statusHistory ?? [],
      };
}
const supportedKinds: ReadonlySet<string> = new Set<ItemKind>([
  'standard',
  'weighed',
  'batch-tracked',
  'variant-bearing',
]);
function isItemKind(value: unknown): value is ItemKind {
  return typeof value === 'string' && supportedKinds.has(value);
}
const supportedStatuses: ReadonlySet<string> = new Set<ItemStatus>([
  'active',
  'suspended',
  'discontinued',
]);
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
  let kind: unknown = input.kind;
  if (kind === undefined) kind = 'standard';
  if (!isItemKind(kind)) return refuse('cat.tracking-unsupported');
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
  if (kind === 'weighed' && unit.value.kind !== 'weight')
    return refuse('cat.tracking-unit-incompatible');
  const item: Item = {
    tenant: t,
    id: newId<'item'>(),
    name,
    category: input.category,
    kind,
    baseUnit: unit.value,
    status: 'active',
    statusReason: null,
    statusHistory: [],
  };
  s.put(key('item', t, item.id), item);
  return ok(item);
}

export function changeItemStatus(
  s: RecordSession,
  by: CommandContext,
  at: Instant,
  id: ItemId,
  status: ItemStatus,
  reason: string,
): Outcome<Item> {
  const old = itemIn(s, by.tenant, id);
  if (old === null) return refuse('cat.item-not-found');
  if (!supportedStatuses.has(status)) return refuse('cat.status-invalid');
  // Discontinued is terminal. A suspended item may be retired directly; history survives.
  if (old.status === status || old.status === 'discontinued')
    return refuse('cat.status-transition-invalid');
  const why = named(reason);
  if (why === null) return refuse('cat.reason-required');
  const next: Item = {
    ...old,
    status,
    statusReason: why,
    statusHistory: [
      ...old.statusHistory,
      { from: old.status, to: status, reason: why, by: by.actor, at },
    ],
  };
  s.put(key('item', by.tenant, id), next);
  return ok(next);
}

export function itemEligibility(
  s: RecordSession,
  t: TenantId,
  id: ItemId,
  trade: ItemTrade,
): Outcome<Item> {
  const item = itemIn(s, t, id);
  if (item === null) return refuse('cat.item-not-found');
  const requestedTrade: unknown = trade;
  if (requestedTrade !== 'purchase' && requestedTrade !== 'sale')
    return refuse('cat.status-invalid');
  if (item.status === 'suspended') return refuse('cat.item-suspended');
  // Existing stock may still be sold after retirement, but replenishment stops.
  if (item.status === 'discontinued' && trade === 'purchase')
    return refuse('cat.item-discontinued');
  return ok(item);
}
