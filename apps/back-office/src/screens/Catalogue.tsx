import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Category, CategoryId, Item } from '@vertex/cat/contract';
import {
  Banner,
  Button,
  PageHeader,
  Panel,
  Select,
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
                <UnitLabel code={one.baseUnit.code} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
