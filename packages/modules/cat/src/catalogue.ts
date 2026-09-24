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
  BarcodeResolution,
  Category,
  CategoryId,
  CategoryRevision,
  CatRefusal,
  Item,
  ItemBarcode,
  ItemId,
  ItemKind,
  ItemStatus,
  ItemUnit,
  ItemUnitId,
  ItemTrade,
  ItemSearch,
  ConvertedItemQuantity,
  NewItemBarcode,
  NewItemUnit,
  NewCategory,
  NewItem,
  RecordSession,
} from './contract.js';
import { SEARCH_LENGTH, SEARCH_LIMIT, SEARCH_LIMIT_MAX } from './contract.js';
import {
  lineOf,
  match,
  searchable,
  shardNames,
  shardOf,
  withLine,
  type IndexEntry,
  type IndexShard,
} from './search.js';

type Outcome<T> = Result<T, CatRefusal>;
type Stored = Category | Item;
type Later = 'code' | 'status' | 'statusReason' | 'statusHistory' | 'units' | 'barcodes';
type StoredItem = Omit<Item, Later> & Partial<Pick<Item, Later>>;
/**
 * A barcode's entry in the tenant's index: the one thing that makes a code
 * unique, and what turns a scan into a read by key rather than a walk through
 * every item. It names the item and nothing more — what the code means is kept
 * on the item, so there is a single record of it to agree with.
 */
interface BarcodeEntry {
  readonly tenant: TenantId;
  readonly item: ItemId;
}
/** An item code's entry in the tenant's index: what makes the code unique, as for a barcode. */
interface CodeEntry {
  readonly tenant: TenantId;
  readonly item: ItemId;
}
type Kind = 'category' | 'item' | 'barcode' | 'code' | 'search';
const key = (type: Kind, tenant: TenantId, id: string): string =>
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
  // Once, not per key: the store holds every module's records, and this runs
  // over all of them.
  const within = prefix(type, tenant);
  return session
    .keys()
    .filter((one) => one.startsWith(within))
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
        code: item.code ?? null,
        status: item.status ?? 'active',
        statusReason: item.statusReason ?? null,
        statusHistory: item.statusHistory ?? [],
        units: item.units ?? [baseItemUnit(item)],
        barcodes: item.barcodes ?? [],
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
  const given = itemCode(input.code);
  if (!given.ok) return given;
  const code = given.value;
  const holder = code === null ? null : codeEntryIn(s, t, code);
  if (code !== null && holder !== null) {
    // Named, as a taken barcode is: the next question is which item has it.
    const owner = itemIn(s, t, holder.item);
    return refuse('cat.code-taken', { code, item: owner?.name ?? '' });
  }
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
    code,
    category: input.category,
    kind,
    baseUnit: unit.value,
    units: [],
    barcodes: [],
    status: 'active',
    statusReason: null,
    statusHistory: [],
  };
  const withBase = { ...item, units: [baseItemUnit(item)] };
  if (code !== null)
    s.put(key('code', t, codeKey(code)), { tenant: t, item: item.id } satisfies CodeEntry);
  storeItem(s, withBase);
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
  storeItem(s, { ...item, units: [...item.units, added] });
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
  storeItem(s, next);
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

const BARCODE_LENGTH = 48;
/**
 * A code as it is kept and shown: surrounding space trimmed, invisible
 * formatting removed, and Arabic-Indic digits read as the digits they are.
 *
 * `FIN` refuses `١١٠١` for an account code, so that two codes cannot read as
 * one. A barcode is the opposite case: nobody chooses it, it is copied off a
 * label, and a manager transcribing one on an Arabic keyboard means exactly the
 * digits a scanner would send. Refusing would only teach them to switch
 * layouts; folding means the typed code and the scanned one are the same code,
 * which is also what keeps them from being registered twice. The direction
 * marks an Arabic spreadsheet or chat wraps round a pasted code (`\p{Cf}`) are
 * dropped for the same reason: nobody typed them, and nobody can see them to
 * take them out.
 *
 * Otherwise printable ASCII without spaces, which is every symbology a till
 * scanner reads as a plain code — and a limit of 48, the most a Code 128 label
 * carries in practice, so that a pasted paragraph is refused rather than
 * indexed. A GS1 element string with its separators is not a code to register
 * but a message to parse, which is `CAT-05`'s.
 */
function barcodeText(value: unknown): string | null {
  return machineText(value, BARCODE_LENGTH);
}

/**
 * A code as a person copies it off a label or a price list: the invisible
 * formatting an Arabic document wraps round it removed, surrounding space
 * trimmed, Arabic-Indic digits read as digits — then printable ASCII without
 * spaces, and no longer than `max`, or not a code at all.
 */
function machineText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/\p{Cf}/gu, '')
    .trim()
    .replace(/[٠-٩۰-۹]/gu, (digit) => {
      const point = digit.codePointAt(0) ?? 0;
      return String(point - (point >= 0x6f0 ? 0x6f0 : 0x660));
    });
  return text.length <= max && /^[\x21-\x7e]+$/u.test(text) ? text : null;
}

/**
 * The form a code is unique in.
 *
 * One GTIN reaches a till in several spellings: a UPC-A label is sent as twelve
 * digits by one scanner and as a thirteen-digit EAN with a leading zero by the
 * next, a UPC-E is sent as its eight digits or expanded to the UPC-A it
 * abbreviates, and a case code may carry the same number as a GTIN-14. Keyed as
 * typed, the second spelling would scan as an unknown item and could even be
 * registered to a different one. So a code that *is* a GTIN — eight, twelve,
 * thirteen or fourteen digits with a valid check digit — is keyed as the
 * fourteen-digit number GS1 defines them all to be; any other code is keyed
 * exactly as written, case included, because Code 128 distinguishes case.
 *
 * The price is that two numeric codes differing only in leading zeros, both
 * with valid check digits, are one code here. That is not a choice this
 * module could decline: the scanners already treat them as one.
 */
function barcodeKey(code: string): string {
  const expanded = upcA(code);
  if (expanded !== null) return expanded.padStart(14, '0');
  return isGtin(code) ? code.padStart(14, '0') : code;
}

function isGtin(code: string): boolean {
  if (!/^(?:\d{8}|\d{12,14})$/u.test(code)) return false;
  let sum = 0;
  // From the right, excluding the check digit, weights alternate 3, 1, 3 …
  for (let at = code.length - 2, weight = 3; at >= 0; at -= 1, weight = 4 - weight)
    sum += (code.charCodeAt(at) - 48) * weight;
  return (10 - (sum % 10)) % 10 === code.charCodeAt(code.length - 1) - 48;
}

/**
 * The UPC-A a UPC-E abbreviates, or null when the code is not one.
 *
 * Eight digits alone cannot say whether they are a UPC-E or an EAN-8. A UPC-E
 * starts with number system 0 or 1 and carries the check digit *of its
 * expansion*, so that is the test; eight digits that pass it are keyed as the
 * expansion, and any others fall through to the EAN-8 reading. Either way one
 * string always has one key, which is the property a scan depends on.
 */
function upcA(code: string): string | null {
  const found = /^([01])(\d)(\d)(\d)(\d)(\d)(\d)(\d)$/u.exec(code);
  if (found === null) return null;
  const [, system = '', d1 = '', d2 = '', d3 = '', d4 = '', d5 = '', d6 = ''] = found;
  const check = code.slice(-1);
  const body =
    d6 <= '2'
      ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
      : d6 === '3'
        ? `${d1}${d2}${d3}00000${d4}${d5}`
        : d6 === '4'
          ? `${d1}${d2}${d3}${d4}00000${d5}`
          : `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const expanded = `${system}${body}${check}`;
  return isGtin(expanded) ? expanded : null;
}

function entryIn(s: RecordSession, t: TenantId, code: string): BarcodeEntry | null {
  const found = s.get(key('barcode', t, barcodeKey(code))) as BarcodeEntry | undefined;
  return found?.tenant === t ? found : null;
}

export function addItemBarcode(
  s: RecordSession,
  by: CommandContext,
  at: Instant,
  id: ItemId,
  input: NewItemBarcode,
): Outcome<ItemBarcode> {
  const item = itemIn(s, by.tenant, id);
  if (item === null) return refuse('cat.item-not-found');
  // Off the wire, the command may not be the shape its type promises.
  const given = input as Partial<NewItemBarcode> | null;
  const code = barcodeText(given?.code);
  if (code === null) return refuse('cat.barcode-invalid', { max: BARCODE_LENGTH });
  const bound: unknown = given?.unit ?? baseItemUnit(item).id;
  const unit = item.units.find((one) => one.id === bound);
  if (unit === undefined) return refuse('cat.unit-not-found');
  const holder = entryIn(s, by.tenant, code);
  if (holder !== null) {
    // Named, because the next question is always "on which item?" — and the
    // answer is inside this tenant, so it tells the manager nothing they may
    // not already see.
    const owner = itemIn(s, by.tenant, holder.item);
    return refuse('cat.barcode-taken', { code, item: owner?.name ?? '' });
  }
  const added: ItemBarcode = {
    code,
    unit: unit.id,
    active: true,
    registered: { by: by.actor, at },
    history: [],
  };
  s.put(key('barcode', by.tenant, barcodeKey(code)), {
    tenant: by.tenant,
    item: id,
  } satisfies BarcodeEntry);
  storeItem(s, { ...item, barcodes: [...item.barcodes, added] });
  return ok(added);
}

/** Every code ever registered, active or withdrawn: the lookup history depends on. */
export function barcodeIn(s: RecordSession, t: TenantId, raw: string): Outcome<BarcodeResolution> {
  const code = barcodeText(raw);
  if (code === null) return refuse('cat.barcode-invalid', { max: BARCODE_LENGTH });
  const entry = entryIn(s, t, code);
  if (entry === null) return refuse('cat.barcode-not-found', { code });
  const item = itemIn(s, t, entry.item);
  const lookup = barcodeKey(code);
  const barcode = item?.barcodes.find((one) => barcodeKey(one.code) === lookup);
  const unit = item?.units.find((one) => one.id === barcode?.unit);
  // The entry and the item are written in one unit of work and neither is ever
  // deleted, so a half of the pair missing is corruption, not a refusal.
  if (item === null || barcode === undefined || unit === undefined)
    throw new Error(`Barcode index entry without its item record: ${lookup}`);
  return ok({ item, unit, barcode });
}

export function scanIn(s: RecordSession, t: TenantId, raw: string): Outcome<BarcodeResolution> {
  const found = barcodeIn(s, t, raw);
  if (found.ok && !found.value.barcode.active)
    return refuse('cat.barcode-inactive', { code: found.value.barcode.code });
  return found;
}

export function changeBarcodeState(
  s: RecordSession,
  by: CommandContext,
  at: Instant,
  raw: string,
  active: boolean,
  reason: string,
): Outcome<ItemBarcode> {
  const found = barcodeIn(s, by.tenant, raw);
  if (!found.ok) return found;
  const { item, barcode } = found.value;
  if (barcode.active === active)
    return refuse(active ? 'cat.barcode-active' : 'cat.barcode-inactive', { code: barcode.code });
  const why = named(reason);
  if (why === null) return refuse('cat.reason-required');
  const next: ItemBarcode = {
    ...barcode,
    active,
    history: [...barcode.history, { active, reason: why, by: by.actor, at }],
  };
  storeItem(s, { ...item, barcodes: item.barcodes.map((one) => (one === barcode ? next : one)) });
  return ok(next);
}

const CODE_LENGTH = 32;

/**
 * An item's own code, read as `machineText` reads a barcode and for the same
 * reasons: it is copied off a label, or typed on whichever keyboard is there.
 * Omitted or blank means the item has none; anything else must be a code.
 */
function itemCode(value: unknown): Outcome<string | null> {
  if (value === undefined || value === null) return ok(null);
  if (typeof value === 'string' && value.replace(/\p{Cf}/gu, '').trim() === '') return ok(null);
  const code = machineText(value, CODE_LENGTH);
  return code === null ? refuse('cat.code-invalid', { max: CODE_LENGTH }) : ok(code);
}

/**
 * The form an item code is unique in. Case is not part of it: unlike a
 * barcode, which a scanner reads and Code 128 distinguishes by case, an item
 * code is read aloud and typed by people, and `a-100` and `A-100` said over
 * the counter are one item.
 */
function codeKey(code: string): string {
  return code.toUpperCase();
}

function codeEntryIn(s: RecordSession, t: TenantId, code: string): CodeEntry | null {
  const found = s.get(key('code', t, codeKey(code))) as CodeEntry | undefined;
  return found?.tenant === t ? found : null;
}

/**
 * Every write of an item comes through here, and writes the item's line in
 * the search index in the same unit of work (`CAT-15`). The index is a copy of
 * what the record says; kept anywhere else, it would one day say something the
 * record does not, and a search would find an item by a name it no longer has.
 */
function storeItem(s: RecordSession, item: Item): void {
  s.put(key('item', item.tenant, item.id), item);
  const at = key('search', item.tenant, shardOf(item.id));
  const shard = s.get(at) as IndexShard | undefined;
  const entries = shard?.tenant === item.tenant ? shard.entries : '';
  s.put(at, {
    tenant: item.tenant,
    entries: withLine(entries, item.id, lineOf(entryOf(item))),
  } satisfies IndexShard);
}

/**
 * What a search may find an item by. Only active codes: a withdrawn one is a
 * question about history, which `barcode` answers, and finding an item by it
 * at the till would sell by a code the shop has retired.
 */
function entryOf(item: Item): IndexEntry {
  const codes = item.barcodes
    .filter((one) => one.active)
    .flatMap((one) => [searchable(one.code), searchable(barcodeKey(one.code))]);
  return {
    id: item.id,
    category: item.category,
    name: searchable(item.name),
    code: searchable(item.code ?? ''),
    barcodes: [...new Set(codes)].join('|'),
  };
}

export function searchIn(
  s: RecordSession,
  t: TenantId,
  term: unknown,
  limit: unknown,
  throughCategories: boolean,
): Outcome<ItemSearch> {
  if (typeof term !== 'string' || term.length > SEARCH_LENGTH)
    return refuse('cat.search-invalid', { max: SEARCH_LENGTH });
  const size = limit ?? SEARCH_LIMIT;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > SEARCH_LIMIT_MAX)
    return refuse('cat.search-limit-invalid', { max: SEARCH_LIMIT_MAX });
  const shards: string[] = [];
  for (const name of shardNames()) {
    const shard = s.get(key('search', t, name)) as IndexShard | undefined;
    if (shard?.tenant === t && shard.entries !== '') shards.push(shard.entries);
  }
  const found = match(shards, throughCategories ? categoriesIn(s, t) : [], term, size);
  const items = found.ids.map((id) => {
    const item = itemIn(s, t, id);
    // Written in one unit of work with the item and never without it, so an
    // entry naming no item is corruption rather than an empty result.
    if (item === null) throw new Error(`Search index entry without its item record: ${id}`);
    return item;
  });
  return ok({ items, total: found.total });
}

/**
 * Builds every tenant's search index from the items themselves: the index for
 * items stored before it existed, and a statement that the index is only ever
 * a function of the records — rebuilt, it says exactly what they say.
 */
export function rebuildSearchIndex(s: RecordSession): void {
  const shards = new Map<string, { tenant: TenantId; lines: string[] }>();
  for (const one of s.keys()) {
    if (one.startsWith('cat/search/')) {
      const shard = s.get(one) as IndexShard;
      if (!shards.has(one)) shards.set(one, { tenant: shard.tenant, lines: [] });
    }
    if (!one.startsWith('cat/item/')) continue;
    const item = normaliseItem(s.get(one) as StoredItem);
    const at = key('search', item.tenant, shardOf(item.id));
    const shard = shards.get(at) ?? { tenant: item.tenant, lines: [] };
    shard.lines.push(lineOf(entryOf(item)));
    shards.set(at, shard);
  }
  for (const [at, shard] of shards)
    s.put(at, { tenant: shard.tenant, entries: shard.lines.join('\n') } satisfies IndexShard);
}
