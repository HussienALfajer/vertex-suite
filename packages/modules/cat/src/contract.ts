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
  readonly category: CategoryId;
  readonly kind: ItemKind;
  /** A snapshot, resolved when created; category changes do not rewrite it. */
  readonly baseUnit: Unit;
  readonly units: readonly ItemUnit[];
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
>;
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
