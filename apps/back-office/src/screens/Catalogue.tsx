import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  BarcodeResolution,
  Category,
  CategoryId,
  Item,
  ItemBarcode,
  ItemKind,
  ItemStatus,
  ItemUnitId,
} from '@vertex/cat/contract';
import { quantity, toDate, type Refusal, type UnitKind } from '@vertex/kernel';
import {
  Badge,
  Banner,
  Button,
  Code,
  DateTime,
  PageHeader,
  Panel,
  Quantity,
  SearchInput,
  Select,
  TextArea,
  TextInput,
  TreeView,
  UnitLabel,
  useTranslator,
  type TreeNode,
} from '@vertex/ui';
import { messageForRefusal } from '../catalogue.js';
import { useLoaded } from '../organisation.js';
import type { SystemOfRecord } from '../system.js';

const NONE = 'none';
/** CAT's own limit on a term, so that typing can never reach its refusal. */
const TERM_LENGTH = 100;
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
  const [term, setTerm] = useState('');
  const [parent, setParent] = useState(NONE);
  const [category, setCategory] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [defaultUnit, setDefaultUnit] = useState(NONE);
  const [itemUnit, setItemUnit] = useState(NONE);
  const [itemKind, setItemKind] = useState<ItemKind>('standard');
  const [selected, setSelected] = useState<Item | null>(null);
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
  const [newBarcode, setNewBarcode] = useState('');
  const [barcodeUnit, setBarcodeUnit] = useState('');
  const [barcodeTarget, setBarcodeTarget] = useState('');
  const [barcodeReason, setBarcodeReason] = useState('');
  const [lookupCode, setLookupCode] = useState('');
  const [lookup, setLookup] = useState<BarcodeResolution | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    void system.catalogue
      .categories()
      .then((next) => {
        if (live) setCategories(next);
      })
      .catch(() => {
        if (live) setMessage(t.format('data.unreachable'));
      });
    return () => {
      live = false;
    };
  }, [system, t]);

  // The list is a search, never the catalogue: at thirty thousand items the
  // whole of it is neither something to send nor something to read (`CAT-15`).
  // Asked on every keystroke and not debounced, for `Numbering`'s reason — the
  // store node is in the same room and answers in tens of milliseconds — and
  // an answer overtaken by a newer term is dropped rather than shown under it.
  const found = useLoaded(term, (asked) => system.catalogue.search(asked));
  const results = found.value?.ok === true ? found.value.value : null;
  const searchRefusal = found.value?.ok === false ? found.value.error : null;

  const nodes = useMemo(() => treeOf(categories), [categories]);
  const choices = categories.map((one) => ({ id: one.id, label: one.name }));
  const unitChoices = [
    { id: NONE, label: t.format('catalogue.unit.inherit') },
    { id: 'pc', label: t.format('catalogue.unit.pc') },
    { id: 'kg', label: t.format('catalogue.unit.kg') },
  ];
  const unitFor = (value: string) => (value === 'pc' ? PIECE : value === 'kg' ? KILOGRAM : null);
  const target =
    selected?.barcodes.find((one) => one.code === barcodeTarget) ?? selected?.barcodes[0] ?? null;
  const refused = (refusal: Refusal): void => {
    setMessage(messageForRefusal(t, refusal));
  };
  /**
   * After a write: the list asked again, and the item open below read again,
   * since the write may have changed what the list finds it by.
   */
  async function refreshItems(): Promise<void> {
    found.reload();
    if (selected !== null) setSelected(await system.catalogue.item(selected.id));
  }
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
      } else refused(result.error);
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
        ...(itemCode.trim() === '' ? {} : { code: itemCode }),
      });
      if (result.ok) {
        await refreshItems();
        setItemName('');
        setItemCode('');
        setMessage(t.format('catalogue.item.created'));
      } else refused(result.error);
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
        await refreshItems();
        setReason('');
        setMessage(t.format('catalogue.status.changed'));
      } else refused(result.error);
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
        await refreshItems();
        setNewUnitCode('');
        setBasePerUnit('');
        setPreview(null);
        setMessage(t.format('catalogue.units.added'));
      } else refused(result.error);
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
        refused(result.error);
      }
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  async function addBarcode(): Promise<void> {
    if (working || selected === null || newBarcode.trim() === '') return;
    setWorking(true);
    try {
      const result = await system.catalogue.addBarcode(selected.id, {
        code: newBarcode,
        ...(barcodeUnit === '' ? {} : { unit: barcodeUnit as ItemUnitId }),
      });
      if (result.ok) {
        await refreshItems();
        setNewBarcode('');
        setMessage(t.format('catalogue.barcodes.added'));
      } else refused(result.error);
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  async function changeBarcode(): Promise<void> {
    if (working || target === null || barcodeReason.trim() === '') return;
    setWorking(true);
    try {
      const result = target.active
        ? await system.catalogue.deactivateBarcode(target.code, barcodeReason)
        : await system.catalogue.reactivateBarcode(target.code, barcodeReason);
      if (result.ok) {
        await refreshItems();
        setBarcodeReason('');
        setLookup(null);
        setMessage(t.format('catalogue.barcodes.changed'));
      } else refused(result.error);
    } catch {
      setMessage(t.format('data.unreachable'));
    } finally {
      setWorking(false);
    }
  }

  // The history lookup rather than the till's scan: a manager asking about a
  // withdrawn code wants to be told what it was, and that it was withdrawn.
  async function findBarcode(): Promise<void> {
    if (working || lookupCode.trim() === '') return;
    setWorking(true);
    try {
      const result = await system.catalogue.barcode(lookupCode);
      if (result.ok) {
        setLookup(result.value);
        setMessage('');
      } else {
        setLookup(null);
        refused(result.error);
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
      <Panel title={t.format('catalogue.lookup.title')}>
        <form
          className="flex flex-col gap-[var(--vx-gap-md)]"
          onSubmit={(event) => {
            event.preventDefault();
            void findBarcode();
          }}
        >
          <TextInput
            label={t.format('catalogue.lookup.code')}
            value={lookupCode}
            onChange={(value) => {
              setLookupCode(value);
              setLookup(null);
            }}
            isMachineText
            isRequired
          />
          <Button tone="secondary" type="submit" isDisabled={working || lookupCode.trim() === ''}>
            {t.format('catalogue.lookup.find')}
          </Button>
        </form>
        {/* A live region that exists before it has anything to say, so that
            a result read by a screen reader is announced as it arrives —
            not only a refusal, which the banner already announces. */}
        <div role="status" aria-label={t.format('catalogue.lookup.result')}>
          {lookup === null ? null : (
            <>
              {lookup.item.name} — <UnitLabel code={lookup.unit.unit.code} /> —{' '}
              <Code>{lookup.barcode.code}</Code> <BarcodeState barcode={lookup.barcode} />
            </>
          )}
        </div>
      </Panel>
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
          <TextInput
            label={t.format('catalogue.item.code')}
            description={t.format('catalogue.item.code.hint')}
            value={itemCode}
            onChange={setItemCode}
            isMachineText
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
        <SearchInput
          label={t.format('catalogue.search.label')}
          placeholder={t.format('catalogue.search.placeholder')}
          value={term}
          onChange={setTerm}
          maxLength={TERM_LENGTH}
          isLabelVisible
        />
        {/* Present before it has anything to say, so that the count is read
            out as it changes and a person who cannot see the list still
            hears whether the term found anything. */}
        <p role="status" aria-label={t.format('catalogue.search.result')}>
          {results === null
            ? null
            : results.total > results.items.length
              ? t.format('catalogue.search.shown', {
                  shown: results.items.length,
                  total: results.total,
                })
              : t.format('catalogue.search.count', { total: results.total })}
        </p>
        {searchRefusal === null ? null : (
          <Banner tone="warning">{messageForRefusal(t, searchRefusal)}</Banner>
        )}
        {found.unreachable ? <Banner tone="warning">{t.format('data.unreachable')}</Banner> : null}
        {results === null || results.items.length === 0 ? (
          results === null ? null : (
            <p>
              {t.format(term.trim() === '' ? 'catalogue.items.empty' : 'catalogue.search.none')}
            </p>
          )
        ) : (
          <ul>
            {results.items.map((one) => (
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
                {one.code === null ? null : (
                  <>
                    <Code>{one.code}</Code>{' '}
                  </>
                )}
                <Button
                  tone="secondary"
                  onPress={() => {
                    setSelected(one);
                    setNextStatus(one.status === 'suspended' ? 'active' : 'suspended');
                    setPreview(null);
                    setPreviewFrom('');
                    setPreviewTo('');
                    setNewBarcode('');
                    setBarcodeUnit('');
                    setBarcodeTarget('');
                    setBarcodeReason('');
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
          <h3>{t.format('catalogue.barcodes.title')}</h3>
          {selected.barcodes.length === 0 ? (
            <p>{t.format('catalogue.barcodes.empty')}</p>
          ) : (
            <ul>
              {selected.barcodes.map((barcode) => (
                <li key={barcode.code}>
                  <Code>{barcode.code}</Code> —{' '}
                  <UnitLabel
                    code={
                      selected.units.find((one) => one.id === barcode.unit)?.unit.code ??
                      selected.baseUnit.code
                    }
                  />{' '}
                  <BarcodeState barcode={barcode} />
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addBarcode();
            }}
          >
            <TextInput
              label={t.format('catalogue.barcodes.code')}
              value={newBarcode}
              onChange={setNewBarcode}
              isMachineText
              isRequired
            />
            <Select
              label={t.format('catalogue.barcodes.unit')}
              isMachineText
              options={selected.units.map((one) => ({ id: one.id, label: one.unit.code }))}
              value={barcodeUnit === '' ? (selected.units[0]?.id ?? '') : barcodeUnit}
              onChange={(key) => {
                setBarcodeUnit(String(key));
              }}
            />
            <Button tone="primary" type="submit" isDisabled={working || newBarcode.trim() === ''}>
              {t.format('catalogue.barcodes.add')}
            </Button>
          </form>
          {target === null ? null : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void changeBarcode();
              }}
            >
              <Select
                label={t.format('catalogue.barcodes.target')}
                isMachineText
                options={selected.barcodes.map((one) => ({ id: one.code, label: one.code }))}
                value={target.code}
                onChange={(key) => {
                  setBarcodeTarget(String(key));
                }}
              />
              <TextInput
                label={t.format('catalogue.barcodes.reason')}
                value={barcodeReason}
                onChange={setBarcodeReason}
                isRequired
              />
              <Button
                tone={target.active ? 'danger' : 'primary'}
                type="submit"
                isDisabled={working || barcodeReason.trim() === ''}
              >
                {t.format(
                  target.active ? 'catalogue.barcodes.deactivate' : 'catalogue.barcodes.reactivate',
                )}
              </Button>
            </form>
          )}
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

/**
 * Whether a code still scans — and, once it has been withdrawn or restored,
 * why, when and by whom: the reason is the one thing the next manager asks.
 */
function BarcodeState({ barcode }: { readonly barcode: ItemBarcode }): ReactNode {
  const t = useTranslator();
  const last = barcode.history.at(-1);
  return (
    <>
      <Badge tone={barcode.active ? 'success' : 'neutral'}>
        {t.format(barcode.active ? 'catalogue.barcodes.active' : 'catalogue.barcodes.inactive')}
      </Badge>
      {last === undefined ? null : (
        <>
          {' '}
          — {last.reason} — <DateTime value={toDate(last.at)} timeZone="UTC" /> —{' '}
          {t.format('catalogue.item.changedBy')}{' '}
          {last.by === null ? t.format('catalogue.item.system') : <Code>{last.by}</Code>}
        </>
      )}
    </>
  );
}
