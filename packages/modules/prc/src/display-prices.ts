import type { BranchId, TenantId } from '@vertex/contracts';
import type { ItemUnitId } from '@vertex/cat/contract';
import type { ConvertedPrice, RateRefusal } from '@vertex/fx/contract';
import {
  Dec,
  isDecimalString,
  isId,
  ok,
  refuse,
  toDecimalString,
  type Result,
} from '@vertex/kernel';
import {
  DISPLAY_CURRENCY,
  type DisplayPrice,
  type DisplayPriceBasis,
  type DisplayPriceChange,
  type DisplayPriceCommand,
  type DisplayPriceHistoryFilter,
  type DisplayPriceHistoryPage,
  type DisplayPriceState,
  type DisplayPriceTarget,
  type PriceList,
  type PrcRefusal,
  type RateReviewBatchId,
  type UsdPrice,
} from './contract.js';
import { padded, range } from './keys.js';
import { listIn, type RecordSession } from './price-lists.js';
import { currentPrice, validSubject } from './usd-prices.js';

type Outcome<T> = Result<T, PrcRefusal>;

/**
 * Kept apart from the dollar prices' records under a root of their own, so the
 * two audits are two reports (`PRC-11`) and a scan of one never reads the other.
 */
const root = (tenant: TenantId): string => `prc/display/${encodeURIComponent(tenant)}/`;
const priceRoot = (tenant: TenantId): string => `${root(tenant)}price/`;
export const historyRoot = (tenant: TenantId): string => `${root(tenant)}history/`;
const operationRoot = (tenant: TenantId): string => `${root(tenant)}operation/`;
export const displaySequenceKey = (tenant: TenantId): string => `${root(tenant)}sequence`;
/** Every frozen price at one branch, in item, list, unit order. */
export const branchPriceRoot = (tenant: TenantId, branch: BranchId): string =>
  `${priceRoot(tenant)}${branch}/`;
const priceKey = (tenant: TenantId, { branch, subject }: DisplayPriceTarget): string =>
  `${branchPriceRoot(tenant, branch)}${subject.item}/${subject.list}/${subject.unit}`;

/**
 * A reviewed batch's prices, staged where no read looks (`PRC-03`) until the
 * batch is published — and then read through, until each is folded into its
 * own price record.
 */
export const stagedRoot = (tenant: TenantId, batch: RateReviewBatchId): string =>
  `${root(tenant)}staged/${batch}/`;
export const stagedKey = (
  tenant: TenantId,
  batch: RateReviewBatchId,
  subject: DisplayPriceTarget['subject'],
): string => `${stagedRoot(tenant, batch)}${subject.item}/${subject.list}/${subject.unit}`;
/**
 * The published batches at a branch whose prices are not yet all folded into
 * their own records. Written once, at publication: that write is the whole of
 * the moment a batch becomes the price.
 */
export const overlayKey = (tenant: TenantId, branch: BranchId): string =>
  `${root(tenant)}overlay/${branch}`;
/** Where a batch's state is kept: history entries of it are hidden until it is published. */
export const batchKey = (tenant: TenantId, batch: RateReviewBatchId): string =>
  `prc/review/${encodeURIComponent(tenant)}/batch/${batch}`;

/** A staged price, and the audit entry written beside it. */
export interface StagedPrice {
  readonly price: DisplayPrice;
  readonly history: string;
}

/** An audit entry's key: its sequence first, so the audit reads in order by bisection. */
export function historyKeyOf(tenant: TenantId, change: DisplayPriceChange): string {
  const { branch, subject } = change;
  const key = `${historyRoot(tenant)}${padded(change.sequence)}/${String(change.at).padStart(16, '0')}/${branch}/${subject.item}/${subject.list}/${subject.unit}`;
  return change.batch === undefined ? key : `${key}/${change.batch}`;
}

/** The operation's record: what was asked, and what it was answered with. */
interface Replay {
  readonly fingerprint: string;
  readonly price: DisplayPrice;
}

export function validBranch(branch: unknown): branch is BranchId {
  return typeof branch === 'string' && isId(branch);
}

/** The shape of a target, checked field by field: it arrives off a wire. */
export function validateTarget(target: unknown): Outcome<DisplayPriceTarget> {
  if (typeof target !== 'object' || target === null || Array.isArray(target))
    return refuse('prc.subject-invalid');
  const fields = target as Record<string, unknown>;
  if (!validBranch(fields['branch'])) return refuse('prc.branch-not-found');
  if (!validSubject(fields['subject'])) return refuse('prc.subject-invalid');
  return ok({ branch: fields['branch'], subject: fields['subject'] });
}

/**
 * The shape of an approval, before anything is read or anybody is asked.
 *
 * Fields that name the reviewed basis and do not parse are refused as a changed
 * basis: whatever was reviewed, it cannot have been that.
 */
export function validateApproval(command: unknown): Outcome<DisplayPriceCommand> {
  const target = validateTarget(command);
  if (!target.ok) return target;
  const fields = command as Record<string, unknown>;
  if (typeof fields['operation'] !== 'string' || !isId(fields['operation']))
    return refuse('prc.operation-invalid');
  const revision = fields['expectedRevision'];
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision >= Number.MAX_SAFE_INTEGER
  )
    return refuse('prc.revision-stale');
  const reason = fields['reason'];
  if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 500)
    return refuse('prc.reason-required');
  const proposed = fields['proposed'];
  if (typeof proposed !== 'string' || proposed.length > 32 || !isDecimalString(proposed))
    return refuse('prc.amount-invalid');
  const usdRevision = fields['usdRevision'];
  if (
    typeof usdRevision !== 'number' ||
    !Number.isSafeInteger(usdRevision) ||
    usdRevision < 1 ||
    typeof fields['rateRevision'] !== 'string' ||
    !isId(fields['rateRevision'])
  )
    return refuse('prc.display-basis-changed');
  return ok(command as DisplayPriceCommand);
}

/**
 * The frozen price in effect: its own record, or a published batch's staged
 * figure not yet folded into it — whichever is the later revision.
 *
 * The later revision and not the batch, because a price approved by hand
 * after a batch was published is newer than the batch's figure whether or not
 * the batch has been folded yet; folding never writes over a later revision.
 */
export function storedDisplayPrice(
  session: RecordSession,
  tenant: TenantId,
  target: DisplayPriceTarget,
): DisplayPrice | null {
  let price = (session.get(priceKey(tenant, target)) as DisplayPrice | undefined) ?? null;
  const published =
    (session.get(overlayKey(tenant, target.branch)) as readonly RateReviewBatchId[] | undefined) ??
    [];
  for (const batch of published) {
    const staged = session.get(stagedKey(tenant, batch, target.subject)) as StagedPrice | undefined;
    if (staged !== undefined && (price === null || staged.price.revision > price.revision))
      price = staged.price;
  }
  return price;
}

/** The price record itself, without any batch read through: what folding compares against. */
export function ownDisplayPrice(
  session: RecordSession,
  tenant: TenantId,
  target: DisplayPriceTarget,
): DisplayPrice | null {
  return (session.get(priceKey(tenant, target)) as DisplayPrice | undefined) ?? null;
}

export function putOwnDisplayPrice(
  session: RecordSession,
  tenant: TenantId,
  price: DisplayPrice,
): void {
  session.put(priceKey(tenant, price), price);
}

/**
 * The stored snapshot beside its dollar source — read, never recalculated.
 *
 * `usd-changed` compares revisions, not amounts: a dollar price edited to a
 * different figure and back is still a dollar price somebody changed after this
 * one was approved, and the review is theirs to decide.
 */
export function displayState(
  session: RecordSession,
  tenant: TenantId,
  target: DisplayPriceTarget,
): DisplayPriceState {
  const usd = currentPrice(session, tenant, target.subject);
  const price = storedDisplayPrice(session, tenant, target);
  const status =
    usd === null
      ? 'unpriced'
      : price === null
        ? 'not-frozen'
        : price.basis.usdRevision === usd.revision
          ? 'frozen'
          : 'usd-changed';
  return { branch: target.branch, subject: target.subject, usd, price, status };
}

/** Every list and unit of one item at one branch, in list order then the item's own unit order. */
export function itemDisplayStates(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  item: DisplayPriceTarget['subject']['item'],
  lists: readonly PriceList[],
  units: readonly ItemUnitId[],
): readonly DisplayPriceState[] {
  return lists.flatMap((list) =>
    units.map((unit) =>
      displayState(session, tenant, { branch, subject: { list: list.id, item, unit } }),
    ),
  );
}

/**
 * What `FX` answered, as the basis a frozen price keeps. Canonical decimals
 * throughout, so an equal figure is an equal string on every machine.
 */
export function basisOf(usd: UsdPrice, converted: ConvertedPrice): DisplayPriceBasis {
  return {
    usdAmount: usd.amount,
    usdRevision: usd.revision,
    rate: converted.rate,
    exact: toDecimalString(converted.exact),
    residual: toDecimalString(converted.residual.amount),
    rounding: converted.rounding,
  };
}

/**
 * `FX`'s refusal, restated as one a price screen can act on.
 *
 * A missing rate keeps its values — the branch, the currency and the day —
 * because that is the whole of what the prompt has to tell somebody to go and
 * enter. Anything else `FX` refuses means the currency cannot be priced in at
 * all here, and says which refusal it was.
 */
export function fromConversion(refusal: RateRefusal): PrcRefusal {
  if (refusal.code === 'fx.rate-missing') return refuse('prc.rate-missing', refusal.values).error;
  if (refusal.code === 'fx.branch-not-found') return refuse('prc.branch-not-found').error;
  if (refusal.code === 'fx.branch-inactive') return refuse('prc.branch-inactive').error;
  return refuse('prc.conversion-unavailable', { cause: refusal.code }).error;
}

/** Whether what would be frozen now is exactly what the person reviewed. */
export function reviewed(
  command: DisplayPriceCommand,
  amount: string,
  basis: DisplayPriceBasis,
): boolean {
  return (
    new Dec(command.proposed).equals(new Dec(amount)) &&
    command.usdRevision === basis.usdRevision &&
    command.rateRevision === basis.rate.revision
  );
}

/** The first answer to this operation, or its refusal if it is being reused for something else. */
export function replayed(
  session: RecordSession,
  tenant: TenantId,
  actor: DisplayPriceChange['actor'],
  command: DisplayPriceCommand,
): Outcome<DisplayPrice> | null {
  const prior = session.get(`${operationRoot(tenant)}${command.operation}`) as Replay | undefined;
  if (prior === undefined) return null;
  return prior.fingerprint === fingerprintOf(actor, command)
    ? ok(prior.price)
    : refuse('prc.operation-reused');
}

function fingerprintOf(actor: DisplayPriceChange['actor'], command: DisplayPriceCommand): string {
  return JSON.stringify({
    actor,
    branch: command.branch,
    subject: command.subject,
    expectedRevision: command.expectedRevision,
    proposed: command.proposed,
    usdRevision: command.usdRevision,
    rateRevision: command.rateRevision,
    reason: command.reason,
  });
}

/**
 * Freezes a reviewed figure and its audit entry in one transaction.
 *
 * Everything that could refuse outside — the rate, the branch, the subject —
 * was decided before this opened, because `FX` and `SYS` are asked through
 * their own transactions. What is decided here is what only this transaction
 * can see truly: the operation, the revision, and whether the dollar price is
 * still the one the figure was derived from. Reading it here also puts it in
 * this transaction's read set, so a dollar edit committing alongside is a
 * conflict and not a silent overtake.
 */
export function putDisplayPrice(
  session: RecordSession,
  tenant: TenantId,
  actor: DisplayPriceChange['actor'],
  at: DisplayPriceChange['at'],
  command: DisplayPriceCommand,
  amount: string,
  basis: DisplayPriceBasis,
): Outcome<DisplayPrice> {
  const replay = replayed(session, tenant, actor, command);
  if (replay !== null) return replay;
  const list = listIn(session, tenant, command.subject.list);
  if (!list) return refuse('prc.list-not-found');
  if (!list.active) return refuse('prc.list-inactive');
  const usd = currentPrice(session, tenant, command.subject);
  if (usd === null) return refuse('prc.usd-price-missing');
  if (usd.revision !== basis.usdRevision)
    return refuse('prc.display-basis-changed', { usdRevision: usd.revision });
  const old = storedDisplayPrice(session, tenant, command);
  if ((old?.revision ?? 0) !== command.expectedRevision)
    return refuse('prc.revision-stale', { currentRevision: old?.revision ?? 0 });

  const sequenceKey = displaySequenceKey(tenant);
  const sequence = ((session.get(sequenceKey) as number | undefined) ?? 0) + 1;
  const reason = command.reason.trim();
  const price: DisplayPrice = {
    tenant,
    branch: command.branch,
    subject: command.subject,
    amount,
    currency: DISPLAY_CURRENCY,
    revision: command.expectedRevision + 1,
    basis,
    approvedBy: actor,
    approvedAt: at,
    reason,
  };
  const change: DisplayPriceChange = {
    tenant,
    branch: command.branch,
    subject: command.subject,
    operation: command.operation,
    actor,
    at,
    currency: DISPLAY_CURRENCY,
    oldAmount: old?.amount ?? null,
    oldBasis: old?.basis ?? null,
    newAmount: amount,
    basis,
    reason,
    revision: price.revision,
    sequence,
  };
  session.put(sequenceKey, sequence);
  session.put(priceKey(tenant, command), price);
  session.put(historyKeyOf(tenant, change), change);
  session.put(`${operationRoot(tenant)}${command.operation}`, {
    fingerprint: fingerprintOf(actor, command),
    price,
  } satisfies Replay);
  return ok(price);
}

/** The filter's shape, checked before anybody is asked about the branch it names. */
export function validHistoryFilter(filter: unknown): filter is DisplayPriceHistoryFilter {
  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) return false;
  const fields = filter as Record<string, unknown>;
  const validId = (value: unknown): boolean =>
    value === undefined || (typeof value === 'string' && isId(value));
  const validTime = (value: unknown): boolean =>
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value));
  const before = fields['before'];
  const limit = fields['limit'];
  return (
    validId(fields['branch']) &&
    validId(fields['batch']) &&
    validId(fields['item']) &&
    validId(fields['list']) &&
    validId(fields['unit']) &&
    validTime(fields['from']) &&
    validTime(fields['to']) &&
    (before === undefined ||
      (typeof before === 'number' && Number.isSafeInteger(before) && before >= 1)) &&
    (limit === undefined ||
      (typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100))
  );
}

/**
 * Newest first, a page at a time, filtered on what the key already says.
 *
 * A batch's entries are written while it is staged, and are not changes until
 * it is published: until then they are passed over, so the audit never shows
 * one price of a batch nobody can yet read as a price (`PRC-03`). A batch that
 * is abandoned never shows at all, and its entries are removed.
 */
export function displayHistory(
  session: RecordSession,
  tenant: TenantId,
  filter: DisplayPriceHistoryFilter,
): DisplayPriceHistoryPage {
  const limit = filter.limit ?? 50;
  const published = new Map<string, boolean>();
  const visible = (batch: string): boolean => {
    let known = published.get(batch);
    if (known === undefined) {
      const record = session.get(batchKey(tenant, batch as RateReviewBatchId)) as
        { readonly state: string } | undefined;
      known = record?.state === 'published';
      published.set(batch, known);
    }
    return known;
  };
  const { keys, start, end } = range(session, historyRoot(tenant));
  const matching: { key: string; position: number }[] = [];
  // Newest first, stopping at one past the page: the listing is in sequence order.
  for (let at = end - 1; at >= start && matching.length <= limit; at -= 1) {
    const key = keys[at] ?? '';
    const [sequence, time, branch, item, list, unit, batch] = key
      .slice(historyRoot(tenant).length)
      .split('/');
    if (!sequence || !time || !branch || !item || !list || !unit) continue;
    const position = Number(sequence);
    const moment = Number(time);
    if (
      (!filter.branch || branch === filter.branch) &&
      (!filter.item || item === filter.item) &&
      (!filter.list || list === filter.list) &&
      (!filter.unit || unit === filter.unit) &&
      (!filter.batch || batch === filter.batch) &&
      (filter.from === undefined || moment >= filter.from) &&
      (filter.to === undefined || moment <= filter.to) &&
      (filter.before === undefined || position < filter.before) &&
      (batch === undefined || visible(batch))
    )
      matching.push({ key, position });
  }
  const entries = matching.slice(0, limit).map(({ key }) => session.get(key) as DisplayPriceChange);
  const last = entries.at(-1);
  return { entries, next: matching.length > limit && last ? last.sequence : null };
}
