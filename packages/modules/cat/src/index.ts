import { refuse, type Result } from '@vertex/kernel';
import {
  defineModule,
  provideContract,
  untilCommitted,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';
import {
  CAT_PERMISSIONS,
  Catalogue,
  CatalogueAdministration,
  type CatRefusal,
  type ItemUnitId,
  type RecordSession,
} from './contract.js';
import {
  categoriesIn,
  addItemBarcode,
  addItemUnit,
  barcodeIn,
  changeBarcodeState,
  categoryIn,
  changeItemStatus,
  createCategory,
  createItem,
  convertItemQuantity,
  itemIn,
  itemEligibility,
  itemsIn,
  unitsIn,
  moveCategory,
  scanIn,
  reviseCategory,
} from './catalogue.js';

export * from './contract.js';

const seeds: readonly PermissionDeclaration[] = [
  {
    id: CAT_PERMISSIONS.category.view,
    labelKey: `permission.${CAT_PERMISSIONS.category.view}`,
    seededFor: ['manager', 'purchasing', 'warehouse-keeper', 'floor-supervisor', 'cashier'],
  },
  {
    id: CAT_PERMISSIONS.category.create,
    labelKey: `permission.${CAT_PERMISSIONS.category.create}`,
    seededFor: ['manager'],
  },
  {
    id: CAT_PERMISSIONS.category.edit,
    labelKey: `permission.${CAT_PERMISSIONS.category.edit}`,
    seededFor: ['manager'],
  },
  {
    id: CAT_PERMISSIONS.item.view,
    labelKey: `permission.${CAT_PERMISSIONS.item.view}`,
    seededFor: ['manager', 'purchasing', 'warehouse-keeper', 'floor-supervisor', 'cashier'],
  },
  {
    id: CAT_PERMISSIONS.item.create,
    labelKey: `permission.${CAT_PERMISSIONS.item.create}`,
    seededFor: ['manager'],
  },
  {
    id: CAT_PERMISSIONS.item.edit,
    labelKey: `permission.${CAT_PERMISSIONS.item.edit}`,
    seededFor: ['manager'],
  },
];

export function catModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'CAT',
    labelKey: 'module.cat',
    dependsOn: ['SYS', 'SEC', 'FX'],
    permissions: seeds,
    provides: [
      provideContract(Catalogue, (context: ModuleContext<Session>): Catalogue => {
        const read = async <T>(
          by: CommandContext,
          right: string,
          empty: T,
          work: (s: Session) => T,
        ): Promise<T> =>
          (await context.authorise(by, right))
            ? context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)))
            : empty;
        // Every item read that can be refused rather than answered empty: the
        // right it needs is item view, and a caller without it is told so.
        const answer = async <T>(
          by: CommandContext,
          work: (s: Session) => Result<T, CatRefusal>,
        ): Promise<Result<T, CatRefusal>> =>
          (await context.authorise(by, CAT_PERMISSIONS.item.view))
            ? context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)))
            : refuse('cat.not-permitted', { right: CAT_PERMISSIONS.item.view });
        return {
          categories: (by) =>
            read(by, CAT_PERMISSIONS.category.view, [], (s) => categoriesIn(s, by.tenant)),
          category: (by, id) =>
            read(by, CAT_PERMISSIONS.category.view, null, (s) => categoryIn(s, by.tenant, id)),
          items: (by) => read(by, CAT_PERMISSIONS.item.view, [], (s) => itemsIn(s, by.tenant)),
          item: (by, id) =>
            read(by, CAT_PERMISSIONS.item.view, null, (s) => itemIn(s, by.tenant, id)),
          units: (by, id) => answer(by, (s) => unitsIn(s, by.tenant, id)),
          convert: (by, id, amount, from, to) =>
            answer(by, (s) => convertItemQuantity(s, by.tenant, id, amount, from, to)),
          stockQuantity: (by, id, amount, from) =>
            answer(by, (s) =>
              convertItemQuantity(s, by.tenant, id, amount, from, id as unknown as ItemUnitId),
            ),
          eligibility: (by, id, trade) =>
            answer(by, (s) => itemEligibility(s, by.tenant, id, trade)),
          scan: (by, code) => answer(by, (s) => scanIn(s, by.tenant, code)),
          barcode: (by, code) => answer(by, (s) => barcodeIn(s, by.tenant, code)),
        };
      }),
      provideContract(
        CatalogueAdministration,
        (context: ModuleContext<Session>): CatalogueAdministration => {
          const write = async <T>(
            by: CommandContext,
            right: string,
            work: (s: Session) => Result<T, CatRefusal>,
          ): Promise<Result<T, CatRefusal>> =>
            (await context.authorise(by, right))
              ? untilCommitted(() =>
                  context.transactor.run(by, (uow) => Promise.resolve(work(uow.session))),
                )
              : refuse('cat.not-permitted', { right });
          return {
            createCategory: (by, input) =>
              write(by, CAT_PERMISSIONS.category.create, (s) =>
                createCategory(s, by.tenant, input),
              ),
            reviseCategory: (by, id, revision) =>
              write(by, CAT_PERMISSIONS.category.edit, (s) =>
                reviseCategory(s, by.tenant, id, revision),
              ),
            moveCategory: (by, id, parent) =>
              write(by, CAT_PERMISSIONS.category.edit, (s) =>
                moveCategory(s, by.tenant, id, parent),
              ),
            createItem: (by, input) =>
              write(by, CAT_PERMISSIONS.item.create, (s) => createItem(s, by.tenant, input)),
            addUnit: (by, id, input) =>
              write(by, CAT_PERMISSIONS.item.edit, (s) => addItemUnit(s, by.tenant, id, input)),
            changeItemStatus: (by, id, status, reason) =>
              write(by, CAT_PERMISSIONS.item.edit, (s) =>
                changeItemStatus(s, by, context.clock.now(), id, status, reason),
              ),
            addBarcode: (by, id, input) =>
              write(by, CAT_PERMISSIONS.item.edit, (s) =>
                addItemBarcode(s, by, context.clock.now(), id, input),
              ),
            deactivateBarcode: (by, code, reason) =>
              write(by, CAT_PERMISSIONS.item.edit, (s) =>
                changeBarcodeState(s, by, context.clock.now(), code, false, reason),
              ),
            reactivateBarcode: (by, code, reason) =>
              write(by, CAT_PERMISSIONS.item.edit, (s) =>
                changeBarcodeState(s, by, context.clock.now(), code, true, reason),
              ),
          };
        },
      ),
    ],
  });
}
