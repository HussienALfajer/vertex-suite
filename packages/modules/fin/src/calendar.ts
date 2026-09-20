import type { TenantId, UserId } from '@vertex/contracts';
import {
  addDays,
  addMonths,
  InvalidDayError,
  localDate,
  localDateFrom,
  newId,
  ok,
  partsOfDay,
  refuse,
  type Instant,
  type LocalDate,
  type Result,
} from '@vertex/kernel';

import { shown, written } from './arriving.js';
import type {
  AccountingPeriod,
  AccountingPeriodId,
  CalendarRefusal,
  FiscalYear,
  FiscalYearId,
  PeriodReopening,
  RecordSession,
  TenantCalendar,
  YearDefinition,
  YearShape,
} from './contract.js';
import { readRecord, scanRecords, writeRecord } from './records.js';

/**
 * The fiscal calendar, and the closing of a period: `FIN-05`.
 *
 * Every function takes the session of a transaction already open and does all
 * of its checking **before** any of its writing, for the reason the chart
 * gives: a refusal is a returned value rather than a thrown one, so the
 * transaction it was refused in still commits, and a command that had written
 * something before refusing would leave it behind.
 *
 * Two properties are kept here and nowhere else, because everything `FIN-05`
 * promises rests on them:
 *
 *   - **The calendar has no gaps and no overlaps.** Every day from the first
 *     year's first period to the last year's last belongs to exactly one
 *     period. A year is only ever appended where the calendar ends and only
 *     the last may be redefined, so contiguity is a property of every write
 *     rather than something a check has to go looking for.
 *   - **A period's days are settled before anything is posted into it.** Once
 *     an entry lands, the shape of its year is fixed; a figure that has moved
 *     to another period since it was reported is a figure nobody can
 *     reconcile.
 */

type Outcome<T> = Result<T, CalendarRefusal>;

/** A definition's fields as they may actually arrive: typed by a person, or read off a wire. */
type Arriving<T> = { readonly [Field in keyof T]: unknown };

/**
 * A definition as it may actually arrive, **including not at all**.
 *
 * Nothing is read as a definition with nothing in it, so that a command which
 * reached this module without its body is refused field by field like any
 * other rather than thrown at. The fields themselves are judged below; this
 * only makes sure there is somewhere to read them from.
 */
function fieldsOf<Definition>(arriving: unknown): Arriving<Definition> {
  return (arriving ?? {}) as Arriving<Definition>;
}

/**
 * The longest fiscal year this accepts, in months.
 *
 * Twelve is the ordinary answer and the seed's. More is allowed because the
 * year a shop moves its year end in is genuinely longer — eighteen months is
 * the usual transition — and a bound of two years is the point past which the
 * figure is a typing mistake rather than a decision.
 */
const MOST_MONTHS = 24;

/** Who is keeping the books, and the one moment this command reads. */
export interface Keeping {
  readonly by: UserId | null;
  readonly at: Instant;
}

/**
 * A year with nothing outside this module can edit, and neither can its
 * periods.
 *
 * Sealed on the way **out** rather than on the way in, which is where it
 * matters: the store hands back a fresh copy of whatever was committed, so a
 * caller given one unsealed could edit a period — its closure, its `posted`
 * mark — and hand it to something that believed it. The same reason
 * `writeRecord` freezes, one level deeper, because a calendar is a record with
 * records inside it.
 */
function sealedPeriod(period: AccountingPeriod): AccountingPeriod {
  return Object.freeze({
    ...period,
    closed: period.closed === null ? null : Object.freeze({ ...period.closed }),
  });
}

function sealed(year: FiscalYear): FiscalYear {
  return Object.freeze({ ...year, periods: Object.freeze(year.periods.map(sealedPeriod)) });
}

function calendarIn(session: RecordSession, tenant: TenantId): TenantCalendar | null {
  return readRecord(session, 'calendar', tenant, []);
}

/**
 * Every year of the tenant, in date order.
 *
 * Sorted on the way out rather than trusted to the order they were written in,
 * as the chart sorts by code: the order is then a property of the days
 * themselves, and a screen reading the calendar twice reads it the same way
 * both times.
 */
function yearsOf(calendar: TenantCalendar | null): readonly FiscalYear[] {
  return [...(calendar?.years ?? [])].sort((one, other) =>
    one.opensOn < other.opensOn ? -1 : one.opensOn > other.opensOn ? 1 : 0,
  );
}

export function yearsIn(session: RecordSession, tenant: TenantId): readonly FiscalYear[] {
  return yearsOf(calendarIn(session, tenant)).map(sealed);
}

function store(
  session: RecordSession,
  tenant: TenantId,
  years: readonly FiscalYear[],
): readonly FiscalYear[] {
  writeRecord(session, 'calendar', tenant, [], { tenant, years });
  return years;
}

/** How many whole months lie between two days, by the calendar and not by their length. */
function monthsBetween(from: LocalDate, to: LocalDate): number {
  const start = partsOfDay(from);
  const end = partsOfDay(to);
  return (end.year - start.year) * 12 + (end.month - start.month);
}

/**
 * A year's periods, each measured from the day the year opens.
 *
 * From the start every time, never a month at a time from the period before:
 * `addMonths` clamps to the end of the month it lands in, so stepping loses a
 * day of every month a clamp touched and the year comes up short. Each period
 * ends the day before the next one begins, which is what makes them meet
 * exactly — including across a clamp, where a period is a day or three shorter
 * than its neighbours and still leaves nothing between them.
 */
function divide(year: FiscalYearId, opensOn: LocalDate, shape: YearShape): AccountingPeriod[] {
  const periods: AccountingPeriod[] = [];
  for (let ordinal = 1; ordinal * shape.monthsPerPeriod <= shape.months; ordinal += 1) {
    periods.push({
      id: newId<'accounting-period'>(),
      year,
      ordinal,
      opensOn: addMonths(opensOn, (ordinal - 1) * shape.monthsPerPeriod),
      closesOn: addDays(addMonths(opensOn, ordinal * shape.monthsPerPeriod), -1),
      closed: null,
      posted: false,
    });
  }
  return periods;
}

function yearFrom(id: FiscalYearId, opensOn: LocalDate, shape: YearShape): FiscalYear {
  // The year ends where its last period does, computed the same way that
  // period's own end is — from the day the year opened, and never by reading
  // it back off the periods, so that the two cannot come to disagree.
  return {
    id,
    opensOn,
    closesOn: addDays(addMonths(opensOn, shape.months), -1),
    periods: divide(id, opensOn, shape),
  };
}

/**
 * A year the calendar can actually write.
 *
 * Day arithmetic raises past the last year a day has a written form, which is
 * right where this module computed the figures and wrong where a person typed
 * them: an opening day so late that a year from it runs off the end of the
 * calendar is a day to refuse, not a command to bring down. `day` is the one
 * the refusal names — what was typed, or the day the calendar already reaches
 * and cannot be extended past.
 */
function defining(day: LocalDate, build: () => FiscalYear): Outcome<FiscalYear> {
  try {
    return ok(build());
  } catch (cause) {
    if (cause instanceof InvalidDayError) return refuse('fin.day-invalid', { day });
    throw cause;
  }
}

/**
 * The shape a year already has, which is the shape the next one takes unless
 * the accountant says otherwise.
 *
 * Derived rather than stored, because it is exactly what `divide` was given:
 * storing it would be a second copy of the periods' own spans, free to
 * disagree with them after a redefinition.
 */
function shapeOf(year: FiscalYear): YearShape {
  const months = monthsBetween(year.opensOn, addDays(year.closesOn, 1));
  return { months, monthsPerPeriod: months / year.periods.length };
}

function shapeArriving(shape: unknown): Outcome<YearShape> {
  const { months, monthsPerPeriod } = fieldsOf<YearShape>(shape);
  // One refusal, always carrying both figures: a message that names the bound
  // it was given cannot be written against values that sometimes hold it.
  if (
    typeof months !== 'number' ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > MOST_MONTHS
  ) {
    return refuse('fin.fiscal-year-months-invalid', { months: shown(months), most: MOST_MONTHS });
  }
  // Dividing the year exactly is the whole of the rule, and it is also what
  // rules out a period longer than the year: a remainder of `months` is not
  // zero. A second check for that would be a condition no input can reach.
  if (
    typeof monthsPerPeriod !== 'number' ||
    !Number.isInteger(monthsPerPeriod) ||
    monthsPerPeriod < 1 ||
    months % monthsPerPeriod !== 0
  ) {
    return refuse('fin.months-per-period-invalid', {
      monthsPerPeriod: shown(monthsPerPeriod),
      months,
    });
  }
  return ok({ months, monthsPerPeriod });
}

/**
 * A day as it may actually arrive: the brand is gone at run time, and a day
 * reaches this module from a screen, off a wire and out of `SYN-02`'s replay.
 */
function dayArriving(day: unknown): Outcome<LocalDate> {
  const read = localDate(day as string);
  return read === null ? refuse('fin.day-invalid', { day: shown(day) }) : ok(read);
}

/**
 * Installs the tenant's first fiscal year, unless it has one
 * (`FiscalCalendarAdministration.seed`).
 *
 * `today` is the caller's, because whose day it is belongs to the branch and
 * not to this file. Writes nothing at all for a tenant already keeping a
 * calendar: a replayed seed that rewrote the same record would conflict with
 * every command reading it at that moment, for no change.
 */
export function seedCalendar(
  session: RecordSession,
  tenant: TenantId,
  today: LocalDate,
): readonly FiscalYear[] {
  const existing = yearsOf(calendarIn(session, tenant));
  if (existing.length > 0) return existing.map(sealed);

  const opensOn = localDateFrom(partsOfDay(today).year, 1, 1);
  const year = yearFrom(newId<'fiscal-year'>(), opensOn, { months: 12, monthsPerPeriod: 1 });
  return store(session, tenant, [year]).map(sealed);
}

export function appendYear(
  session: RecordSession,
  tenant: TenantId,
  shape?: YearShape,
): Outcome<FiscalYear> {
  const years = yearsOf(calendarIn(session, tenant));
  const last = years[years.length - 1];
  if (last === undefined) return refuse('fin.calendar-unseeded');

  // The shape the last year has is judged exactly like one somebody typed. It
  // was read back out of a store, and a store is outside this module: a
  // calendar written by an older version of this code, or damaged, would
  // otherwise be the one input nothing here looks at twice.
  const shaped = shapeArriving(shape ?? shapeOf(last));
  if (!shaped.ok) return shaped;

  // The day after the calendar currently reaches, and no other: that is the
  // whole of "appended without gaps", and it is why the caller never states it.
  const year = defining(last.closesOn, () =>
    yearFrom(newId<'fiscal-year'>(), addDays(last.closesOn, 1), shaped.value),
  );
  if (!year.ok) return year;
  store(session, tenant, [...years, year.value]);
  return ok(sealed(year.value));
}

export function redefineYear(
  session: RecordSession,
  tenant: TenantId,
  id: FiscalYearId,
  definition: YearDefinition,
): Outcome<FiscalYear> {
  const { opensOn } = fieldsOf<YearDefinition>(definition);
  const shaped = shapeArriving(definition);
  if (!shaped.ok) return shaped;
  const day = dayArriving(opensOn);
  if (!day.ok) return day;

  const years = yearsOf(calendarIn(session, tenant));
  const at = years.findIndex((one) => one.id === id);
  const year = years[at];
  const last = years[years.length - 1];
  // A calendar with no last year has no years at all, and so has not this one.
  if (year === undefined || last === undefined) {
    return refuse('fin.fiscal-year-not-found', { year: id });
  }

  if (last.id !== id) {
    // Redefining an earlier year would move every year after it, and those
    // are years the shop has already traded in.
    return refuse('fin.fiscal-year-not-last', { year: id, last: last.id });
  }
  // Closed before posted: a closed period is a decision somebody took, and
  // redefining the year would undo it without asking for the right that
  // reopening one asks for.
  const shut = year.periods.find((one) => one.closed !== null);
  if (shut !== undefined) return refuse('fin.period-closed', { period: shut.id });
  const used = year.periods.find((one) => one.posted);
  if (used !== undefined) return refuse('fin.fiscal-year-posted', { year: id, period: used.id });

  const previous = years[at - 1];
  if (previous !== undefined) {
    const follows = addDays(previous.closesOn, 1);
    if (day.value !== follows) {
      return refuse('fin.fiscal-year-gap', { year: id, opensOn: day.value, follows });
    }
  }

  // The year keeps its identity and its periods are new: a period is a span,
  // and these are different spans. Nothing refers to the old ones — a period
  // that had been posted into or closed would have refused above.
  const redefined = defining(day.value, () => yearFrom(id, day.value, shaped.value));
  if (!redefined.ok) return redefined;
  store(
    session,
    tenant,
    years.map((one) => (one.id === id ? redefined.value : one)),
  );
  return ok(sealed(redefined.value));
}

/** A period, the year holding it, and where that year sits in the calendar. */
interface Located {
  readonly years: readonly FiscalYear[];
  readonly year: FiscalYear;
  readonly period: AccountingPeriod;
}

function locate(session: RecordSession, tenant: TenantId, id: AccountingPeriodId): Located | null {
  const years = yearsOf(calendarIn(session, tenant));
  for (const year of years) {
    const period = year.periods.find((one) => one.id === id);
    if (period !== undefined) return { years, year, period };
  }
  return null;
}

/** The calendar as it is, with one period replaced by a revision of itself. */
function withPeriod(located: Located, period: AccountingPeriod): readonly FiscalYear[] {
  return located.years.map((year) =>
    year.id === located.year.id
      ? {
          ...year,
          periods: year.periods.map((one) => (one.id === period.id ? period : one)),
        }
      : year,
  );
}

export function closePeriod(
  session: RecordSession,
  tenant: TenantId,
  id: AccountingPeriodId,
  keeping: Keeping,
): Outcome<AccountingPeriod> {
  const located = locate(session, tenant, id);
  if (located === null) return refuse('fin.period-not-found', { period: id });
  // Already closed is answered as done, and writes nothing: a button pressed
  // twice, or a command `SYN-02` replays, must not fail — and must not restamp
  // the closure with a second author and a later moment.
  if (located.period.closed !== null) return ok(sealedPeriod(located.period));

  const closed: AccountingPeriod = {
    ...located.period,
    closed: { by: keeping.by, at: keeping.at },
  };
  store(session, tenant, withPeriod(located, closed));
  return ok(sealedPeriod(closed));
}

export function reopenPeriod(
  session: RecordSession,
  tenant: TenantId,
  id: AccountingPeriodId,
  reason: string,
  keeping: Keeping,
): Outcome<AccountingPeriod> {
  const located = locate(session, tenant, id);
  if (located === null) return refuse('fin.period-not-found', { period: id });
  const undone = located.period.closed;
  // Open already: answered as done, and nothing is logged. A reason is asked
  // for only where there is something to give one for — a replayed command
  // must not turn into a second entry in a log people read as a list of acts.
  if (undone === null) return ok(sealedPeriod(located.period));

  const why = written(reason);
  if (why === null) return refuse('fin.reopen-reason-required', { period: id });

  const reopened: AccountingPeriod = { ...located.period, closed: null };
  store(session, tenant, withPeriod(located, reopened));
  const entry: PeriodReopening = {
    id: newId<'period-reopening'>(),
    tenant,
    year: located.year.id,
    // The period the calendar actually holds, never the identifier that was
    // asked for: the two agree here, and writing the found record's own is how
    // they go on agreeing.
    period: located.period.id,
    undone: Object.freeze({ ...undone }),
    reason: why,
    by: keeping.by,
    at: keeping.at,
  };
  writeRecord(session, 'reopening', tenant, [id, entry.id], entry);
  return ok(sealedPeriod(reopened));
}

export function reopeningsIn(
  session: RecordSession,
  tenant: TenantId,
  period?: AccountingPeriodId,
): readonly PeriodReopening[] {
  return scanRecords(session, 'reopening', tenant)
    .filter((one) => period === undefined || one.period === period)
    .sort((one, other) => one.at - other.at || (one.id < other.id ? -1 : 1))
    .map((one) => Object.freeze({ ...one, undone: Object.freeze({ ...one.undone }) }));
}

/**
 * The open period an entry dated on `day` belongs in, or why there is none
 * (`FiscalCalendar.postingPeriodOn`).
 *
 * The four answers are kept apart because they are acted on differently: a day
 * that is not a day is a defect upstream, a calendar that was never installed
 * is a shop not yet set up, a day outside the years is a calendar somebody has
 * to extend, and a closed period is the one `FIN-05` routes to a decision.
 */
export function postingPeriodOn(
  session: RecordSession,
  tenant: TenantId,
  day: LocalDate,
): Outcome<AccountingPeriod> {
  const dated = dayArriving(day);
  if (!dated.ok) return dated;
  const on = dated.value;

  const years = yearsOf(calendarIn(session, tenant));
  if (years.length === 0) return refuse('fin.calendar-unseeded', { day: on });

  const period = years
    .find((year) => year.opensOn <= on && on <= year.closesOn)
    ?.periods.find((one) => one.opensOn <= on && on <= one.closesOn);
  if (period === undefined) return refuse('fin.day-outside-calendar', { day: on });
  if (period.closed !== null) return refuse('fin.period-closed', { day: on, period: period.id });
  return ok(sealedPeriod(period));
}

/**
 * The same question, answered inside the transaction that is about to post, and
 * recording that the period has now been posted into.
 *
 * The seam the posting engine of `FIN-02` calls, and the whole of what `FIN-05`
 * asks of it: one call, inside the caller's transaction, that both decides
 * whether the entry may be written and marks the period so that its year can no
 * longer be reshaped underneath it. The mark is written once per period and
 * never again, so the second entry of a month costs the calendar nothing.
 */
export function admitPosting(
  session: RecordSession,
  tenant: TenantId,
  day: LocalDate,
): Outcome<AccountingPeriod> {
  const allowed = postingPeriodOn(session, tenant, day);
  if (!allowed.ok || allowed.value.posted) return allowed;

  const located = locate(session, tenant, allowed.value.id);
  // Located a moment ago by the same read: absent here is a store that changed
  // under an open transaction, which is not something to paper over.
  if (located === null) {
    throw new Error(`The period ${allowed.value.id} left the calendar of tenant ${tenant}.`);
  }
  const posted: AccountingPeriod = { ...located.period, posted: true };
  store(session, tenant, withPeriod(located, posted));
  return ok(sealedPeriod(posted));
}

/**
 * Whether a year is open or closed (`FIN-05`), which is whether any period in
 * it still is.
 *
 * Derived and never stored: a year with a state of its own could say it was
 * closed while a period inside it took postings, and there is no reading of
 * `FIN-05` under which both are true.
 */
export function yearState(year: FiscalYear): 'open' | 'closed' {
  return year.periods.every((one) => one.closed !== null) ? 'closed' : 'open';
}
