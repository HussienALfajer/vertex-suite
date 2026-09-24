import { permissionId, type PermissionId, type TenantId } from '@vertex/contracts';
import type { ItemId, ItemUnitId } from '@vertex/cat/contract';
import type { Id, Instant, Refusal, Result } from '@vertex/kernel';
import { contractKey, type CommandContext } from '@vertex/platform';

export type PriceListId = Id<'price-list'>;

export interface PriceList {
  readonly tenant: TenantId;
  readonly id: PriceListId;
  /** Standard lists keep their code even after a tenant renames them. */
  readonly code: 'retail' | 'half-wholesale' | 'wholesale' | null;
  readonly name: string;
  readonly active: boolean;
}

/** A price belongs to this exact CAT unit of this exact item in one list and tenant. */
export interface PriceSubject {
  readonly list: PriceListId;
  readonly item: ItemId;
  readonly unit: ItemUnitId;
}

export type PrcRefusal = Refusal<
  | 'prc.not-permitted'
  | 'prc.name-required'
  | 'prc.name-invalid'
  | 'prc.name-taken'
  | 'prc.list-not-found'
  | 'prc.list-inactive'
  | 'prc.item-not-found'
  | 'prc.unit-not-on-item'
  | 'prc.subject-invalid'
  | 'prc.amount-invalid'
  | 'prc.reason-required'
  | 'prc.revision-stale'
  | 'prc.operation-invalid'
  | 'prc.operation-reused'
  | 'prc.history-query-invalid'
>;

export interface UsdPrice {
  readonly tenant: TenantId;
  readonly subject: PriceSubject;
  /** Canonical exact decimal, settled to the USD cent. */
  readonly amount: string;
  readonly currency: 'USD';
  readonly revision: number;
}

export interface UsdPriceChange {
  readonly tenant: TenantId;
  readonly subject: PriceSubject;
  readonly operation: Id<'price-operation'>;
  readonly actor: CommandContext['actor'];
  readonly at: Instant;
  readonly oldAmount: string | null;
  readonly newAmount: string;
  readonly reason: string;
  readonly revision: number;
  readonly sequence: number;
}

export interface UsdPriceCommand {
  readonly subject: PriceSubject;
  readonly amount: { readonly amount: string; readonly currency: 'USD' };
  readonly expectedRevision: number;
  readonly reason: string;
  readonly operation: Id<'price-operation'>;
}

export interface PriceHistoryFilter {
  readonly item?: ItemId;
  readonly list?: PriceListId;
  readonly unit?: ItemUnitId;
  readonly from?: Instant;
  readonly to?: Instant;
  readonly before?: number;
  readonly limit?: number;
}

export interface PriceHistoryPage {
  readonly entries: readonly UsdPriceChange[];
  readonly next: number | null;
}

export interface UsdPrices {
  /** Null means explicitly unpriced; no unit or list fallback is applied. */
  get(by: CommandContext, subject: PriceSubject): Promise<Result<UsdPrice | null, PrcRefusal>>;
  /** Bounded by the selected item's units and the tenant's lists. */
  forItem(by: CommandContext, item: ItemId): Promise<Result<readonly UsdPrice[], PrcRefusal>>;
  history(
    by: CommandContext,
    filter: PriceHistoryFilter,
  ): Promise<Result<PriceHistoryPage, PrcRefusal>>;
  set(by: CommandContext, command: UsdPriceCommand): Promise<Result<UsdPrice, PrcRefusal>>;
}

export interface PriceLists {
  /** Includes inactive lists so historical identities remain readable. */
  list(by: CommandContext): Promise<readonly PriceList[]>;
  get(by: CommandContext, id: PriceListId): Promise<PriceList | null>;
  subject(by: CommandContext, subject: PriceSubject): Promise<Result<PriceSubject, PrcRefusal>>;
}

export interface PriceListAdministration {
  /** Called by tenant provisioning; safe to call again after restart. */
  seed(by: CommandContext): Promise<Result<readonly PriceList[], PrcRefusal>>;
  create(by: CommandContext, name: string): Promise<Result<PriceList, PrcRefusal>>;
  rename(by: CommandContext, id: PriceListId, name: string): Promise<Result<PriceList, PrcRefusal>>;
  deactivate(by: CommandContext, id: PriceListId): Promise<Result<PriceList, PrcRefusal>>;
}

export const PriceLists = contractKey<PriceLists>('prc.price-lists');
export const PriceListAdministration = contractKey<PriceListAdministration>(
  'prc.price-list-administration',
);
export const UsdPrices = contractKey<UsdPrices>('prc.usd-prices');

export const PRC_PERMISSIONS = Object.freeze({
  list: Object.freeze({
    view: permissionId('prc', 'price-list', 'view'),
    create: permissionId('prc', 'price-list', 'create'),
    edit: permissionId('prc', 'price-list', 'edit'),
  }),
  price: Object.freeze({
    view: permissionId('prc', 'price', 'view'),
    edit: permissionId('prc', 'price', 'edit'),
    history: permissionId('prc', 'price-history', 'view'),
  }),
}) satisfies Record<string, Record<string, PermissionId>>;
