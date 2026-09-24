import { permissionId, type BranchId, type PermissionId, type TenantId } from '@vertex/contracts';
import type { ItemId, ItemUnitId } from '@vertex/cat/contract';
import type { PriceRate, RateRevisionId, SettlementRule } from '@vertex/fx/contract';
import type { CurrencyCode, Id, Instant, Refusal, Result } from '@vertex/kernel';
import { contractKey, eventType, type CommandContext } from '@vertex/platform';

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
  /** Not a percentage in `RATE_REVIEW_THRESHOLD`'s range, or not null. */
  | 'prc.threshold-invalid'
  /** No such review task at the branch named, in this tenant. */
  | 'prc.review-not-found'
  /** The task is not awaiting a decision: it was decided, superseded, or is still being prepared. */
  | 'prc.review-not-pending'
  /** Prices the task lists have changed since it listed them. Refresh it and review again. */
  | 'prc.review-stale'
  /** Today's rate or the owner's threshold has moved on since the task was raised. */
  | 'prc.review-superseded'
  /** Every listed price is excluded: there is nothing to approve. Reject the task instead. */
  | 'prc.review-empty'
  | 'prc.review-query-invalid'
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
  /** The reviewed batch that published this figure (`PRC-03`); absent when approved on its own. */
  readonly batch?: RateReviewBatchId;
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
  /** The reviewed batch this change was one price of (`PRC-03`); absent when approved on its own. */
  readonly batch?: RateReviewBatchId;
}

export interface DisplayPriceHistoryFilter extends PriceHistoryFilter {
  readonly branch?: BranchId;
  /** One batch's changes: every price it published, and nothing else. */
  readonly batch?: RateReviewBatchId;
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

export type RateReviewTaskId = Id<'rate-review-task'>;
export type RateReviewBatchId = Id<'rate-review-batch'>;

/**
 * The owner's threshold (`PRC-03`): how far today's rate may move from the rate
 * a frozen price was approved at before somebody is asked to review it.
 *
 * **A percentage of the rate the price was frozen at**, one setting for the
 * whole tenant. Per tenant, because the specification gives the owner one
 * threshold to configure and a branch's own movement is already measured
 * against its own rate; per branch would be a second dial nobody asked for.
 *
 * At least 0.1: a rate is typed to the pound, and below a tenth of a percent a
 * correction of a single mistyped digit raises a task. At most 50: past half,
 * the shelf has drifted further than any review could still call a
 * correction. Two decimal places, as an owner writes a percentage.
 *
 * **Null — disabled — is the default.** Enabling it is the owner's act: a
 * shop upgraded into this feature does not wake up to a review of every price
 * it holds.
 *
 * The comparison, exactly, for one frozen price at one branch: with `r0` the
 * rate its basis names and `r1` the rate `PriceConversion` applies today (the
 * same buy side a preview uses), it has **moved** when
 *
 *     |r1 − r0| × 100 ≥ threshold × r0
 *
 * in exact decimals — never divided, so no quotient is ever rounded. Equality
 * moves it: a 5% threshold is met by a 5% move. The baseline is each price's
 * own frozen rate, so several small revisions that together cross the
 * threshold are caught, a rate that returns toward the baseline stops
 * counting, and only a price approved again takes a new baseline. Only the
 * branch's current revision for today is compared; a same-day correction
 * replaces the revision it corrects.
 */
export const RATE_REVIEW_THRESHOLD = Object.freeze({ min: '0.1', max: '50', decimals: 2 });

export interface RateReviewPolicy {
  readonly tenant: TenantId;
  /** Percent, as a canonical decimal; null when disabled. */
  readonly threshold: string | null;
  /** 0 before the owner first sets it; one more for each change, including disabling it. */
  readonly revision: number;
  readonly changedBy: CommandContext['actor'];
  readonly changedAt: Instant | null;
}

export interface RateReviewPolicyCommand {
  readonly threshold: string | null;
  readonly expectedRevision: number;
  readonly operation: Id<'price-operation'>;
}

/**
 * Where a review task stands.
 *
 * - `preparing` — its prices are still being listed; not yet a decision anybody can take.
 * - `pending` — awaiting review: exclude prices, reject it, or approve it.
 * - `approving` — approved, and its batch is being published. Nothing of it is
 *   visible as a price until the whole batch is.
 * - `approved` — its batch is published: every included price, at once.
 * - `rejected` — decided against; every price it listed stays as frozen.
 * - `superseded` — today's rate or the threshold moved on, or it was
 *   refreshed; whatever replaces it is a task of its own.
 *
 * A rate that moved past the threshold without changing any listed figure —
 * every price it reached settles where it already is — raises no task at all.
 */
export type RateReviewState =
  'preparing' | 'pending' | 'approving' | 'approved' | 'rejected' | 'superseded';

/**
 * Why a price the rate moved past is not listed.
 *
 * - `list-inactive` — its list was withdrawn; a withdrawn list is not priced.
 * - `subject-invalid` — its item or unit no longer exists in the catalogue.
 * - `usd-missing` — no dollar price to derive a figure from.
 * - `unchanged` — the new figure settles to the one already frozen.
 * - `amount-invalid` — the new figure settles to nothing.
 */
export type RateReviewSkip =
  'list-inactive' | 'subject-invalid' | 'usd-missing' | 'unchanged' | 'amount-invalid';

export interface RateReviewCounts {
  /** Frozen prices at the branch when the scan began. */
  readonly frozen: number;
  /** How many of them the scan has examined: `frozen` once prepared. */
  readonly scanned: number;
  /** Those the rate moved past the threshold. */
  readonly moved: number;
  /** Listed for review: moved, and with a new figure. */
  readonly entries: number;
  readonly excluded: number;
  readonly skipped: Readonly<Record<RateReviewSkip, number>>;
}

export interface RateReviewDecision {
  readonly kind: 'approved' | 'rejected';
  readonly actor: CommandContext['actor'];
  readonly at: Instant;
  readonly reason: string;
  readonly operation: Id<'price-operation'>;
}

export interface RateReviewSupersession {
  readonly at: Instant;
  readonly cause: 'rate-revised' | 'policy-changed' | 'refreshed';
  readonly by: CommandContext['actor'];
}

/**
 * One attempt to publish an approved task's prices.
 *
 * Staged a chunk at a time where nothing reads it, then published by a
 * single small write — so no reader ever sees part of it. A batch whose basis
 * changed before it could be published is `abandoned` and publishes nothing;
 * its task returns to review (a price changed) or is superseded (the rate or
 * threshold did).
 */
export interface RateReviewBatch {
  readonly id: RateReviewBatchId;
  readonly task: RateReviewTaskId;
  readonly state: 'staging' | 'published' | 'abandoned';
  readonly operation: Id<'price-operation'>;
  readonly actor: CommandContext['actor'];
  readonly reason: string;
  /** When it was approved: the time every price change of it records. */
  readonly at: Instant;
  readonly total: number;
  readonly staged: number;
  readonly publishedAt: Instant | null;
  readonly failure: {
    readonly cause: 'stale' | 'superseded';
    readonly at: Instant;
    readonly stale: number;
  } | null;
}

/**
 * A review task (`PRC-03`): today's rate at one branch has moved past the
 * owner's threshold from the rate some frozen prices were approved at.
 *
 * Raised by PRC, owned by PRC, and never a price change by itself. At most one
 * is raised for a branch, rate revision and threshold revision.
 */
export interface RateReviewTask {
  readonly tenant: TenantId;
  readonly id: RateReviewTaskId;
  readonly branch: BranchId;
  /** The rate that crossed, as `FX` stated it — the rate every proposed figure is at. */
  readonly rate: PriceRate;
  readonly policy: { readonly revision: number; readonly threshold: string };
  readonly state: RateReviewState;
  readonly raisedAt: Instant;
  /** One more for every exclusion changed: what an approval says it reviewed. */
  readonly review: number;
  readonly counts: RateReviewCounts;
  readonly decision: RateReviewDecision | null;
  readonly supersession: RateReviewSupersession | null;
  /** The latest attempt to publish it, if it was approved. */
  readonly batch: RateReviewBatch | null;
}

/**
 * One price a task lists: the frozen figure as it is, and the figure proposed
 * in its place, each with everything it was derived from.
 */
export interface RateReviewEntry extends DisplayPriceTarget {
  readonly task: RateReviewTaskId;
  readonly current: {
    readonly amount: string;
    readonly revision: number;
    readonly basis: DisplayPriceBasis;
  };
  readonly usd: { readonly amount: string; readonly revision: number };
  readonly currency: CurrencyCode;
  readonly proposed: string;
  readonly basis: DisplayPriceBasis;
  readonly included: boolean;
  readonly exclusion: {
    readonly actor: CommandContext['actor'];
    readonly at: Instant;
  } | null;
  /**
   * Read, not stored: the dollar price or the frozen price has changed since
   * this was listed, so approving would be refused. Refresh the task.
   */
  readonly stale: boolean;
}

export interface RateReviewRef {
  readonly branch: BranchId;
  readonly task: RateReviewTaskId;
}

export interface RateReviewTaskQuery {
  /** One branch's tasks, asked at that branch; absent, every branch's, at the tenant-wide place. */
  readonly branch?: BranchId;
  /** Only tasks still preparing, pending or approving. */
  readonly open?: boolean;
  /** The `next` of the page before. */
  readonly before?: RateReviewTaskId;
  readonly limit?: number;
}

export interface RateReviewTaskPage {
  readonly tasks: readonly RateReviewTask[];
  readonly next: RateReviewTaskId | null;
}

export interface RateReviewEntryQuery extends RateReviewRef {
  /** The `next` of the page before. */
  readonly after?: string;
  /** At most 100; 50 when absent. */
  readonly limit?: number;
  /** Only included, or only excluded, entries. */
  readonly included?: boolean;
}

export interface RateReviewEntryPage {
  readonly entries: readonly RateReviewEntry[];
  readonly next: string | null;
}

export interface RateReviewExclusion extends RateReviewRef {
  /** At most 100 at a time: a page. */
  readonly subjects: readonly PriceSubject[];
  readonly excluded: boolean;
  readonly expectedReview: number;
}

export interface RateReviewRejection extends RateReviewRef {
  readonly reason: string;
  readonly operation: Id<'price-operation'>;
}

/**
 * Approving a task as reviewed: the review revision the person saw, and why.
 *
 * Every figure published is the one the task lists, recalculated at approval
 * and refused unless it still comes to exactly that.
 */
export interface RateReviewApproval extends RateReviewRef {
  readonly expectedReview: number;
  readonly reason: string;
  readonly operation: Id<'price-operation'>;
}

export interface RateReviews {
  policy(by: CommandContext): Promise<Result<RateReviewPolicy, PrcRefusal>>;
  setPolicy(
    by: CommandContext,
    command: RateReviewPolicyCommand,
  ): Promise<Result<RateReviewPolicy, PrcRefusal>>;
  /** Newest first, a page at a time. */
  tasks(
    by: CommandContext,
    query: RateReviewTaskQuery,
  ): Promise<Result<RateReviewTaskPage, PrcRefusal>>;
  task(by: CommandContext, ref: RateReviewRef): Promise<Result<RateReviewTask, PrcRefusal>>;
  /** The listed prices, a page at a time, in list-item-unit key order. */
  entries(
    by: CommandContext,
    query: RateReviewEntryQuery,
  ): Promise<Result<RateReviewEntryPage, PrcRefusal>>;
  exclude(
    by: CommandContext,
    command: RateReviewExclusion,
  ): Promise<Result<RateReviewTask, PrcRefusal>>;
  reject(
    by: CommandContext,
    command: RateReviewRejection,
  ): Promise<Result<RateReviewTask, PrcRefusal>>;
  /**
   * Supersedes a pending task so that its prices are listed again from what
   * they are now, keeping its exclusions. The replacement appears once the
   * monitor has listed it.
   */
  refresh(by: CommandContext, ref: RateReviewRef): Promise<Result<RateReviewTask, PrcRefusal>>;
  /** Accepts the approval and hands the batch to the monitor to publish. */
  approve(
    by: CommandContext,
    command: RateReviewApproval,
  ): Promise<Result<RateReviewTask, PrcRefusal>>;
}

/**
 * The work nobody is waiting on a screen for, done in bounded steps by the host.
 *
 * Detection does not wait for an event: an event is held in memory between
 * commit and dispatch, and a rate recorded just before the process died would
 * never be heard of. Each `drive` instead reads every active branch's current
 * rate and the threshold, compares them with a checkpoint PRC keeps durably,
 * and scans what has changed — then carries every task being prepared and
 * every batch being published one step further. Every step is idempotent and
 * resumes from where the last committed step left it, so a host calls it at
 * startup, after anything that might have moved a rate, and on a timer.
 *
 * Only the system may drive: `by.actor` must be null.
 */
export interface RateReviewMonitor {
  drive(by: CommandContext): Promise<{ readonly more: boolean }>;
}

/** A task is ready for review (`SYS-04` will subscribe; the task itself is durable, this is not). */
export interface RateReviewRaised {
  readonly task: RateReviewTaskId;
  readonly branch: BranchId;
  readonly entries: number;
}
export const RateReviewRaised = eventType<RateReviewRaised>('prc.rate-review-raised');

/** A batch is published: its prices are the frozen display prices from now on. */
export interface RateReviewPublished {
  readonly task: RateReviewTaskId;
  readonly batch: RateReviewBatchId;
  readonly branch: BranchId;
  readonly prices: number;
}
export const RateReviewPublished = eventType<RateReviewPublished>('prc.rate-review-published');

export const RateReviews = contractKey<RateReviews>('prc.rate-reviews');
export const RateReviewMonitor = contractKey<RateReviewMonitor>('prc.rate-review-monitor');

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
  review: Object.freeze({
    /** Seeing tasks and their listed prices, and the threshold they were raised under. */
    view: permissionId('prc', 'rate-review', 'view'),
    /** Excluding, rejecting, refreshing and approving: every decision a task takes. */
    approve: permissionId('prc', 'rate-review', 'approve'),
    /** Setting the threshold: the owner's. */
    policy: permissionId('prc', 'rate-review-policy', 'edit'),
  }),
}) satisfies Record<string, Record<string, PermissionId>>;
