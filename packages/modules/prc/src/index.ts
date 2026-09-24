import { Catalogue, CAT_PERMISSIONS } from '@vertex/cat/contract';
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
];

export function prcModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'PRC',
    labelKey: 'module.prc',
    dependsOn: ['CAT', 'FX', 'SYS', 'SEC'],
    permissions,
    provides: [
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
