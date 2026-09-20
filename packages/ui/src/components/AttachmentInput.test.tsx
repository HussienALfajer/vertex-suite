import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { Translator } from '@vertex/i18n';

import { VertexProvider } from '../providers/VertexProvider.js';
import { AttachmentInput, type AttachmentInputProps, type ChosenFile } from './AttachmentInput.js';

afterEach(cleanup);

const CHOOSE = 'إرفاق ملف';

const translator = new Translator({
  locale: 'ar',
  catalogue: {
    'attachment.choose': CHOOSE,
    'attachment.remove': 'إزالة {name}',
  },
});

const LABEL = 'المرفقات';
const ACCEPT = ['application/pdf', 'image/png'];
const LIMIT = 1024;

/** A file as a platform chooser hands one over. */
function file(name: string, mediaType: string, size = 8): File {
  return new File([new Uint8Array(size).fill(7)], name, { type: mediaType });
}

function Host({
  onChange,
  onReject,
}: {
  readonly onChange: AttachmentInputProps['onChange'];
  readonly onReject: NonNullable<AttachmentInputProps['onReject']>;
}): ReactNode {
  const [held, setHeld] = useState<readonly ChosenFile[]>([]);
  return (
    <VertexProvider translator={translator} locale="ar" numerals="latn" root={null}>
      <AttachmentInput
        label={LABEL}
        value={held}
        onChange={(next) => {
          setHeld(next);
          onChange(next);
        }}
        accept={ACCEPT}
        maxBytes={LIMIT}
        onReject={onReject}
      />
    </VertexProvider>
  );
}

interface Rendered {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly changed: Mock<AttachmentInputProps['onChange']>;
  readonly rejected: Mock<NonNullable<AttachmentInputProps['onReject']>>;
}

/**
 * `applyAccept` says whether the chooser itself filters by the `accept`
 * attribute. Off for the test that drives a file past it, which is what a
 * person does when they switch a platform dialog to "all files" — and the
 * reason the list of types is enforced in the component and not only offered.
 */
function field(applyAccept = true): Rendered {
  const user = userEvent.setup({ applyAccept });
  const changed = vi.fn<AttachmentInputProps['onChange']>();
  const rejected = vi.fn<NonNullable<AttachmentInputProps['onReject']>>();
  render(<Host onChange={changed} onReject={rejected} />);
  return { user, changed, rejected };
}

/**
 * The chooser `FileTrigger` opens, which is an `input[type=file]` React Aria
 * keeps out of sight. Driven directly, because a platform file dialog is the
 * one thing a document implementation has no way to open.
 */
const chooser = (): HTMLInputElement => {
  const input = globalThis.document.querySelector('input[type="file"]');
  if (input === null) throw new Error('The field opens no chooser.');
  return input as HTMLInputElement;
};

/** What the last call handed the caller, as names and sizes. */
const taken = (changed: Mock<AttachmentInputProps['onChange']>): readonly string[] =>
  (changed.mock.calls.at(-1)?.[0] ?? []).map((one) => `${one.name} ${String(one.size)}`);

describe('AttachmentInput', () => {
  it('hands over the bytes of what was chosen, and not a handle onto a disk', async () => {
    const { user, changed } = field();

    await user.upload(chooser(), file('invoice.pdf', 'application/pdf', 12));

    await waitFor(() => {
      expect(taken(changed)).toEqual(['invoice.pdf 12']);
    });
    const [first] = changed.mock.calls.at(-1)?.[0] ?? [];
    // A `File` read twice can answer differently and cannot be held in the
    // state of a form; what the caller gets is the evidence itself.
    expect(first?.bytes).toBeInstanceOf(Uint8Array);
    expect(first?.bytes.length).toBe(12);
    expect(first?.mediaType).toBe('application/pdf');
  });

  it('turns away a file of a kind the caller will not take, and says which and why', async () => {
    const { user, changed, rejected } = field(false);

    await user.upload(chooser(), file('macro.xlsm', 'application/vnd.ms-excel'));

    await waitFor(() => {
      expect(rejected).toHaveBeenCalledWith([{ name: 'macro.xlsm', reason: 'type' }]);
    });
    // Nothing is silently dropped, and nothing that would be refused later is
    // carried as far as the command that would refuse it.
    expect(changed).not.toHaveBeenCalled();
  });

  it('turns away a file over the limit, and keeps the ones beside it', async () => {
    const { user, changed, rejected } = field();

    await user.upload(chooser(), [
      file('scan.png', 'image/png', LIMIT + 1),
      file('receipt.png', 'image/png', 40),
    ]);

    await waitFor(() => {
      expect(taken(changed)).toEqual(['receipt.png 40']);
    });
    expect(rejected).toHaveBeenCalledWith([{ name: 'scan.png', reason: 'size' }]);
  });

  it('adds to what is already attached rather than replacing it', async () => {
    // An invoice, and then the receipt for it: a chooser that replaced the
    // list would lose the first without saying so.
    const { user, changed } = field();

    await user.upload(chooser(), file('invoice.pdf', 'application/pdf', 10));
    await waitFor(() => {
      expect(taken(changed)).toHaveLength(1);
    });
    await user.upload(chooser(), file('receipt.png', 'image/png', 20));

    await waitFor(() => {
      expect(taken(changed)).toEqual(['invoice.pdf 10', 'receipt.png 20']);
    });
  });

  it('takes one off the list by name, and leaves the rest where they were', async () => {
    const { user, changed } = field();
    await user.upload(chooser(), [
      file('a.pdf', 'application/pdf', 10),
      file('b.pdf', 'application/pdf', 20),
    ]);
    await waitFor(() => {
      expect(taken(changed)).toHaveLength(2);
    });

    await user.click(screen.getByRole('button', { name: 'إزالة a.pdf' }));

    expect(taken(changed)).toEqual(['b.pdf 20']);
  });

  it('offers one control, and it is one a keyboard reaches', () => {
    // §11.1: a drop target is a pointer the whole way down, and the register
    // has no pointer. The chooser a button opens is keyboard-operable on every
    // platform this runs on.
    field();

    const controls = screen.getAllByRole('button');
    expect(controls).toHaveLength(1);
    expect(controls[0]?.textContent).toBe(CHOOSE);
  });
});
