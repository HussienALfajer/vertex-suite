import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { Translator } from '@vertex/i18n';

import { VertexProvider } from '../providers/VertexProvider.js';
import { Combobox, type ComboboxOption, type ComboboxProps } from './Combobox.js';

afterEach(cleanup);

const translator = new Translator({
  locale: 'ar',
  catalogue: { 'combobox.showOptions': 'إظهار الخيارات' },
});

const LABEL = 'الحساب';
const NOTHING = 'لا حساب بهذا الاسم';

/** A slice of a retail chart, which is the list this control was built for. */
const ACCOUNTS: readonly ComboboxOption[] = [
  { id: 'cash', label: '1101', detail: 'الصندوق' },
  { id: 'bank', label: '1102', detail: 'المصرف' },
  { id: 'rent', label: '5400', detail: 'الإيجار' },
  { id: 'shrinkage', label: '5210', detail: 'العجز في المخزون', isDisabled: true },
];

function Host({
  onChange,
  options,
}: {
  readonly onChange: ComboboxProps['onChange'];
  readonly options: readonly ComboboxOption[];
}): ReactNode {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <VertexProvider translator={translator} locale="ar" numerals="latn" root={null}>
      <Combobox
        label={LABEL}
        options={options}
        emptyMessage={NOTHING}
        value={chosen}
        onChange={(next) => {
          setChosen(next);
          onChange(next);
        }}
      />
    </VertexProvider>
  );
}

interface Rendered {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly changed: Mock<ComboboxProps['onChange']>;
}

function field(options: readonly ComboboxOption[] = ACCOUNTS): Rendered {
  const user = userEvent.setup();
  const changed = vi.fn<ComboboxProps['onChange']>();
  render(<Host onChange={changed} options={options} />);
  return { user, changed };
}

/**
 * The field itself, by its role rather than by its label: the label names
 * both the input and the control that opens the list, which is React Aria
 * wiring them to one name and not two fields sharing one.
 */
const box = (): HTMLInputElement => screen.getByRole('combobox');

const offered = async (): Promise<readonly string[]> =>
  (await screen.findAllByRole('option')).map((option) => option.textContent.trim());

describe('Combobox', () => {
  it('narrows the list to what was typed', async () => {
    const { user } = field();

    await user.type(box(), '11');

    expect(await offered()).toEqual(['1101الصندوق', '1102المصرف']);
  });

  it('searches what explains an option as well as what identifies it', async () => {
    // An accountant knows a third of a chart by its codes and the rest by its
    // words. A control that searched only the code would be one that answers
    // "nothing" about an account sitting in front of the person asking.
    const { user } = field();

    await user.type(box(), 'إيجار');

    expect(await offered()).toEqual(['5400الإيجار']);
  });

  it('finds a word whichever way the keyboard wrote it', async () => {
    // The same word with a tatweel in it: two keyboards, two sequences of code
    // points, one word. A plain substring match finds neither from the other.
    const { user } = field();

    await user.type(box(), 'الإيــجار');

    expect(await offered()).toEqual(['5400الإيجار']);
  });

  it('hands back the option that was chosen, and never what was typed', async () => {
    const { user, changed } = field();

    await user.type(box(), 'المصرف');
    await user.click(await screen.findByRole('option', { name: /1102/ }));

    expect(changed).toHaveBeenLastCalledWith('bank');
    // The list is closed: what comes back names an option, so nothing a person
    // types can become a value the caller has to judge.
    expect(box().value).toContain('1102');
  });

  it('says that nothing matches rather than closing on somebody mid-search', async () => {
    const { user, changed } = field();

    await user.type(box(), 'زززز');

    // React Aria announces the empty state as the one thing in the list, so
    // what is asserted is that no **account** is offered rather than that the
    // list is empty of nodes.
    expect(await screen.findByText(NOTHING)).toBeTruthy();
    expect(screen.queryByRole('option', { name: /\d{4}/ })).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it('offers an option it will not take, marked as one it will not take', async () => {
    const { user, changed } = field();

    await user.type(box(), '5210');
    const [only] = await screen.findAllByRole('option');

    expect(only?.getAttribute('aria-disabled')).toBe('true');
    await user.click(only!);
    expect(changed).not.toHaveBeenCalled();
  });

  it('opens the whole list from its own control, for somebody who is not searching', async () => {
    const { user } = field();

    await user.click(screen.getByRole('button', { name: /إظهار الخيارات/ }));

    expect(await offered()).toHaveLength(ACCOUNTS.length);
  });
});
