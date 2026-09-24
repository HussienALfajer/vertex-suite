import { permissionId, type BranchId, type PermissionId, type TenantId } from '@vertex/contracts';
import type { ItemId, ItemUnitId } from '@vertex/cat/contract';
import type { PriceRate, RateRevisionId, SettlementRule } from '@vertex/fx/contract';
import type { CurrencyCode, Id, Instant, Refusal, Result } from '@vertex/kernel';
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
  /** The branch is not this tenant's, or does not exist. */
  | 'prc.branch-not-found'
  /** A withdrawn branch sets no new prices; its frozen ones stay readable. */
  | 'prc.branch-inactive'
  /** No dollar price to derive from. Never derived from zero, another unit, or another list. */
  | 'prc.usd-price-missing'
  /** No rate for the branch's today (`FX-04`); yesterday's is not used in its place. */
  | 'prc.rate-missing'
  /** `FX` could not restate the price: the currency is unset, withdrawn, or the rate cannot apply. */
  | 'prc.conversion-unavailable'
  /** The price recalculated at approval is not the one that was reviewed. Preview again. */
  | 'prc.display-basis-changed'
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

/**
 * The currency a customer reads on the shelf (`PRC-02`).
 *
 * One constant rather than a parameter: the specification names it, every
 * frozen price is keyed without it, and a second display currency would need a
 * decision about labels and registers that `U09.5` has not made.
 */
export const DISPLAY_CURRENCY = 'SYP' satisfies CurrencyCode;

/** One frozen price: a branch, and the exact list, item and unit it is for. */
export interface DisplayPriceTarget {
  readonly branch: BranchId;
  readonly subject: PriceSubject;
}

/**
 * Everything a frozen price was derived from, copied at the moment it was
 * approved and never read through again.
 *
 * `usdRevision` is what makes a later dollar edit visible: the frozen figure
 * stays, and says which dollar price it was made from. The rate is `FX`'s
 * `PriceRate` as it stood, so a correction of that day's rate after approval
 * changes nothing here (`FX-05`).
 */
export interface DisplayPriceBasis {
  readonly usdAmount: string;
  readonly usdRevision: number;
  readonly rate: PriceRate;
  /** The product before settling, as an exact decimal. */
  readonly exact: string;
  /** Signed: what settling moved (`FX-07`). */
  readonly residual: string;
  readonly rounding: SettlementRule;
}

/**
 * A frozen display price (`PRC-03`): approved by a person, and stable until a
 * person approves another.
 *
 * **Not yet the shelf or register price.** It is PRC's approved snapshot; which
 * snapshot a printed label and a register line agree on is `PRC-04`'s, in
 * `U09.5`, and nothing here claims that agreement.
 */
export interface DisplayPrice extends DisplayPriceTarget {
  readonly tenant: TenantId;
  /** Canonical exact decimal, settled onto the currency's step. */
  readonly amount: string;
  readonly currency: CurrencyCode;
  readonly revision: number;
  readonly basis: DisplayPriceBasis;
  readonly approvedBy: CommandContext['actor'];
  readonly approvedAt: Instant;
  readonly reason: string;
}

/**
 * Where a frozen price stands against its dollar source.
 *
 * - `unpriced` — no dollar price: nothing to derive from, and nothing is.
 * - `not-frozen` — a dollar price, never approved as a display price here.
 * - `usd-changed` — frozen from an older dollar revision: needs review.
 * - `frozen` — frozen from the current dollar revision. Says nothing about
 *   today's rate, deliberately: a frozen price does not follow it.
 */
export type DisplayPriceStatus = 'unpriced' | 'not-frozen' | 'usd-changed' | 'frozen';

/** The operational read: the stored snapshot as it is, with its dollar source beside it. */
export interface DisplayPriceState extends DisplayPriceTarget {
  readonly usd: UsdPrice | null;
  readonly price: DisplayPrice | null;
  readonly status: DisplayPriceStatus;
}

/**
 * What approving now would store, and what it would replace. Writes nothing.
 *
 * The fields a confirmation must repeat are here, so that what is approved is
 * what was reviewed: see `DisplayPriceCommand`.
 */
export interface DisplayPricePreview extends DisplayPriceTarget {
  readonly currency: CurrencyCode;
  readonly proposed: string;
  readonly basis: DisplayPriceBasis;
  readonly current: DisplayPrice | null;
}

/**
 * Approving a reviewed preview.
 *
 * It carries what the person reviewed — the proposed figure, the dollar
 * revision and the rate revision — and the price is recalculated at approval
 * and refused (`prc.display-basis-changed`) unless it comes to exactly that.
 * Otherwise a rate corrected between preview and approval would freeze a figure
 * nobody looked at.
 */
export interface DisplayPriceCommand extends DisplayPriceTarget {
  readonly expectedRevision: number;
  readonly proposed: string;
  readonly usdRevision: number;
  readonly rateRevision: RateRevisionId;
  readonly reason: string;
  readonly operation: Id<'price-operation'>;
}

/**
 * One approval in the audit (`PRC-11`), kept apart from the dollar price's so
 * that each is reported as what it is: the old and the new figure, and the
 * source each was derived from.
 */
export interface DisplayPriceChange extends DisplayPriceTarget {
  readonly tenant: TenantId;
  readonly operation: Id<'price-operation'>;
  readonly actor: CommandContext['actor'];
  readonly at: Instant;
  readonly currency: CurrencyCode;
  readonly oldAmount: string | null;
  readonly oldBasis: DisplayPriceBasis | null;
  readonly newAmount: string;
  readonly basis: DisplayPriceBasis;
  readonly reason: string;
  readonly revision: number;
  readonly sequence: number;
}

export interface DisplayPriceHistoryFilter extends PriceHistoryFilter {
  readonly branch?: BranchId;
}

export interface DisplayPriceHistoryPage {
  readonly entries: readonly DisplayPriceChange[];
  readonly next: number | null;
}

export interface DisplayPrices {
  /** The stored snapshot and its dollar source. Never calls `FX`. */
  get(
    by: CommandContext,
    target: DisplayPriceTarget,
  ): Promise<Result<DisplayPriceState, PrcRefusal>>;
  /** Bounded by the item's units and the tenant's lists, at one branch. */
  forItem(
    by: CommandContext,
    branch: BranchId,
    item: ItemId,
  ): Promise<Result<readonly DisplayPriceState[], PrcRefusal>>;
  /** Calculates at today's rate for review. Writes nothing. */
  preview(
    by: CommandContext,
    target: DisplayPriceTarget,
  ): Promise<Result<DisplayPricePreview, PrcRefusal>>;
  /** Recalculates, checks it against what was reviewed, and freezes it with its audit entry. */
  approve(
    by: CommandContext,
    command: DisplayPriceCommand,
  ): Promise<Result<DisplayPrice, PrcRefusal>>;
  history(
    by: CommandContext,
    filter: DisplayPriceHistoryFilter,
  ): Promise<Result<DisplayPriceHistoryPage, PrcRefusal>>;
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
export const DisplayPrices = contractKey<DisplayPrices>('prc.display-prices');

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
  display: Object.freeze({
    view: permissionId('prc', 'display-price', 'view'),
    /** Previewing and approving: the preview is the first half of an approval. */
    edit: permissionId('prc', 'display-price', 'edit'),
  }),
}) satisfies Record<string, Record<string, PermissionId>>;
