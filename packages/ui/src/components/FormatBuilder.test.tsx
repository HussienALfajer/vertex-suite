import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Translator } from '@vertex/i18n';

import { VertexProvider } from '../providers/VertexProvider.js';
import { FormatBuilder, type FormatBuilderMark } from './FormatBuilder.js';

afterEach(cleanup);

const translator = new Translator({
  locale: 'ar',
  catalogue: {
    'formatBuilder.leading': 'نص قبل أول علامة',
    'formatBuilder.mark.drag': 'اسحب لإعادة ترتيب: {mark}',
    'formatBuilder.mark.width': 'عدد خانات {mark}',
    'formatBuilder.mark.suffix': 'نص بعد {mark}',
    'formatBuilder.mark.moved': '{mark} في الموضع {position} من {count}',
  },
});

const PREFIX: FormatBuilderMark = { id: 'prefix', label: 'رمز الصندوق' };
const GENERATION: FormatBuilderMark = { id: 'generation', label: 'جيل الجهاز', paddable: true };
const YEAR: FormatBuilderMark = { id: 'year', label: 'السنة المالية' };
const SEQUENCE: FormatBuilderMark = {
  id: 'sequence',
  label: 'الرقم التسلسلي',
  paddable: true,
  defaultWidth: 6,
};

const WITH_TILL = [PREFIX, GENERATION, YEAR, SEQUENCE];
const WITHOUT_TILL = [YEAR, SEQUENCE];

/** The caller a real screen is: it owns the format, and hands back whatever it is told. */
function Holder({
  initial,
  marks,
  onFormat,
  errorMessage,
}: {
  readonly initial: string;
  readonly marks: readonly FormatBuilderMark[];
  readonly onFormat: (format: string) => void;
  readonly errorMessage?: string;
}): ReactNode {
  const [format, setFormat] = useState(initial);
  return (
    <FormatBuilder
      label="الصيغة"
      marks={marks}
      value={format}
      onChange={(next) => {
        setFormat(next);
        onFormat(next);
      }}
      {...(errorMessage === undefined ? {} : { errorMessage })}
    />
  );
}

function hold(
  initial: string,
  marks: readonly FormatBuilderMark[],
  errorMessage?: string,
): ReturnType<typeof vi.fn> {
  const onFormat = vi.fn();
  render(
    <VertexProvider translator={translator} root={null}>
      <Holder
        initial={initial}
        marks={marks}
        onFormat={onFormat}
        {...(errorMessage === undefined ? {} : { errorMessage })}
      />
    </VertexProvider>,
  );
  return onFormat;
}

/** The marks, read off their handles in the order they will print. */
function cardOrder(): readonly string[] {
  return screen
    .getAllByRole('button', { name: /اسحب لإعادة ترتيب/u })
    .map((handle) => (handle.getAttribute('aria-label') ?? '').replace('اسحب لإعادة ترتيب: ', ''));
}

describe('<FormatBuilder> — a numbering format built from cards', () => {
  it('draws a format as one card per mark, in the order it will print', () => {
    hold('{prefix}-{generation}-{year}-{sequence:6}', WITH_TILL);
    expect(cardOrder()).toEqual(['رمز الصندوق', 'جيل الجهاز', 'السنة المالية', 'الرقم التسلسلي']);
    expect(screen.getByLabelText('عدد خانات الرقم التسلسلي')).toHaveProperty('value', '6');
  });

  it('reports every edit as the whole format it produces', async () => {
    const person = userEvent.setup();
    const onFormat = hold('{year}-{sequence:6}', WITHOUT_TILL);

    const between = screen.getByLabelText('نص بعد السنة المالية');
    await person.clear(between);
    await person.type(between, '/');

    expect(onFormat).toHaveBeenLastCalledWith('{year}/{sequence:6}');
  });

  it('keeps the grammar’s own braces out of the text between marks', async () => {
    const person = userEvent.setup();
    const onFormat = hold('{year}-{sequence:6}', WITHOUT_TILL);

    await person.type(screen.getByLabelText('نص بعد السنة المالية'), '{{x}');

    expect(onFormat).toHaveBeenLastCalledWith('{year}-x{sequence:6}');
  });

  it('pads a mark to no more digits than the grammar accepts', async () => {
    const person = userEvent.setup();
    const onFormat = hold('{year}-{sequence:6}', WITHOUT_TILL);

    const width = screen.getByLabelText('عدد خانات الرقم التسلسلي');
    await person.clear(width);
    await person.type(width, '150');

    expect(onFormat).toHaveBeenLastCalledWith('{year}-{sequence:99}');
  });

  it('moves a card from the keyboard, and says where it went', async () => {
    // The row is an `ltr` island, so ArrowLeft is "earlier in the format" on
    // an Arabic page as well — the direction the number is printed in.
    const person = userEvent.setup();
    const onFormat = hold('{year}-{sequence:6}', WITHOUT_TILL);

    screen.getByRole('button', { name: 'اسحب لإعادة ترتيب: الرقم التسلسلي' }).focus();
    await person.keyboard('{ArrowLeft}');

    expect(onFormat).toHaveBeenLastCalledWith('{sequence:6}-{year}');
    expect(cardOrder()).toEqual(['الرقم التسلسلي', 'السنة المالية']);
    expect(screen.getByText('الرقم التسلسلي في الموضع 1 من 2')).toBeDefined();
  });

  it('moves a card dragged by its handle, and only while the handle is held', () => {
    const onFormat = hold('{year}-{sequence:6}', WITHOUT_TILL);
    const handle = screen.getByRole('button', { name: 'اسحب لإعادة ترتيب: الرقم التسلسلي' });
    const card = handle.parentElement;
    const target = screen.getByRole('button', {
      name: 'اسحب لإعادة ترتيب: السنة المالية',
    }).parentElement;
    if (card === null || target === null) throw new Error('A card has no element.');

    // The fields inside a card are ordinary text fields until the handle is
    // held: a draggable ancestor would take a pointer's text selection away.
    expect(card.getAttribute('draggable')).toBe('false');
    fireEvent.pointerDown(handle);
    expect(card.getAttribute('draggable')).toBe('true');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragEnd(card, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'sequence');
    expect(onFormat).toHaveBeenLastCalledWith('{sequence:6}-{year}');
    expect(card.getAttribute('draggable')).toBe('false');
  });

  it('does not move a card past either end', async () => {
    const person = userEvent.setup();
    const onFormat = hold('{year}-{sequence:6}', WITHOUT_TILL);

    screen.getByRole('button', { name: 'اسحب لإعادة ترتيب: السنة المالية' }).focus();
    await person.keyboard('{ArrowLeft}');

    expect(onFormat).not.toHaveBeenCalled();
  });

  it('adds a mark the format does not carry yet, separated, and tells the caller', () => {
    // A till just chosen for a series whose format was shaped by hand.
    const onFormat = hold('{year}-{sequence:6}', WITH_TILL);
    expect(onFormat).toHaveBeenLastCalledWith('{year}-{sequence:6}-{prefix}-{generation}');
  });

  it('drops a mark no longer offered together with the separator that framed it', () => {
    // The till taken off the series again: no `{prefix}`, and no stray dash
    // left where it was.
    const onFormat = hold('{prefix}-{generation}-{year}-{sequence:6}', WITHOUT_TILL);
    expect(onFormat).toHaveBeenLastCalledWith('{year}-{sequence:6}');
  });

  it('drops a last mark together with the separator in front of it', () => {
    const onFormat = hold('{year}-{sequence:6}-{prefix}', WITHOUT_TILL);
    expect(onFormat).toHaveBeenLastCalledWith('{year}-{sequence:6}');
  });

  it('says nothing to the caller while there is no format yet to shape', () => {
    // An empty value is a caller still fetching its suggestion; reporting the
    // fallback here would overwrite the suggestion when it arrived.
    const onFormat = hold('', WITH_TILL);
    expect(onFormat).not.toHaveBeenCalled();
    expect(cardOrder()).toHaveLength(4);
  });

  it('makes the format its caller’s the moment a person edits the fallback', async () => {
    const person = userEvent.setup();
    const onFormat = hold('', WITHOUT_TILL);

    await person.type(screen.getByLabelText('نص قبل أول علامة'), 'F');

    expect(onFormat).toHaveBeenLastCalledWith('F{year}-{sequence:6}');
  });

  it('is marked invalid while it carries an error, where a form looks for one', () => {
    hold('{year}-{sequence:6}', WITHOUT_TILL, 'أدخل الصيغة.');
    expect(screen.getByRole('alert').textContent).toBe('أدخل الصيغة.');
    expect(screen.getByRole('group', { name: 'الصيغة' }).closest('[data-invalid]')).not.toBeNull();
  });

  it('lays the cards out in the order they print, whatever the page’s direction — §9', () => {
    hold('{year}-{sequence:6}', WITHOUT_TILL);
    expect(screen.getByRole('group', { name: 'الصيغة' }).getAttribute('dir')).toBe('ltr');
  });
});
