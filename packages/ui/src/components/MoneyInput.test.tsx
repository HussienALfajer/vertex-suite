import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { Translator } from '@vertex/i18n';
import { defineCurrency, money, toDecimalString, type Currency, type Money } from '@vertex/kernel';

import { VertexProvider } from '../providers/VertexProvider.js';
import type { Numerals } from '../providers/context.js';
import { MoneyInput, type MoneyInputProps } from './MoneyInput.js';

afterEach(cleanup);

const translator = new Translator({ locale: 'ar', catalogue: {} });

const USD = defineCurrency({
  code: 'USD',
  symbol: '$',
  decimals: 2,
  roundingIncrement: '0.01',
  roundingMode: 'half-up',
});

/** A currency settled to the note and kept to no places: the field has no fraction to take. */
const SYP = defineCurrency({
  code: 'SYP',
  symbol: 'S',
  decimals: 0,
  roundingIncrement: '100',
  roundingMode: 'half-up',
});

const LABEL = 'المبلغ';

/**
 * The field as a screen actually holds it: the amount lives in the caller's
 * state and comes back down as the value.
 *
 * Controlled, because that is what it is — like `TextInput` and `DateInput`
 * before it. A harness that dropped what the field handed back would be
 * testing a control nothing in this product uses, and would hide the one
 * behaviour a controlled field owes its caller: an edit the caller does not
 * keep is an edit that does not stay on screen.
 */
function Host({
  currency,
  onChange,
  numerals,
}: {
  readonly currency: Currency;
  readonly onChange: MoneyInputProps['onChange'];
  readonly numerals: Numerals;
}): ReactNode {
  const [held, setHeld] = useState<Money | null>(null);
  // A screen that changes which currency a figure is in clears the figure,
  // because an amount is in one currency and pointing the field at another
  // does not convert it. Held here so the field is exercised the way a screen
  // drives it.
  const [was, setWas] = useState(currency.code);
  if (was !== currency.code) {
    setWas(currency.code);
    setHeld(null);
  }
  return (
    <VertexProvider translator={translator} locale="ar" numerals={numerals} root={null}>
      <MoneyInput
        label={LABEL}
        currency={currency}
        value={held}
        onChange={(next) => {
          setHeld(next);
          onChange(next);
        }}
      />
    </VertexProvider>
  );
}

interface Rendered {
  readonly user: ReturnType<typeof userEvent.setup>;
  /**
   * Typed by the prop it stands in for, so that what this asserts about the
   * value handed back is checked when the file compiles: an untyped mock makes
   * every argument `any`, and an assertion about an `any` proves nothing about
   * the type the component promises.
   */
  readonly changed: Mock<MoneyInputProps['onChange']>;
  readonly withCurrency: (currency: Currency) => void;
}

function field(currency: Currency = USD, numerals: Numerals = 'latn'): Rendered {
  const user = userEvent.setup();
  const changed = vi.fn<MoneyInputProps['onChange']>();
  const view = render(<Host currency={currency} onChange={changed} numerals={numerals} />);
  return {
    user,
    changed,
    withCurrency: (next) => {
      view.rerender(<Host currency={next} onChange={changed} numerals={numerals} />);
    },
  };
}

const box = (): HTMLInputElement => screen.getByLabelText(LABEL);

/** The last amount the field handed back, written the way the kernel writes one. */
const handedBack = (changed: Mock<MoneyInputProps['onChange']>): string | null => {
  const last = changed.mock.calls.at(-1)?.[0] ?? null;
  return last === null ? null : `${toDecimalString(last)} ${last.currency}`;
};

describe('MoneyInput', () => {
  it('hands back an exact amount in its own currency, never a number', async () => {
    const { user, changed } = field();

    await user.type(box(), '1250.75');

    expect(handedBack(changed)).toBe('1250.75 USD');
    // The whole reason this is not a number field: a float cannot hold the
    // figure a shop settles in, and nothing on this path ever became one.
    expect(typeof changed.mock.calls.at(-1)?.[0]?.amount).not.toBe('number');
  });

  it('does not take a keystroke that would leave something no amount, and keeps what was there', async () => {
    const { user, changed } = field();

    await user.type(box(), '12a3');

    // The letter never lands, so `12` stays on screen and the digit after it
    // carries on from there. A field that took the letter and then refused the
    // value would be showing a figure nobody typed.
    expect(box().value).toBe('123');
    expect(handedBack(changed)).toBe('123 USD');
  });

  it('refuses more places than the currency is kept to, rather than rounding them away', async () => {
    // `fin.line-amount-too-precise` made unreachable: the module refuses a
    // figure that passed no rounding point of `FX-07`, and a control that
    // rounded it here would be a second opinion about a tenant's money.
    const { user, changed } = field();

    await user.type(box(), '10.999');

    expect(box().value).toBe('10.99');
    expect(handedBack(changed)).toBe('10.99 USD');
  });

  it('takes no decimal mark at all for a currency kept to no places', async () => {
    const { user, changed } = field(SYP);

    await user.type(box(), '5000.5');

    expect(box().value).toBe('50005');
    expect(handedBack(changed)).toBe('50005 SYP');
  });

  it('is empty until a figure is typed, and a lone decimal mark is still empty', async () => {
    const { user, changed } = field();

    await user.type(box(), '.');

    expect(box().value).toBe('.');
    expect(handedBack(changed)).toBeNull();

    await user.type(box(), '5');

    expect(handedBack(changed)).toBe('0.5 USD');
  });

  it('reads and writes the reader’s own digits, and stores the figures the kernel keeps', async () => {
    // §5.5: which digits are displayed is a tenant's setting and never touches
    // a stored value. A shopkeeper reading in Arabic-Indic digits types the
    // ones on their own keyboard, and the books hold `500.25`.
    const { user, changed } = field(USD, 'arab');

    await user.type(box(), '٥٠٠٫٢٥');

    expect(handedBack(changed)).toBe('500.25 USD');
    expect(box().value).toBe('٥٠٠٫٢٥');
  });

  it('settles a figure pasted in other digits into the ones the page is written in', async () => {
    const { user, changed } = field(USD, 'arab');

    await user.click(box());
    await user.paste('1,234.50');

    // The group marks are what `Intl` writes and never what a figure means, so
    // they are dropped; the digits and the mark become the reader's own.
    expect(handedBack(changed)).toBe('1234.5 USD');
    expect(box().value).toBe('١٢٣٤٫٥٠');
  });

  it('shows the currency it is an amount of, because a bare figure is one nobody can check', () => {
    field();

    expect(screen.getByText(USD.code)).toBeTruthy();
  });

  it('is a field of whichever currency it is handed, and not the one before it', async () => {
    // The field follows the currency rather than the other way round: a figure
    // the caller has cleared leaves the field, and what may be typed next is
    // what the new currency can hold.
    const { user, withCurrency } = field();
    await user.type(box(), '12.34');
    expect(box().value).toBe('12.34');

    withCurrency(SYP);
    expect(box().value).toBe('');
    expect(screen.getByText(SYP.code)).toBeTruthy();

    await user.type(box(), '56.78');
    expect(box().value).toBe('5678');
  });

  it('shows an amount it was given without waiting to be typed into', () => {
    const changed = vi.fn<MoneyInputProps['onChange']>();
    render(
      <VertexProvider translator={translator} locale="ar" numerals="latn" root={null}>
        <MoneyInput label={LABEL} currency={USD} value={money('99.5', 'USD')} onChange={changed} />
      </VertexProvider>,
    );

    expect(box().value).toBe('99.5');
  });
});
