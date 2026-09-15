import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Translator } from '@vertex/i18n';

import { DensityScope } from '../providers/DensityScope.js';
import { VertexProvider } from '../providers/VertexProvider.js';
import { Badge } from './Badge.js';
import { Button, IconButton } from './Button.js';
import { Checkbox, Switch } from './Toggle.js';
import { Page, PageHeader } from './Page.js';
import { Panel } from './Panel.js';
import { TextInput } from './TextInput.js';

afterEach(cleanup);

const translator = new Translator({
  locale: 'ar',
  catalogue: { 'a11y.skipToContent': 'تخطَّ إلى المحتوى' },
});

function wrap(children: ReactNode): void {
  render(
    <VertexProvider translator={translator} root={null}>
      {children}
    </VertexProvider>,
  );
}

describe('<Button>', () => {
  it('is operable from the keyboard alone — POS-02', async () => {
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

describe('<Badge>', () => {
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
