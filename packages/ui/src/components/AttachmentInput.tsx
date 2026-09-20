import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { FileTrigger, Label, Text } from 'react-aria-components';

import { useTranslator, useVertex } from '../providers/context.js';
import { Button, IconButton } from './Button.js';

/** A file as it was chosen: what it is called, what it is, and its bytes. */
export interface ChosenFile {
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly bytes: Uint8Array;
}

/** Why a file was not taken. What it means in words is the screen's to say. */
export interface RejectedFile {
  readonly name: string;
  readonly reason: 'type' | 'size';
}

export interface AttachmentInputProps {
  /** Required. A field without a label is a field someone has to guess at. */
  readonly label: string;
  readonly value: readonly ChosenFile[];
  readonly onChange: (files: readonly ChosenFile[]) => void;
  /**
   * The media types the caller will take, as a closed list. Offered to the
   * file chooser and enforced again here, because a person can always ask a
   * platform chooser for every file on the machine.
   */
  readonly accept: readonly string[];
  /** The most one file may carry. */
  readonly maxBytes: number;
  /**
   * What was turned away, and why — so the screen can say it in the words of
   * the rule it belongs to. Nothing is silently dropped.
   */
  readonly onReject?: (rejected: readonly RejectedFile[]) => void;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isDisabled?: boolean;
  readonly className?: string;
}

/**
 * The files attached to something, chosen and listed.
 *
 * **It hands over bytes, not `File` objects.** A `File` is a live handle onto
 * something on the person's disk: read it twice and it can answer differently,
 * and it cannot be held in the state of a form that is still being filled in.
 * What a caller needs is the evidence itself, so the bytes are read when the
 * file is chosen and what crosses this boundary is a plain value (`FIN-04`:
 * the hash on the entry is the hash of exactly the bytes that were attached).
 *
 * **What the caller will refuse, this refuses first.** A file of the wrong
 * type or over the limit is turned away here, named in `onReject` so the
 * screen can say why in the words of the rule — rather than being carried all
 * the way to a command that answers `fin.attachment-too-large` about a file
 * the person can no longer see.
 *
 * **A button and no drop zone.** §11.1 makes a control a keyboard cannot reach
 * a defect rather than a style, and a drop target is a pointer the whole way
 * down; the file chooser a button opens is the one route that is already
 * keyboard-operable on every platform this runs on. A drop zone would be a
 * second way to do one thing, and the second way would be the one nobody on a
 * register could use.
 */
export function AttachmentInput({
  label,
  value,
  onChange,
  accept,
  maxBytes,
  onReject,
  description,
  errorMessage,
  isDisabled,
  className,
}: AttachmentInputProps): ReactNode {
  const translator = useTranslator();
  const { formattingLocale } = useVertex();

  async function take(chosen: FileList | null): Promise<void> {
    if (chosen === null) return;
    const taken: ChosenFile[] = [];
    const turnedAway: RejectedFile[] = [];

    for (const file of chosen) {
      if (!accept.includes(file.type)) {
        turnedAway.push({ name: file.name, reason: 'type' });
        continue;
      }
      if (file.size > maxBytes) {
        turnedAway.push({ name: file.name, reason: 'size' });
        continue;
      }
      taken.push({
        name: file.name,
        mediaType: file.type,
        size: file.size,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }

    // Added to what is already there, because choosing files twice is how a
    // person attaches an invoice and then the receipt for it — a chooser that
    // replaced the list would lose the first without saying so.
    if (taken.length > 0) onChange([...value, ...taken]);
    if (turnedAway.length > 0) onReject?.(turnedAway);
  }

  return (
    <div className={clsx('flex flex-col gap-[var(--vx-gap-xs)]', className)}>
      {/* A plain label: what it names is a list and a button, not one field,
          so there is no control for `htmlFor` to point at. The button carries
          its own name, and the list below is ordinary text. */}
      <Label elementType="span" className="text-footnote font-medium text-fg-secondary">
        {label}
      </Label>

      {value.length === 0 ? null : (
        <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
          {value.map((file, index) => (
            <li
              // By position, because a person may attach the same file twice
              // and two identical names are two attachments (`FIN-04` counts
              // them by ordinal), not one listed twice.
              key={`${String(index)}:${file.name}`}
              className={clsx(
                'bg-fill-secondary border-line flex items-center gap-[var(--vx-gap-sm)]',
                'rounded border px-[var(--vx-pad-md)] py-[var(--vx-pad-xs)]',
              )}
            >
              <PaperclipIcon />
              <span className="text-body text-fg min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-footnote text-fg-muted shrink-0" dir="ltr">
                {sizeOf(file.size, formattingLocale)}
              </span>
              <IconButton
                tone="ghost"
                aria-label={translator.format('attachment.remove', { name: file.name })}
                {...(isDisabled === undefined ? {} : { isDisabled })}
                onPress={() => {
                  onChange(value.filter((_, at) => at !== index));
                }}
              >
                <RemoveIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <FileTrigger
        allowsMultiple
        acceptedFileTypes={[...accept]}
        onSelect={(files) => void take(files)}
      >
        <Button tone="secondary" {...(isDisabled === undefined ? {} : { isDisabled })}>
          {translator.format('attachment.choose')}
        </Button>
      </FileTrigger>

      {description === undefined ? null : (
        <Text slot="description" className="text-footnote text-fg-muted">
          {description}
        </Text>
      )}
      {errorMessage === undefined ? null : (
        <p className="text-footnote text-fg-danger">{errorMessage}</p>
      )}
    </div>
  );
}

/** A thousand and twenty-four bytes, which is what every file manager means by a kilobyte. */
const KILOBYTE = 1024;

/**
 * A file's size, in the reader's own language and digits.
 *
 * Through `Intl`'s own unit names rather than through the catalogue: "كيلوبايت"
 * is not a word this product coins, and a key for it would be a translation of
 * something every platform already translates. A size is a count of bytes on a
 * disk and not a business figure, so the arithmetic here is ordinary — no money
 * and no quantity passes through it.
 */
function sizeOf(bytes: number, locale: string): string {
  const inKilobytes = bytes / KILOBYTE;
  const [amount, unit, places] =
    inKilobytes < KILOBYTE
      ? ([inKilobytes, 'kilobyte', 0] as const)
      : ([inKilobytes / KILOBYTE, 'megabyte', 1] as const);
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: places,
  }).format(amount);
}

/** A paperclip: something attached to the page rather than written on it. */
function PaperclipIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="size-[var(--vx-icon)] shrink-0 fill-none stroke-current text-fg-muted"
      strokeWidth="1.5"
    >
      <path
        d="M13.5 6.5l-5.8 5.8a1.75 1.75 0 002.5 2.5l6-6a3.25 3.25 0 00-4.6-4.6l-6 6a4.75 4.75 0 006.7 6.7l5.2-5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A cross: taking this one off the list, which is not a delete of anything. */
function RemoveIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="fill-none stroke-current"
      strokeWidth="1.5"
    >
      <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
    </svg>
  );
}
