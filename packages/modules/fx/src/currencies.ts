import type { TenantId } from '@vertex/contracts';
import {
  Dec,
  flawOf,
  ok,
  refuse,
  type CurrencyCode,
  type CurrencyFlaw,
  type Err,
  type Instant,
  type Result,
} from '@vertex/kernel';

import type {
  CurrencyRefusal,
  CurrencyRevision,
  NewCurrency,
  RecordSession,
  TenantCurrency,
} from './contract.js';
import { readRecord, scanRecords, writeRecord } from './records.js';
import { SEEDED_CURRENCIES, SEEDED_FUNCTIONAL } from './seeds.js';

/**
 * A tenant's currencies and the one its books are kept in: `FX-01` and `FX-02`.
 *
 * Every function takes the session of a transaction already open and does all
 * of its checking **before** any of its writing. That order is not a style. A
 * refusal is a returned value rather than a thrown one, so the transaction it
 * was refused in still commits — and a command that had written something
 * before refusing would leave it behind.
 */

type Outcome<T> = Result<T, CurrencyRefusal>;

/** A definition's fields as they may actually arrive: typed by a person, or read off a wire. */
type Arriving = { readonly [Field in keyof NewCurrency]: unknown };

/**
 * ISO 4217's form: three capital Latin letters.
 *
 * Neither trimmed nor upper-cased on the way in. A code is the key every amount
 * in the system names its currency by, and the kernel compares it exactly: a
 * `syp` quietly accepted here would be a currency whose amounts `SYP` refuses to
 * be added to. One spelling, refused in any other, is the only arrangement that
 * cannot drift — the screen that takes the typing is where casing is fixed.
 *
 * Deliberately not checked against `Intl.supportedValuesOf('currency')`. That
 * list is the runtime's own ICU data, and the store node, a register's Electron
 * and a browser need not carry the same version of it: a code accepted in one
 * place and refused in another is a sync failure waiting for the day somebody
 * uses it.
 */
const ISO_4217 = /^[A-Z]{3}$/;

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && ISO_4217.test(value);
}

/**
 * Codes are ASCII, so they are ordered by code unit and never by a locale: the
 * same list must come back in the same order on every machine in the shop.
 */
function byCode(one: TenantCurrency, other: TenantCurrency): number {
  return one.code < other.code ? -1 : one.code > other.code ? 1 : 0;
}

export function currencyIn(
  session: RecordSession,
  tenant: TenantId,
  code: CurrencyCode,
): TenantCurrency | null {
  return readRecord(session, 'currency', tenant, [code]);
}

export function currenciesIn(session: RecordSession, tenant: TenantId): readonly TenantCurrency[] {
  return scanRecords(session, 'currency', tenant).sort(byCode);
}

function functionalCodeIn(session: RecordSession, tenant: TenantId): CurrencyCode | null {
  return readRecord(session, 'functional', tenant, [])?.currency ?? null;
}

export function functionalIn(session: RecordSession, tenant: TenantId): TenantCurrency | null {
  const code = functionalCodeIn(session, tenant);
  if (code === null) return null;

  const currency = currencyIn(session, tenant, code);
  // Thrown, not answered with null. Nothing here deletes a currency and nothing
  // chooses one that does not exist, so a choice naming a missing currency is a
  // store that has been damaged — and null would report it as a tenant that has
  // simply not been set up, which every caller handles by carrying on.
  if (currency === null) {
    throw new Error(
      `The functional currency of tenant ${tenant} is ${code}, and the tenant has no such currency.`,
    );
  }
  return currency;
}

/**
 * What the kernel found wrong with a definition, as the refusal that names the
 * field.
 *
 * The values are strings because they are what somebody typed, echoed back:
 * a precision that arrived as `"2"` is exactly the thing to show them. The
 * definition is read as unknown for the same reason — the flaw being named is
 * often that a field is not what its type claims.
 */
function refusalFor(flaw: CurrencyFlaw, definition: NewCurrency): Err<CurrencyRefusal> {
  const arriving = definition as Arriving;
  const code = String(arriving.code);
  switch (flaw) {
    case 'code-empty':
      return refuse('fx.currency-code-invalid', { code });
    case 'symbol-empty':
      return refuse('fx.currency-symbol-required', { code });
    case 'decimals-out-of-range':
      return refuse('fx.currency-decimals-invalid', {
        code,
        decimals: String(arriving.decimals),
      });
    case 'increment-not-decimal':
    case 'increment-not-positive':
      return refuse('fx.currency-increment-invalid', {
        code,
        increment: String(arriving.roundingIncrement),
      });
    case 'increment-finer-than-decimals':
      return refuse('fx.currency-increment-too-fine', {
        code,
        increment: String(arriving.roundingIncrement),
        decimals: String(arriving.decimals),
      });
    case 'rounding-mode-unknown':
      return refuse('fx.currency-rounding-mode-unknown', {
        code,
        mode: String(arriving.roundingMode),
      });
  }
}

/**
 * A definition as it will be stored, or the refusal that stops the write.
 *
 * The one way a currency record is made, whether an owner typed it or the seed
 * shipped it, so the two cannot come to be stored differently.
 *
 * The increment is stored in one spelling. `0.050`, `.05` and `0.05` are one
 * step, and a record that kept whichever was typed would show an owner three
 * different rules that are the same rule — and compare unequal to itself the
 * moment one of them was revised to another.
 */
function settled(
  tenant: TenantId,
  definition: NewCurrency,
  enabled: boolean,
): Outcome<TenantCurrency> {
  const { code } = definition as Arriving;
  if (!isCurrencyCode(code)) return refuse('fx.currency-code-invalid', { code: String(code) });

  // Everything else is the kernel's judgement, so that what this module stores
  // and what the kernel will round with can never disagree about what a
  // currency is.
  const flaw = flawOf(definition);
  if (flaw !== null) return refusalFor(flaw, definition);

  return ok({
    tenant,
    code,
    symbol: definition.symbol.trim(),
    decimals: definition.decimals,
    roundingIncrement: new Dec(definition.roundingIncrement).toFixed(),
    roundingMode: definition.roundingMode,
    enabled,
  });
}

export function defineTenantCurrency(
  session: RecordSession,
  tenant: TenantId,
  definition: NewCurrency,
): Outcome<TenantCurrency> {
  const currency = settled(tenant, definition, true);
  if (!currency.ok) return currency;

  const { code } = currency.value;
  if (currencyIn(session, tenant, code) !== null) return refuse('fx.currency-exists', { code });

  return ok(writeRecord(session, 'currency', tenant, [code], currency.value));
}

export function reviseCurrency(
  session: RecordSession,
  tenant: TenantId,
  code: CurrencyCode,
  changes: CurrencyRevision,
): Outcome<TenantCurrency> {
  const current = currencyIn(session, tenant, code);
  if (current === null) return refuse('fx.currency-not-found', { code });

  // Before the definition as a whole is judged, because it is the more basic
  // answer: lowering the precision of a currency in use is not allowed at all,
  // and a refusal about the increment it no longer fits would send the owner to
  // fix the wrong field.
  if (typeof changes.decimals === 'number' && changes.decimals < current.decimals) {
    return refuse('fx.currency-decimals-reduced', {
      code,
      from: current.decimals,
      to: String(changes.decimals),
    });
  }

  // Field by field, and absent is "leave it": an owner revising the symbol has
  // said nothing about how the currency rounds.
  const revised = settled(
    tenant,
    {
      code: current.code,
      symbol: changes.symbol ?? current.symbol,
      decimals: changes.decimals ?? current.decimals,
      roundingIncrement: changes.roundingIncrement ?? current.roundingIncrement,
      roundingMode: changes.roundingMode ?? current.roundingMode,
    },
    current.enabled,
  );
  if (!revised.ok) return revised;

  return ok(writeRecord(session, 'currency', tenant, [code], revised.value));
}

/**
 * Takes a currency out of use or puts it back.
 *
 * Asking for the state it is already in is answered as done and writes nothing:
 * a button pressed twice, or a command `SYN-02` replays, must not fail.
 *
 * The functional currency is read inside this transaction rather than trusted
 * from anywhere outside it. Taking a currency out of use while another command
 * makes it functional is the one pair of commands that could leave the books in
 * a currency nobody takes — and it is refused by the store at commit only
 * because each of the two read what the other writes.
 */
export function setCurrencyEnabled(
  session: RecordSession,
  tenant: TenantId,
  code: CurrencyCode,
  enabled: boolean,
): Outcome<TenantCurrency> {
  const current = currencyIn(session, tenant, code);
  if (current === null) return refuse('fx.currency-not-found', { code });

  if (!enabled && functionalCodeIn(session, tenant) === code) {
    return refuse('fx.currency-is-functional', { code });
  }
  if (current.enabled === enabled) return ok(current);

  return ok(writeRecord(session, 'currency', tenant, [code], { ...current, enabled }));
}

/** Chooses the functional currency. Choosing the one already chosen writes nothing. */
export function makeFunctional(
  session: RecordSession,
  tenant: TenantId,
  code: CurrencyCode,
): Outcome<TenantCurrency> {
  const currency = currencyIn(session, tenant, code);
  if (currency === null) return refuse('fx.currency-not-found', { code });
  if (!currency.enabled) return refuse('fx.currency-disabled', { code });

  const chosen = readRecord(session, 'functional', tenant, []);
  if (chosen?.currency === code) return ok(currency);
  if (chosen !== null && chosen.fixedAt !== null) {
    return refuse('fx.functional-currency-in-use', { code, functional: chosen.currency });
  }

  writeRecord(session, 'functional', tenant, [], { tenant, currency: code, fixedAt: null });
  return ok(currency);
}

/**
 * Fixes the functional currency, the first time a figure is written against it.
 *
 * Called in the transaction that writes the figure, so the two commit together
 * or not at all: a rate that rolled back leaves the choice as free as it was.
 */
export function fixFunctional(session: RecordSession, tenant: TenantId, at: Instant): void {
  const chosen = readRecord(session, 'functional', tenant, []);
  // The caller has already read the functional currency to express its figure
  // in, so there is always one here; a store without it has been damaged.
  if (chosen === null) {
    throw new Error(`Tenant ${tenant} has no functional currency to fix.`);
  }
  if (chosen.fixedAt === null) {
    writeRecord(session, 'functional', tenant, [], { ...chosen, fixedAt: at });
  }
}

/**
 * What seeding did: the tenant's currencies afterwards, and the ones this run
 * installed.
 *
 * The second list is what the module announces (`CurrencyDefined`), and it is
 * kept apart from the first so that a replayed seed — the interrupted first-run
 * installation `SYN-02` runs again — announces nothing, rather than telling the
 * ledger four times over about currencies it already has accounts for.
 */
export interface Seeded {
  readonly currencies: readonly TenantCurrency[];
  readonly added: readonly TenantCurrency[];
}

/**
 * Installs the seeded currencies and the default functional currency, adding
 * only what is missing (see `CurrencyAdministration.seed`).
 *
 * One refusal is possible, and it is checked before anything is written. A
 * tenant that defined the dollar and took it out of use before being seeded has
 * no functional currency, and the default is one it does not take. Making it
 * functional anyway would break the rule `makeFunctional` keeps; putting it back
 * into use would overrule an owner's decision. So seeding stops and says so, and
 * the owner either puts the dollar back or chooses another currency first.
 */
export function seedCurrencies(session: RecordSession, tenant: TenantId): Outcome<Seeded> {
  const chosen = functionalCodeIn(session, tenant);
  if (chosen === null && currencyIn(session, tenant, SEEDED_FUNCTIONAL)?.enabled === false) {
    return refuse('fx.currency-disabled', { code: SEEDED_FUNCTIONAL });
  }

  const added: TenantCurrency[] = [];
  for (const definition of SEEDED_CURRENCIES) {
    if (currencyIn(session, tenant, definition.code) !== null) continue;
    const currency = settled(tenant, definition, true);
    // The seeds are defined through the kernel when this module loads, so a seed
    // this module refuses means the two have come to disagree about what a
    // currency is. That is a defect in the product, identical in every shop.
    if (!currency.ok) {
      throw new Error(
        `The seeded currency ${definition.code} is refused as ${currency.error.code}.`,
      );
    }
    added.push(writeRecord(session, 'currency', tenant, [definition.code], currency.value));
  }

  if (chosen === null) {
    writeRecord(session, 'functional', tenant, [], {
      tenant,
      currency: SEEDED_FUNCTIONAL,
      fixedAt: null,
    });
  }
  // In code order, as the list is, so the ledger hears them in the order it lists them.
  return ok({ currencies: currenciesIn(session, tenant), added: added.sort(byCode) });
}
