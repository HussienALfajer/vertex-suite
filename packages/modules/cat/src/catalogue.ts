import type { TenantId } from '@vertex/contracts';
import {
  defineUnit,
  isDecimalString,
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
  ItemUnit,
  ItemUnitId,
  ItemTrade,
  ConvertedItemQuantity,
  NewItemUnit,
  NewCategory,
  NewItem,
  RecordSession,
} from './contract.js';

type Outcome<T> = Result<T, CatRefusal>;
type Stored = Category | Item;
type StoredItem = Omit<Item, 'status' | 'statusReason' | 'statusHistory' | 'units'> &
  Partial<Pick<Item, 'status' | 'statusReason' | 'statusHistory' | 'units'>>;
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
        units: item.units ?? [baseItemUnit(item)],
      };
}
function baseItemUnit(item: Pick<Item, 'id' | 'baseUnit'>): ItemUnit {
  // An existing item's UUID is its base-unit identity. This is deterministic for
  // pre-U08.3 records and never requires rewriting their category or history.
  return {
    id: item.id as unknown as ItemUnitId,
    item: item.id,
    unit: item.baseUnit,
    basePerUnit: '1',
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
    if (typeof value.code !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.code))
      return refuse('cat.unit-invalid');
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
    units: [],
    status: 'active',
    statusReason: null,
    statusHistory: [],
  };
  const withBase = { ...item, units: [baseItemUnit(item)] };
  s.put(key('item', t, item.id), withBase);
  return ok(withBase);
}

export function unitsIn(s: RecordSession, t: TenantId, id: ItemId): Outcome<readonly ItemUnit[]> {
  const item = itemIn(s, t, id);
  return item === null ? refuse('cat.item-not-found') : ok(item.units);
}

export function addItemUnit(
  s: RecordSession,
  t: TenantId,
  id: ItemId,
  input: NewItemUnit,
): Outcome<ItemUnit> {
  const item = itemIn(s, t, id);
  if (item === null) return refuse('cat.item-not-found');
  const unit = unitFrom(input.unit);
  if (!unit.ok) return unit;
  if (item.units.some((one) => one.unit.code.toLowerCase() === unit.value.code.toLowerCase()))
    return refuse('cat.unit-duplicate');
  if (
    typeof input.basePerUnit !== 'string' ||
    !isDecimalString(input.basePerUnit) ||
    input.basePerUnit.length > 80 ||
    decimalParts(input.basePerUnit).integer <= 0n
  )
    return refuse('cat.factor-invalid');
  const factor = decimalParts(input.basePerUnit);
  if (
    factor.scale > item.baseUnit.decimals &&
    factor.integer % 10n ** BigInt(factor.scale - item.baseUnit.decimals) !== 0n
  )
    return refuse('cat.factor-invalid');
  const added: ItemUnit = {
    id: newId<'item-unit'>(),
    item: id,
    unit: unit.value,
    basePerUnit: canonicalDecimal(input.basePerUnit),
  };
  s.put(key('item', t, id), { ...item, units: [...item.units, added] });
  return ok(added);
}

function decimalParts(value: string): { integer: bigint; scale: number } {
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return {
    integer: BigInt(`${negative ? '-' : ''}${(whole ?? '') + fraction}`),
    scale: fraction.length,
  };
}
function scaledDecimal(value: bigint, scale: number): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
  return sign + (scale === 0 ? digits : digits.slice(0, -scale)) + (fraction ? `.${fraction}` : '');
}
function canonicalDecimal(value: string): string {
  const parsed = decimalParts(value);
  return scaledDecimal(parsed.integer, parsed.scale);
}

export function convertItemQuantity(
  s: RecordSession,
  t: TenantId,
  id: ItemId,
  amount: string,
  from: ItemUnitId,
  to: ItemUnitId,
): Outcome<ConvertedItemQuantity> {
  const item = itemIn(s, t, id);
  if (item === null) return refuse('cat.item-not-found');
  const source = item.units.find((one) => one.id === from);
  const destination = item.units.find((one) => one.id === to);
  if (source === undefined || destination === undefined) return refuse('cat.unit-not-found');
  if (typeof amount !== 'string' || !isDecimalString(amount) || amount.length > 80)
    return refuse('cat.quantity-invalid');
  const quantity = decimalParts(amount);
  if (
    quantity.scale > source.unit.decimals &&
    quantity.integer % 10n ** BigInt(quantity.scale - source.unit.decimals) !== 0n
  )
    return refuse('cat.quantity-invalid');
  const sourceFactor = decimalParts(source.basePerUnit);
  const targetFactor = decimalParts(destination.basePerUnit);
  const numerator =
    quantity.integer *
    sourceFactor.integer *
    10n ** BigInt(targetFactor.scale + destination.unit.decimals);
  const denominator = targetFactor.integer * 10n ** BigInt(quantity.scale + sourceFactor.scale);
  if (numerator % denominator !== 0n) return refuse('cat.conversion-inexact');
  return ok({
    amount: scaledDecimal(numerator / denominator, destination.unit.decimals),
    unit: destination,
  });
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
