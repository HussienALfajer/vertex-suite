import { permissionId, type PermissionId, type TenantId } from '@vertex/contracts';
import type { Id, Instant, Refusal, Result, Unit } from '@vertex/kernel';
import { contractKey, type CommandContext } from '@vertex/platform';

export type CategoryId = Id<'category'>;
export type ItemId = Id<'item'>;
export type ItemUnitId = Id<'item-unit'>;
/**
 * The factor is the exact number of base units contained in one of this unit.
 * All edges lead directly to the immutable base; callers cannot introduce a
 * second path with a contradictory factor or change an existing relationship.
 */
export interface ItemUnit {
  readonly id: ItemUnitId;
  readonly item: ItemId;
  readonly unit: Unit;
  readonly basePerUnit: string;
}
export interface NewItemUnit {
  readonly unit: Unit;
  readonly basePerUnit: string;
}
/**
 * One code printed on the goods — a manufacturer's, a supplier's, a carton's or
 * a legacy one — and the unit a scan of it means (CAT-04).
 *
 * Never removed and never moved to another item: a receipt printed last year
 * names the code it was sold by, and it must still say what that code meant.
 * Withdrawing a code is deactivation, which stops the till accepting it and
 * keeps both the binding and the reason it was withdrawn.
 */
export interface ItemBarcode {
  /** As registered, after surrounding space is trimmed and Arabic-Indic digits are read as digits. */
  readonly code: string;
  /** Always one of the item's units; a code registered without one scans as the base unit. */
  readonly unit: ItemUnitId;
  readonly active: boolean;
  readonly registered: { readonly by: CommandContext['actor']; readonly at: Instant };
  readonly history: readonly ItemBarcodeChange[];
}
export interface ItemBarcodeChange {
  readonly active: boolean;
  readonly reason: string;
  readonly by: CommandContext['actor'];
  readonly at: Instant;
}
export interface NewItemBarcode {
  readonly code: string;
  /** Omitted, the code scans as the item's base unit. */
  readonly unit?: ItemUnitId;
}
/** What a code resolves to: the item, the unit it counts in, and the code's own record. */
export interface BarcodeResolution {
  readonly item: Item;
  readonly unit: ItemUnit;
  readonly barcode: ItemBarcode;
}
export interface ConvertedItemQuantity {
  readonly amount: string;
  readonly unit: ItemUnit;
}
/** Stored as an extensible value; the validator admits only these four today. */
export type ItemKind = 'standard' | 'weighed' | 'batch-tracked' | 'variant-bearing';
export type ItemStatus = 'active' | 'suspended' | 'discontinued';
export type ItemTrade = 'purchase' | 'sale';
export interface ItemStatusChange {
  readonly from: ItemStatus;
  readonly to: ItemStatus;
  readonly reason: string;
  readonly by: CommandContext['actor'];
  readonly at: Instant;
}
export interface Category {
  readonly tenant: TenantId;
  readonly id: CategoryId;
  readonly name: string;
  readonly parent: CategoryId | null;
  /** Null means look to the next ancestor when a new item is created. */
  readonly defaultBaseUnit: Unit | null;
}
export interface Item {
  readonly tenant: TenantId;
  readonly id: ItemId;
  readonly name: string;
  /**
   * The shop's own number for the item — what a shelf label, a supplier's
   * price list or a scale's PLU calls it — unique within the tenant whatever
   * its case. Null for an item that has none, which every item stored before
   * codes existed is.
   */
  readonly code: string | null;
  readonly category: CategoryId;
  readonly kind: ItemKind;
  /** A snapshot, resolved when created; category changes do not rewrite it. */
  readonly baseUnit: Unit;
  readonly units: readonly ItemUnit[];
  readonly barcodes: readonly ItemBarcode[];
  readonly status: ItemStatus;
  readonly statusReason: string | null;
  readonly statusHistory: readonly ItemStatusChange[];
}
export interface NewCategory {
  readonly name: string;
  readonly parent: CategoryId | null;
  readonly defaultBaseUnit?: Unit | null;
}
export interface CategoryRevision {
  readonly name?: string;
  readonly defaultBaseUnit?: Unit | null;
}
export interface NewItem {
  readonly name: string;
  /** Omitted or blank, the item has no code. */
  readonly code?: string;
  readonly category: CategoryId;
  readonly baseUnit?: Unit;
  /** Omission is standard for U08.1 callers and records. */
  readonly kind?: ItemKind;
}
export type CatRefusal = Refusal<
  | 'cat.not-permitted'
  | 'cat.name-required'
  | 'cat.category-not-found'
  | 'cat.parent-not-found'
  | 'cat.cycle'
  | 'cat.unit-required'
  | 'cat.unit-invalid'
  | 'cat.unit-duplicate'
  | 'cat.unit-not-found'
  | 'cat.factor-invalid'
  | 'cat.quantity-invalid'
  | 'cat.conversion-inexact'
  | 'cat.tracking-unsupported'
  | 'cat.tracking-unit-incompatible'
  | 'cat.item-not-found'
  | 'cat.status-invalid'
  | 'cat.status-transition-invalid'
  | 'cat.reason-required'
  | 'cat.item-suspended'
  | 'cat.item-discontinued'
  | 'cat.barcode-invalid'
  | 'cat.barcode-taken'
  | 'cat.barcode-not-found'
  | 'cat.barcode-inactive'
  | 'cat.barcode-active'
  | 'cat.code-invalid'
  | 'cat.code-taken'
  | 'cat.search-invalid'
  | 'cat.search-limit-invalid'
>;
/** What a search found (`CAT-15`): the best matches, and how many there were in all. */
export interface ItemSearch {
  /** Best match first, and never more than the limit the search was given. */
  readonly items: readonly Item[];
  /** Every item that matched, so a screen can say its list was cut short. */
  readonly total: number;
}
export interface RecordSession {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
  keys(): readonly string[];
}
export interface Catalogue {
  categories(by: CommandContext): Promise<readonly Category[]>;
  category(by: CommandContext, id: CategoryId): Promise<Category | null>;
  items(by: CommandContext): Promise<readonly Item[]>;
  item(by: CommandContext, id: ItemId): Promise<Item | null>;
  units(by: CommandContext, id: ItemId): Promise<Result<readonly ItemUnit[], CatRefusal>>;
  convert(
    by: CommandContext,
    id: ItemId,
    amount: string,
    from: ItemUnitId,
    to: ItemUnitId,
  ): Promise<Result<ConvertedItemQuantity, CatRefusal>>;
  /** Stock writers call this to obtain only the item's immutable base unit. */
  stockQuantity(
    by: CommandContext,
    id: ItemId,
    amount: string,
    from: ItemUnitId,
  ): Promise<Result<ConvertedItemQuantity, CatRefusal>>;
  eligibility(by: CommandContext, id: ItemId, trade: ItemTrade): Promise<Result<Item, CatRefusal>>;
  /**
   * The till's question: what is this code, and may it be sold by? Only an
   * active code answers; a withdrawn one is refused as `cat.barcode-inactive`
   * rather than as unknown, so the cashier is told the code was retired and
   * not that the item does not exist. Whether the item itself may be sold is
   * `eligibility`'s question, asked separately.
   */
  scan(by: CommandContext, code: string): Promise<Result<BarcodeResolution, CatRefusal>>;
  /**
   * The record's question: what did this code mean? Answers for active and
   * withdrawn codes alike, which is what keeps a historical document readable.
   */
  barcode(by: CommandContext, code: string): Promise<Result<BarcodeResolution, CatRefusal>>;
  /**
   * The items a person means by what they typed (`CAT-15`): every word found
   * in the item's name, code or active barcodes, or its category's name, with
   * diacritics, hamza and alef forms, taa marbuta and a missing definite
   * article all forgiven, and a part of a word enough to find the whole.
   *
   * Every status is found, as by `item`: whether a found item may be sold or
   * bought is `eligibility`'s question, asked of the one the cashier picks.
   * An empty term finds everything, in name order. `limit` defaults to 50 and
   * may not exceed 200.
   */
  search(by: CommandContext, term: string, limit?: number): Promise<Result<ItemSearch, CatRefusal>>;
}
export interface CatalogueAdministration {
  createCategory(by: CommandContext, input: NewCategory): Promise<Result<Category, CatRefusal>>;
  reviseCategory(
    by: CommandContext,
    id: CategoryId,
    revision: CategoryRevision,
  ): Promise<Result<Category, CatRefusal>>;
  moveCategory(
    by: CommandContext,
    id: CategoryId,
    parent: CategoryId | null,
  ): Promise<Result<Category, CatRefusal>>;
  createItem(by: CommandContext, input: NewItem): Promise<Result<Item, CatRefusal>>;
  addUnit(
    by: CommandContext,
    id: ItemId,
    input: NewItemUnit,
  ): Promise<Result<ItemUnit, CatRefusal>>;
  changeItemStatus(
    by: CommandContext,
    id: ItemId,
    status: ItemStatus,
    reason: string,
  ): Promise<Result<Item, CatRefusal>>;
  addBarcode(
    by: CommandContext,
    id: ItemId,
    input: NewItemBarcode,
  ): Promise<Result<ItemBarcode, CatRefusal>>;
  deactivateBarcode(
    by: CommandContext,
    code: string,
    reason: string,
  ): Promise<Result<ItemBarcode, CatRefusal>>;
  reactivateBarcode(
    by: CommandContext,
    code: string,
    reason: string,
  ): Promise<Result<ItemBarcode, CatRefusal>>;
}
export const Catalogue = contractKey<Catalogue>('cat.catalogue');
export const CatalogueAdministration = contractKey<CatalogueAdministration>('cat.administration');
export const CAT_PERMISSIONS = Object.freeze({
  category: Object.freeze({
    view: permissionId('cat', 'category', 'view'),
    create: permissionId('cat', 'category', 'create'),
    edit: permissionId('cat', 'category', 'edit'),
  }),
  item: Object.freeze({
    view: permissionId('cat', 'item', 'view'),
    create: permissionId('cat', 'item', 'create'),
    edit: permissionId('cat', 'item', 'edit'),
  }),
}) satisfies Record<string, Record<string, PermissionId>>;
