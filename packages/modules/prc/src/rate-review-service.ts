import type { BranchId } from '@vertex/contracts';
import { Catalogue, CAT_PERMISSIONS, type Item } from '@vertex/cat/contract';
import { CONVERT_ALL_LIMIT, PriceConversion, type ConvertedPrice } from '@vertex/fx/contract';
import { money, ok, refuse, type Result } from '@vertex/kernel';
import { Organisation } from '@vertex/sys/contract';
import {
  ANYWHERE,
  provideContract,
  untilCommitted,
  type CommandContext,
  type ContractProvision,
  type ModuleContext,
} from '@vertex/platform';
import {
  DISPLAY_CURRENCY,
  PRC_PERMISSIONS,
  RateReviewMonitor,
  RateReviewPublished,
  RateReviewRaised,
  RateReviews,
  type PrcRefusal,
  type RateReviewApproval,
  type RateReviewBatch,
  type RateReviewBatchId,
  type RateReviewTask,
} from './contract.js';
import { fromConversion } from './display-prices.js';
import type { RecordSession } from './price-lists.js';
import {
  abandon,
  batchWork,
  detect,
  decisionReplay,
  entryPage,
  policyIn,
  putApproval,
  putExclusion,
  putPolicy,
  putPublication,
  putRefresh,
  putRejection,
  putScanAbandoned,
  putScanStep,
  putSettlingStep,
  putStagingStep,
  sameFigure,
  scanningIn,
  scanStep,
  stagingStep,
  taskAt,
  taskPage,
  validDecision,
  validEntryQuery,
  validExclusion,
  validPolicyCommand,
  validRef,
  validTaskQuery,
  workIn,
  type BatchWork,
} from './rate-reviews.js';

export interface RateReviewOptions {
  /**
   * Prices per step of a scan or a batch: one transaction each.
   *
   * A thousand by default. Every commit on the store node advances one
   * revision for the whole store, so a transaction that holds thirty thousand
   * prices holds every other command in the shop — a sale arriving from a till
   * included — for as long as it takes to write, and is itself retried from
   * the start whenever one of them commits first. A thousand is a few hundred
   * milliseconds of writing; see the measurement in `apps/store-node`.
   */
  readonly chunk?: number;
}

type Checked<T> = Promise<Result<T, PrcRefusal>>;

interface Publisher {
  raised(task: RateReviewTask): void;
  published(batch: RateReviewBatch, branch: BranchId): void;
}

export function rateReviewProvisions<Session extends RecordSession>(
  options: RateReviewOptions,
): readonly ContractProvision<Session>[] {
  const size = options.chunk ?? 1000;
  if (!Number.isSafeInteger(size) || size < 1 || size > CONVERT_ALL_LIMIT)
    throw new RangeError(`A review step holds between 1 and ${String(CONVERT_ALL_LIMIT)} prices.`);

  return [
    provideContract(RateReviews, (context: ModuleContext<Session>) => {
      const organisation = context.require(Organisation);
      const conversion = context.require(PriceConversion);
      const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
        context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));
      const write = <T>(
        by: CommandContext,
        work: (session: Session) => Result<T, PrcRefusal>,
      ): Checked<T> =>
        untilCommitted(() =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session))),
        );

      /**
       * At the task's branch (`SEC-04`), with the catalogue right beside it as
       * every PRC read of an item's prices asks — the listed prices name items.
       * Absent a branch, the tenant-wide place.
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
      const deciding = async (by: CommandContext, branch: BranchId): Promise<boolean> =>
        by.actor !== null && (await permitted(by, PRC_PERMISSIONS.review.approve, branch));

      return {
        // The threshold is one for every branch, so reading it is asked
        // wherever the right is held; changing it, at the tenant-wide place.
        policy: async (by) =>
          (await context.authorise(by, PRC_PERMISSIONS.review.view, ANYWHERE))
            ? ok(await read(by, (session) => policyIn(session, by.tenant)))
            : refuse('prc.not-permitted'),

        setPolicy: async (by, input) => {
          if (by.actor === null || !(await context.authorise(by, PRC_PERMISSIONS.review.policy)))
            return refuse('prc.not-permitted');
          const command = validPolicyCommand(input);
          if (!command.ok) return command;
          return write(by, (session) =>
            putPolicy(session, by.tenant, by.actor, context.clock.now(), command.value),
          );
        },

        tasks: async (by, query) => {
          if (!validTaskQuery(query)) return refuse('prc.review-query-invalid');
          if (!(await permitted(by, PRC_PERMISSIONS.review.view, query.branch)))
            return refuse('prc.not-permitted');
          return ok(await read(by, (session) => taskPage(session, by.tenant, query)));
        },

        task: async (by, ref) => {
          if (!validRef(ref)) return refuse('prc.review-not-found');
          if (!(await permitted(by, PRC_PERMISSIONS.review.view, ref.branch)))
            return refuse('prc.not-permitted');
          return read(by, (session) => taskAt(session, by.tenant, ref));
        },

        entries: async (by, query) => {
          if (!validEntryQuery(query)) return refuse('prc.review-query-invalid');
          if (!(await permitted(by, PRC_PERMISSIONS.review.view, query.branch)))
            return refuse('prc.not-permitted');
          return read(by, (session) => entryPage(session, by.tenant, query));
        },

        exclude: async (by, input) => {
          const command = validExclusion(input);
          if (!command.ok) return command;
          if (!(await deciding(by, command.value.branch))) return refuse('prc.not-permitted');
          return write(by, (session) =>
            putExclusion(session, by.tenant, by.actor, context.clock.now(), command.value),
          );
        },

        reject: async (by, input) => {
          const command = validDecision(input, 'reject');
          if (!command.ok) return command;
          if (!(await deciding(by, command.value.branch))) return refuse('prc.not-permitted');
          return write(by, (session) =>
            putRejection(session, by.tenant, by.actor, context.clock.now(), command.value),
          );
        },

        refresh: async (by, ref) => {
          if (!validRef(ref)) return refuse('prc.review-not-found');
          if (!(await deciding(by, ref.branch))) return refuse('prc.not-permitted');
          return write(by, (session) =>
            putRefresh(session, by.tenant, by.actor, context.clock.now(), ref),
          );
        },

        approve: async (by, input) => {
          const parsed = validDecision(input, 'approve');
          if (!parsed.ok) return parsed;
          const command = parsed.value as RateReviewApproval;
          if (!(await deciding(by, command.branch))) return refuse('prc.not-permitted');
          // A retry is answered before anything is asked of FX: it is the same
          // approval, whatever the rate has done since.
          const replay = await read(by, (session) =>
            decisionReplay(session, by.tenant, by.actor, 'approve', command),
          );
          if (replay !== null) return replay;
          const branch = await organisation.branch(by, command.branch);
          if (branch === null) return refuse('prc.review-not-found');
          if (!branch.active) return refuse('prc.branch-inactive');
          const today = await conversion.rate(by, command.branch, DISPLAY_CURRENCY);
          if (!today.ok) return { ok: false, error: fromConversion(today.error) };
          return write(by, (session) =>
            putApproval(session, by.tenant, by.actor, context.clock.now(), command, today.value),
          );
        },
      } satisfies RateReviews;
    }),

    provideContract(RateReviewMonitor, (context: ModuleContext<Session>) => {
      const organisation = context.require(Organisation);
      const conversion = context.require(PriceConversion);
      const cat = context.require(Catalogue);
      const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
        context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));
      const commit = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
        untilCommitted(() =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session))),
        );
      /** A step whose transaction announces what it made ready, once it has committed. */
      const publishing = <T>(
        by: CommandContext,
        work: (session: Session, publish: Publisher) => T,
      ): Promise<T> =>
        untilCommitted(() =>
          context.transactor.run(by, (uow) =>
            Promise.resolve(
              work(uow.session, {
                raised: (task) => {
                  uow.publish(RateReviewRaised, {
                    task: task.id,
                    branch: task.branch,
                    entries: task.counts.entries,
                  });
                },
                published: (batch, branch) => {
                  uow.publish(RateReviewPublished, {
                    task: batch.task,
                    batch: batch.id,
                    branch,
                    prices: batch.total,
                  });
                },
              }),
            ),
          ),
        );

      /**
       * The catalogue, read once per scan rather than once per price: a scan
       * of thirty thousand items asking `CAT` item by item is thirty thousand
       * transactions. Held only for the scan it was read for.
       */
      let catalogue: { readonly scan: string; readonly items: ReadonlyMap<string, Item> } | null =
        null;
      const itemsFor = async (by: CommandContext, scan: string) => {
        if (catalogue?.scan !== scan)
          catalogue = {
            scan,
            items: new Map((await cat.items(by)).map((item) => [item.id, item])),
          };
        return catalogue.items;
      };

      /** FX's figures for many dollar amounts, a conversion's worth at a time. */
      const restate = async (
        by: CommandContext,
        branch: BranchId,
        amounts: readonly string[],
      ): Promise<Result<readonly ConvertedPrice[], PrcRefusal>> => {
        const figures: ConvertedPrice[] = [];
        for (let at = 0; at < amounts.length; at += CONVERT_ALL_LIMIT) {
          const page = await conversion.convertAll(
            by,
            branch,
            amounts.slice(at, at + CONVERT_ALL_LIMIT).map((amount) => money(amount, 'USD')),
            DISPLAY_CURRENCY,
          );
          if (!page.ok) return { ok: false, error: fromConversion(page.error) };
          figures.push(...page.value);
        }
        return ok(figures);
      };

      const scanOnce = async (by: CommandContext, branch: BranchId): Promise<void> => {
        const step = await read(by, (session) => scanStep(session, by.tenant, branch, size));
        if (step === null) return;
        const moved = step.candidates.filter((one) => one.verdict === 'moved');
        const invalid = new Set<string>();
        const figures = new Map<string, ConvertedPrice>();
        if (moved.length > 0) {
          const items = await itemsFor(by, step.scan.task);
          const known = moved.filter((one) => {
            const item = items.get(one.subject.item);
            const valid = item?.units.some((unit) => unit.id === one.subject.unit) === true;
            if (!valid) invalid.add(one.key);
            return valid;
          });
          const restated = await restate(
            by,
            branch,
            known.map((one) => one.usd?.amount ?? '0'),
          );
          // Today's rate went, or was corrected, while the scan ran: what it
          // listed is at a rate that is no longer today's.
          if (
            !restated.ok ||
            restated.value.some((figure) => figure.rate.revision !== step.scan.rate.revision)
          ) {
            await commit(by, (session) => {
              putScanAbandoned(session, by.tenant, branch, step.scan.task, context.clock.now());
            });
            return;
          }
          known.forEach((one, at) => {
            const figure = restated.value[at];
            if (figure !== undefined) figures.set(one.key, figure);
          });
        }
        // The catalogue is held for one scan and no longer.
        if (step.last) catalogue = null;
        await publishing(by, (session, publish) =>
          putScanStep(
            session,
            by.tenant,
            branch,
            step,
            figures,
            invalid,
            context.clock.now(),
            (task) => {
              publish.raised(task);
            },
          ),
        );
      };

      const abandonIf = (
        by: CommandContext,
        work: BatchWork,
        cause: 'stale' | 'superseded',
        stale: number,
      ): Promise<void> =>
        commit(by, (session) => {
          const now = batchWork(session, by.tenant, work.batch.id);
          if (now?.batch.state !== 'staging') return;
          abandon(session, by.tenant, now.batch, now.task, cause, stale, context.clock.now());
        });

      const stageOnce = async (by: CommandContext, work: BatchWork): Promise<void> => {
        const step = await read(by, (session) => stagingStep(session, by.tenant, work, size));
        if (step.stale > 0) return abandonIf(by, work, 'stale', step.stale);
        // Fewer left to stage than were approved, and none: the task's
        // entries are not the ones approved. A step that did nothing would
        // be taken again forever; this is a stale batch.
        if (step.short) return abandonIf(by, work, 'stale', work.batch.total - work.batch.staged);
        if (step.entries.length === 0) {
          // Everything is staged: the publication boundary.
          const today = await conversion.rate(by, work.batch.branch, DISPLAY_CURRENCY);
          if (!today.ok) return abandonIf(by, work, 'superseded', 0);
          await publishing(by, (session, publish) => {
            putPublication(session, by.tenant, work, today.value, context.clock.now(), (batch) => {
              publish.published(batch, work.batch.branch);
            });
          });
          return;
        }
        const restated = await restate(
          by,
          work.batch.branch,
          step.entries.map((record) => record.usd.amount),
        );
        if (!restated.ok) return abandonIf(by, work, 'superseded', 0);
        if (restated.value.some((figure) => figure.rate.revision !== work.task.rate.revision))
          return abandonIf(by, work, 'superseded', 0);
        // The rate is the one reviewed; a figure that still differs was
        // settled by a rule the owner has revised since (`FX-07`).
        const differ = step.entries.filter((record, at) => {
          const figure = restated.value[at];
          return figure === undefined || !sameFigure(record, figure, work.task.rate);
        }).length;
        if (differ > 0) return abandonIf(by, work, 'stale', differ);
        await commit(by, (session) => putStagingStep(session, by.tenant, step));
      };

      const stepBatch = async (by: CommandContext, id: RateReviewBatchId): Promise<void> => {
        const work = await read(by, (session) => batchWork(session, by.tenant, id));
        if (work === null) {
          await commit(by, (session) => {
            putSettlingStep(session, by.tenant, id, size);
          });
          return;
        }
        if (work.batch.state === 'staging') return stageOnce(by, work);
        await commit(by, (session) => {
          putSettlingStep(session, by.tenant, id, size);
        });
      };

      const detectAll = async (by: CommandContext): Promise<boolean> => {
        const policy = await read(by, (session) => policyIn(session, by.tenant));
        let changed = false;
        for (const branch of await organisation.branches(by)) {
          let today = null;
          if (policy.threshold !== null) {
            const rate = await conversion.rate(by, branch.id, DISPLAY_CURRENCY);
            today = rate.ok ? rate.value : null;
          }
          const found = today;
          if (
            await commit(by, (session) =>
              detect(session, by.tenant, branch.id, found, context.clock.now()),
            )
          )
            changed = true;
        }
        return changed;
      };

      return {
        drive: async (by) => {
          if (by.actor !== null) throw new Error('Only the system drives the rate-review monitor.');
          const work = await read(by, (session) => workIn(session, by.tenant));
          const batch = work[0];
          if (batch !== undefined) {
            await stepBatch(by, batch);
            return { more: true };
          }
          const scanning = await read(by, (session) => scanningIn(session, by.tenant));
          const branch = scanning[0];
          if (branch !== undefined) {
            await scanOnce(by, branch);
            return { more: true };
          }
          return { more: await detectAll(by) };
        },
      } satisfies RateReviewMonitor;
    }),
  ];
}
