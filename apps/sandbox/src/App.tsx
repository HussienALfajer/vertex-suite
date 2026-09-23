import { useMemo, useState, type ReactNode } from 'react';

import { defineCurrency, defineUnit, money, quantity } from '@vertex/kernel';
import {
  Badge,
  Banner,
  BreadcrumbTrail,
  Button,
  Checkbox,
  ConfirmationDialog,
  CurrencyRate,
  DataTable,
  DateTime,
  DensityScope,
  Dialog,
  IconButton,
  Money,
  Page,
  PageHeader,
  Panel,
  Quantity,
  Select,
  SideNav,
  Switch,
  TableRowAction,
  TableRowActions,
  TextInput,
  ToastRegion,
  useToast,
  VertexProvider,
  type DataTableColumn,
  type Density,
  type Numerals,
  type ThemeChoice,
} from '@vertex/ui';

import { createTranslator } from './catalogue.js';
import { SyncDemo } from './sync.js';

const USD = defineCurrency({
  code: 'USD',
  symbol: '$',
  decimals: 2,
  roundingIncrement: '0.01',
  roundingMode: 'half-up',
});
const SYP = defineCurrency({
  code: 'SYP',
  symbol: 'ل.س', // policy-exempt: §12 — a currency symbol is data (FX-01), not a label
  decimals: 2,
  roundingIncrement: '100',
  roundingMode: 'half-up',
});
const KILOGRAM = defineUnit({ code: 'KG', kind: 'weight', decimals: 3 });
const PIECE = defineUnit({ code: 'PC', kind: 'count', decimals: 0 });

const TIMEZONE = 'Asia/Damascus';
const NOW = new Date('2026-09-14T09:30:00Z');

interface Item {
  readonly id: string;
  readonly nameKey: string;
  readonly stock: string;
  readonly price: string;
}

const ROWS: readonly Item[] = [
  { id: '1', nameKey: 'sample.sugar', stock: '0.400', price: '12300' },
  { id: '2', nameKey: 'sample.rice', stock: '18.000', price: '58900' },
  { id: '3', nameKey: 'sample.oil', stock: '4.250', price: '41200' },
];

const COLUMNS = (t: (key: string) => string): readonly DataTableColumn<Item>[] => [
  { id: 'name', header: t('column.name'), isRowHeader: true, render: (row) => t(row.nameKey) },
  {
    id: 'stock',
    header: t('column.stock'),
    align: 'end',
    render: (row) => <Quantity value={quantity(row.stock, 'KG')} unit={KILOGRAM} />,
  },
  {
    id: 'price',
    header: t('column.price'),
    align: 'end',
    render: (row) => <Money value={money(row.price, 'SYP')} currency={SYP} />,
  },
  {
    id: 'actions',
    header: t('column.actions'),
    align: 'end',
    render: () => (
      <TableRowActions>
        <TableRowAction aria-label={t('action.edit')}>
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="fill-none stroke-current"
            strokeWidth="1.5"
          >
            <path d="M13 3.5l3.5 3.5L7 16.5H3.5V13z" strokeLinejoin="round" />
          </svg>
        </TableRowAction>
      </TableRowActions>
    ),
  },
];

function NotifyButton({ label, message }: { label: string; message: string }): ReactNode {
  const toast = useToast();
  return (
    <Button
      onPress={() => {
        toast.show(message, { tone: 'success' });
      }}
    >
      {label}
    </Button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="border-line flex items-baseline justify-between gap-[var(--vx-gap-md)] border-b py-[var(--vx-pad-sm)] last:border-0">
      <span className="text-fg-secondary text-footnote">{label}</span>
      {children}
    </div>
  );
}

export function App(): ReactNode {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [density, setDensity] = useState<Density>('comfortable');
  const [numerals, setNumerals] = useState<Numerals>('latn');
  const translator = useMemo(() => createTranslator(), []);
  const t = (key: string): string => translator.format(key);

  return (
    <VertexProvider
      translator={translator}
      theme={theme}
      density={density}
      numerals={numerals}
      locale="ar"
    >
      <ToastRegion>
        <Page>
          <BreadcrumbTrail
            label={t('crumbs.label')}
            items={[
              { id: 'home', label: t('crumbs.home'), href: '#' },
              { id: 'items', label: t('nav.items') },
            ]}
          />
          <PageHeader
            title={t('page.title')}
            description={t('page.description')}
            actions={
              <>
                <Button tone="secondary">{t('action.cancel')}</Button>
                <Button tone="primary">{t('action.save')}</Button>
              </>
            }
          />

          <Panel title={t('panel.actions')}>
            <div className="flex flex-col gap-[var(--vx-gap-md)]">
              <div className="flex flex-wrap items-center gap-[var(--vx-gap-sm)]">
                <Button tone="primary">{t('action.save')}</Button>
                <Button tone="secondary">{t('action.cancel')}</Button>
                <Button tone="ghost">{t('action.more')}</Button>
                <Button tone="danger">{t('action.delete')}</Button>
                <Button tone="primary" isDisabled>
                  {t('action.save')}
                </Button>
                <IconButton aria-label={t('action.more')}>
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <circle cx="4" cy="10" r="1.6" />
                    <circle cx="10" cy="10" r="1.6" />
                    <circle cx="16" cy="10" r="1.6" />
                  </svg>
                </IconButton>
              </div>

              <DensityScope value="compact">
                <div className="flex flex-wrap items-center gap-[var(--vx-gap-sm)]">
                  <Button tone="primary">{t('action.save')}</Button>
                  <Button tone="secondary">{t('action.cancel')}</Button>
                  <span className="text-fg-muted text-caption">compact</span>
                </div>
              </DensityScope>

              <DensityScope value="touch">
                <div className="flex flex-wrap items-center gap-[var(--vx-gap-sm)]">
                  <Button tone="primary">{t('action.save')}</Button>
                  <Button tone="secondary">{t('action.cancel')}</Button>
                  <span className="text-fg-muted text-caption">touch</span>
                </div>
              </DensityScope>
            </div>
          </Panel>

          <div className="grid gap-[var(--vx-gap-lg)] md:grid-cols-2">
            <Panel title={t('panel.figures')}>
              <Row label={t('figure.price')}>
                <Money value={money('12300', 'SYP')} currency={SYP} />
              </Row>
              <Row label={t('figure.cost')}>
                <Money value={money('8.4567', 'USD')} currency={USD} />
              </Row>
              <Row label={t('figure.variance')}>
                <Money value={money('-42.50', 'USD')} currency={USD} />
              </Row>
              <Row label={t('figure.weight')}>
                <Quantity value={quantity('0.4', 'KG')} unit={KILOGRAM} />
              </Row>
              <Row label={t('figure.count')}>
                <Quantity value={quantity('3', 'PC')} unit={PIECE} />
              </Row>
              <Row label={t('figure.rate')}>
                <CurrencyRate
                  rate="14500"
                  currency="SYP"
                  functionalCurrency="USD"
                  asOf={NOW}
                  timeZone={TIMEZONE}
                  decimals={0}
                  isCurrent={false}
                />
              </Row>
              <Row label={t('figure.openedAt')}>
                <DateTime value={NOW} timeZone={TIMEZONE} provisional />
              </Row>
            </Panel>

            <div className="flex flex-col gap-[var(--vx-gap-lg)]">
              <Panel title={t('panel.fields')}>
                <div className="flex flex-col gap-[var(--vx-gap-md)]">
                  <TextInput label={t('field.itemName')} description={t('field.itemName.help')} />
                  <TextInput label={t('field.barcode')} errorMessage={t('field.barcode.error')} />
                </div>
              </Panel>

              <Panel title={t('panel.status')}>
                <div className="flex flex-wrap items-center gap-[var(--vx-gap-sm)]">
                  <Badge tone="success">{t('status.posted')}</Badge>
                  <Badge tone="warning">{t('status.pending')}</Badge>
                  <Badge tone="danger">{t('status.belowCost')}</Badge>
                  <Badge tone="neutral">{t('status.draft')}</Badge>
                  <Badge tone="info">{t('status.info')}</Badge>
                </div>
              </Panel>
            </div>
          </div>

          <Panel title={t('nav.label')} flush>
            <SideNav
              label={t('nav.label')}
              currentId="items"
              className="w-full border-e-0"
              items={[
                { id: 'items', label: t('nav.items'), href: '#', badge: '3' },
                { id: 'stock', label: t('nav.stock'), href: '#' },
                { id: 'reports', label: t('nav.reports'), href: '#' },
              ]}
            />
          </Panel>

          <Panel title={t('panel.notices')}>
            <div className="flex flex-col gap-[var(--vx-gap-sm)]">
              <Banner tone="info">{t('banner.info')}</Banner>
              <Banner tone="warning">{t('banner.warning')}</Banner>
              <Banner tone="danger">{t('banner.danger')}</Banner>
            </div>
          </Panel>

          <SyncDemo timeZone={TIMEZONE} />

          <div className="grid gap-[var(--vx-gap-lg)] md:grid-cols-2">
            <Panel title={t('panel.grid')} flush>
              <DataTable
                label={t('panel.grid')}
                columns={COLUMNS(t)}
                rows={ROWS}
                emptyMessage={t('grid.empty')}
              />
            </Panel>

            <Panel title={t('panel.overlays')}>
              <div className="flex flex-col gap-[var(--vx-gap-md)]">
                <Select
                  label={t('select.unit')}
                  options={[
                    { id: 'KG', label: 'KG' },
                    { id: 'PC', label: 'PC' },
                    { id: 'BOX', label: 'BOX' },
                  ]}
                />
                <Checkbox defaultSelected>{t('toggle.active')}</Checkbox>
                <Switch>{t('toggle.track')}</Switch>

                <div className="flex flex-wrap items-center gap-[var(--vx-gap-sm)]">
                  <Dialog
                    title={t('dialog.title')}
                    trigger={<Button>{t('action.openDialog')}</Button>}
                    footer={<Button tone="primary">{t('action.save')}</Button>}
                  >
                    <p>{t('dialog.body')}</p>
                  </Dialog>

                  <ConfirmationDialog
                    title={t('confirm.title')}
                    message={t('confirm.message')}
                    confirmLabel={t('action.delete')}
                    tone="danger"
                    onConfirm={() => undefined}
                    trigger={<Button tone="danger">{t('action.confirmDelete')}</Button>}
                  />

                  <NotifyButton label={t('action.notify')} message={t('toast.saved')} />
                </div>
              </div>
            </Panel>
          </div>

          <Panel>
            <div className="flex flex-wrap items-end gap-[var(--vx-gap-lg)]">
              <Switcher
                label={t('theme.label')}
                value={theme}
                onChange={setTheme}
                options={[
                  ['system', t('theme.system')],
                  ['light', t('theme.light')],
                  ['dark', t('theme.dark')],
                ]}
              />
              <Switcher
                label={t('density.label')}
                value={density}
                onChange={setDensity}
                options={[
                  ['compact', t('density.compact')],
                  ['comfortable', t('density.comfortable')],
                  ['touch', t('density.touch')],
                ]}
              />
              <Switcher
                label={t('numerals.label')}
                value={numerals}
                onChange={setNumerals}
                options={[
                  ['latn', t('numerals.latn')],
                  ['arab', t('numerals.arab')],
                ]}
              />
            </div>
          </Panel>
        </Page>
      </ToastRegion>
    </VertexProvider>
  );
}

function Switcher<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly (readonly [T, string])[];
}): ReactNode {
  return (
    <div className="flex flex-col gap-[var(--vx-gap-xs)]">
      <span className="text-fg-secondary text-footnote">{label}</span>
      <div className="flex gap-[var(--vx-gap-xs)]">
        {options.map(([key, text]) => (
          <Button
            key={key}
            tone={key === value ? 'primary' : 'secondary'}
            onPress={() => {
              onChange(key);
            }}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  );
}
