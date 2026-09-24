import type { BranchId } from '@vertex/contracts';
import { Catalogue, CAT_PERMISSIONS } from '@vertex/cat/contract';
import { Currencies, PriceConversion } from '@vertex/fx/contract';
import { isId, money, ok, refuse, toDecimalString, type Result } from '@vertex/kernel';
import { Organisation } from '@vertex/sys/contract';
import {
  defineModule,
  provideContract,
  untilCommitted,
  type CommandContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';
import {
  DISPLAY_CURRENCY,
  DisplayPrices,
  PRC_PERMISSIONS,
  PriceLists,
  PriceListAdministration,
  UsdPrices,
  type DisplayPriceBasis,
  type DisplayPriceTarget,
  type PriceSubject,
  type PrcRefusal,
} from './contract.js';
import {
  basisOf,
  displayHistory,
  displayState,
  fromConversion,
  itemDisplayStates,
  putDisplayPrice,
  replayed,
  reviewed,
  storedDisplayPrice,
  validateApproval,
  validateTarget,
  validBranch,
  validHistoryFilter,
} from './display-prices.js';
import {
  createList,
  deactivateList,
  listIn,
  listsIn,
  renameList,
  seedLists,
  type RecordSession,
} from './price-lists.js';
import {
  currentPrice,
  itemPrices,
  priceHistory,
  putPrice,
  validateCommand,
  validSubject,
} from './usd-prices.js';

export * from './contract.js';

const permissions: readonly PermissionDeclaration[] = [
  {
    id: PRC_PERMISSIONS.list.view,
    labelKey: `permission.${PRC_PERMISSIONS.list.view}`,
    seededFor: ['manager', 'purchasing'],
  },
  {
    id: PRC_PERMISSIONS.list.create,
    labelKey: `permission.${PRC_PERMISSIONS.list.create}`,
    seededFor: ['manager'],
  },
  {
    id: PRC_PERMISSIONS.list.edit,
    labelKey: `permission.${PRC_PERMISSIONS.list.edit}`,
    seededFor: ['manager'],
  },
  {
    id: PRC_PERMISSIONS.price.view,
    labelKey: `permission.${PRC_PERMISSIONS.price.view}`,
    seededFor: ['manager', 'purchasing'],
  },
  {
    id: PRC_PERMISSIONS.price.edit,
    labelKey: `permission.${PRC_PERMISSIONS.price.edit}`,
    seededFor: ['manager'],
  },
  {
    id: PRC_PERMISSIONS.price.history,
    labelKey: `permission.${PRC_PERMISSIONS.price.history}`,
    seededFor: ['manager'],
  },
  {
    id: PRC_PERMISSIONS.display.view,
    labelKey: `permission.${PRC_PERMISSIONS.display.view}`,
    seededFor: ['manager', 'purchasing'],
  },
  {
    // The manager's, as `FX-04` gives a branch's rates to its manager: a
    // frozen price is that rate made durable on every item it is approved for.
    id: PRC_PERMISSIONS.display.edit,
    labelKey: `permission.${PRC_PERMISSIONS.display.edit}`,
    seededFor: ['manager'],
  },
];

export function prcModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'PRC',
    labelKey: 'module.prc',
    dependsOn: ['CAT', 'FX', 'SYS', 'SEC'],
    permissions,
    provides: [
      provideContract(UsdPrices, (context) => {
        const cat = context.require(Catalogue);
        const currencies = context.require(Currencies);
        const permitted = async (by: CommandContext, right: string): Promise<boolean> =>
          (await context.authorise(by, right)) &&
          (await context.authorise(by, CAT_PERMISSIONS.item.view));
        const check = async (by: CommandContext, subject: unknown) => {
          if (!validSubject(subject)) return refuse('prc.subject-invalid');
          const list = await context.transactor.run(by, (uow) =>
            Promise.resolve(listIn(uow.session, by.tenant, subject.list)),
          );
          if (!list) return refuse('prc.list-not-found');
          const item = await cat.item(by, subject.item);
          if (!item) return refuse('prc.item-not-found');
          if (!item.units.some((one) => one.id === subject.unit))
            return refuse('prc.unit-not-on-item');
          return ok(subject);
        };
        return {
          get: async (by, subject) => {
            if (!(await permitted(by, PRC_PERMISSIONS.price.view)))
              return refuse('prc.not-permitted');
            const checked = await check(by, subject);
            if (!checked.ok) return checked;
            return context.transactor.run(by, (uow) =>
              Promise.resolve(ok(currentPrice(uow.session, by.tenant, checked.value))),
            );
          },
          forItem: async (by, id) => {
            if (!(await permitted(by, PRC_PERMISSIONS.price.view)))
              return refuse('prc.not-permitted');
            if (typeof id !== 'string' || !isId(id)) return refuse('prc.item-not-found');
            const item = await cat.item(by, id);
            if (!item) return refuse('prc.item-not-found');
            return context.transactor.run(by, (uow) =>
              Promise.resolve(
                ok(
                  itemPrices(
                    uow.session,
                    by.tenant,
                    id,
                    item.units.map((one) => one.id),
                  ),
                ),
              ),
            );
          },
          history: async (by, filter) => {
            if (!(await permitted(by, PRC_PERMISSIONS.price.history)))
              return refuse('prc.not-permitted');
            return context.transactor.run(by, (uow) =>
              Promise.resolve(priceHistory(uow.session, by.tenant, filter)),
            );
          },
          set: async (by, input) => {
            if (!(await permitted(by, PRC_PERMISSIONS.price.edit)) || by.actor === null)
              return refuse('prc.not-permitted');
            const usd = await currencies.currency(by, 'USD');
            if (!usd) return refuse('prc.amount-invalid');
            const parsed = validateCommand(input, usd);
            if (!parsed.ok) return parsed;
            const checked = await check(by, parsed.value.subject);
            if (!checked.ok) return checked;
            return untilCommitted(() =>
              context.transactor.run(by, (uow) =>
                Promise.resolve(
                  putPrice(uow.session, by.tenant, by.actor, context.clock.now(), parsed.value),
                ),
              ),
            );
          },
        };
      }),
      provideContract(DisplayPrices, (context) => {
        const cat = context.require(Catalogue);
        const organisation = context.require(Organisation);
        const conversion = context.require(PriceConversion);
        type Checked<T> = Promise<Result<T, PrcRefusal>>;

        /**
         * Asked at the branch (`SEC-04`), before `SYS` is asked whether it
         * exists: somebody refused learns nothing about branches they could not
         * have acted on. The catalogue right is asked beside it, as every PRC
         * read of an item's prices does — and at the same branch, because a
         * question with no branch is the tenant-wide place, and a manager
         * confined to this branch would never be admitted there.
         */
        const permitted = async (
          by: CommandContext,
          right: string,
          branch?: BranchId,
        ): Promise<boolean> => {
          const where = branch === undefined ? undefined : { branch };
          return (
            (await context.authorise(by, right, where)) &&
            (await context.authorise(by, CAT_PERMISSIONS.item.view, where))
          );
        };

        /**
         * The branch, through `SYS`, in the caller's tenant. Reading takes a
         * withdrawn branch — its frozen prices are its history — and pricing
         * does not.
         */
        const branchIn = async (
          by: CommandContext,
          id: BranchId,
          purpose: 'reading' | 'pricing',
        ): Checked<BranchId> => {
          const branch = await organisation.branch(by, id);
          if (branch === null) return refuse('prc.branch-not-found');
          if (purpose === 'pricing' && !branch.active) return refuse('prc.branch-inactive');
          return ok(id);
        };

        /**
         * The list is this tenant's, and the unit is this item's own. A
         * withdrawn list is read, and not priced: a preview on it would be a
         * reviewed figure no approval could ever freeze.
         */
        const subjectIn = async (
          by: CommandContext,
          subject: PriceSubject,
          purpose: 'reading' | 'pricing',
        ): Checked<PriceSubject> => {
          const list = await context.transactor.run(by, (uow) =>
            Promise.resolve(listIn(uow.session, by.tenant, subject.list)),
          );
          if (!list) return refuse('prc.list-not-found');
          if (purpose === 'pricing' && !list.active) return refuse('prc.list-inactive');
          const item = await cat.item(by, subject.item);
          if (!item) return refuse('prc.item-not-found');
          if (!item.units.some((one) => one.id === subject.unit))
            return refuse('prc.unit-not-on-item');
          return ok(subject);
        };

        const target = async (
          by: CommandContext,
          input: DisplayPriceTarget,
          purpose: 'reading' | 'pricing',
        ): Checked<DisplayPriceTarget> => {
          const branch = await branchIn(by, input.branch, purpose);
          if (!branch.ok) return branch;
          const subject = await subjectIn(by, input.subject, purpose);
          if (!subject.ok) return subject;
          return ok(input);
        };

        /**
         * What approving now would freeze: the current dollar price, restated
         * by `FX` at this branch's rate for today. Never from zero, and never
         * from another unit or list — an unpriced subject is refused.
         */
        const derive = async (
          by: CommandContext,
          at: DisplayPriceTarget,
        ): Checked<{ readonly amount: string; readonly basis: DisplayPriceBasis }> => {
          const usd = await context.transactor.run(by, (uow) =>
            Promise.resolve(currentPrice(uow.session, by.tenant, at.subject)),
          );
          if (usd === null) return refuse('prc.usd-price-missing');
          const converted = await conversion.convert(
            by,
            at.branch,
            money(usd.amount, 'USD'),
            DISPLAY_CURRENCY,
          );
          if (!converted.ok) return { ok: false, error: fromConversion(converted.error) };
          // A dollar price small enough to settle to nothing is not a shelf
          // price anybody could be asked to pay.
          if (converted.value.amount.amount.lte(0)) return refuse('prc.amount-invalid');
          return ok({
            amount: toDecimalString(converted.value.amount),
            basis: basisOf(usd, converted.value),
          });
        };

        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          get: async (by, input) => {
            const shaped = validateTarget(input);
            if (!shaped.ok) return shaped;
            if (!(await permitted(by, PRC_PERMISSIONS.display.view, shaped.value.branch)))
              return refuse('prc.not-permitted');
            const checked = await target(by, shaped.value, 'reading');
            if (!checked.ok) return checked;
            return ok(await read(by, (session) => displayState(session, by.tenant, checked.value)));
          },

          forItem: async (by, branch, item) => {
            if (!validBranch(branch)) return refuse('prc.branch-not-found');
            if (!(await permitted(by, PRC_PERMISSIONS.display.view, branch)))
              return refuse('prc.not-permitted');
            const place = await branchIn(by, branch, 'reading');
            if (!place.ok) return place;
            if (typeof item !== 'string' || !isId(item)) return refuse('prc.item-not-found');
            const found = await cat.item(by, item);
            if (!found) return refuse('prc.item-not-found');
            return ok(
              await read(by, (session) =>
                itemDisplayStates(
                  session,
                  by.tenant,
                  branch,
                  item,
                  listsIn(session, by.tenant),
                  found.units.map((one) => one.id),
                ),
              ),
            );
          },

          preview: async (by, input) => {
            const shaped = validateTarget(input);
            if (!shaped.ok) return shaped;
            if (!(await permitted(by, PRC_PERMISSIONS.display.edit, shaped.value.branch)))
              return refuse('prc.not-permitted');
            const checked = await target(by, shaped.value, 'pricing');
            if (!checked.ok) return checked;
            const derived = await derive(by, checked.value);
            if (!derived.ok) return derived;
            const current = await read(by, (session) =>
              storedDisplayPrice(session, by.tenant, checked.value),
            );
            return ok({
              ...checked.value,
              currency: DISPLAY_CURRENCY,
              proposed: derived.value.amount,
              basis: derived.value.basis,
              current,
            });
          },

          approve: async (by, input) => {
            const parsed = validateApproval(input);
            if (!parsed.ok) return parsed;
            const command = parsed.value;
            if (
              by.actor === null ||
              !(await permitted(by, PRC_PERMISSIONS.display.edit, command.branch))
            )
              return refuse('prc.not-permitted');
            // A retry is answered before anything is recalculated: it is the
            // same approval, whatever the rate has done since.
            const replay = await read(by, (session) =>
              replayed(session, by.tenant, by.actor, command),
            );
            if (replay !== null) return replay;
            const checked = await target(by, command, 'pricing');
            if (!checked.ok) return checked;
            const derived = await derive(by, checked.value);
            if (!derived.ok) return derived;
            const { amount, basis } = derived.value;
            if (!reviewed(command, amount, basis))
              return refuse('prc.display-basis-changed', {
                proposed: amount,
                usdRevision: basis.usdRevision,
                rateRevision: basis.rate.revision,
              });
            return untilCommitted(() =>
              context.transactor.run(by, (uow) =>
                Promise.resolve(
                  putDisplayPrice(
                    uow.session,
                    by.tenant,
                    by.actor,
                    context.clock.now(),
                    command,
                    amount,
                    basis,
                  ),
                ),
              ),
            );
          },

          history: async (by, filter) => {
            if (!validHistoryFilter(filter)) return refuse('prc.history-query-invalid');
            // One branch's history is asked at that branch; every branch's at
            // the tenant-wide place, which only an unconfined grant reaches.
            if (!(await permitted(by, PRC_PERMISSIONS.price.history, filter.branch)))
              return refuse('prc.not-permitted');
            return ok(await read(by, (session) => displayHistory(session, by.tenant, filter)));
          },
        } satisfies DisplayPrices;
      }),
      provideContract(PriceLists, (context): PriceLists => {
        const cat = context.require(Catalogue);
        return {
          list: async (by) =>
            (await context.authorise(by, PRC_PERMISSIONS.list.view))
              ? context.transactor.run(by, (uow) =>
                  Promise.resolve(listsIn(uow.session, by.tenant)),
                )
              : [],
          get: async (by, id) =>
            (await context.authorise(by, PRC_PERMISSIONS.list.view))
              ? context.transactor.run(by, (uow) =>
                  Promise.resolve(listIn(uow.session, by.tenant, id)),
                )
              : null,
          subject: async (by, subject) => {
            if (!(await context.authorise(by, PRC_PERMISSIONS.list.view)))
              return refuse('prc.not-permitted', { right: PRC_PERMISSIONS.list.view });
            if (!(await context.authorise(by, CAT_PERMISSIONS.item.view)))
              return refuse('prc.not-permitted', { right: CAT_PERMISSIONS.item.view });
            const candidate: unknown = subject;
            if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
              return refuse('prc.subject-invalid');
            const fields = candidate as Record<string, unknown>;
            if (
              typeof fields['list'] !== 'string' ||
              typeof fields['item'] !== 'string' ||
              typeof fields['unit'] !== 'string' ||
              !isId(fields['list']) ||
              !isId(fields['item']) ||
              !isId(fields['unit'])
            )
              return refuse('prc.subject-invalid');
            const list = await context.transactor.run(by, (uow) =>
              Promise.resolve(listIn(uow.session, by.tenant, subject.list)),
            );
            if (list === null) return refuse('prc.list-not-found');
            const item = await cat.item(by, subject.item);
            if (item === null) return refuse('prc.item-not-found');
            if (!item.units.some((unit) => unit.id === subject.unit))
              return refuse('prc.unit-not-on-item');
            return ok(subject);
          },
        };
      }),
      provideContract(PriceListAdministration, (context): PriceListAdministration => {
        const write = async <T>(
          by: CommandContext,
          right: string,
          work: (session: Session) => Result<T, PrcRefusal>,
        ): Promise<Result<T, PrcRefusal>> =>
          (await context.authorise(by, right))
            ? untilCommitted(() =>
                context.transactor.run(by, (uow) => Promise.resolve(work(uow.session))),
              )
            : refuse('prc.not-permitted', { right });
        return {
          seed: (by) =>
            by.actor === null
              ? untilCommitted(() =>
                  context.transactor.run(by, (uow) =>
                    Promise.resolve(seedLists(uow.session, by.tenant)),
                  ),
                )
              : Promise.resolve(refuse('prc.not-permitted')),
          create: (by, name) =>
            write(by, PRC_PERMISSIONS.list.create, (s) => createList(s, by.tenant, name)),
          rename: (by, id, name) =>
            write(by, PRC_PERMISSIONS.list.edit, (s) => renameList(s, by.tenant, id, name)),
          deactivate: (by, id) =>
            write(by, PRC_PERMISSIONS.list.edit, (s) => deactivateList(s, by.tenant, id)),
        };
      }),
    ],
  });
}
