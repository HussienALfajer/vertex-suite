import { useEffect, useState, type ReactNode } from 'react';
import type { Item } from '@vertex/cat/contract';
import { newId } from '@vertex/kernel';
import type {
  DisplayPriceBasis,
  DisplayPriceChange,
  DisplayPriceHistoryPage,
  DisplayPricePreview,
  DisplayPriceState,
  DisplayPriceStatus,
  DisplayPriceTarget,
  PriceList,
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
} from '@vertex/ui';
import type { Translator } from '@vertex/i18n';
import { messageForRefusal } from '../catalogue.js';
import type { SystemOfRecord } from '../system.js';
import { Figure } from './books.js';

const TONES: Readonly<Record<DisplayPriceStatus, BadgeTone>> = {
  unpriced: 'neutral',
  'not-frozen': 'neutral',
  'usd-changed': 'warning',
  frozen: 'success',
};

/** Where a frozen figure came from, in one line: the dollar price, and the rate and day it was taken at. */
function sourceOf(t: Translator, basis: DisplayPriceBasis): string {
  return t.format('displayPrices.sourceOf', {
    usd: basis.usdAmount,
    usdRevision: basis.usdRevision,
    rate: basis.rate.rate,
    day: basis.rate.day,
    sequence: basis.rate.sequence,
  });
}

/**
 * PRC-02/03/11: one item's frozen SYP display prices at one branch.
 *
 * Every figure here is **read as stored**. The only time today's rate is
 * consulted is a preview, which the person asks for, and which writes nothing;
 * the figure it proposes is frozen only when the person approves it with a
 * reason — and it is then this branch's approved display price, not yet what
 * a printed label or a register shows (`PRC-04`, `U09.5`), which the preview
 * says in so many words.
 *
 * `version` changes whenever the dollar prices above were saved, so a row that
 * has just become `usd-changed` says so without the person reloading.
 */
export function DisplayPricesPanel({
  system,
  item,
  lists,
  version,
}: {
  readonly system: SystemOfRecord;
  readonly item: Item;
  readonly lists: readonly PriceList[];
  readonly version: number;
}): ReactNode {
  const t = useTranslator();
  const [branches, setBranches] = useState<readonly Branch[] | null>(null);
  const [branch, setBranch] = useState<Branch['id'] | null>(null);
  const [states, setStates] = useState<readonly DisplayPriceState[]>([]);
  const [reviewing, setReviewing] = useState<DisplayPriceState | null>(null);
  const [preview, setPreview] = useState<DisplayPricePreview | null>(null);
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<DisplayPriceHistoryPage | null>(null);
  const [historyTarget, setHistoryTarget] = useState<DisplayPriceTarget | null>(null);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<BannerTone>('danger');
  const [busy, setBusy] = useState(false);

  /** Bumped after an approval, so the rows are read back from the store rather than assumed. */
  const [reloaded, setReloaded] = useState(0);

  const fail = (text: string): void => {
    setMessage(text);
    setTone('danger');
  };

  useEffect(() => {
    let live = true;
    system.organisation.branches
      .list({ including: 'all' })
      .then((found) => {
        if (!live) return;
        setBranches(found);
        // A shop with one branch has only one answer to "which branch".
        const only = found.length === 1 ? found[0] : undefined;
        if (only) setBranch(only.id);
      })
      .catch(() => {
        if (!live) return;
        setMessage(t.format('data.unreachable'));
        setTone('danger');
      });
    return () => {
      live = false;
    };
  }, [system, t]);

  // Another branch or another item: nothing under review carries over.
  useEffect(() => {
    setReviewing(null);
    setPreview(null);
    setHistory(null);
    setHistoryTarget(null);
  }, [branch, item.id]);

  // Read for a new branch, a new item, a dollar price just saved, or an approval.
  useEffect(() => {
    if (branch === null) {
      setStates([]);
      return;
    }
    let live = true;
    system.displayPrices
      .forItem(branch, item.id)
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setStates(result.value);
          // A review already open reads the fresh state too: a dollar price
          // saved above changes the source it is reviewing.
          setReviewing((open) =>
            open === null
              ? null
              : (result.value.find(
                  (one) =>
                    one.subject.list === open.subject.list &&
                    one.subject.unit === open.subject.unit,
                ) ?? open),
          );
        } else {
          setMessage(messageForRefusal(t, result.error));
          setTone('danger');
        }
      })
      .catch(() => {
        if (!live) return;
        setMessage(t.format('data.unreachable'));
        setTone('danger');
      });
    return () => {
      live = false;
    };
  }, [system, t, branch, item.id, version, reloaded]);

  async function showHistory(target: DisplayPriceTarget, before?: number | null): Promise<void> {
    setHistoryTarget(target);
    try {
      const result = await system.displayPrices.history({
        branch: target.branch,
        ...target.subject,
        limit: 20,
        ...(before ? { before } : {}),
      });
      if (!result.ok) fail(messageForRefusal(t, result.error));
      else
        setHistory(
          before && history
            ? { entries: [...history.entries, ...result.value.entries], next: result.value.next }
            : result.value,
        );
    } catch {
      fail(t.format('data.unreachable'));
    }
  }

  async function askPreview(): Promise<void> {
    if (!reviewing || busy) return;
    setBusy(true);
    setPreview(null);
    try {
      const result = await system.displayPrices.preview({
        branch: reviewing.branch,
        subject: reviewing.subject,
      });
      if (!result.ok) fail(messageForRefusal(t, result.error));
      else {
        setPreview(result.value);
        setMessage('');
      }
    } catch {
      fail(t.format('data.unreachable'));
    } finally {
      setBusy(false);
    }
  }

  async function approve(): Promise<void> {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const result = await system.displayPrices.approve({
        branch: preview.branch,
        subject: preview.subject,
        expectedRevision: preview.current?.revision ?? 0,
        proposed: preview.proposed,
        usdRevision: preview.basis.usdRevision,
        rateRevision: preview.basis.rate.revision,
        reason,
        operation: newId<'price-operation'>(),
      });
      if (!result.ok) {
        fail(messageForRefusal(t, result.error));
        // What was reviewed is no longer what would be frozen: the person
        // previews again rather than approving a figure they have not seen.
        if (
          result.error.code === 'prc.display-basis-changed' ||
          result.error.code === 'prc.revision-stale'
        ) {
          setPreview(null);
          setReloaded((count) => count + 1);
        }
        return;
      }
      setReloaded((count) => count + 1);
      setReviewing(null);
      setPreview(null);
      setReason('');
      setMessage(t.format('displayPrices.approved'));
      setTone('success');
      if (historyTarget) await showHistory(historyTarget);
    } catch {
      fail(t.format('data.unreachable'));
    } finally {
      setBusy(false);
    }
  }

  const chosen = branches?.find((one) => one.id === branch) ?? null;
  const listOf = (id: string) => lists.find((one) => one.id === id);
  const unitOf = (id: string) => item.units.find((one) => one.id === id);
  const labelOf = (state: DisplayPriceTarget): string =>
    `${unitOf(state.subject.unit)?.unit.code ?? ''} · ${listOf(state.subject.list)?.name ?? ''} · ${t.format('displayPrices.title')}`;
  const historyColumns: readonly DataTableColumn<DisplayPriceChange>[] = [
    {
      id: 'when',
      header: t.format('usdPrices.when'),
      isRowHeader: true,
      render: (entry) =>
        new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(entry.at),
    },
    {
      id: 'old',
      header: t.format('displayPrices.old'),
      render: (entry) =>
        entry.oldAmount === null ? (
          t.format('displayPrices.none')
        ) : (
          <Figure amount={{ amount: entry.oldAmount, currency: entry.currency }} />
        ),
    },
    {
      id: 'new',
      header: t.format('displayPrices.new'),
      render: (entry) => <Figure amount={{ amount: entry.newAmount, currency: entry.currency }} />,
    },
    {
      id: 'source',
      header: t.format('displayPrices.source'),
      render: (entry) => sourceOf(t, entry.basis),
    },
    { id: 'actor', header: t.format('usdPrices.actor'), render: (entry) => entry.actor },
    { id: 'reason', header: t.format('displayPrices.reason'), render: (entry) => entry.reason },
  ];

  return (
    <div className="flex flex-col gap-[var(--vx-gap-lg)]">
      <Panel title={t.format('displayPrices.title')}>
        <p className="text-fg-secondary">{t.format('displayPrices.description')}</p>
        {branches !== null && branches.length === 0 ? (
          <p>{t.format('displayPrices.noBranches')}</p>
        ) : (
          <Select
            label={t.format('displayPrices.branch')}
            options={(branches ?? []).map((one) => ({ id: one.id, label: one.name }))}
            value={branch}
            onChange={(key) => {
              setBranch(key === null ? null : (String(key) as Branch['id']));
              setMessage('');
            }}
          />
        )}
        {message && <Banner tone={tone}>{message}</Banner>}
        {branch === null ? (
          branches !== null &&
          branches.length > 0 && <p>{t.format('displayPrices.chooseBranch')}</p>
        ) : (
          <div className="flex flex-col gap-[var(--vx-gap-sm)]">
            {states.map((state) => {
              const list = listOf(state.subject.list);
              return (
                <div
                  key={`${state.subject.list}${state.subject.unit}`}
                  role="group"
                  aria-label={labelOf(state)}
                  className="flex flex-wrap items-center gap-[var(--vx-gap-md)] border-b border-line py-[var(--vx-pad-sm)]"
                >
                  <strong>{list?.name}</strong>
                  <span>{unitOf(state.subject.unit)?.unit.code}</span>
                  {state.price ? (
                    <Figure amount={state.price} />
                  ) : (
                    <span>{t.format('displayPrices.none')}</span>
                  )}
                  <Badge tone={TONES[state.status]}>
                    {t.format(`displayPrices.status.${state.status}`)}
                  </Badge>
                  {state.price && (
                    <span className="text-footnote text-fg-secondary">
                      {t.format('displayPrices.frozenFrom', {
                        usd: state.price.basis.usdAmount,
                        usdRevision: state.price.basis.usdRevision,
                        day: state.price.basis.rate.day,
                        sequence: state.price.basis.rate.sequence,
                      })}
                    </span>
                  )}
                  {list?.active && chosen?.active && state.usd && (
                    <Button
                      onPress={() => {
                        setReviewing(state);
                        setPreview(null);
                        setReason('');
                        setMessage('');
                      }}
                    >
                      {t.format('displayPrices.review')}
                    </Button>
                  )}
                  <Button
                    onPress={() => {
                      void showHistory(state);
                    }}
                  >
                    {t.format('displayPrices.history')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      {reviewing && (
        <Panel title={`${t.format('displayPrices.review')} — ${labelOf(reviewing)}`}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-[var(--vx-gap-md)] gap-y-[var(--vx-gap-xs)]">
            <dt>
              {t.format('displayPrices.usdSource', { revision: reviewing.usd?.revision ?? 0 })}
            </dt>
            <dd>
              {reviewing.usd ? <Figure amount={reviewing.usd} /> : t.format('displayPrices.none')}
            </dd>
            <dt>{t.format('displayPrices.current')}</dt>
            <dd>
              {reviewing.price ? (
                <>
                  <Figure amount={reviewing.price} /> — {sourceOf(t, reviewing.price.basis)}
                </>
              ) : (
                t.format('displayPrices.none')
              )}
            </dd>
          </dl>
          <p className="text-footnote text-fg-secondary">{t.format('displayPrices.previewNote')}</p>
          <div className="flex flex-wrap gap-[var(--vx-gap-sm)]">
            <Button
              isDisabled={busy}
              onPress={() => {
                void askPreview();
              }}
            >
              {t.format('displayPrices.preview')}
            </Button>
            <Button
              tone="ghost"
              onPress={() => {
                setReviewing(null);
                setPreview(null);
                setReason('');
              }}
            >
              {t.format('action.cancel')}
            </Button>
          </div>
          {preview && (
            <form
              className="flex flex-col gap-[var(--vx-gap-md)]"
              onSubmit={(event) => {
                event.preventDefault();
                void approve();
              }}
            >
              <dl className="grid grid-cols-[max-content_1fr] gap-x-[var(--vx-gap-md)] gap-y-[var(--vx-gap-xs)]">
                <dt>{t.format('displayPrices.proposed')}</dt>
                <dd>
                  <strong>
                    <Figure amount={{ amount: preview.proposed, currency: preview.currency }} />
                  </strong>
                </dd>
                <dt>
                  {t.format('displayPrices.usdSource', { revision: preview.basis.usdRevision })}
                </dt>
                <dd>
                  <Figure amount={{ amount: preview.basis.usdAmount, currency: 'USD' }} />
                </dd>
              </dl>
              <p>
                {t.format('displayPrices.rate', {
                  currency: preview.basis.rate.currency,
                  functional: preview.basis.rate.functional,
                  day: preview.basis.rate.day,
                  sequence: preview.basis.rate.sequence,
                  rate: preview.basis.rate.rate,
                })}
              </p>
              <p>
                {t.format('displayPrices.rounding', {
                  exact: preview.basis.exact,
                  increment: preview.basis.rounding.increment,
                  mode: t.format(`currency.roundingMode.${preview.basis.rounding.mode}`),
                })}
              </p>
              <div className="flex flex-wrap items-end gap-[var(--vx-gap-md)]">
                <TextInput
                  label={t.format('displayPrices.reason')}
                  value={reason}
                  onChange={setReason}
                  maxLength={500}
                />
                <Button type="submit" tone="primary" isDisabled={busy}>
                  {t.format('displayPrices.approve')}
                </Button>
              </div>
            </form>
          )}
        </Panel>
      )}
      {history && historyTarget && (
        <Panel title={`${t.format('displayPrices.history')} — ${labelOf(historyTarget)}`} flush>
          <DataTable
            label={t.format('displayPrices.history')}
            columns={historyColumns}
            rows={history.entries}
            rowKey={(entry) => entry.operation}
            emptyMessage={t.format('displayPrices.noHistory')}
          />
          {history.next && (
            <Button
              onPress={() => {
                void showHistory(historyTarget, history.next);
              }}
            >
              {t.format('usdPrices.more')}
            </Button>
          )}
        </Panel>
      )}
    </div>
  );
}
