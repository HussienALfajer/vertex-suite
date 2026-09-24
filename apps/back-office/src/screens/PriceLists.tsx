import { useEffect, useState, type ReactNode } from 'react';
import type { PriceList } from '@vertex/prc/contract';
import {
  Banner,
  Button,
  ConfirmationDialog,
  DataTable,
  PageHeader,
  Panel,
  TextInput,
  useTranslator,
  type BannerTone,
  type DataTableColumn,
} from '@vertex/ui';
import { messageForRefusal } from '../catalogue.js';
import type { SystemOfRecord } from '../system.js';
import { StatusBadge } from './structure.js';

/** PRC-01: small tenant-owned list administration, with every write read back through the port. */
export function PriceListsScreen({ system }: { readonly system: SystemOfRecord }): ReactNode {
  const t = useTranslator();
  const [lists, setLists] = useState<readonly PriceList[]>([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<PriceList | null>(null);
  const [editName, setEditName] = useState('');
  const [withdrawing, setWithdrawing] = useState<PriceList | null>(null);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<BannerTone>('info');
  const [busy, setBusy] = useState(false);

  function show(message: string, tone: BannerTone): void {
    setMessage(message);
    setTone(tone);
  }

  useEffect(() => {
    let live = true;
    void system.priceLists
      .list()
      .then((found) => {
        if (live) setLists(found);
      })
      .catch(() => {
        if (live) {
          setMessage(t.format('data.unreachable'));
          setTone('danger');
        }
      });
    return () => {
      live = false;
    };
  }, [system, t]);

  async function refresh(): Promise<void> {
    setLists(await system.priceLists.list());
  }

  async function create(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const result = await system.priceLists.create(newName);
      if (!result.ok) show(messageForRefusal(t, result.error), 'danger');
      else {
        setNewName('');
        show(t.format('priceLists.created'), 'success');
        await refresh();
      }
    } catch {
      show(t.format('data.unreachable'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function rename(): Promise<void> {
    if (busy || editing === null) return;
    setBusy(true);
    try {
      const result = await system.priceLists.rename(editing.id, editName);
      if (!result.ok) show(messageForRefusal(t, result.error), 'danger');
      else {
        setEditing(null);
        show(t.format('priceLists.renamed'), 'success');
        await refresh();
      }
    } catch {
      show(t.format('data.unreachable'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(): Promise<void> {
    if (busy || withdrawing === null) return;
    setBusy(true);
    try {
      const result = await system.priceLists.deactivate(withdrawing.id);
      if (!result.ok) show(messageForRefusal(t, result.error), 'danger');
      else {
        show(t.format('priceLists.deactivated'), 'success');
        await refresh();
      }
    } catch {
      show(t.format('data.unreachable'), 'danger');
    } finally {
      setWithdrawing(null);
      setBusy(false);
    }
  }

  const columns: readonly DataTableColumn<PriceList>[] = [
    {
      id: 'name',
      header: t.format('priceLists.name'),
      isRowHeader: true,
      render: (list) => list.name,
    },
    {
      id: 'status',
      header: t.format('priceLists.status'),
      render: (list) => <StatusBadge isActive={list.active} />,
    },
    {
      id: 'actions',
      header: t.format('priceLists.actions'),
      render: (list) =>
        list.active ? (
          <div className="flex flex-wrap gap-[var(--vx-gap-sm)]">
            <Button
              onPress={() => {
                setEditing(list);
                setEditName(list.name);
                setMessage('');
              }}
            >
              {t.format('action.rename')}
            </Button>
            <Button
              tone="danger"
              onPress={() => {
                setWithdrawing(list);
              }}
            >
              {t.format('priceLists.deactivate')}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--vx-gap-lg)]">
      <PageHeader
        title={t.format('priceLists.title')}
        description={t.format('priceLists.description')}
      />
      {message === '' ? null : <Banner tone={tone}>{message}</Banner>}
      <Panel title={t.format('priceLists.create')}>
        <form
          className="flex flex-wrap items-end gap-[var(--vx-gap-md)]"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <TextInput
            label={t.format('priceLists.name')}
            value={newName}
            onChange={setNewName}
            maxLength={100}
          />
          <Button type="submit" tone="primary" isDisabled={busy}>
            {t.format('priceLists.create')}
          </Button>
        </form>
      </Panel>
      <Panel title={t.format('priceLists.all')} flush>
        <DataTable
          label={t.format('priceLists.all')}
          columns={columns}
          rows={lists}
          emptyMessage={t.format('priceLists.empty')}
        />
      </Panel>
      {editing === null ? null : (
        <Panel title={t.format('priceLists.rename')}>
          <form
            className="flex flex-wrap items-end gap-[var(--vx-gap-md)]"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <TextInput
              label={t.format('priceLists.newName')}
              value={editName}
              onChange={setEditName}
              maxLength={100}
              autoFocus
            />
            <Button type="submit" tone="primary" isDisabled={busy}>
              {t.format('action.save')}
            </Button>
            <Button
              onPress={() => {
                setEditing(null);
              }}
            >
              {t.format('action.cancel')}
            </Button>
          </form>
        </Panel>
      )}
      <ConfirmationDialog
        isOpen={withdrawing !== null}
        onOpenChange={(open) => {
          if (!open) setWithdrawing(null);
        }}
        title={t.format('priceLists.deactivate')}
        message={t.format('priceLists.deactivate.confirm', { name: withdrawing?.name ?? '' })}
        confirmLabel={t.format('priceLists.deactivate')}
        tone="danger"
        onConfirm={() => {
          void deactivate();
        }}
      />
    </div>
  );
}
