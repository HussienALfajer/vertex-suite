import { permissionId, type PermissionId, type TenantId } from '@vertex/contracts';
import type { Id, Refusal, Result, Unit } from '@vertex/kernel';
import { contractKey, type CommandContext } from '@vertex/platform';

export type CategoryId = Id<'category'>;
export type ItemId = Id<'item'>;
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
  readonly kind: 'standard';
  /** A snapshot, resolved when created; category changes do not rewrite it. */
  readonly baseUnit: Unit;
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
}
export type CatRefusal = Refusal<
  | 'cat.not-permitted'
  | 'cat.name-required'
  | 'cat.category-not-found'
  | 'cat.parent-not-found'
  | 'cat.cycle'
  | 'cat.unit-required'
  | 'cat.unit-invalid'
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
  }),
}) satisfies Record<string, Record<string, PermissionId>>;
