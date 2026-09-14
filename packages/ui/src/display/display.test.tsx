import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';

import { Translator } from '@vertex/i18n';
import { defineCurrency, defineUnit, money, quantity } from '@vertex/kernel';

import { VertexProvider } from '../providers/VertexProvider.js';
import { CurrencyRate } from './CurrencyRate.js';
import { DateTime } from './DateTime.js';
import { Money } from './Money.js';
import { Quantity } from './Quantity.js';
import { UnitLabel } from './UnitLabel.js';

afterEach(cleanup);

const USD = defineCurrency({
  code: 'USD',
  symbol: '$',
  decimals: 2,
  roundingIncrement: '0.01',
  roundingMode: 'half-up',
});

const SYP = defineCurrency({
  code: 'SYP',
  symbol: 'ل.س',
  decimals: 2,
  roundingIncrement: '100',
  roundingMode: 'half-up',
});

const KILOGRAM = defineUnit({ code: 'KG', kind: 'weight', decimals: 3 });
const PIECE = defineUnit({ code: 'PC', kind: 'count', decimals: 0 });

const translator = new Translator({
  locale: 'ar',
  catalogue: {
    'unit.KG': 'كغ',
    'unit.PC': 'قطعة',
    'date.provisional': 'مؤقت',
    'date.provisional.explanation': 'وردية فُتحت دون عقدة المتجر',
    'rate.notToday': 'ليس سعر اليوم',
  },
});

function wrap(children: ReactNode, numerals: 'latn' | 'arab' = 'latn'): void {
  render(
    <VertexProvider translator={translator} numerals={numerals} root={null}>
      {children}
    </VertexProvider>,
  );
}

describe('<Money> — §12', () => {
  it('always shows the currency code', () => {
    wrap(<Money value={money('1234.50', 'USD')} currency={USD} />);
    expect(screen.getByText('USD')).toBeDefined();
  });

  it('shows the amount at exactly the stored precision', () => {
    wrap(<Money value={money('1234.5', 'USD')} currency={USD} />);
    expect(screen.getByText('1,234.50')).toBeDefined();
  });

  it('marks a figure displayed below its stored precision, and keeps the full value', () => {
    // A rounded display must never be mistaken for the stored value.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Money value={money('1234.5678', 'USD')} currency={USD} />
      </VertexProvider>,
    );
    expect(screen.getByText('1,234.57')).toBeDefined();
    expect(container.querySelector('[title="1234.5678 USD"]')).not.toBeNull();
  });

  it('carries no marker when nothing was hidden', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Money value={money('10.00', 'USD')} currency={USD} />
      </VertexProvider>,
    );
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('renders a negative with a sign and the danger colour, never colour alone', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Money value={money('-42.00', 'USD')} currency={USD} />
      </VertexProvider>,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain('text-fg-danger');
    expect(root?.textContent).toContain('-42.00');
  });

  it('uses tabular numerals so a column aligns', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Money value={money('1.00', 'USD')} currency={USD} />
      </VertexProvider>,
    );
    expect(container.firstElementChild?.className).toContain('tabular-nums');
  });

  it('honours a currency that settles to a coarse increment', () => {
    wrap(<Money value={money('12300', 'SYP')} currency={SYP} />);
    expect(screen.getByText('12,300.00')).toBeDefined();
    expect(screen.getByText('SYP')).toBeDefined();
  });

  it('renders Western digits by default and Arabic-Indic only when the tenant asks — §5.5', () => {
    wrap(<Money value={money('1234.50', 'USD')} currency={USD} />);
    expect(screen.getByText('1,234.50')).toBeDefined();
    cleanup();
    wrap(<Money value={money('1234.50', 'USD')} currency={USD} />, 'arab');
    expect(screen.getByText(/١٬٢٣٤/u)).toBeDefined();
  });
});

describe('<Quantity> — §12', () => {
  it('never shows a weight as an integer count', () => {
    wrap(<Quantity value={quantity('0.4', 'KG')} unit={KILOGRAM} />);
    expect(screen.getByText('0.400')).toBeDefined();
  });

  it('shows a count as a whole number', () => {
    wrap(<Quantity value={quantity('3', 'PC')} unit={PIECE} />);
    expect(screen.getByText('3')).toBeDefined();
  });

  it('always states the unit, resolved through the terminology layer', () => {
    wrap(<Quantity value={quantity('1.5', 'KG')} unit={KILOGRAM} />);
    expect(screen.getByText('كغ')).toBeDefined();
  });

  it('refuses to render a quantity against a unit it is not expressed in', () => {
    expect(() => {
      wrap(<Quantity value={quantity('1', 'KG')} unit={PIECE} />);
    }).toThrow();
  });
});

describe('<UnitLabel> — SYS-08', () => {
  it('uses the tenant name for a concept when there is one', () => {
    const renamed = new Translator({
      locale: 'ar',
      catalogue: {},
      tenantTerms: { KG: 'كيلو' },
    });
    render(
      <VertexProvider translator={renamed} root={null}>
        <UnitLabel code="KG" />
      </VertexProvider>,
    );
    expect(screen.getByText('كيلو')).toBeDefined();
  });
});

describe('<DateTime> — §12', () => {
  const at = new Date('2026-09-14T09:30:00Z');

  it('renders in the branch timezone and states the zone', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <DateTime value={at} timeZone="Asia/Damascus" />
      </VertexProvider>,
    );
    expect(container.textContent).toMatch(/12:30|GMT|\+3/u);
  });

  it('marks a provisional business date visibly — POS-01', () => {
    wrap(<DateTime value={at} timeZone="Asia/Damascus" provisional />);
    expect(screen.getByText('مؤقت')).toBeDefined();
  });

  it('says nothing about provisionality when the date is confirmed', () => {
    wrap(<DateTime value={at} timeZone="Asia/Damascus" />);
    expect(screen.queryByText('مؤقت')).toBeNull();
  });
});

describe('<CurrencyRate> — FX-04', () => {
  const asOf = new Date('2026-09-14T00:00:00Z');

  it('names both halves of the quote, in the stored direction', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <CurrencyRate
          rate="14500"
          currency="SYP"
          functionalCurrency="USD"
          asOf={asOf}
          timeZone="Asia/Damascus"
          decimals={0}
        />
      </VertexProvider>,
    );
    expect(container.textContent).toContain('14,500 SYP / 1 USD');
  });

  it('marks a rate that is not today’s', () => {
    wrap(
      <CurrencyRate
        rate="14500"
        currency="SYP"
        functionalCurrency="USD"
        asOf={asOf}
        timeZone="Asia/Damascus"
        isCurrent={false}
      />,
    );
    expect(screen.getByText('ليس سعر اليوم')).toBeDefined();
  });
});
