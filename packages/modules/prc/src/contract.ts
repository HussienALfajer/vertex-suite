import { permissionId, type PermissionId, type TenantId } from '@vertex/contracts';
import type { ItemId, ItemUnitId } from '@vertex/cat/contract';
import type { Id, Refusal, Result } from '@vertex/kernel';
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
>;

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

export const PRC_PERMISSIONS = Object.freeze({
  list: Object.freeze({
    view: permissionId('prc', 'price-list', 'view'),
    create: permissionId('prc', 'price-list', 'create'),
    edit: permissionId('prc', 'price-list', 'edit'),
  }),
}) satisfies Record<string, Record<string, PermissionId>>;
