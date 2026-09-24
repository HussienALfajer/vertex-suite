import { useEffect, useState, type ReactNode } from 'react';
import type { Item } from '@vertex/cat/contract';
import { newId } from '@vertex/kernel';
import type {
  PriceList,
  PriceSubject,
  RateReviewEntry,
  RateReviewEntryPage,
  RateReviewPolicy,
  RateReviewState,
  RateReviewTask,
  RateReviewTaskPage,
} from '@vertex/prc/contract';
import type { Branch } from '@vertex/sys/contract';
import {
  Badge,
  Banner,
  Button,
  DataTable,
  Panel,
  Select,
  TextInput,
  useTranslator,
  type BadgeTone,
  type BannerTone,
  type DataTableColumn,
  type DataTableProps,
} from '@vertex/ui';
import type { Translator } from '@vertex/i18n';
import { messageForRefusal } from '../catalogue.js';
import type { SystemOfRecord } from '../system.js';
import { Figure } from './books.js';

const TONES: Readonly<Record<RateReviewState, BadgeTone>> = {
  preparing: 'info',
  pending: 'warning',
  approving: 'info',
  approved: 'success',
  rejected: 'neutral',
  superseded: 'neutral',
};

/** A row's key: the price it lists, which is unique within a task. */
const keyOf = (subject: PriceSubject): string => `${subject.item}/${subject.list}/${subject.unit}`;

/** What the grid says is selected: some rows by key, or every row on the page. */
type Selection = Parameters<NonNullable<DataTableProps<RateReviewEntry>['onSelectionChange']>>[0];

/** While the store node is still working on a task, it is read again this often. */
const WATCH_MS = 1500;

const when = (at: number): string =>
  new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(at);

function rateOf(t: Translator, task: RateReviewTask): string {
  return t.format('rateReviews.rateOf', {
    rate: task.rate.rate,
    day: task.rate.day,
    sequence: task.rate.sequence,
  });
}

/**
 * PRC-03/11: the owner's threshold, and the review tasks a rate that moves past
 * it raises at a branch.
 *
 * Nothing here changes a price by itself. A task lists the frozen prices the
 * rate moved away from, each beside the figure proposed in its place and
 * everything it was derived from, **a page at a time** — a task can list every
 * price in a thirty-thousand-item shop, and none of it is ever held in this
 * screen at once. A person excludes prices, rejects the task, or approves it
 * with a reason; an approval is published by the store node as one batch, and
 * this screen watches it until it is, saying so — and saying what happened if
 * it could not be.
 */
export function RateReviewsScreen({ system }: { readonly system: SystemOfRecord }): ReactNode {
  const t = useTranslator();
  const [policy, setPolicy] = useState<RateReviewPolicy | null>(null);
  const [threshold, setThreshold] = useState('');
  const [branches, setBranches] = useState<readonly Branch[] | null>(null);
  const [branch, setBranch] = useState<Branch['id'] | null>(null);
  const [tasks, setTasks] = useState<RateReviewTaskPage | null>(null);
  const [task, setTask] = useState<RateReviewTask | null>(null);
  const [page, setPage] = useState<RateReviewEntryPage | null>(null);
  /** The cursors of the pages before this one, so "first page" is always one step. */
  const [after, setAfter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(new Set());
  const [items, setItems] = useState<ReadonlyMap<string, Item>>(new Map());
  const [lists, setLists] = useState<readonly PriceList[]>([]);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<BannerTone>('danger');
  const [busy, setBusy] = useState(false);
  /** Bumped to read the task list again. */
  const [reloaded, setReloaded] = useState(0);

  const show = (text: string, as: BannerTone): void => {
    setMessage(text);
    setTone(as);
  };
  const failed = (): void => {
    show(t.format('data.unreachable'), 'danger');
  };

  useEffect(() => {
    let live = true;
    Promise.all([
      system.rateReviews.policy(),
      system.organisation.branches.list({ including: 'all' }),
      system.priceLists.list(),
    ])
      .then(([found, all, priced]) => {
        if (!live) return;
        if (found.ok) {
          setPolicy(found.value);
          setThreshold(found.value.threshold ?? '');
        } else show(messageForRefusal(t, found.error), 'danger');
        setBranches(all);
        setLists(priced);
        const only = all.length === 1 ? all[0] : undefined;
        if (only) setBranch(only.id);
      })
      .catch(() => {
        if (live) show(t.format('data.unreachable'), 'danger');
      });
    return () => {
      live = false;
    };
  }, [system, t]);

  // The branch's tasks, newest first.
  useEffect(() => {
    if (branch === null) {
      setTasks(null);
      return;
    }
    let live = true;
    system.rateReviews
      .tasks({ branch, limit: 20 })
      .then((result) => {
        if (!live) return;
        if (result.ok) setTasks(result.value);
        else show(messageForRefusal(t, result.error), 'danger');
      })
      .catch(() => {
        if (live) show(t.format('data.unreachable'), 'danger');
      });
    return () => {
      live = false;
    };
  }, [system, t, branch, reloaded]);

  // Another branch: nothing open carries over.
  useEffect(() => {
    setTask(null);
    setPage(null);
  }, [branch]);

  // A task the store node is still working on is read again until it is not.
  const working = task?.state === 'preparing' || task?.state === 'approving';
  const watched = working ? task : null;
  useEffect(() => {
    if (watched === null) return undefined;
    const timer = setInterval(() => {
      void system.rateReviews.task({ branch: watched.branch, task: watched.id }).then((result) => {
        if (!result.ok) return;
        // Only the task still open: the person may have opened another while
        // this answer was on its way.
        setTask((open) => (open?.id === result.value.id ? result.value : open));
        if (result.value.state !== watched.state) setReloaded((count) => count + 1);
      });
    }, WATCH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [system, watched]);

  async function readPage(open: RateReviewTask, from: string | null): Promise<void> {
    const result = await system.rateReviews.entries({
      branch: open.branch,
      task: open.id,
      limit: 50,
      ...(from === null ? {} : { after: from }),
    });
    if (!result.ok) {
      show(messageForRefusal(t, result.error), 'danger');
      return;
    }
    setPage(result.value);
    setAfter(from);
    setSelected(new Set());
    // Names for the page's items only: the page is bounded, so this is too.
    const missing = [...new Set(result.value.entries.map((one) => one.subject.item))].filter(
      (id) => !items.has(id),
    );
    if (missing.length === 0) return;
    const found = await Promise.all(missing.map((id) => system.catalogue.item(id)));
    setItems((known) => {
      const next = new Map(known);
      for (const item of found) if (item !== null) next.set(item.id, item);
      return next;
    });
  }

  async function openTask(chosen: RateReviewTask): Promise<void> {
    setMessage('');
    setReason('');
    try {
      const result = await system.rateReviews.task({ branch: chosen.branch, task: chosen.id });
      if (!result.ok) {
        show(messageForRefusal(t, result.error), 'danger');
        return;
      }
      setTask(result.value);
      await readPage(result.value, null);
    } catch {
      failed();
    }
  }

  async function savePolicy(value: string | null): Promise<void> {
    if (busy || policy === null) return;
    setBusy(true);
    try {
      const result = await system.rateReviews.setPolicy({
        threshold: value,
        expectedRevision: policy.revision,
        operation: newId<'price-operation'>(),
      });
      if (!result.ok) show(messageForRefusal(t, result.error), 'danger');
      else {
        setPolicy(result.value);
        setThreshold(result.value.threshold ?? '');
        show(t.format('rateReviews.policy.saved'), 'success');
        setReloaded((count) => count + 1);
      }
    } catch {
      failed();
    } finally {
      setBusy(false);
    }
  }

  /** Runs a decision on the open task, then reads the task and its page back. */
  async function decide(
    work: (open: RateReviewTask) => ReturnType<SystemOfRecord['rateReviews']['approve']>,
    done: string,
  ): Promise<void> {
    if (busy || task === null) return;
    setBusy(true);
    try {
      const result = await work(task);
      if (!result.ok) {
        show(messageForRefusal(t, result.error), 'danger');
        // The task may have moved on under the person: read it as it is.
        const now = await system.rateReviews.task({ branch: task.branch, task: task.id });
        if (now.ok) setTask(now.value);
        return;
      }
      setTask(result.value);
      setReason('');
      show(done, 'success');
      setReloaded((count) => count + 1);
      await readPage(result.value, after);
    } catch {
      failed();
    } finally {
      setBusy(false);
    }
  }

  const chosenSubjects = (): readonly PriceSubject[] => {
    const rows = page?.entries ?? [];
    return selected === 'all'
      ? rows.map((one) => one.subject)
      : rows.filter((one) => selected.has(keyOf(one.subject))).map((one) => one.subject);
  };

  const listName = (id: string): string => lists.find((one) => one.id === id)?.name ?? '';
  const unitCode = (entry: RateReviewEntry): string =>
    items.get(entry.subject.item)?.units.find((one) => one.id === entry.subject.unit)?.unit.code ??
    '';

  const taskColumns: readonly DataTableColumn<RateReviewTask>[] = [
    {
      id: 'raised',
      header: t.format('rateReviews.raisedAt'),
      isRowHeader: true,
      render: (one) => when(one.raisedAt),
    },
    {
      id: 'state',
      header: t.format('rateReviews.state'),
      render: (one) => (
        <Badge tone={TONES[one.state]}>{t.format(`rateReviews.state.${one.state}`)}</Badge>
      ),
    },
    { id: 'rate', header: t.format('rateReviews.rate'), render: (one) => rateOf(t, one) },
    {
      id: 'counts',
      header: t.format('rateReviews.counts'),
      render: (one) =>
        t.format('rateReviews.countsOf', {
          entries: one.counts.entries,
          excluded: one.counts.excluded,
        }),
    },
    {
      id: 'open',
      header: t.format('rateReviews.open'),
      render: (one) => (
        <Button
          onPress={() => {
            void openTask(one);
          }}
        >
          {t.format('rateReviews.open')}
        </Button>
      ),
    },
  ];

  const entryColumns: readonly DataTableColumn<RateReviewEntry>[] = [
    {
      id: 'item',
      header: t.format('rateReviews.item'),
      isRowHeader: true,
      render: (entry) => items.get(entry.subject.item)?.name ?? entry.subject.item,
    },
    {
      id: 'list',
      header: t.format('rateReviews.list'),
      render: (entry) => `${listName(entry.subject.list)} · ${unitCode(entry)}`,
    },
    {
      id: 'current',
      header: t.format('rateReviews.current'),
      render: (entry) => (
        <span className="flex flex-col">
          <Figure amount={{ amount: entry.current.amount, currency: entry.currency }} />
          <span className="text-footnote text-fg-secondary">
            {t.format('rateReviews.frozenAt', {
              rate: entry.current.basis.rate.rate,
              day: entry.current.basis.rate.day,
            })}
          </span>
        </span>
      ),
    },
    {
      id: 'proposed',
      header: t.format('rateReviews.proposed'),
      render: (entry) => (
        <span className="flex flex-col">
          <strong>
            <Figure amount={{ amount: entry.proposed, currency: entry.currency }} />
          </strong>
          <span className="text-footnote text-fg-secondary">
            {t.format('rateReviews.exactOf', { exact: entry.basis.exact })}
          </span>
        </span>
      ),
    },
    {
      id: 'usd',
      header: t.format('rateReviews.usd'),
      render: (entry) =>
        t.format('rateReviews.usdOf', { amount: entry.usd.amount, revision: entry.usd.revision }),
    },
    {
      id: 'status',
      header: t.format('rateReviews.status'),
      render: (entry) => (
        <span className="flex flex-wrap gap-[var(--vx-gap-xs)]">
          <Badge tone={entry.included ? 'success' : 'neutral'}>
            {t.format(entry.included ? 'rateReviews.included' : 'rateReviews.excluded')}
          </Badge>
          {entry.stale && <Badge tone="warning">{t.format('rateReviews.stale')}</Badge>}
        </span>
      ),
    },
  ];

  const pending = task?.state === 'pending';
  const included = task === null ? 0 : task.counts.entries - task.counts.excluded;
  const skipped = task?.counts.skipped;

  return (
    <div className="flex flex-col gap-[var(--vx-gap-lg)]">
      <Panel title={t.format('rateReviews.title')}>
        <p className="text-fg-secondary">{t.format('rateReviews.description')}</p>
        {message && <Banner tone={tone}>{message}</Banner>}
      </Panel>

      <Panel title={t.format('rateReviews.policy')}>
        {policy !== null && (
          <p>
            {policy.threshold === null
              ? t.format('rateReviews.policy.disabled')
              : t.format('rateReviews.policy.current', { threshold: policy.threshold })}
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-[var(--vx-gap-md)]"
          onSubmit={(event) => {
            event.preventDefault();
            // An empty field is the owner saying "no threshold".
            const typed = threshold.trim();
            void savePolicy(typed === '' ? null : typed);
          }}
        >
          <TextInput
            label={t.format('rateReviews.policy.threshold')}
            description={t.format('rateReviews.policy.help')}
            value={threshold}
            onChange={setThreshold}
            maxLength={5}
            inputMode="decimal"
            isMachineText
          />
          <Button type="submit" tone="primary" isDisabled={busy || policy === null}>
            {t.format('rateReviews.policy.save')}
          </Button>
          {policy?.threshold != null && (
            <Button
              isDisabled={busy}
              onPress={() => {
                void savePolicy(null);
              }}
            >
              {t.format('rateReviews.policy.disable')}
            </Button>
          )}
        </form>
      </Panel>

      <Panel title={t.format('rateReviews.tasks')}>
        <Select
          label={t.format('rateReviews.branch')}
          options={(branches ?? []).map((one) => ({ id: one.id, label: one.name }))}
          value={branch}
          onChange={(key) => {
            setBranch(key === null ? null : (String(key) as Branch['id']));
            setMessage('');
          }}
        />
        {branch === null ? (
          <p>{t.format('rateReviews.chooseBranch')}</p>
        ) : (
          <>
            <DataTable
              label={t.format('rateReviews.tasks')}
              columns={taskColumns}
              rows={tasks?.tasks ?? []}
              emptyMessage={t.format('rateReviews.noTasks')}
            />
            <div className="flex flex-wrap gap-[var(--vx-gap-sm)]">
              <Button
                onPress={() => {
                  setReloaded((count) => count + 1);
                }}
              >
                {t.format('rateReviews.reload')}
              </Button>
              {tasks?.next && (
                <Button
                  onPress={() => {
                    const before = tasks.next;
                    if (before === null) return;
                    void system.rateReviews.tasks({ branch, limit: 20, before }).then((result) => {
                      if (result.ok)
                        setTasks({
                          tasks: [...tasks.tasks, ...result.value.tasks],
                          next: result.value.next,
                        });
                    });
                  }}
                >
                  {t.format('rateReviews.more')}
                </Button>
              )}
            </div>
          </>
        )}
      </Panel>

      {task && (
        <Panel
          title={`${t.format('rateReviews.task')} — ${t.format(`rateReviews.state.${task.state}`)}`}
        >
          <p>
            {t.format('rateReviews.basis', {
              currency: task.rate.currency,
              functional: task.rate.functional,
              day: task.rate.day,
              sequence: task.rate.sequence,
              rate: task.rate.rate,
              threshold: task.policy.threshold,
            })}
          </p>
          {skipped && (
            <p className="text-footnote text-fg-secondary">
              {t.format('rateReviews.skipped', {
                listInactive: skipped['list-inactive'],
                subjectInvalid: skipped['subject-invalid'],
                usdMissing: skipped['usd-missing'],
                unchanged: skipped.unchanged,
                amountInvalid: skipped['amount-invalid'],
              })}
            </p>
          )}
          {task.state === 'preparing' && (
            <Banner tone="info">
              {t.format('rateReviews.progress.preparing', {
                scanned: task.counts.scanned,
                frozen: task.counts.frozen,
              })}
            </Banner>
          )}
          {task.state === 'approving' && task.batch && (
            <Banner tone="info">
              {t.format('rateReviews.progress.approving', {
                staged: task.batch.staged,
                total: task.batch.total,
              })}
            </Banner>
          )}
          {task.batch?.state === 'abandoned' && task.batch.failure && (
            <Banner tone="warning">
              {task.batch.failure.cause === 'stale'
                ? t.format('rateReviews.failure.stale', { stale: task.batch.failure.stale })
                : t.format('rateReviews.failure.superseded')}
            </Banner>
          )}
          {task.decision && (
            <Banner tone={task.decision.kind === 'approved' ? 'success' : 'info'}>
              {t.format(`rateReviews.decision.${task.decision.kind}`, {
                actor: task.decision.actor ?? '',
                at: when(task.decision.at),
                reason: task.decision.reason,
                total: task.batch?.total ?? 0,
              })}
            </Banner>
          )}
          {task.supersession && (
            <Banner tone="info">
              {t.format(`rateReviews.supersession.${task.supersession.cause}`)}
            </Banner>
          )}

          <h3 className="text-headline">{t.format('rateReviews.entries')}</h3>
          {pending && (
            <p className="text-footnote text-fg-secondary">
              {t.format('rateReviews.entries.help')}
            </p>
          )}
          <DataTable
            label={t.format('rateReviews.entries')}
            columns={entryColumns}
            rows={page?.entries ?? []}
            rowKey={(entry) => keyOf(entry.subject)}
            emptyMessage={t.format('rateReviews.noEntries')}
            {...(pending
              ? {
                  selectionMode: 'multiple' as const,
                  selectedKeys: selected,
                  onSelectionChange: setSelected,
                }
              : {})}
          />
          <div className="flex flex-wrap gap-[var(--vx-gap-sm)]">
            {pending && (
              <>
                <Button
                  isDisabled={busy}
                  onPress={() => {
                    const subjects = chosenSubjects();
                    if (subjects.length === 0) return;
                    void decide(
                      (open) =>
                        system.rateReviews.exclude({
                          branch: open.branch,
                          task: open.id,
                          subjects,
                          excluded: true,
                          expectedReview: open.review,
                        }),
                      '',
                    );
                  }}
                >
                  {t.format('rateReviews.exclude')}
                </Button>
                <Button
                  isDisabled={busy}
                  onPress={() => {
                    const subjects = chosenSubjects();
                    if (subjects.length === 0) return;
                    void decide(
                      (open) =>
                        system.rateReviews.exclude({
                          branch: open.branch,
                          task: open.id,
                          subjects,
                          excluded: false,
                          expectedReview: open.review,
                        }),
                      '',
                    );
                  }}
                >
                  {t.format('rateReviews.include')}
                </Button>
              </>
            )}
            {after !== null && (
              <Button
                onPress={() => {
                  void readPage(task, null);
                }}
              >
                {t.format('rateReviews.firstPage')}
              </Button>
            )}
            {page?.next && (
              <Button
                onPress={() => {
                  void readPage(task, page.next);
                }}
              >
                {t.format('rateReviews.nextPage')}
              </Button>
            )}
          </div>

          {pending && (
            <form
              className="flex flex-col gap-[var(--vx-gap-md)]"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <p className="text-footnote text-fg-secondary">
                {t.format('rateReviews.approveNote', { included })}
              </p>
              <div className="flex flex-wrap items-end gap-[var(--vx-gap-md)]">
                <TextInput
                  label={t.format('rateReviews.reason')}
                  value={reason}
                  onChange={setReason}
                  maxLength={500}
                />
                <Button
                  tone="primary"
                  isDisabled={busy}
                  onPress={() => {
                    void decide(
                      (open) =>
                        system.rateReviews.approve({
                          branch: open.branch,
                          task: open.id,
                          expectedReview: open.review,
                          reason,
                          operation: newId<'price-operation'>(),
                        }),
                      t.format('rateReviews.accepted'),
                    );
                  }}
                >
                  {t.format('rateReviews.approve')}
                </Button>
                <Button
                  isDisabled={busy}
                  onPress={() => {
                    void decide(
                      (open) =>
                        system.rateReviews.reject({
                          branch: open.branch,
                          task: open.id,
                          reason,
                          operation: newId<'price-operation'>(),
                        }),
                      t.format('rateReviews.rejected'),
                    );
                  }}
                >
                  {t.format('rateReviews.reject')}
                </Button>
                <Button
                  tone="ghost"
                  isDisabled={busy}
                  onPress={() => {
                    void decide(
                      (open) => system.rateReviews.refresh({ branch: open.branch, task: open.id }),
                      t.format('rateReviews.refreshed'),
                    );
                  }}
                >
                  {t.format('rateReviews.refresh')}
                </Button>
              </div>
            </form>
          )}
        </Panel>
      )}
    </div>
  );
}
