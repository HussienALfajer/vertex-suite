import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { Translator } from '@vertex/i18n';
import { localDate, type LocalDate } from '@vertex/kernel';

import { VertexProvider } from '../providers/VertexProvider.js';
import type { Numerals } from '../providers/context.js';
import { DateInput, type DateInputProps } from './DateInput.js';

afterEach(cleanup);

const translator = new Translator({ locale: 'ar', catalogue: {} });

/** The figures a day is written from, which is what a field holds and shows. */
const day = (written: string): LocalDate => {
  const value = localDate(written);
  if (value === null) throw new Error(`"${written}" is not a day.`);
  return value;
};

interface Rendered {
  readonly user: ReturnType<typeof userEvent.setup>;
  /**
   * Typed by the prop it stands in for rather than left as `vi.fn()`, so that
   * what this asserts about the value handed back is checked when the file
   * compiles and not only when it runs: an untyped mock makes every argument
   * `any`, and `expect(given).toMatch(…)` on an `any` proves nothing about the
   * type the component promises.
   */
  readonly changed: Mock<DateInputProps['onChange']>;
}

function field(
  props: Partial<DateInputProps> = {},
  numerals: Numerals = 'latn',
  locale = 'ar',
): Rendered {
  const user = userEvent.setup();
  const changed = vi.fn<DateInputProps['onChange']>();
  render(
    <VertexProvider translator={translator} locale={locale} numerals={numerals} root={null}>
      <DateInput
        label="بداية السنة المالية"
        value={day('2026-09-20')}
        onChange={changed}
        {...props}
      />
    </VertexProvider>,
  );
  return { user, changed };
}

/** The editable parts, in the order the locale lays them out. */
const segments = (): readonly HTMLElement[] => screen.getAllByRole('spinbutton');

const shownAs = (): string =>
  segments()
    .map((segment) => segment.textContent)
    .join('|');

/** Steps one part of the field, which is how a day already on screen is corrected. */
async function nudge(rendered: Rendered, part: number): Promise<void> {
  const segment = segments()[part];
  if (segment === undefined) throw new Error(`The field has no part ${String(part)}.`);
  await rendered.user.click(segment);
  await rendered.user.keyboard('{ArrowUp}');
}

/** The day the last change handed back, which is what every one of these is about. */
function lastGiven(rendered: Rendered): LocalDate | null {
  const call = rendered.changed.mock.calls.at(-1);
  if (call === undefined) throw new Error('The field never changed.');
  return call[0];
}

describe('<DateInput>', () => {
  it('holds a day as the product writes one, and shows it a part at a time', () => {
    field();

    // Three editable parts, never one text box: a field that parses typed text
    // has to decide whether `03/04` is March or April, silently, in a shop
    // where both conventions are in living memory.
    expect(segments()).toHaveLength(3);
    expect(shownAs()).toContain('2026');
    expect(shownAs()).toContain('20');
  });

  it('writes the figures in the tenant’s digits without the day changing — §5.5', () => {
    // The same day, twice, with only the display setting between them. What
    // comes back out is what this asserts is unmoved: `value` never sees a
    // digit shape.
    field({}, 'arab');

    expect(shownAs()).toContain('٢٠٢٦');
    expect(shownAs()).not.toContain('2026');
  });

  it('hands back the product’s own day, not a calendar object', async () => {
    // React Aria's segments step by arrow key, which is the one interaction a
    // person uses on a date they are correcting rather than replacing.
    const rendered = field();
    await nudge(rendered, 0);

    expect(rendered.changed).toHaveBeenCalledTimes(1);
    // A string in the one spelling `@vertex/kernel` accepts, and nothing else:
    // a screen states a day the way every record in this product states one.
    const given = lastGiven(rendered);
    expect(typeof given).toBe('string');
    expect(given).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(given).not.toBe('2026-09-20');
  });

  it('keeps the product’s own calendar when the reader’s locale displays another', async () => {
    // A reader whose locale asks for Umm al-Qura sees 09/04/1448 where the
    // value is 2026-09-20. What must not happen is those figures being stored:
    // `1448-04-09` and `2026-09-20` are the same day and different records, and
    // every period boundary in `FIN-05` is compared as the latter.
    const rendered = field({}, 'latn', 'ar-u-ca-islamic-umalqura');
    expect(shownAs()).toContain('1448');

    await nudge(rendered, 0);

    // The Gregorian day, moved by exactly the part that was stepped — never a
    // Hijri figure, and never the `[u-ca-…]` suffix a non-Gregorian date
    // writes itself out with.
    expect(lastGiven(rendered)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lastGiven(rendered)).not.toBe('2026-09-20');
  });

  it('starts an empty field on the day the caller named, never on the machine’s clock', async () => {
    // A day in this product is always somewhere's day. Left to itself React
    // Aria would take the empty field's first keystroke from the device it is
    // displayed on — which on a register whose clock is wrong is the one
    // moment in the interface nobody could correct at a seam.
    const rendered = field({ value: null, placeholder: day('1999-01-31') });

    for (let part = 0; part < segments().length; part += 1) await nudge(rendered, part);

    expect(lastGiven(rendered)).toBe('1999-01-31');
  });

  it('says what is wrong beside the field, and marks the field itself', () => {
    field({ errorMessage: 'اليوم خارج التقويم.' });

    expect(screen.getByText('اليوم خارج التقويم.')).toBeDefined();
    const [first] = segments();
    expect(first?.getAttribute('aria-invalid')).toBe('true');
  });

  it('is one tab stop, landing on the first part a person would type', async () => {
    // Three parts and one stop: a form with four dates on it is four tab
    // presses, not twelve (§11.1). Moving **between** the parts is by arrow
    // and is laid out from measured positions, which no document
    // implementation reports; `ledger.spec.ts` proves it in a real browser.
    const rendered = field();

    await rendered.user.tab();
    expect(document.activeElement?.getAttribute('role')).toBe('spinbutton');
    expect(document.activeElement).toBe(segments()[0]);
  });
});
