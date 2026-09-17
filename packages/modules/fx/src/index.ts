import type { PermissionId } from '@vertex/contracts';
import { refuse, type CurrencyCode, type Result } from '@vertex/kernel';
import {
  defineModule,
  provideContract,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';

import {
  Currencies,
  CurrencyAdministration,
  FX_PERMISSION_SEEDS,
  FX_PERMISSIONS,
  type CurrencyRefusal,
  type CurrencyRevision,
  type Listing,
  type NewCurrency,
  type RecordSession,
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

export * from './contract.js';

/**
 * Every right this module defines, built from the same grammar the ids were, so
 * that `SEC-01` seeds and `SEC-02` grants them without retyping a string.
 */
function permissions(): readonly PermissionDeclaration[] {
  return FX_PERMISSION_SEEDS.map(({ id, seededFor }) => ({
    id,
    labelKey: `permission.${id}`,
    seededFor,
  }));
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
 * It declares no dependency yet. `modules.md` §3 gives it one, `SYS`, and the
 * first rule here that asks `SYS` anything declares it: a daily rate belongs to
 * a branch (`FX-04`). A dependency declared before it is used is a claim the
 * composition enforces and nothing in the module needs.
 *
 * No migrations and no events, as in `SYS` and `SEC`: there is no schema until a
 * driver exists and a placeholder migration would burn the name the real one
 * wants, and nothing yet listens for a currency changing.
 */
export function fxModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'FX',
    labelKey: 'module.fx',
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
    ],
  });
}
