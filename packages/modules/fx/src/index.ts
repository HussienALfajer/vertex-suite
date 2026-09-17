import type { BranchId, PermissionId } from '@vertex/contracts';
import {
  localDateOf,
  ok,
  refuse,
  type CurrencyCode,
  type Instant,
  type LocalDate,
  type Result,
} from '@vertex/kernel';
import {
  defineModule,
  provideContract,
  type AuthorisationScope,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';
import { Organisation, type Branch } from '@vertex/sys/contract';

import {
  Currencies,
  CurrencyAdministration,
  ExchangeRates,
  FX_PERMISSION_SEEDS,
  FX_PERMISSIONS,
  RateAdministration,
  RateStamps,
  type CurrencyRefusal,
  type CurrencyRevision,
  type Listing,
  type NewCurrency,
  type PreparedStamp,
  type RateQuote,
  type RateRefusal,
  type RateStampId,
  type RecordSession,
  type Stamping,
  type TenantCurrency,
} from './contract.js';
import {
  currenciesIn,
  currencyIn,
  defineTenantCurrency,
  functionalIn,
  makeFunctional,
  reviseCurrency,
  seedCurrencies,
  setCurrencyEnabled,
} from './currencies.js';
import {
  adoptSuggestions,
  boardOf,
  confirmLastKnownRates,
  rateInForce,
  recordRate,
  revisionsOn,
  suggestRate,
  type Recording,
} from './rates.js';
import { overridesOn, prepareStamp, stampIn, writeStamp } from './stamps.js';

export * from './contract.js';

/**
 * Every right this module defines, built from the same grammar the ids were, so
 * that `SEC-01` seeds and `SEC-02` grants them without retyping a string.
 */
function permissions(): readonly PermissionDeclaration[] {
  // `sensitive` travels with the rest, as it does in `SEC`: the role editor
  // marks it, and `SEC-05`'s re-authorisation will key on it.
  return FX_PERMISSION_SEEDS.map(({ id, seededFor, sensitive }) => ({
    id,
    labelKey: `permission.${id}`,
    seededFor,
    ...(sensitive === undefined ? {} : { sensitive }),
  }));
}

/** A branch, and the one moment a command reads the clock — with the day it makes there. */
interface BranchToday {
  readonly branch: Branch;
  readonly at: Instant;
  readonly day: LocalDate;
}

function visible(
  currencies: readonly TenantCurrency[],
  listing: Listing | undefined,
): readonly TenantCurrency[] {
  return listing?.including === 'all' ? currencies : currencies.filter((one) => one.enabled);
}

/**
 * `FX`, as an edition hosts it.
 *
 * A factory for the reason `SYS` is one: the session type belongs to the host,
 * and a store node and a register run this same module over different stores.
 *
 * It depends on `SYS`, as `modules.md` §3 says, and asks it two things only: a
 * branch — whether it exists, whether it trades, and the zone its day is counted
 * in — and the registers of a branch, to know that a confirmation is being given
 * at one. Both through `SYS`'s contract, and both before this module's own
 * transaction opens, which is the arrangement `SEC` uses for the same reason:
 * one command never holds two transactions open at once.
 *
 * `RateStamps` is the one contract here that writes into somebody else's
 * transaction rather than its own, and it is split in two so that it can: see
 * the contract for why a document and the rate it was priced at cannot be
 * allowed to commit separately.
 *
 * No migrations and no events, as in `SYS` and `SEC`: there is no schema until a
 * driver exists and a placeholder migration would burn the name the real one
 * wants, and nothing yet listens for a currency changing.
 */
export function fxModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'FX',
    labelKey: 'module.fx',
    dependsOn: ['SYS'],
    permissions: permissions(),
    provides: [
      provideContract(Currencies, (context: ModuleContext<Session>) => {
        // Unguarded: see `Currencies` in the contract for where a person's
        // sight is decided.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          currencies: (by: CommandContext, listing?: Listing) =>
            read(by, (session) => visible(currenciesIn(session, by.tenant), listing)),
          currency: (by: CommandContext, code: CurrencyCode) =>
            read(by, (session) => currencyIn(session, by.tenant, code)),
          functional: (by: CommandContext) =>
            read(by, (session) => functionalIn(session, by.tenant)),
        } satisfies Currencies;
      }),

      provideContract(CurrencyAdministration, (context: ModuleContext<Session>) => {
        /**
         * Ask, then act — the arrangement `SYS` uses, for its reasons.
         *
         * The question is asked before the transaction opens, so a refusal
         * costs no transaction and the answer never holds a second connection
         * open while this one waits. A denial is a refusal naming the right, so
         * that a screen can say which one is missing.
         *
         * Always at the tenant-wide place: a currency's rules hold in every
         * branch of the group at once, so there is no branch to be judged at.
         */
        const guarded = async <T>(
          by: CommandContext,
          right: PermissionId,
          work: (session: Session) => Result<T, CurrencyRefusal>,
        ): Promise<Result<T, CurrencyRefusal>> => {
          if (!(await context.authorise(by, right))) {
            return refuse('fx.not-permitted', { right });
          }
          return context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));
        };

        const { currency, functionalCurrency } = FX_PERMISSIONS;

        return {
          seed: (by: CommandContext) =>
            guarded(by, currency.create, (session) => seedCurrencies(session, by.tenant)),
          define: (by: CommandContext, input: NewCurrency) =>
            guarded(by, currency.create, (session) =>
              defineTenantCurrency(session, by.tenant, input),
            ),
          revise: (by: CommandContext, code: CurrencyCode, changes: CurrencyRevision) =>
            guarded(by, currency.edit, (session) =>
              reviseCurrency(session, by.tenant, code, changes),
            ),
          disable: (by: CommandContext, code: CurrencyCode) =>
            guarded(by, currency.withdraw, (session) =>
              setCurrencyEnabled(session, by.tenant, code, false),
            ),
          enable: (by: CommandContext, code: CurrencyCode) =>
            guarded(by, currency.withdraw, (session) =>
              setCurrencyEnabled(session, by.tenant, code, true),
            ),
          makeFunctional: (by: CommandContext, code: CurrencyCode) =>
            guarded(by, functionalCurrency.edit, (session) =>
              makeFunctional(session, by.tenant, code),
            ),
        } satisfies CurrencyAdministration;
      }),

      provideContract(ExchangeRates, (context: ModuleContext<Session>) => {
        const today = branchToday(context);
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          // Read for a withdrawn branch as for any other: its board and its
          // rates are history, and history stays readable (`SYS-09`).
          board: async (by: CommandContext, id: BranchId) => {
            const here = await today(by, id, 'reading');
            if (!here.ok) return here;
            const { branch, day } = here.value;
            return read(by, (session) => boardOf(session, by.tenant, id, day, branch.timeZone));
          },
          current: async (by: CommandContext, id: BranchId, code: CurrencyCode) => {
            const here = await today(by, id, 'reading');
            if (!here.ok) return here;
            const { day } = here.value;
            return read(by, (session) => rateInForce(session, by.tenant, id, day, code, by.device));
          },
          revisions: (by: CommandContext, id: BranchId, code: CurrencyCode, day: LocalDate) =>
            read(by, (session) => revisionsOn(session, by.tenant, id, code, day)),
        } satisfies ExchangeRates;
      }),

      provideContract(RateStamps, (context: ModuleContext<Session>) => {
        const today = branchToday(context);
        const { rate } = FX_PERMISSIONS;

        // Unguarded but for the override, as the rest of this module's reads
        // are: a cashier stamps the rate of every sale they ring up, and
        // whether they may open the rates screen has nothing to do with it.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          prepare: async (by: CommandContext, stamping: Stamping) => {
            // Asked first and asked only when there is one, before `SYS` is
            // asked whether the branch exists: somebody refused an override
            // learns nothing about branches they could not have stamped in.
            if (
              stamping.override !== undefined &&
              !(await context.authorise(by, rate.override, { branch: stamping.branch }))
            ) {
              return refuse('fx.not-permitted', { right: rate.override });
            }

            // Trading, not reading: a withdrawn branch issues no documents, so
            // there is nothing for it to stamp.
            const here = await today(by, stamping.branch, 'trading');
            if (!here.ok) return here;
            const { at, day } = here.value;

            return read(by, (session) => {
              const inForce = rateInForce(
                session,
                by.tenant,
                stamping.branch,
                day,
                stamping.currency,
                by.device,
              );
              // Including `fx.rate-missing`, and including it when an override
              // was typed: an override replaces the rate that would have
              // applied, and `FX-04` blocks the operation where none would.
              if (!inForce.ok) return inForce;

              return prepareStamp(
                { tenant: by.tenant, actor: by.actor, at },
                { branch: stamping.branch, day, inForce: inForce.value },
                stamping,
              );
            });
          },

          stamp: (by: CommandContext, session: RecordSession, prepared: PreparedStamp) =>
            writeStamp(session, by.tenant, prepared),

          stamped: (by: CommandContext, id: RateStampId) =>
            read(by, (session) => stampIn(session, by.tenant, id)),

          overrides: (by: CommandContext, id: BranchId, day: LocalDate) =>
            read(by, (session) => overridesOn(session, by.tenant, id, day)),
        } satisfies RateStamps;
      }),

      provideContract(RateAdministration, (context: ModuleContext<Session>) => {
        const today = branchToday(context);
        const { rate, suggestedRate, lastKnownRate } = FX_PERMISSIONS;

        /**
         * Ask, then look, then act.
         *
         * The right is asked first, before `SYS` is asked whether the branch
         * exists: somebody refused learns nothing about branches they could not
         * have acted on, and a refusal costs no read at all.
         */
        const guarded = async <T>(
          by: CommandContext,
          right: PermissionId,
          where: AuthorisationScope | undefined,
          work: () => Promise<Result<T, RateRefusal>>,
        ): Promise<Result<T, RateRefusal>> => {
          if (!(await context.authorise(by, right, where))) {
            return refuse('fx.not-permitted', { right });
          }
          return work();
        };

        const run = <T>(
          by: CommandContext,
          work: (session: Session) => Result<T, RateRefusal>,
        ): Promise<Result<T, RateRefusal>> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        const recording = (by: CommandContext, at: Instant): Recording => ({
          tenant: by.tenant,
          actor: by.actor,
          at,
        });

        return {
          record: (by: CommandContext, id: BranchId, code: CurrencyCode, quote: RateQuote) =>
            guarded(by, rate.record, { branch: id }, async () => {
              const here = await today(by, id, 'trading');
              if (!here.ok) return here;
              const { at, day } = here.value;
              return run(by, (session) =>
                recordRate(session, recording(by, at), id, day, code, quote),
              );
            }),

          suggest: (by: CommandContext, code: CurrencyCode, quote: RateQuote) =>
            guarded(by, suggestedRate.suggest, undefined, () =>
              run(by, (session) =>
                suggestRate(session, recording(by, context.clock.now()), code, quote),
              ),
            ),

          adopt: (by: CommandContext, id: BranchId) =>
            guarded(by, rate.record, { branch: id }, async () => {
              const here = await today(by, id, 'trading');
              if (!here.ok) return here;
              const { branch, at, day } = here.value;
              return run(by, (session) =>
                adoptSuggestions(session, recording(by, at), id, day, branch.timeZone),
              );
            }),

          confirmLastKnown: (by: CommandContext, id: BranchId) =>
            guarded(by, lastKnownRate.confirm, { branch: id }, async () => {
              const here = await today(by, id, 'trading');
              if (!here.ok) return here;
              const { at, day } = here.value;

              // Standing at a register of this branch: a machine the shop has
              // assigned to one of its tills, and that till still in use.
              const device = by.device;
              const standingAt =
                device === null
                  ? undefined
                  : (await context.require(Organisation).registers(by, id)).find(
                      (one) => one.heldBy === device,
                    );
              if (device === null || standingAt === undefined) {
                return refuse('fx.not-at-register', { branch: id });
              }

              return run(by, (session) =>
                confirmLastKnownRates(session, recording(by, at), id, day, {
                  register: standingAt.id,
                  device,
                }),
              );
            }),
        } satisfies RateAdministration;
      }),
    ],
  });
}

/**
 * A branch as `SYS` has it, the moment this command reads the clock, and the
 * day that moment is at the branch.
 *
 * The clock is read once, here, so that the day a rate is filed under and the
 * moment it is stamped with can never straddle midnight between two readings.
 * `trading` refuses a withdrawn branch, which enters and confirms nothing;
 * `reading` does not, because a withdrawn branch's rates are still its history.
 */
function branchToday<Session>(context: ModuleContext<Session>) {
  return async (
    by: CommandContext,
    id: BranchId,
    purpose: 'trading' | 'reading',
  ): Promise<Result<BranchToday, RateRefusal>> => {
    const branch = await context.require(Organisation).branch(by, id);
    if (branch === null) return refuse('fx.branch-not-found', { branch: id });
    if (purpose === 'trading' && !branch.active) {
      return refuse('fx.branch-inactive', { branch: id });
    }
    const at = context.clock.now();
    return ok({ branch, at, day: localDateOf(at, branch.timeZone) });
  };
}
