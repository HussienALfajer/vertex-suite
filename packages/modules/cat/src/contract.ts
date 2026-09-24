import { permissionId, type PermissionId, type TenantId } from '@vertex/contracts';
import type { Id, Instant, Refusal, Result, Unit } from '@vertex/kernel';
import { contractKey, type CommandContext, type UnitOfWork } from '@vertex/platform';

export type CategoryId = Id<'category'>;
export type ItemId = Id<'item'>;
export type ItemUnitId = Id<'item-unit'>;
export type CostMovementId = Id<'cost-movement'>;
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
  | 'cat.cost-quantity-invalid'
  | 'cat.cost-value-invalid'
  | 'cat.cost-insufficient-stock'
  | 'cat.cost-movement-taken'
>;

/** Cost stays at the store node, separate from the item records sent to a register. */
export interface ItemCost {
  readonly item: ItemId;
  readonly baseUnit: ItemUnit;
  readonly quantity: string;
  /** The authoritative inventory value in USD, settled to cents. */
  readonly valueUSD: string;
  /** An exact ratio: divide the inventory value by base-unit quantity only when displaying it. */
  readonly average: { readonly valueUSD: string; readonly quantity: string } | null;
  readonly revision: number;
}

/** The inventory account role is declared by STK, which owns stock movements. */
export const INVENTORY_ROLE = 'stk.inventory';
export type CostDirection = 'receipt' | 'issue';
export interface CostQuote {
  readonly movement: CostMovementId;
  readonly item: ItemId;
  readonly direction: CostDirection;
  readonly quantity: string;
  /** Receipts supply this value; issues derive it from the current moving average. */
  readonly valueUSD: string;
  readonly before: ItemCost;
  readonly after: ItemCost;
}

/** Only the facts CAT must verify from FIN's posted entry; CAT cannot depend on FIN. */
export interface InventoryPosting {
  readonly entry: {
    readonly tenant: TenantId;
    readonly source: { readonly document: string };
  };
  readonly lines: readonly {
    readonly role: string | null;
    readonly side: 'debit' | 'credit';
    readonly amount: { readonly amount: string; readonly currency: string };
    readonly original?: { readonly amount: string; readonly currency: string } | null;
  }[];
}

/** Internal stock-writer seam. A quote and FIN's entry are committed in the same unit of work. */
export interface ItemCosting {
  snapshot(by: CommandContext, item: ItemId): Promise<Result<ItemCost, CatRefusal>>;
  quoteReceipt(
    by: CommandContext,
    movement: CostMovementId,
    item: ItemId,
    quantity: string,
    unit: ItemUnitId,
    valueUSD: string,
  ): Promise<Result<CostQuote, CatRefusal>>;
  quoteIssue(
    by: CommandContext,
    movement: CostMovementId,
    item: ItemId,
    quantity: string,
    unit: ItemUnitId,
  ): Promise<Result<CostQuote, CatRefusal>>;
  /** Refuses stale/corrupt quotes by throwing, so FIN's posting rolls back as well. */
  apply(
    uow: UnitOfWork<RecordSession>,
    quote: CostQuote,
    /** Null is valid only when inventory value does not change (free stock). */
    posted: InventoryPosting | null,
  ): Result<ItemCost, CatRefusal>;
}
export const ItemCosting = contractKey<ItemCosting>('cat.item-costing');
/**
 * The longest term a search accepts: a name and a code, not a paragraph. A
 * screen limits its field to this, so that typing never reaches the refusal.
 */
export const SEARCH_LENGTH = 100;
/** How many items one answer carries, unless the caller asks for fewer. */
export const SEARCH_LIMIT = 50;
/** The most one answer may carry: a screen of results, not the catalogue. */
export const SEARCH_LIMIT_MAX = 200;
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
