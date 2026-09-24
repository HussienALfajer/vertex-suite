import { refuse, type Result } from '@vertex/kernel';
import {
  ANYWHERE,
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
  ItemCosting,
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
  searchIn,
  rebuildSearchIndex,
  reviseCategory,
} from './catalogue.js';
import { applyCost, costSnapshot, quoteIssue, quoteReceipt } from './cost.js';

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
    // On both nodes, because both search: the store node for the back office
    // and the register at the till. Items stored before the index existed are
    // indexed here, once; from then on every item write keeps its own line.
    migrations: [
      {
        id: 'cat.0001-search-index',
        target: 'both',
        up: (session) => {
          rebuildSearchIndex(session);
          return Promise.resolve();
        },
      },
    ],
    provides: [
      provideContract(ItemCosting, (context: ModuleContext<Session>): ItemCosting => ({
        snapshot: (by, id) =>
          context.transactor.run(by, (uow) =>
            Promise.resolve(costSnapshot(uow.session, by.tenant, id)),
          ),
        quoteReceipt: (by, movement, id, quantity, unit, valueUSD) =>
          context.transactor.run(by, (uow) =>
            Promise.resolve(
              quoteReceipt(uow.session, by.tenant, movement, id, quantity, unit, valueUSD),
            ),
          ),
        quoteIssue: (by, movement, id, quantity, unit) =>
          context.transactor.run(by, (uow) =>
            Promise.resolve(quoteIssue(uow.session, by.tenant, movement, id, quantity, unit)),
          ),
        apply: applyCost,
      })),
      provideContract(Catalogue, (context: ModuleContext<Session>): Catalogue => {
        /**
         * Every read is asked `ANYWHERE`: admitted by a grant of the right in
         * any branch at all, not only by an unconfined one.
         *
         * The catalogue is one set of records for the whole shop group, so a
         * read has no branch to be judged at, and asking at the tenant-wide
         * place — what an absent branch means to `SEC` — refused everybody
         * confined to one. A manager of Damascus could not see the item whose
         * Damascus price they were approving, and `PRC` answered them that the
         * item did not exist.
         *
         * Taking a branch from the caller instead was rejected. Whatever branch
         * is named, the answer is the identical record, so the scope would
         * protect nothing while making every caller — the till, a price screen,
         * a stock count — invent one, and refusing whoever forgot. Branch-scoped
         * work stays branch-scoped where it is decided: a command that acts at a
         * branch asks its own right there, and reads the item only once admitted.
         *
         * Writes are not widened. `CatalogueAdministration` still asks at the
         * tenant-wide place, because renaming an item renames it in every
         * branch, and that is not the act of somebody who runs one.
         */
        const may = (by: CommandContext, right: string): Promise<boolean> =>
          context.authorise(by, right, ANYWHERE);
        const read = async <T>(
          by: CommandContext,
          right: string,
          empty: T,
          work: (s: Session) => T,
        ): Promise<T> =>
          (await may(by, right))
            ? context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)))
            : empty;
        // Every item read that can be refused rather than answered empty: the
        // right it needs is item view, and a caller without it is told so.
        const answer = async <T>(
          by: CommandContext,
          work: (s: Session) => Result<T, CatRefusal>,
        ): Promise<Result<T, CatRefusal>> =>
          (await may(by, CAT_PERMISSIONS.item.view))
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
          // A category name is found only by a caller who may read categories;
          // otherwise the ranking would name them, one guessed word at a time.
          search: async (by, term, limit) => {
            const throughCategories = await may(by, CAT_PERMISSIONS.category.view);
            return answer(by, (s) => searchIn(s, by.tenant, term, limit, throughCategories));
          },
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
