import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Translator } from '@vertex/i18n';

import { DensityScope } from '../providers/DensityScope.js';
import { VertexProvider } from '../providers/VertexProvider.js';
import { Badge } from './Badge.js';
import { Button, IconButton } from './Button.js';
import { Checkbox, Switch } from './Toggle.js';
import { DataTable } from './DataTable.js';
import { UnsavedChangesDialog } from './Dialog.js';
import { focusFirstInvalid } from './focusFirstInvalid.js';
import { SideNav } from './Navigation.js';
import { Page, PageHeader } from './Page.js';
import { Panel } from './Panel.js';
import { SearchInput } from './SearchInput.js';
import { ToastRegion, useToast } from './Toast.js';
import { Tabs } from './Tabs.js';
import { TextInput } from './TextInput.js';

afterEach(cleanup);

const translator = new Translator({
  locale: 'ar',
  catalogue: {
    'a11y.skipToContent': 'تخطَّ إلى المحتوى',
    'action.dismiss': 'إغلاق',
    'action.cancel': 'إلغاء',
  },
});

function wrap(children: ReactNode): void {
  render(
    <VertexProvider translator={translator} root={null}>
      {children}
    </VertexProvider>,
  );
}

describe('<Button>', () => {
  it('is operable from the keyboard alone', async () => {
    // What POS-02 asks of every control; the register, not a button, proves it.
    const user = userEvent.setup();
    const pressed = vi.fn();
    wrap(<Button onPress={pressed}>حفظ</Button>);

    await user.tab();
    expect(document.activeElement?.textContent).toBe('حفظ');
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(pressed).toHaveBeenCalledTimes(2);
  });

  it('spends the neutral fill on the primary action, never the accent', () => {
    // §4.4 names fill-primary the neutral primary button. If the accent were
    // spent on every confirm, focus would have to compete with it — and focus
    // is what a keyboard-only cashier actually tracks.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Button tone="primary">حفظ</Button>
      </VertexProvider>,
    );
    const className = container.querySelector('button')?.className ?? '';
    expect(className).toContain('bg-fill-primary');
    expect(className).not.toContain('bg-fill-accent');
  });

  it('carries a focus ring that is never simply removed', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Button>حفظ</Button>
      </VertexProvider>,
    );
    const className = container.querySelector('button')?.className ?? '';
    expect(className).toContain('outline-none');
    expect(className).toContain('--vx-focus-ring');
  });

  it('takes the danger ring on a destructive control', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Button tone="danger">حذف</Button>
      </VertexProvider>,
    );
    expect(container.querySelector('button')?.className).toContain('--vx-focus-ring-danger');
  });

  it('does not fire when disabled', async () => {
    const user = userEvent.setup();
    const pressed = vi.fn();
    wrap(
      <Button isDisabled onPress={pressed}>
        حفظ
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(pressed).not.toHaveBeenCalled();
  });
});

describe('<IconButton>', () => {
  it('is square at the control height, so touch clears 48px for free', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <IconButton aria-label="إغلاق">
          <svg />
        </IconButton>
      </VertexProvider>,
    );
    const className = container.querySelector('button')?.className ?? '';
    expect(className).toContain('h-[var(--vx-h-control)]');
    expect(className).toContain('w-[var(--vx-h-control)]');
  });

  it('has an accessible name', () => {
    wrap(
      <IconButton aria-label="إغلاق">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeDefined();
  });
});

describe('<TextInput>', () => {
  it('wires its label, description and error to the input', () => {
    wrap(<TextInput label="اسم الصنف" description="كما يظهر على الرف" />);
    const input = screen.getByLabelText('اسم الصنف');
    expect(input).toBeDefined();
    expect(input.getAttribute('aria-describedby')).not.toBeNull();
  });

  it('marks itself invalid when it carries an error', () => {
    wrap(<TextInput label="اسم الصنف" errorMessage="مطلوب" />);
    expect(screen.getByLabelText('اسم الصنف').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('مطلوب')).toBeDefined();
  });

  it('accepts typing', async () => {
    const user = userEvent.setup();
    wrap(<TextInput label="اسم الصنف" />);
    await user.type(screen.getByLabelText('اسم الصنف'), 'سكر');
    expect(screen.getByLabelText<HTMLInputElement>('اسم الصنف').value).toBe('سكر');
  });

  it('lays machine text out in the order it was typed — SYS-01', () => {
    // A numbering format is bracket pairs separated by punctuation, and in a
    // right-to-left paragraph the algorithm resolves those brackets to the
    // paragraph's direction (UAX #9, N0) and reverses the parts: measured in a
    // browser, `{prefix}-{generation}-{year}-{sequence:6}` comes out as
    // `{sequence:6}-{year}-{generation}-{prefix}`. It cannot be asserted here
    // — no layout engine under these tests — so what is asserted is the
    // mechanism that prevents it, which `Code` carries the measurement for.
    wrap(<TextInput label="الصيغة" isMachineText defaultValue="{prefix}-{sequence:6}" />);
    const input = screen.getByLabelText('الصيغة');

    expect(input.getAttribute('dir')).toBe('ltr');
    // The label is prose and stays in the document's own direction: it is read
    // in the same breath as the Arabic sentence above it.
    expect(screen.getByText('الصيغة').getAttribute('dir')).toBeNull();
  });

  it('leaves an ordinary field in the document’s direction', () => {
    wrap(<TextInput label="اسم الصنف" />);
    expect(screen.getByLabelText('اسم الصنف').getAttribute('dir')).toBeNull();
  });

  it('never lets the browser write the error message — §12', () => {
    // Left to validate natively, the browser writes "Please fill out this
    // field." in its own language, under a label reading "اسم المستخدم". It is
    // the one user-facing string nothing in this repository can translate and
    // no tenant can rename, so the constraint is announced and the words are
    // left to `errorMessage`.
    wrap(<TextInput label="اسم الصنف" isRequired />);
    const input = screen.getByLabelText<HTMLInputElement>('اسم الصنف');

    expect(input.getAttribute('aria-required')).toBe('true');
    // Native validation would report invalid on an empty required field and
    // hand the browser its own words to say about it.
    expect(input.required).toBe(false);
    expect(input.validity.valid).toBe(true);
  });
});

describe('<Page>', () => {
  it('begins with a skip link, resolved through the terminology layer', () => {
    wrap(
      <Page>
        <PageHeader title="الأصناف" />
      </Page>,
    );
    const link = screen.getByRole('link', { name: 'تخطَّ إلى المحتوى' });
    expect(link.getAttribute('href')).toBe('#main');
  });

  it('has exactly one page title', () => {
    wrap(
      <Page>
        <PageHeader title="الأصناف" description="كل ما يُباع" />
        <Panel title="لوحة">محتوى</Panel>
      </Page>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });
});

describe('<SideNav> grouping', () => {
  it('prints a heading once, only where a `group` starts, and not over an ungrouped item', () => {
    wrap(
      <SideNav
        label="nav"
        items={[
          { id: 'a', label: 'Alpha', href: '/a' },
          { id: 'b', label: 'Beta', href: '/b', group: 'One' },
          { id: 'c', label: 'Gamma', href: '/c', group: 'One' },
          { id: 'd', label: 'Delta', href: '/d', group: 'Two' },
        ]}
      />,
    );

    // Named once each, though "One" covers two items — a caller repeating a
    // group name for every item in it must not repeat the heading too.
    expect(screen.getAllByText('One')).toHaveLength(1);
    expect(screen.getAllByText('Two')).toHaveLength(1);
    // Every link is still on screen, headings or not.
    for (const label of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('prints no heading at all when nothing sets `group`, unchanged from before it existed', () => {
    wrap(
      <SideNav
        label="nav"
        items={[
          { id: 'a', label: 'Alpha', href: '/a' },
          { id: 'b', label: 'Beta', href: '/b' },
        ]}
      />,
    );

    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

describe('<DataTable> rowKey', () => {
  interface CodeKeyed {
    readonly code: string;
    readonly name: string;
  }

  it('keys a row by `rowKey` for a record with no `id`, rather than requiring one', () => {
    const rows: readonly CodeKeyed[] = [
      { code: 'SYP', name: 'Syrian pound' },
      { code: 'USD', name: 'US dollar' },
    ];

    wrap(
      <DataTable
        label="currencies"
        rows={rows}
        rowKey={(row) => row.code}
        emptyMessage="none"
        columns={[
          { id: 'code', header: 'Code', isRowHeader: true, render: (row) => row.code },
          { id: 'name', header: 'Name', render: (row) => row.name },
        ]}
      />,
    );

    expect(screen.getByRole('rowheader', { name: 'SYP' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'USD' })).toBeTruthy();
  });
});

describe('<DataTable> scroll edges', () => {
  /** Scroll metrics a layout engine would have measured; happy-dom lays nothing out. */
  function measure(element: HTMLElement, metrics: Record<string, number>): void {
    for (const [name, value] of Object.entries(metrics)) {
      Object.defineProperty(element, name, { configurable: true, value });
    }
  }

  it('marks the edges that still hide rows, and only those', () => {
    wrap(
      <DataTable
        label="rows"
        rows={[{ id: 'one', name: 'one' }]}
        emptyMessage="none"
        columns={[{ id: 'name', header: 'Name', isRowHeader: true, render: (row) => row.name }]}
      />,
    );
    const container = screen.getByRole('grid').parentElement;
    if (container === null) throw new Error('The table has no scrolling container.');

    measure(container, {
      scrollTop: 40,
      scrollHeight: 500,
      clientHeight: 200,
      scrollLeft: 0,
      scrollWidth: 300,
      clientWidth: 300,
    });
    fireEvent.scroll(container);
    expect(container.hasAttribute('data-scroll-shadow-top')).toBe(true);
    expect(container.hasAttribute('data-scroll-shadow-bottom')).toBe(true);
    expect(container.hasAttribute('data-scroll-shadow-left')).toBe(false);
    expect(container.hasAttribute('data-scroll-shadow-right')).toBe(false);

    measure(container, { scrollTop: 300 });
    fireEvent.scroll(container);
    expect(container.hasAttribute('data-scroll-shadow-bottom')).toBe(false);
  });
});

describe('<UnsavedChangesDialog>', () => {
  function ask(isSaving = false): {
    onCancel: ReturnType<typeof vi.fn>;
    onDiscard: ReturnType<typeof vi.fn>;
    onSave: ReturnType<typeof vi.fn>;
  } {
    const answers = { onCancel: vi.fn(), onDiscard: vi.fn(), onSave: vi.fn() };
    wrap(
      <UnsavedChangesDialog
        title="تغييرات لم تُحفظ"
        message="لن تُحفظ التغييرات."
        discardLabel="تجاهل ومتابعة"
        saveLabel="حفظ ومتابعة"
        savingLabel="جارٍ الحفظ…"
        isOpen
        isSaving={isSaving}
        {...answers}
      />,
    );
    return answers;
  }

  it('offers three answers: stay, leave without saving, and save then leave', async () => {
    const user = userEvent.setup();
    const answers = ask();

    expect(screen.getByRole('alertdialog', { name: 'تغييرات لم تُحفظ' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'تجاهل ومتابعة' }));
    await user.click(screen.getByRole('button', { name: 'حفظ ومتابعة' }));
    expect(answers.onDiscard).toHaveBeenCalledTimes(1);
    expect(answers.onSave).toHaveBeenCalledTimes(1);
    expect(answers.onCancel).not.toHaveBeenCalled();
  });

  it('takes Escape as the answer that stays', async () => {
    const user = userEvent.setup();
    const answers = ask();

    await user.keyboard('{Escape}');

    expect(answers.onCancel).toHaveBeenCalledTimes(1);
    expect(answers.onDiscard).not.toHaveBeenCalled();
  });

  it('takes no second answer while the save it started is in flight', async () => {
    const user = userEvent.setup();
    const answers = ask(true);

    for (const name of ['إلغاء', 'تجاهل ومتابعة', 'جارٍ الحفظ…']) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled'), name).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(answers.onCancel).not.toHaveBeenCalled();
  });
});

describe('focusFirstInvalid', () => {
  it('moves focus to the first field a form has marked invalid, not the first field', async () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <form>
          <TextInput label="الاسم" value="موجود" onChange={() => undefined} />
          <TextInput label="الرمز" value="" onChange={() => undefined} errorMessage="أدخل الرمز." />
          <TextInput
            label="العنوان"
            value=""
            onChange={() => undefined}
            errorMessage="أدخل العنوان."
          />
        </form>
      </VertexProvider>,
    );

    focusFirstInvalid(container.querySelector('form'));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('الرمز'));
    });
  });

  it('asks nothing of a form that is not there', () => {
    expect(() => {
      focusFirstInvalid(null);
    }).not.toThrow();
  });
});

describe('<Badge>', () => {
  it('fills the neutral tone with a token that differs from the row it sits on', () => {
    // `fill-secondary` is `surface-2` in the light theme — the same white as a
    // table row — and a neutral badge drawn with it was bare text.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Badge tone="neutral">مسحوب</Badge>
      </VertexProvider>,
    );
    const className = container.firstElementChild?.className ?? '';
    expect(className).toContain('bg-badge-neutral');
    expect(className).not.toContain('bg-fill-secondary');
  });

  it('pairs every tone with its own readable foreground', () => {
    const tones = ['accent', 'success', 'danger', 'warning', 'info'] as const;
    for (const tone of tones) {
      const { container, unmount } = render(
        <VertexProvider translator={translator} root={null}>
          <Badge tone={tone}>حالة</Badge>
        </VertexProvider>,
      );
      // `bg-tint-*` / `text-on-tint-*`, not `bg-bg-*` / `text-on-bg-*`: the
      // tokens keep the names §4.4 publishes, and Tailwind gets an alias that
      // does not repeat its own utility prefix (see tailwind.test.ts).
      const className = container.firstElementChild?.className ?? '';
      expect(className, tone).toContain(`bg-tint-${tone}`);
      expect(className, tone).toContain(`text-on-tint-${tone}`);
      unmount();
    }
  });
});

describe('a toggle is named by the words beside it — §11', () => {
  // Both of these shipped with the caption as a sibling `<Label>`, which looked
  // right and was not: the element React Aria renders for the control **is** the
  // `<label>` of the hidden input, so a caption outside it named nothing. A
  // screen reader announced "switch" with no name, and clicking the words did
  // nothing. Asserted through the accessible name rather than through the
  // markup, because the arrangement is what was wrong and the name is what a
  // person actually gets.
  it('gives a switch the name a person reads next to it', async () => {
    const user = userEvent.setup();
    wrap(<Switch>إظهار المسحوب</Switch>);

    const control = screen.getByRole('switch', { name: 'إظهار المسحوب' });
    expect(control).toBeTruthy();

    // And the words operate it, which is the same fact seen from the pointer.
    await user.click(screen.getByText('إظهار المسحوب'));
    expect((control as HTMLInputElement).checked).toBe(true);
  });

  it('gives a checkbox the name a person reads next to it', async () => {
    const user = userEvent.setup();
    wrap(<Checkbox>طباعة إيصال</Checkbox>);

    const control = screen.getByRole('checkbox', { name: 'طباعة إيصال' });
    expect(control).toBeTruthy();

    await user.click(screen.getByText('طباعة إيصال'));
    expect((control as HTMLInputElement).checked).toBe(true);
  });
});

describe('the pointer says whether a click will do something — §11.3', () => {
  // The browser gives `<a href>` a hand and `<button>` an arrow, so a control
  // library that says nothing ships arrows over every button. This shipped that
  // way until someone put a mouse on it.
  const controls = [
    ['Button', <Button key="b">س</Button>, 'button'],
    [
      'IconButton',
      <IconButton key="i" aria-label="س">
        <svg />
      </IconButton>,
      'button',
    ],
    ['Checkbox', <Checkbox key="c">س</Checkbox>, 'label'],
    ['Switch', <Switch key="s">س</Switch>, 'label'],
  ] as const;

  for (const [name, element, selector] of controls) {
    it(`${name} offers a hand`, () => {
      const { container, unmount } = render(
        <VertexProvider translator={translator} root={null}>
          {element}
        </VertexProvider>,
      );
      const control = container.querySelector(selector);
      expect(control?.className, name).toContain('cursor-pointer');
      unmount();
    });
  }

  it('a disabled control does not promise a click that will not happen', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Button isDisabled>س</Button>
      </VertexProvider>,
    );
    expect(container.querySelector('button')?.className).toContain('disabled:cursor-not-allowed');
  });

  it('a text field keeps the text cursor, because typing is not an action', () => {
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <TextInput label="س" />
      </VertexProvider>,
    );
    expect(container.querySelector('input')?.className ?? '').not.toContain('cursor-pointer');
  });
});

describe('<DensityScope> — §6.1', () => {
  it('lets a subtree raise density', () => {
    const { container } = render(
      <VertexProvider translator={translator} density="comfortable" root={null}>
        <DensityScope value="compact">
          <Button>حفظ</Button>
        </DensityScope>
      </VertexProvider>,
    );
    expect(container.querySelector('[data-density]')?.getAttribute('data-density')).toBe('compact');
  });

  it('refuses to lower a touch surface below touch, and says so', () => {
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => undefined);
    const { container } = render(
      <VertexProvider translator={translator} density="touch" root={null}>
        <DensityScope value="compact">
          <Button>حفظ</Button>
        </DensityScope>
      </VertexProvider>,
    );
    // A finger cannot hit a 24px target. The request is ignored, not honoured.
    expect(container.querySelector('[data-density]')?.getAttribute('data-density')).toBe('touch');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('<ToastRegion> — a message that is delivered', () => {
  it('lives outside the application, where a dialog cannot hide it', () => {
    // A dialog hides everything outside itself from assistive technology and
    // lays a scrim over it. Inside the app, a toast a dialog raised about its
    // own work was dimmed, unreachable and never announced.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <ToastRegion>
          <span />
        </ToastRegion>
      </VertexProvider>,
    );
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(container.contains(region)).toBe(false);
    expect(region?.hasAttribute('data-react-aria-top-layer')).toBe(true);
  });

  it('gives focus back to where it was when a toast is dismissed from the keyboard', async () => {
    const person = userEvent.setup();
    let show: (message: string) => void = () => undefined;
    function Shower(): ReactNode {
      const toast = useToast();
      show = (message) => {
        toast.show(message, { duration: null });
      };
      return <Button onPress={() => undefined}>حفظ</Button>;
    }
    wrap(
      <ToastRegion>
        <Shower />
      </ToastRegion>,
    );

    await person.tab();
    const origin = document.activeElement;
    act(() => {
      show('حُفظ الفرع');
    });
    screen.getByRole('button', { name: 'إغلاق' }).focus();
    await person.keyboard('{Enter}');

    expect(screen.queryByText('حُفظ الفرع')).toBeNull();
    expect(document.activeElement).toBe(origin);
  });
});

describe('<SearchInput>', () => {
  it('is announced by its name once, not twice', () => {
    wrap(<SearchInput label="بحث" />);
    expect(screen.getByRole('searchbox').getAttribute('aria-label')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'بحث' })).toBeDefined();
  });
});

describe('<Tabs>', () => {
  const YEARS = [
    { id: '2025', label: '٢٠٢٥', content: <p>فترات ٢٠٢٥</p> },
    { id: '2026', label: '٢٠٢٦', content: <p>فترات ٢٠٢٦</p> },
    { id: '2027', label: '٢٠٢٧', content: <p>فترات ٢٠٢٧</p> },
  ];

  const YEARS_LABEL = 'السنوات المالية';

  it('shows one panel at a time, and only that one is in the page', () => {
    wrap(<Tabs label={YEARS_LABEL} tabs={YEARS} defaultSelectedKey="2026" />);

    expect(screen.getByText('فترات ٢٠٢٦')).toBeDefined();
    // Hidden-but-present would put the controls of every year into the tab
    // order of a page that is showing one.
    expect(screen.queryByText('فترات ٢٠٢٥')).toBeNull();
  });

  it('is one tab stop for the strip, with the arrows choosing inside it — §11.1', async () => {
    const person = userEvent.setup();
    wrap(<Tabs label={YEARS_LABEL} tabs={YEARS} defaultSelectedKey="2025" />);

    await person.tab();
    expect(document.activeElement?.textContent).toBe('٢٠٢٥');

    // `←` runs **with** the text where the document is right to left, which
    // React Aria reads off the locale rather than being told (§9). Going the
    // other way from the first tab wraps round to the last, which is what
    // keeps a strip of ten years reachable without counting presses.
    await person.keyboard('{ArrowLeft}');
    expect(screen.getByText('فترات ٢٠٢٦')).toBeDefined();

    await person.keyboard('{ArrowRight}');
    await person.keyboard('{ArrowRight}');
    expect(screen.getByText('فترات ٢٠٢٧')).toBeDefined();
  });

  it('says what the strip chooses between, for somebody listening', () => {
    wrap(<Tabs label={YEARS_LABEL} tabs={YEARS} defaultSelectedKey="2026" />);

    expect(screen.getByRole('tablist', { name: YEARS_LABEL })).toBeDefined();
  });

  it('marks the tab that is on by more than its colour — §4.6', () => {
    wrap(<Tabs label={YEARS_LABEL} tabs={YEARS} defaultSelectedKey="2026" />);

    // A rule under it and heavier ink, not a shade of grey: colour alone would
    // be the only cue for a reader who cannot separate the two.
    const on = screen.getByRole('tab', { selected: true });
    expect(on.className).toContain('data-[selected]:border-b-2');
    expect(on.className).toContain('data-[selected]:font-body-semibold');
  });
});
