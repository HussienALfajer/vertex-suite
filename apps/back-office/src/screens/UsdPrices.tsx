import { useState, type ReactNode } from 'react';
import type { Item } from '@vertex/cat/contract';
import { newId } from '@vertex/kernel';
import type {
  PriceHistoryPage,
  PriceList,
  PriceSubject,
  UsdPrice,
  UsdPriceChange,
} from '@vertex/prc/contract';
import {
  Banner,
  Button,
  DataTable,
  Panel,
  TextInput,
  useTranslator,
  type BannerTone,
  type DataTableColumn,
} from '@vertex/ui';
import { messageForRefusal } from '../catalogue.js';
import type { SystemOfRecord } from '../system.js';
import { DisplayPricesPanel } from './DisplayPrices.js';

interface PriceRow {
  readonly list: PriceList;
  readonly unit: Item['units'][number];
  readonly price: UsdPrice | null;
}

/** PRC-01/02/11: search a small CAT page, then read only the selected item's prices and audit. */
export function UsdPricesScreen({
  system,
  lists,
}: {
  readonly system: SystemOfRecord;
  readonly lists: readonly PriceList[];
}): ReactNode {
  const t = useTranslator();
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<readonly Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [prices, setPrices] = useState<readonly UsdPrice[]>([]);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<PriceHistoryPage | null>(null);
  const [historySubject, setHistorySubject] = useState<PriceSubject | null>(null);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<BannerTone>('danger');
  const [busy, setBusy] = useState(false);
  /** Bumped on every dollar price saved, so the display prices below reread their status. */
  const [saved, setSaved] = useState(0);

  async function search(): Promise<void> {
    setBusy(true);
    try {
      const result = await system.catalogue.search(term, 30);
      if (!result.ok) {
        setMessage(messageForRefusal(t, result.error));
        setTone('danger');
      } else {
        setMatches(result.value.items);
        setMessage('');
      }
    } catch {
      setMessage(t.format('data.unreachable'));
      setTone('danger');
    } finally {
      setBusy(false);
    }
  }

  async function load(item: Item): Promise<void> {
    setBusy(true);
    setSelected(item);
    setEditing(null);
    setHistory(null);
    setHistorySubject(null);
    try {
      const result = await system.usdPrices.forItem(item.id);
      if (!result.ok) {
        setMessage(messageForRefusal(t, result.error));
        setTone('danger');
      } else {
        setPrices(result.value);
        setMessage('');
      }
    } catch {
      setMessage(t.format('data.unreachable'));
      setTone('danger');
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!selected || !editing || busy) return;
    setBusy(true);
    try {
      const result = await system.usdPrices.set({
        subject: { list: editing.list.id, item: selected.id, unit: editing.unit.id },
        amount: { amount, currency: 'USD' },
        expectedRevision: editing.price?.revision ?? 0,
        reason,
        operation: newId<'price-operation'>(),
      });
      if (!result.ok) {
        setMessage(messageForRefusal(t, result.error));
        setTone('danger');
        if (result.error.code === 'prc.revision-stale') {
          const fresh = await system.usdPrices.forItem(selected.id);
          if (fresh.ok) {
            setPrices(fresh.value);
            setEditing({
              ...editing,
              price:
                fresh.value.find(
                  (one) =>
                    one.subject.list === editing.list.id && one.subject.unit === editing.unit.id,
                ) ?? null,
            });
          }
        }
      } else {
        const fresh = await system.usdPrices.forItem(selected.id);
        if (fresh.ok) setPrices(fresh.value);
        setSaved((count) => count + 1);
        setEditing(null);
        setAmount('');
        setReason('');
        setMessage(t.format('usdPrices.saved'));
        setTone('success');
        if (historySubject) await showHistory(historySubject);
      }
    } catch {
      setMessage(t.format('data.unreachable'));
      setTone('danger');
    } finally {
      setBusy(false);
    }
  }

  async function showHistory(
    subject: PriceSubject,
    before?: PriceHistoryPage['next'],
  ): Promise<void> {
    setHistorySubject(subject);
    try {
      const result = await system.usdPrices.history({
        ...subject,
        limit: 20,
        ...(before ? { before } : {}),
      });
      if (!result.ok) {
        setMessage(messageForRefusal(t, result.error));
        setTone('danger');
      } else {
        setHistory(
          before && history
            ? { entries: [...history.entries, ...result.value.entries], next: result.value.next }
            : result.value,
        );
        setMessage('');
      }
    } catch {
      setMessage(t.format('data.unreachable'));
      setTone('danger');
    }
  }

  const rows: readonly PriceRow[] = selected
    ? lists.flatMap((list) =>
        selected.units.map((unit) => ({
          list,
          unit,
          price:
            prices.find((one) => one.subject.list === list.id && one.subject.unit === unit.id) ??
            null,
        })),
      )
    : [];
  const auditColumns: readonly DataTableColumn<UsdPriceChange>[] = [
    {
      id: 'when',
      header: t.format('usdPrices.when'),
      isRowHeader: true,
      render: (entry) =>
        new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(entry.at),
    },
    {
      id: 'old',
      header: t.format('usdPrices.old'),
      render: (entry) => entry.oldAmount ?? t.format('usdPrices.missing'),
    },
    { id: 'new', header: t.format('usdPrices.new'), render: (entry) => entry.newAmount },
    { id: 'actor', header: t.format('usdPrices.actor'), render: (entry) => entry.actor },
    { id: 'reason', header: t.format('usdPrices.reason'), render: (entry) => entry.reason },
  ];
  return (
    <div className="flex flex-col gap-[var(--vx-gap-lg)]">
      <Panel title={t.format('usdPrices.title')}>
        <form
          className="flex flex-wrap items-end gap-[var(--vx-gap-md)]"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <TextInput
            label={t.format('usdPrices.search')}
            value={term}
            onChange={setTerm}
            maxLength={100}
          />
          <Button type="submit" isDisabled={busy}>
            {t.format('usdPrices.search.submit')}
          </Button>
        </form>
        {message && <Banner tone={tone}>{message}</Banner>}
        <div className="flex flex-wrap gap-[var(--vx-gap-sm)]">
          {matches.map((item) => (
            <Button
              key={item.id}
              onPress={() => {
                void load(item);
              }}
            >
              {item.name}
            </Button>
          ))}
        </div>
      </Panel>
      {selected && (
        <Panel title={selected.name}>
          <div className="flex flex-col gap-[var(--vx-gap-sm)]">
            {rows.map((row) => (
              <div
                key={`${row.list.id}${row.unit.id}`}
                role="group"
                aria-label={`${row.list.name} ${row.unit.unit.code}`}
                className="flex flex-wrap items-center gap-[var(--vx-gap-md)] border-b border-line py-[var(--vx-pad-sm)]"
              >
                <strong>{row.list.name}</strong>
                <span>{row.unit.unit.code}</span>
                <span>{row.price ? `${row.price.amount} USD` : t.format('usdPrices.missing')}</span>
                {row.list.active && (
                  <Button
                    onPress={() => {
                      setEditing(row);
                      setAmount(row.price?.amount ?? '');
                      setReason('');
                      setMessage('');
                    }}
                  >
                    {t.format('usdPrices.edit')}
                  </Button>
                )}
                <Button
                  onPress={() => {
                    void showHistory({ list: row.list.id, item: selected.id, unit: row.unit.id });
                  }}
                >
                  {t.format('usdPrices.history')}
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {editing && (
        <Panel title={t.format('usdPrices.edit')}>
          <form
            className="flex flex-wrap items-end gap-[var(--vx-gap-md)]"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <TextInput label={t.format('usdPrices.amount')} value={amount} onChange={setAmount} />
            <TextInput
              label={t.format('usdPrices.reason')}
              value={reason}
              onChange={setReason}
              maxLength={500}
            />
            <Button type="submit" tone="primary" isDisabled={busy}>
              {t.format('action.save')}
            </Button>
          </form>
        </Panel>
      )}
      {selected && (
        <DisplayPricesPanel system={system} item={selected} lists={lists} version={saved} />
      )}
      {history && (
        <Panel title={t.format('usdPrices.history')} flush>
          <DataTable
            label={t.format('usdPrices.history')}
            columns={auditColumns}
            rows={history.entries}
            rowKey={(entry) => entry.operation}
            emptyMessage={t.format('usdPrices.noHistory')}
          />
          {history.next && historySubject && (
            <Button
              onPress={() => {
                void showHistory(historySubject, history.next);
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
