import type { BranchId, DeviceId, RegisterId, TenantId, UserId } from '@vertex/contracts';
import {
  localDateOf,
  newId,
  ok,
  refuse,
  type CurrencyCode,
  type Instant,
  type LocalDate,
  type Result,
} from '@vertex/kernel';

import type {
  LastKnownRate,
  LastKnownRates,
  RateBoard,
  RateInForce,
  RateQuote,
  RateRefusal,
  RateRevision,
  RecordSession,
  SuggestedRate,
  SuggestedRateId,
  TenantCurrency,
} from './contract.js';
import { currenciesIn, currencyIn, fixFunctional, functionalIn } from './currencies.js';
import { settleQuote, type SettledQuote } from './quotes.js';
import { readRecord, scanRecords, writeRecord } from './records.js';

/**
 * A branch's daily rates, the tenant's suggestions, and a register's last-known
 * rates: `FX-04`.
 *
 * Every function takes the session of a transaction already open and checks
 * everything before it writes anything, as the rest of this module does: a
 * refusal is a value, so its transaction still commits.
 *
 * None of them decides what day it is. The caller reads the branch, reads the
 * clock once, and hands both in — so "today" is one answer for the whole
 * command, and a rate is filed under the day the branch was in at the moment
 * it was recorded, never under the store node's.
 */

type Rated<T> = Result<T, RateRefusal>;

/** Who is writing, and the one moment the whole command is stamped with. */
export interface Recording {
  readonly tenant: TenantId;
  readonly actor: UserId | null;
  readonly at: Instant;
}

/** The functional currency, and a currency a rate can be recorded for against it. */
interface Traded {
  readonly functional: TenantCurrency;
  readonly currency: TenantCurrency;
}

/**
 * Whether a rate may be recorded for, or read for, this currency.
 *
 * The functional currency is checked before whether the currency is in use,
 * because it is the more basic answer: the functional currency has no rate at
 * all, and it can never be out of use to begin with.
 */
function traded(session: RecordSession, tenant: TenantId, code: CurrencyCode): Rated<Traded> {
  const functional = functionalIn(session, tenant);
  if (functional === null) return refuse('fx.functional-currency-unset');

  const currency = currencyIn(session, tenant, code);
  if (currency === null) return refuse('fx.currency-not-found', { currency: code });
  if (currency.code === functional.code) {
    return refuse('fx.currency-is-functional', { currency: code });
  }
  if (!currency.enabled) return refuse('fx.currency-disabled', { currency: code });
  return ok({ functional, currency });
}

/** Every currency in use that has a rate: all of them but the functional one, in code order. */
function currenciesWithRates(
  session: RecordSession,
  tenant: TenantId,
  functional: TenantCurrency,
): readonly TenantCurrency[] {
  return currenciesIn(session, tenant).filter((one) => one.enabled && one.code !== functional.code);
}

/** A record the store says exists, or a defect: nothing here deletes one. */
function present<T>(record: T | null, what: string): T {
  if (record === null) {
    throw new Error(`${what} is named by a record that points to it, and is not in the store.`);
  }
  return record;
}

/** The revision in force for a currency at a branch on a day, or null. */
function revisionInForce(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  code: CurrencyCode,
  day: LocalDate,
): RateRevision | null {
  const head = readRecord(session, 'revision-head', tenant, [branch, code, day]);
  if (head === null) return null;
  return present(
    readRecord(session, 'revision', tenant, [branch, code, day, head.revision]),
    `Revision ${head.revision}`,
  );
}

/**
 * Writes the next revision of a day — its first, or a correction of its latest.
 *
 * Fixes the functional currency in the same transaction: this revision is
 * expressed per one unit of it, and it commits only if the revision does.
 *
 * **Every rate this module records is written here**, which is why the rule that
 * a branch's day only ever moves forward is enforced here rather than at each
 * caller: a third way of recording a rate cannot be added without passing
 * through it. It refuses before it writes, so a caller that records several
 * currencies in one transaction — `adoptSuggestions` — leaves nothing behind
 * when it stops at the first.
 */
function writeRevision(
  session: RecordSession,
  recording: Recording,
  branch: BranchId,
  day: LocalDate,
  { functional, currency }: Traded,
  settled: SettledQuote,
  adoptedFrom: SuggestedRateId | null,
): Rated<RateRevision> {
  const { tenant } = recording;
  const latest = readRecord(session, 'latest-day', tenant, [branch]);
  // Days compare as text: a local date is written to sort in date order.
  if (latest !== null && day < latest.day) {
    return refuse('fx.rate-day-behind', { branch, day, latest: latest.day });
  }

  const head = readRecord(session, 'revision-head', tenant, [branch, currency.code, day]);
  const revision: RateRevision = {
    id: newId<'rate-revision'>(),
    tenant,
    branch,
    currency: currency.code,
    functional: functional.code,
    day,
    sequence: (head?.sequence ?? 0) + 1,
    buy: settled.buy,
    sell: settled.sell,
    quoted: settled.quoted,
    supersedes: head?.revision ?? null,
    adoptedFrom,
    recordedBy: recording.actor,
    recordedAt: recording.at,
  };
  writeRecord(session, 'revision', tenant, [branch, currency.code, day, revision.id], revision);
  writeRecord(session, 'revision-head', tenant, [branch, currency.code, day], {
    revision: revision.id,
    sequence: revision.sequence,
  });
  // Only when the day advances. Rewriting it with the same day would make every
  // rate entered on an open day collide with every other, for nothing.
  if (latest === null || day > latest.day) {
    writeRecord(session, 'latest-day', tenant, [branch], { day });
  }
  fixFunctional(session, tenant, recording.at);
  return ok(revision);
}

/** Records a branch's rate for its today: the day's first, or a correction. */
export function recordRate(
  session: RecordSession,
  recording: Recording,
  branch: BranchId,
  day: LocalDate,
  code: CurrencyCode,
  quote: RateQuote,
): Rated<RateRevision> {
  const currency = traded(session, recording.tenant, code);
  if (!currency.ok) return currency;
  const settled = settleQuote(quote);
  if (!settled.ok) return settled;

  return writeRevision(session, recording, branch, day, currency.value, settled.value, null);
}

/** Publishes the tenant's suggested rate for a currency, replacing the last one. */
export function suggestRate(
  session: RecordSession,
  recording: Recording,
  code: CurrencyCode,
  quote: RateQuote,
): Rated<SuggestedRate> {
  const { tenant } = recording;
  const currency = traded(session, tenant, code);
  if (!currency.ok) return currency;
  const settled = settleQuote(quote);
  if (!settled.ok) return settled;

  const head = readRecord(session, 'suggestion-head', tenant, [code]);
  const suggestion: SuggestedRate = {
    id: newId<'suggested-rate'>(),
    tenant,
    currency: code,
    functional: currency.value.functional.code,
    buy: settled.value.buy,
    sell: settled.value.sell,
    quoted: settled.value.quoted,
    supersedes: head?.suggestion ?? null,
    suggestedBy: recording.actor,
    suggestedAt: recording.at,
  };
  writeRecord(session, 'suggestion', tenant, [code, suggestion.id], suggestion);
  writeRecord(session, 'suggestion-head', tenant, [code], { suggestion: suggestion.id });
  fixFunctional(session, tenant, recording.at);
  return ok(suggestion);
}

/**
 * The tenant's latest suggestion for a currency, if it was published on this
 * branch's day — read in the branch's own zone, since the tenant has none.
 */
function suggestionFor(
  session: RecordSession,
  tenant: TenantId,
  code: CurrencyCode,
  day: LocalDate,
  timeZone: string,
): SuggestedRate | null {
  const head = readRecord(session, 'suggestion-head', tenant, [code]);
  if (head === null) return null;
  const suggestion = present(
    readRecord(session, 'suggestion', tenant, [code, head.suggestion]),
    `Suggestion ${head.suggestion}`,
  );
  return localDateOf(suggestion.suggestedAt, timeZone) === day ? suggestion : null;
}

/**
 * Makes the branch's rates today's suggestions, every currency in one action.
 *
 * A suggestion the branch's rate in force was already adopted from is not
 * recorded again, and is still answered — so pressing the button twice, or a
 * replayed command, reads back what the first did and writes nothing.
 *
 * Refused only when there is nothing at all to adopt, and then before anything
 * is written, because nothing was.
 */
export function adoptSuggestions(
  session: RecordSession,
  recording: Recording,
  branch: BranchId,
  day: LocalDate,
  timeZone: string,
): Rated<readonly RateRevision[]> {
  const { tenant } = recording;
  const functional = functionalIn(session, tenant);
  if (functional === null) return refuse('fx.functional-currency-unset');

  const adopted: RateRevision[] = [];
  for (const currency of currenciesWithRates(session, tenant, functional)) {
    const suggestion = suggestionFor(session, tenant, currency.code, day, timeZone);
    if (suggestion === null) continue;

    const inForce = revisionInForce(session, tenant, branch, currency.code, day);
    if (inForce?.adoptedFrom === suggestion.id) {
      adopted.push(inForce);
      continue;
    }
    const written = writeRevision(
      session,
      recording,
      branch,
      day,
      { functional, currency },
      suggestion,
      suggestion.id,
    );
    // Every currency here is being recorded for the same day, so a day that is
    // behind is behind for all of them: stopping at the first is the whole
    // answer, and it has written nothing.
    if (!written.ok) return written;
    adopted.push(written.value);
  }

  if (adopted.length === 0) return refuse('fx.suggested-rate-missing', { branch, day });
  return ok(Object.freeze(adopted));
}

/** Today's board at a branch. */
export function boardOf(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  day: LocalDate,
  timeZone: string,
): Rated<RateBoard> {
  const functional = functionalIn(session, tenant);
  if (functional === null) return refuse('fx.functional-currency-unset');

  const lines = currenciesWithRates(session, tenant, functional).map((currency) => ({
    currency,
    revision: revisionInForce(session, tenant, branch, currency.code, day),
    suggestion: suggestionFor(session, tenant, currency.code, day, timeZone),
  }));
  return ok({ branch, day, functional, lines: Object.freeze(lines) });
}

/**
 * The rate a currency trades at in a branch today, as the caller standing where
 * they are may trade at it.
 *
 * Today's revision whenever there is one. Otherwise a last-known rate — only
 * under a confirmation given at the very machine the caller is standing at, for
 * today. Otherwise `fx.rate-missing`, and never yesterday's rate in silence.
 */
export function rateInForce(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  day: LocalDate,
  code: CurrencyCode,
  device: DeviceId | null,
): Rated<RateInForce> {
  const currency = traded(session, tenant, code);
  if (!currency.ok) return currency;

  const today = revisionInForce(session, tenant, branch, code, day);
  if (today !== null) return ok({ revision: today, lastKnown: null });

  if (device !== null) {
    const confirmed = readRecord(session, 'last-known', tenant, [branch, day, device]);
    const covering = confirmed?.rates.find((one) => one.currency === code);
    if (confirmed !== null && covering !== undefined) {
      const revision = present(
        readRecord(session, 'revision', tenant, [
          branch,
          code,
          covering.rateDay,
          covering.revision,
        ]),
        `Revision ${covering.revision}`,
      );
      return ok({ revision, lastKnown: confirmed });
    }
  }

  return refuse('fx.rate-missing', { branch, currency: code, day });
}

/** Every revision of one day, first to last. */
export function revisionsOn(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  code: CurrencyCode,
  day: LocalDate,
): readonly RateRevision[] {
  return scanRecords(session, 'revision', tenant, [branch, code, day]).sort(
    (one, other) => one.sequence - other.sequence,
  );
}

/**
 * The revision in force at the end of the most recent day before this one that
 * had any: what a register synced last.
 *
 * Days compare as text because a local date is written to sort in date order.
 */
function mostRecentBefore(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  code: CurrencyCode,
  day: LocalDate,
): RateRevision | null {
  let latest: RateRevision | null = null;
  for (const revision of scanRecords(session, 'revision', tenant, [branch, code])) {
    if (revision.day >= day) continue;
    if (
      latest === null ||
      revision.day > latest.day ||
      (revision.day === latest.day && revision.sequence > latest.sequence)
    ) {
      latest = revision;
    }
  }
  return latest;
}

/**
 * Where the confirmation is being given: a register of the branch, and the
 * machine standing at it. Established by the caller, which asks `SYS`.
 */
export interface AtRegister {
  readonly register: RegisterId;
  readonly device: DeviceId;
}

/**
 * Confirms that a register trades today on the most recent rates it holds, for
 * every currency lacking today's.
 *
 * Once per register per day. A confirmation already given is answered as it
 * stands, even if a rate has arrived since: `rateInForce` prefers today's rate
 * whenever there is one, so an old confirmation can never hide a new rate.
 */
export function confirmLastKnownRates(
  session: RecordSession,
  recording: Recording,
  branch: BranchId,
  day: LocalDate,
  { register, device }: AtRegister,
): Rated<LastKnownRates> {
  const { tenant } = recording;
  const given = readRecord(session, 'last-known', tenant, [branch, day, device]);
  if (given !== null) return ok(given);

  const functional = functionalIn(session, tenant);
  if (functional === null) return refuse('fx.functional-currency-unset');

  const lacking = currenciesWithRates(session, tenant, functional).filter(
    (currency) => revisionInForce(session, tenant, branch, currency.code, day) === null,
  );
  if (lacking.length === 0) return refuse('fx.rates-current', { branch, day });

  const rates: LastKnownRate[] = [];
  for (const currency of lacking) {
    const latest = mostRecentBefore(session, tenant, branch, currency.code, day);
    if (latest !== null) {
      rates.push({ currency: currency.code, revision: latest.id, rateDay: latest.day });
    }
  }
  // Nothing was ever synced for any currency missing today's rate: there is no
  // last-known rate to stand in, and a supervisor cannot confirm one into being.
  if (rates.length === 0) return refuse('fx.rate-missing', { branch, day });

  const confirmation: LastKnownRates = {
    id: newId<'last-known-rates'>(),
    tenant,
    branch,
    register,
    device,
    day,
    rates: Object.freeze(rates),
    confirmedBy: recording.actor,
    confirmedAt: recording.at,
  };
  return ok(writeRecord(session, 'last-known', tenant, [branch, day, device], confirmation));
}
