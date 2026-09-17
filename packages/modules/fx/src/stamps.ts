import type { BranchId, TenantId } from '@vertex/contracts';
import { Dec, newId, ok, refuse, type Decimal, type LocalDate, type Result } from '@vertex/kernel';

import type {
  CashDirection,
  PreparedStamp,
  QuoteForm,
  RateInForce,
  RateOverride,
  RateOverrideQuote,
  RateRefusal,
  RateSide,
  RateStamp,
  RateStampId,
  RecordSession,
  Stamping,
} from './contract.js';
import { settleRate } from './quotes.js';
import { readRecord, scanRecords, writeRecord } from './records.js';
import type { Recording } from './rates.js';

/**
 * The rate one document used, worked out and then written down: `FX-05` and
 * `FX-06`.
 *
 * Two halves of one act, and they are apart on purpose — see `RateStamps` in
 * the contract. `prepareStamp` decides, reading only; `writeStamp` writes,
 * inside a transaction somebody else opened and cannot refuse from.
 */

type Stamped<T> = Result<T, RateRefusal>;

/**
 * The side of the board a direction of money selects (`FX-06`).
 *
 * The whole of the automatic selection, and it is a function of one argument
 * because that is all `FX-04` makes it: buy is the rate applied when receiving
 * the currency, sell when paying it out. There is nothing here for a caller to
 * pass in and nothing for a screen to choose, which is what "applied
 * automatically" means.
 */
export function sideFor(direction: CashDirection): RateSide {
  return direction === 'received' ? 'buy' : 'sell';
}

/** Something a person wrote: not blank, and not punctuation standing in for words. */
function isWritten(reason: unknown): reason is string {
  return typeof reason === 'string' && /\p{L}|\p{N}/u.test(reason);
}

/** An override as it will be logged: what will be applied, and what was typed. */
interface SettledOverride {
  readonly applied: Decimal;
  readonly quoted: { readonly form: QuoteForm; readonly rate: string };
  readonly reason: string;
}

/**
 * An override, judged and turned into the figure that will be applied.
 *
 * Judged against the revision in force and not against the override alone,
 * because "receiving at no less than paying out" is a statement about a pair:
 * an overridden buy is read beside the day's sell, and an overridden sell
 * beside the day's buy. The board's other side is the only thing it can be
 * compared with, which is also why an override cannot rescue a day with no rate
 * — `prepareStamp` has already refused by the time this runs.
 *
 * Every field is read as it may actually arrive rather than as the type
 * promises, for the reason `settleQuote` reads a board that way: a rate can
 * reach this module off a wire, and a type is gone at run time.
 */
function settleOverride(
  quote: RateOverrideQuote,
  side: RateSide,
  inForce: RateInForce,
): Stamped<SettledOverride> {
  const { form, rate, reason } = quote as { [K in keyof RateOverrideQuote]: unknown };
  // The reason first: somebody who typed neither a reason nor a rate is told
  // about the reason, which is the part they have to decide rather than read.
  if (!isWritten(reason)) return refuse('fx.override-reason-required', { side });

  const settled = settleRate(form, side, rate);
  if (!settled.ok) return settled;
  const applied = settled.value.canonical;

  const { revision } = inForce;
  const against = new Dec(side === 'buy' ? revision.sell : revision.buy);
  const crosses = side === 'buy' ? applied.lessThan(against) : applied.greaterThan(against);
  if (crosses) {
    return refuse('fx.override-crosses-spread', {
      side,
      applied: applied.toFixed(),
      against: against.toFixed(),
    });
  }
  return ok({ applied, quoted: { form: settled.value.form, rate: String(rate) }, reason });
}

/** Where and when a stamp is being taken: what the caller established before asking. */
export interface StampingHere {
  readonly branch: BranchId;
  readonly day: LocalDate;
  readonly inForce: RateInForce;
}

/**
 * The stamp this movement will carry, and the log entry that goes with it.
 *
 * Everything that can refuse is refused here, outside anybody's transaction.
 * The identifier is settled here too: the caller is building a document that
 * names the stamp, and a document cannot name something that will not have an
 * identifier until after the document is written.
 */
export function prepareStamp(
  recording: Recording,
  here: StampingHere,
  stamping: Stamping,
): Stamped<PreparedStamp> {
  const { tenant, actor, at } = recording;
  const { branch, day, inForce } = here;
  const { revision, lastKnown } = inForce;
  const side = sideFor(stamping.direction);
  const automatic = side === 'buy' ? revision.buy : revision.sell;

  let applied = automatic;
  let override: RateOverride | null = null;
  const id = newId<'rate-stamp'>();

  if (stamping.override !== undefined) {
    const settled = settleOverride(stamping.override, side, inForce);
    if (!settled.ok) return settled;
    applied = settled.value.applied.toFixed();
    override = {
      id: newId<'rate-override'>(),
      tenant,
      stamp: id,
      branch,
      currency: revision.currency,
      day,
      side,
      automatic,
      applied,
      quoted: settled.value.quoted,
      reason: settled.value.reason,
      revision: revision.id,
      by: actor,
      at,
    };
  }

  return ok({
    stamp: {
      id,
      tenant,
      branch,
      currency: revision.currency,
      // Taken from the revision and not read again: the rate is expressed per
      // one unit of whatever the functional currency was when it was recorded,
      // and a stamp that named today's instead would be a figure whose units
      // nobody could state.
      functional: revision.functional,
      day,
      direction: stamping.direction,
      side,
      rate: applied,
      revision: revision.id,
      // The day the rate was recorded for, which is today's unless the register
      // is trading on `FX-04`'s exception. Taken from the revision rather than
      // from the confirmation, so the two can never be made to disagree.
      rateDay: revision.day,
      override: override?.id ?? null,
      lastKnown: lastKnown?.id ?? null,
      stampedBy: actor,
      stampedAt: at,
    },
    override,
  });
}

/**
 * Writes a prepared stamp into a transaction the caller already has open.
 *
 * No `Result`: there is nothing left that could refuse, and a refusal here
 * would reach a caller that has already written half a document and has no
 * sensible answer to it.
 *
 * Raises when the tenant of the command and the tenant of the stamp differ.
 * That cannot happen to a caller that prepared its own stamp under its own
 * context, so it is a defect rather than a refusal — and the alternative is
 * writing one tenant's record from another's command, which is the one mistake
 * this system must never make quietly.
 */
export function writeStamp(
  session: RecordSession,
  tenant: TenantId,
  prepared: PreparedStamp,
): RateStamp {
  const { stamp, override } = prepared;
  if (stamp.tenant !== tenant) {
    throw new Error(
      'This stamp was prepared for another tenant. A command writes its own tenant’s records ' +
        'and nobody else’s.',
    );
  }
  if (override !== null) {
    writeRecord(session, 'override', tenant, [stamp.branch, stamp.day, override.id], override);
  }
  return writeRecord(session, 'stamp', tenant, [stamp.id], stamp);
}

/** One stamp, by the identifier the document that used it carries. */
export function stampIn(
  session: RecordSession,
  tenant: TenantId,
  id: RateStampId,
): RateStamp | null {
  return readRecord(session, 'stamp', tenant, [id]);
}

/**
 * Every override at a branch on one day, in the order they were made.
 *
 * Ordered by the moment, and ties broken by the identifier: a UUIDv7 sorts by
 * the time it was made, so two overrides stamped inside the same millisecond
 * still read back the same way on every machine rather than in whatever order
 * the store happened to scan.
 */
export function overridesOn(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  day: LocalDate,
): readonly RateOverride[] {
  return scanRecords(session, 'override', tenant, [branch, day]).sort(
    (one, other) => one.at - other.at || (one.id < other.id ? -1 : one.id > other.id ? 1 : 0),
  );
}
