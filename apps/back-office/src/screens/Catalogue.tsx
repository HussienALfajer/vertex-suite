import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  Category,
  CategoryId,
  Item,
  ItemKind,
  ItemStatus,
  ItemUnitId,
} from '@vertex/cat/contract';
import { quantity, toDate, type UnitKind } from '@vertex/kernel';
import {
  Badge,
  Banner,
  Button,
  Code,
  DateTime,
  PageHeader,
  Panel,
  Quantity,
  Select,
  TextArea,
  TextInput,
  TreeView,
  UnitLabel,
  useTranslator,
  type TreeNode,
} from '@vertex/ui';
import type { SystemOfRecord } from '../system.js';

const NONE = 'none';
const PIECE = { code: 'pc', kind: 'count' as const, decimals: 0 };
const KILOGRAM = { code: 'kg', kind: 'weight' as const, decimals: 3 };

function treeOf(
  categories: readonly Category[],
  parent: CategoryId | null = null,
): readonly TreeNode<Category>[] {
  return categories
    .filter((one) => one.parent === parent)
    .map((value) => ({ value, children: treeOf(categories, value.id) }));
}

export function CatalogueScreen({ system }: { readonly system: SystemOfRecord }): ReactNode {
  const t = useTranslator();
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [items, setItems] = useState<readonly Item[]>([]);
  const [parent, setParent] = useState(NONE);
  const [category, setCategory] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [itemName, setItemName] = useState('');
  const [defaultUnit, setDefaultUnit] = useState(NONE);
  const [itemUnit, setItemUnit] = useState(NONE);
  const [itemKind, setItemKind] = useState<ItemKind>('standard');
  const [selectedItem, setSelectedItem] = useState<Item['id'] | null>(null);
  const [nextStatus, setNextStatus] = useState<ItemStatus>('suspended');
  const [reason, setReason] = useState('');
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitKind, setNewUnitKind] = useState<UnitKind>('count');
  const [newUnitDecimals, setNewUnitDecimals] = useState('0');
  const [basePerUnit, setBasePerUnit] = useState('');
  const [previewAmount, setPreviewAmount] = useState('');
  const [previewFrom, setPreviewFrom] = useState('');
  const [previewTo, setPreviewTo] = useState('');
  const [preview, setPreview] = useState<{ amount: string; unit: Item['units'][number] } | null>(
    null,
  );
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([system.catalogue.categories(), system.catalogue.items()])
      .then(([nextCategories, nextItems]) => {
        if (live) {
          setCategories(nextCategories);
          setItems(nextItems);
        }
      })
      .catch(() => {
        if (live) setMessage(t.format('data.unreachable'));
      });
    return () => {
      live = false;
    };
  }, [system, t]);

  const nodes = useMemo(() => treeOf(categories), [categories]);
  const choices = categories.map((one) => ({ id: one.id, label: one.name }));
  const unitChoices = [
    { id: NONE, label: t.format('catalogue.unit.inherit') },
    { id: 'pc', label: t.format('catalogue.unit.pc') },
    { id: 'kg', label: t.format('catalogue.unit.kg') },
  ];
  const unitFor = (value: string) => (value === 'pc' ? PIECE : value === 'kg' ? KILOGRAM : null);
  const selected = items.find((one) => one.id === selectedItem) ?? null;
  const kinds: readonly ItemKind[] = ['standard', 'weighed', 'batch-tracked', 'variant-bearing'];
  const statuses: readonly ItemStatus[] = ['active', 'suspended', 'discontinued'];

  async function addCategory(): Promise<void> {
    if (working || categoryName.trim() === '') return;
    setWorking(true);
    try {
      const unit = unitFor(defaultUnit);
      const result = await system.catalogue.createCategory({
        name: categoryName,
        parent: parent === NONE ? null : (parent as CategoryId),
        ...(unit === null ? {} : { defaultBaseUnit: unit }),
      });
      if (result.ok) {
        setCategories(await system.catalogue.categories());
        setCategoryName('');
        setMessage(t.format('catalogue.category.created'));
      } else setMessage(t.format(`refusal.${result.error.code}`));
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  async function addItem(): Promise<void> {
    if (working || itemName.trim() === '' || category === '') return;
    setWorking(true);
    try {
      const unit = unitFor(itemUnit);
      const result = await system.catalogue.createItem({
        name: itemName,
        category: category as CategoryId,
        kind: itemKind,
        ...(unit === null ? {} : { baseUnit: unit }),
      });
      if (result.ok) {
        setItems(await system.catalogue.items());
        setItemName('');
        setMessage(t.format('catalogue.item.created'));
      } else setMessage(t.format(`refusal.${result.error.code}`));
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  async function changeStatus(): Promise<void> {
    if (working || selected === null || reason.trim() === '') return;
    setWorking(true);
    try {
      const result = await system.catalogue.changeItemStatus(selected.id, nextStatus, reason);
      if (result.ok) {
        setItems(await system.catalogue.items());
        setReason('');
        setMessage(t.format('catalogue.status.changed'));
      } else setMessage(t.format(`refusal.${result.error.code}`));
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  async function addUnit(): Promise<void> {
    if (working || selected === null) return;
    setWorking(true);
    try {
      const result = await system.catalogue.addUnit(selected.id, {
        unit: { code: newUnitCode, kind: newUnitKind, decimals: Number(newUnitDecimals) },
        basePerUnit,
      });
      if (result.ok) {
        setItems(await system.catalogue.items());
        setNewUnitCode('');
        setBasePerUnit('');
        setPreview(null);
        setMessage(t.format('catalogue.units.added'));
      } else setMessage(t.format(`refusal.${result.error.code}`));
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  async function convertPreview(): Promise<void> {
    if (working || selected === null) return;
    setWorking(true);
    try {
      const result = await system.catalogue.convert(
        selected.id,
        previewAmount,
        (previewFrom || selected.units[0]?.id) as ItemUnitId,
        (previewTo || selected.units[0]?.id) as ItemUnitId,
      );
      if (result.ok) {
        setPreview(result.value);
        setMessage('');
      } else {
        setPreview(null);
        setMessage(t.format(`refusal.${result.error.code}`));
      }
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--vx-gap-lg)]">
      <PageHeader
        title={t.format('catalogue.title')}
        description={t.format('catalogue.description')}
      />
      {message === '' ? null : <Banner tone="info">{message}</Banner>}
      <Panel title={t.format('catalogue.categories')}>
        <TreeView<Category>
          label={t.format('catalogue.categories')}
          nodes={nodes}
          nodeKey={(one) => one.id}
          textValue={(one) => one.name}
          render={(one) => <span>{one.name}</span>}
          emptyMessage={t.format('catalogue.empty')}
          defaultExpandedKeys={new Set(categories.map((one) => one.id))}
        />
      </Panel>
      <Panel title={t.format('catalogue.category.new')}>
        <form
          className="flex flex-col gap-[var(--vx-gap-md)]"
          onSubmit={(event) => {
            event.preventDefault();
            void addCategory();
          }}
        >
          <TextInput
            label={t.format('catalogue.name')}
            value={categoryName}
            onChange={setCategoryName}
            isRequired
          />
          <Select
            label={t.format('catalogue.parent')}
            options={[{ id: NONE, label: t.format('catalogue.root') }, ...choices]}
            value={parent}
            onChange={(key) => {
              setParent(String(key));
            }}
          />
          <Select
            label={t.format('catalogue.defaultUnit')}
            options={unitChoices}
            value={defaultUnit}
            onChange={(key) => {
              setDefaultUnit(String(key));
            }}
          />
          <Button tone="primary" type="submit" isDisabled={working || categoryName.trim() === ''}>
            {t.format('catalogue.category.create')}
          </Button>
        </form>
      </Panel>
      <Panel title={t.format('catalogue.item.new')}>
        <form
          className="flex flex-col gap-[var(--vx-gap-md)]"
          onSubmit={(event) => {
            event.preventDefault();
            void addItem();
          }}
        >
          <TextInput
            label={t.format('catalogue.name')}
            value={itemName}
            onChange={setItemName}
            isRequired
          />
          <Select
            label={t.format('catalogue.item.category')}
            options={choices}
            value={category}
            onChange={(key) => {
              setCategory(String(key));
            }}
          />
          <Select
            label={t.format('catalogue.item.unit')}
            options={unitChoices}
            value={itemUnit}
            onChange={(key) => {
              setItemUnit(String(key));
            }}
          />
          <Select
            label={t.format('catalogue.item.kind')}
            options={kinds.map((kind) => ({ id: kind, label: t.format(`catalogue.kind.${kind}`) }))}
            value={itemKind}
            onChange={(key) => {
              setItemKind(String(key) as ItemKind);
            }}
          />
          <Button
            tone="primary"
            type="submit"
            isDisabled={working || itemName.trim() === '' || category === ''}
          >
            {t.format('catalogue.item.create')}
          </Button>
        </form>
      </Panel>
      <Panel title={t.format('catalogue.items')}>
        {items.length === 0 ? (
          t.format('catalogue.items.empty')
        ) : (
          <ul>
            {items.map((one) => (
              <li key={one.id}>
                {one.name} — {categories.find((cat) => cat.id === one.category)?.name} —{' '}
                <UnitLabel code={one.baseUnit.code} />{' '}
                <Badge tone="neutral">{t.format(`catalogue.kind.${one.kind}`)}</Badge>{' '}
                <Badge
                  tone={
                    one.status === 'active'
                      ? 'success'
                      : one.status === 'suspended'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {t.format(`catalogue.status.${one.status}`)}
                </Badge>{' '}
                <Button
                  tone="secondary"
                  onPress={() => {
                    setSelectedItem(one.id);
                    setNextStatus(one.status === 'suspended' ? 'active' : 'suspended');
                    setPreview(null);
                    setPreviewFrom('');
                    setPreviewTo('');
                  }}
                >
                  {t.format('catalogue.item.inspect')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {selected === null ? null : (
        <Panel title={t.format('catalogue.item.details', { name: selected.name })}>
          <h3>{t.format('catalogue.units.title')}</h3>
          <ul>
            {selected.units.map((itemUnit) => (
              <li key={itemUnit.id}>
                <UnitLabel code={itemUnit.unit.code} /> (<Code>{itemUnit.unit.code}</Code>) —{' '}
                <Quantity
                  value={quantity(itemUnit.basePerUnit, selected.baseUnit.code)}
                  unit={selected.baseUnit}
                />{' '}
                {itemUnit.id === selected.units[0]?.id ? t.format('catalogue.units.base') : null}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addUnit();
            }}
          >
            <TextInput
              label={t.format('catalogue.units.code')}
              value={newUnitCode}
              onChange={setNewUnitCode}
              isMachineText
              isRequired
            />
            <Select
              label={t.format('catalogue.units.kind')}
              options={(['count', 'weight', 'volume', 'length'] as const).map((kind) => ({
                id: kind,
                label: t.format(`catalogue.units.kind.${kind}`),
              }))}
              value={newUnitKind}
              onChange={(key) => {
                setNewUnitKind(String(key) as UnitKind);
                setNewUnitDecimals(String(key) === 'count' ? '0' : '3');
              }}
            />
            <TextInput
              label={t.format('catalogue.units.decimals')}
              value={newUnitDecimals}
              onChange={setNewUnitDecimals}
              isMachineText
              isRequired
            />
            <TextInput
              label={t.format('catalogue.units.factor')}
              value={basePerUnit}
              onChange={setBasePerUnit}
              isMachineText
              isRequired
            />
            <Button
              tone="primary"
              type="submit"
              isDisabled={working || !newUnitCode || !basePerUnit}
            >
              {t.format('catalogue.units.add')}
            </Button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void convertPreview();
            }}
          >
            <TextInput
              label={t.format('catalogue.units.previewAmount')}
              value={previewAmount}
              onChange={(value) => {
                setPreviewAmount(value);
                setPreview(null);
              }}
              isMachineText
              isRequired
            />
            <Select
              label={t.format('catalogue.units.from')}
              isMachineText
              options={selected.units.map((one) => ({ id: one.id, label: one.unit.code }))}
              value={previewFrom === '' ? (selected.units[0]?.id ?? '') : previewFrom}
              onChange={(key) => {
                setPreviewFrom(String(key));
                setPreview(null);
              }}
            />
            <Select
              label={t.format('catalogue.units.to')}
              isMachineText
              options={selected.units.map((one) => ({ id: one.id, label: one.unit.code }))}
              value={previewTo === '' ? (selected.units[0]?.id ?? '') : previewTo}
              onChange={(key) => {
                setPreviewTo(String(key));
                setPreview(null);
              }}
            />
            <Button tone="secondary" type="submit" isDisabled={working || !previewAmount}>
              {t.format('catalogue.units.preview')}
            </Button>
            {preview === null ? null : (
              <p>
                <Quantity
                  value={quantity(preview.amount, preview.unit.unit.code)}
                  unit={preview.unit.unit}
                />
              </p>
            )}
          </form>
          <p>
            {t.format('catalogue.item.reason')}:{' '}
            {selected.statusReason ?? t.format('catalogue.item.noReason')}
          </p>
          <h3>{t.format('catalogue.item.history')}</h3>
          {selected.statusHistory.length === 0 ? (
            <p>{t.format('catalogue.item.noHistory')}</p>
          ) : (
            <ol>
              {selected.statusHistory.map((change, index) => (
                <li key={index}>
                  {t.format(`catalogue.status.${change.from}`)} →{' '}
                  {t.format(`catalogue.status.${change.to}`)} — {change.reason} —{' '}
                  <DateTime value={toDate(change.at)} timeZone="UTC" /> —{' '}
                  {t.format('catalogue.item.changedBy')}{' '}
                  {change.by === null ? (
                    t.format('catalogue.item.system')
                  ) : (
                    <Code>{change.by}</Code>
                  )}
                </li>
              ))}
            </ol>
          )}
          {selected.status === 'discontinued' ? null : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void changeStatus();
              }}
            >
              <Select
                label={t.format('catalogue.status.next')}
                options={statuses
                  .filter((status) => status !== selected.status)
                  .map((status) => ({ id: status, label: t.format(`catalogue.status.${status}`) }))}
                value={nextStatus}
                onChange={(key) => {
                  setNextStatus(String(key) as ItemStatus);
                }}
              />
              <TextArea
                label={t.format('catalogue.status.reason')}
                value={reason}
                onChange={setReason}
                isRequired
              />
              <Button tone="primary" type="submit" isDisabled={working || reason.trim() === ''}>
                {t.format('catalogue.status.change')}
              </Button>
            </form>
          )}
        </Panel>
      )}
    </div>
  );
}
