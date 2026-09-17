import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Translator } from '@vertex/i18n';
import { defineCurrency, defineUnit, money, quantity } from '@vertex/kernel';

import { VertexProvider } from '../providers/VertexProvider.js';
import { Code } from './Code.js';
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

  it('refuses to render an amount against a currency it is not expressed in', () => {
    // Dollars given the pound's precision and code printed `12.50 SYP`.
    expect(() => {
      wrap(<Money value={money('12.50', 'USD')} currency={SYP} />);
    }).toThrow();
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

  it('marks a quantity shown at less precision than stored, not only on hover', () => {
    // A title is a full value for whoever hovers; §12 asks for a marker too.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Quantity value={quantity('1.23456', 'KG')} unit={KILOGRAM} />
      </VertexProvider>,
    );
    expect(container.textContent).toContain('≈');
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('1.23456 KG');
  });
});

describe('<UnitLabel> — a tenant renames a unit', () => {
  // The display half of SYS-08; the override itself is U27's to prove.
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

  it('marks a provisional business date visibly', () => {
    // POS-01's offline day needs this mark; it does not prove the day.
    wrap(<DateTime value={at} timeZone="Asia/Damascus" provisional />);
    expect(screen.getByText('مؤقت')).toBeDefined();
  });

  it('says nothing about provisionality when the date is confirmed', () => {
    wrap(<DateTime value={at} timeZone="Asia/Damascus" />);
    expect(screen.queryByText('مؤقت')).toBeNull();
  });
});

describe('<CurrencyRate> — a rate and the day it was set', () => {
  // FX-04 shows a rate's date on every currency-sensitive screen; this is the component, not the rule.
  const asOf = new Date('2026-09-14T00:00:00Z');

  it('marks a rate shown at less precision than it is carried, and keeps its full value', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <CurrencyRate
          rate="0.923456"
          currency="EUR"
          functionalCurrency="USD"
          asOf={asOf}
          timeZone="Asia/Damascus"
        />
      </VertexProvider>,
    );
    expect(container.textContent).toContain('≈');
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('0.923456 EUR / 1 USD');
  });

  it('writes the one of "per one" in the tenant’s digits, like the rate beside it', () => {
    const { container } = render(
      <VertexProvider translator={translator} numerals="arab" root={null}>
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
    expect(container.textContent).toContain('SYP / ١ USD');
  });

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

describe('Code — SYS-01', () => {
  it('is an island of its own direction inside an Arabic document', () => {
    // The measurement is in `Code`'s own comment: in a right-to-left paragraph
    // the algorithm resolves a bracket pair to the paragraph's direction
    // (UAX #9, N0), and `SYS-02`'s default format comes out as its four parts
    // in reverse. No layout engine runs under these tests, so what is asserted
    // here is the mechanism that prevents it — and `dir` carries
    // `unicode-bidi: isolate` with it, so the fragment cannot reorder the
    // sentence around it either.
    wrap(<Code>{'{prefix}-{generation}-{year}-{sequence:6}'}</Code>);
    const rendered = screen.getByText('{prefix}-{generation}-{year}-{sequence:6}');

    expect(rendered.getAttribute('dir')).toBe('ltr');
    expect(rendered.className).toContain('font-mono');
  });

  it('carries the whole of a value it is a shortened form of', () => {
    // A column shows the tail of a machine's identifier; the whole of it is
    // what somebody compares against the screen the till is showing.
    wrap(<Code title="01920a7b-3c4d-7e5f-8a9b-0c1d2e3f4a5b">2e3f4a5b</Code>);
    expect(screen.getByText('2e3f4a5b').getAttribute('title')).toBe(
      '01920a7b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
    );
  });
});
