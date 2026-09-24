import { Catalogue, CAT_PERMISSIONS } from '@vertex/cat/contract';
import { Currencies } from '@vertex/fx/contract';
import { isId, ok, refuse, type Result } from '@vertex/kernel';
import {
  defineModule,
  provideContract,
  untilCommitted,
  type CommandContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';
import {
  PRC_PERMISSIONS,
  PriceLists,
  PriceListAdministration,
  UsdPrices,
  type PrcRefusal,
} from './contract.js';
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
