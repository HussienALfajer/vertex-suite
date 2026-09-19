import { clsx } from 'clsx';
import { useEffect, useId, useState, type DragEvent, type ReactNode } from 'react';
import { Input } from 'react-aria-components';

import { useTranslator } from '../providers/context.js';

/**
 * One mark a format may carry — `{id}`, or `{id:width}` when `paddable`.
 *
 * Opaque on purpose: this component knows nothing about `SYS-02`'s four marks
 * or what any of them mean, the same way `TextInput` knows nothing about a
 * numbering format. The screen that needs a particular vocabulary supplies it
 * here, translated, with the padding default it wants a mark to start at.
 */
export interface FormatBuilderMark {
  readonly id: string;
  readonly label: string;
  readonly paddable?: boolean;
  /** The width offered the first time this mark appears with none set. */
  readonly defaultWidth?: number;
}

export interface FormatBuilderProps {
  /** Required. A control without a label is a control someone has to guess at. */
  readonly label: string;
  readonly description?: string;
  readonly errorMessage?: string;
  /**
   * Every mark the produced format must carry. The order on screen is read
   * from `value`, not from here: this list says *which* marks, and a person
   * decides where. There is nothing optional to add or remove — a caller that
   * means to offer a mark includes it, and the format this component produces
   * always carries every one of them exactly once.
   */
  readonly marks: readonly FormatBuilderMark[];
  /** The format string this builds and reads back: `{id}` and `{id:width}` tokens around free text. */
  readonly value: string;
  readonly onChange: (format: string) => void;
  readonly className?: string;
}

interface Card {
  readonly id: string;
  readonly width: number | null;
  /**
   * The literal text after this mark — the separator in the gap that follows
   * this position. It belongs to the gap rather than to the mark, so it stays
   * where it is when marks change places (`moved`).
   */
  readonly suffix: string;
}

interface Arrangement {
  readonly leading: string;
  readonly order: readonly Card[];
}

type Token =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'mark'; readonly id: string; readonly width: number | null };

/** The widest padding `SYS-02`'s grammar accepts: one or two digits, never zero. */
const WIDEST = 99;

/**
 * Splits a format into literal runs and `{id}` / `{id:width}` marks.
 *
 * Deliberately not `SYS-02`'s own parser: that one also decides whether a
 * format is *valid* — unambiguous, carrying every mark it must — and this
 * component has no business holding a second copy of that judgement (the
 * screen's live specimen asks the one place it belongs, on every change). This
 * tokeniser only decides how to draw a string as cards, and degrades to a
 * literal run rather than throwing when it cannot.
 */
function tokenize(format: string): readonly Token[] {
  const tokens: Token[] = [];
  let literal = '';
  let index = 0;
  while (index < format.length) {
    const open = format.indexOf('{', index);
    const close = open === -1 ? -1 : format.indexOf('}', open);
    if (open === -1 || close === -1) {
      literal += format.slice(index);
      break;
    }
    literal += format.slice(index, open);
    const [id = '', widthText] = format.slice(open + 1, close).split(':');
    if (id === '') {
      literal += format.slice(open, close + 1);
    } else {
      if (literal !== '') tokens.push({ kind: 'literal', text: literal });
      literal = '';
      const width = widthText === undefined ? Number.NaN : Number(widthText);
      tokens.push({ kind: 'mark', id, width: Number.isInteger(width) ? width : null });
    }
    index = close + 1;
  }
  if (literal !== '') tokens.push({ kind: 'literal', text: literal });
  return tokens;
}

/**
 * Reads `value` into one card per mark in `marks`: from the string where it
 * already places a mark, at the end with its `defaultWidth` where it does not.
 *
 * A mark `marks` no longer offers is dropped with the separator that framed
 * it — the text after it, or before it when it was the last mark — which is
 * what keeps a format still shaped for a till from leaking `{prefix}` and
 * `{generation}`, or a stray dash where they were, onto a series that has
 * just stopped naming one. A mark appended to a format that already had
 * others gets a dash in front of it where nothing separated it yet, because
 * two marks run together are ambiguous and `SYS-02` refuses the format.
 */
function arrangementFrom(value: string, marks: readonly FormatBuilderMark[]): Arrangement {
  const offered = new Set(marks.map((mark) => mark.id));
  const order: Card[] = [];
  let leading = '';
  let pending = '';
  let dropping = false;

  for (const token of tokenize(value)) {
    if (token.kind === 'literal') {
      if (!dropping) pending += token.text;
      continue;
    }
    if (!offered.has(token.id) || order.some((card) => card.id === token.id)) {
      dropping = true;
      continue;
    }
    dropping = false;
    const previous = order.at(-1);
    if (previous === undefined) leading = pending;
    else order[order.length - 1] = { ...previous, suffix: pending };
    pending = '';
    order.push({ id: token.id, width: token.width, suffix: '' });
  }

  if (order.length === 0) {
    // Nothing parsed — every mark starts fresh and dash-separated, so the
    // first thing a screen shows from an empty value is already a format
    // `SYS-02` would accept rather than every mark run into its neighbour.
    return {
      leading: '',
      order: marks.map((mark, index) => ({
        id: mark.id,
        width: mark.defaultWidth ?? null,
        suffix: index === marks.length - 1 ? '' : '-',
      })),
    };
  }

  const last = order.at(-1);
  if (last !== undefined) order[order.length - 1] = { ...last, suffix: dropping ? '' : pending };

  for (const mark of marks) {
    if (order.some((card) => card.id === mark.id)) continue;
    const previous = order.at(-1);
    if (previous?.suffix === '') order[order.length - 1] = { ...previous, suffix: '-' };
    order.push({ id: mark.id, width: mark.defaultWidth ?? null, suffix: '' });
  }

  return { leading, order };
}

function serialize({ leading, order }: Arrangement): string {
  return order.reduce(
    (format, card) =>
      `${format}{${card.width === null ? card.id : `${card.id}:${String(card.width)}`}}${card.suffix}`,
    leading,
  );
}

/** `{` and `}` are the grammar's own punctuation; typed into free text they would corrupt the format they sit in. */
function stripBraces(text: string): string {
  return text.replace(/[{}]/g, '');
}

/**
 * The mark named `id`, moved to position `to`, with every separator left in
 * its gap.
 *
 * Separators do not travel with a mark. `{year}-{sequence}` with the sequence
 * moved first is `{sequence}-{year}`, which is what a person reordering two
 * cards means — carrying the dash along would give `{sequence}{year}-`, two
 * marks run together, which `SYS-02` refuses as ambiguous.
 */
function moved(arrangement: Arrangement, id: string, to: number): Arrangement {
  const from = arrangement.order.findIndex((card) => card.id === id);
  const card = arrangement.order[from];
  if (card === undefined || to < 0 || to >= arrangement.order.length || to === from) {
    return arrangement;
  }
  const marks = arrangement.order.filter((one) => one.id !== id);
  marks.splice(to, 0, card);
  const order = marks.map((one, index) => ({
    ...one,
    suffix: arrangement.order[index]?.suffix ?? '',
  }));
  return { ...arrangement, order };
}

const bareInput = clsx(
  'h-[var(--vx-h-control-nested)] rounded bg-surface-1 px-[var(--vx-pad-xs)]',
  'border border-line text-footnote font-mono text-fg text-center',
  'outline-none focus-visible:shadow-[var(--vx-focus-ring)]',
);

/**
 * `SYS-02`'s format, built from cards instead of typed as
 * `{prefix}-{generation}-{year}-{sequence:6}`.
 *
 * **Every mark `marks` names is placed, always — there is no "add".** Which
 * marks a series carries is never a free choice (`SYS-02` refuses a till's
 * series without the till's two marks, and a till-less one with them), so the
 * only questions left are the ones this component asks: **which order**,
 * **how many digits** a paddable mark pads to, and **what literal text**, if
 * any, separates them.
 *
 * **Controlled, with nothing of its own to keep in step.** The cards are
 * derived from `value` on every render and every edit is reported as the
 * string it produces, so the arrangement on screen and the format the caller
 * holds cannot disagree. The one thing reported without an edit is
 * normalisation — a mark `marks` names that `value` does not carry yet is
 * drawn at the end, and the caller is told, so what is shown is what would
 * be saved. Not while `value` is empty: an empty format is never a caller's
 * answer (a format with no marks is refused), it is a caller still fetching
 * one, and reporting the fallback arrangement then would overwrite the answer
 * it is about to receive.
 *
 * **Reordering is a drag from a card's handle, or an arrow key on it.** The
 * card becomes draggable only while its handle is held, so the text fields
 * inside it stay ordinary fields a pointer can select in. `react-aria-components`'
 * `GridList` was tried first and given up on: its roving tab stop is built
 * for a row with one focusable thing in it, and a card here has three — the
 * handle, a width and a trailing text. A keyboard move is announced, because
 * a card changing places is otherwise silent to anybody not looking at it.
 *
 * **The row is an `ltr` island** (§9): a format is machine text read left to
 * right by whatever prints it, so the cards read in the order they will
 * print, and the arrow keys move a card physically left or right.
 *
 * **Nothing here decides whether a format is valid.** `SYS-02` answers that
 * — an ambiguous pair of adjacent marks, a width too wide — and the screen
 * shows its answer under this control on every change.
 */
export function FormatBuilder({
  label,
  description,
  errorMessage,
  marks,
  value,
  onChange,
  className,
}: FormatBuilderProps): ReactNode {
  const translator = useTranslator();
  const labelId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const describedBy =
    [description === undefined ? null : descriptionId, errorMessage === undefined ? null : errorId]
      .filter((one) => one !== null)
      .join(' ') || undefined;

  const arrangement = arrangementFrom(value, marks);
  const normalised = serialize(arrangement);
  const labelOf = (id: string): string => marks.find((mark) => mark.id === id)?.label ?? id;

  useEffect(() => {
    if (value !== '' && normalised !== value) onChange(normalised);
  }, [value, normalised, onChange]);

  const [held, setHeld] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // A handle let go of anywhere — not only over itself — disarms its card. A
  // drag that did start ends in `dragend` instead: a browser sends no
  // `pointerup` once a native drag has taken the pointer over.
  useEffect(() => {
    if (held === null) return undefined;
    const release = (): void => {
      setHeld(null);
    };
    globalThis.addEventListener('pointerup', release);
    return () => {
      globalThis.removeEventListener('pointerup', release);
    };
  }, [held]);

  function edit(change: (was: Arrangement) => Arrangement): void {
    const next = serialize(change(arrangement));
    if (next !== value) onChange(next);
  }

  function editCard(id: string, change: (card: Card) => Card): void {
    edit((was) => ({
      ...was,
      order: was.order.map((card) => (card.id === id ? change(card) : card)),
    }));
  }

  function moveByKey(id: string, delta: number): void {
    const to = arrangement.order.findIndex((card) => card.id === id) + delta;
    if (to < 0 || to >= arrangement.order.length) return;
    edit((was) => moved(was, id, to));
    setAnnouncement(
      translator.format('formatBuilder.mark.moved', {
        mark: labelOf(id),
        position: to + 1,
        count: arrangement.order.length,
      }),
    );
  }

  function endDrag(): void {
    setHeld(null);
    setDragging(null);
  }

  return (
    <div
      className={clsx('flex flex-col gap-[var(--vx-gap-xs)]', className)}
      // What `focusFirstInvalid` looks for, and what every other field in the
      // design system carries while it holds an error.
      {...(errorMessage === undefined ? {} : { 'data-invalid': true })}
    >
      <span id={labelId} className="text-footnote font-medium text-fg-secondary">
        {label}
      </span>

      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        dir="ltr"
        className={clsx(
          'flex flex-wrap items-center gap-[var(--vx-gap-xs)] rounded p-[var(--vx-pad-sm)]',
          'bg-fill-field border',
          errorMessage === undefined ? 'border-line-strong' : 'border-line-danger',
        )}
      >
        <Input
          aria-label={translator.format('formatBuilder.leading')}
          value={arrangement.leading}
          onChange={(event) => {
            const leading = stripBraces(event.target.value);
            edit((was) => ({ ...was, leading }));
          }}
          className={clsx(bareInput, 'w-9')}
        />

        {arrangement.order.map((card, index) => {
          const markLabel = labelOf(card.id);
          const isPaddable = marks.find((mark) => mark.id === card.id)?.paddable === true;
          return (
            <div
              key={card.id}
              draggable={held === card.id}
              onDragStart={(event: DragEvent<HTMLDivElement>) => {
                setDragging(card.id);
                event.dataTransfer.effectAllowed = 'move';
                // Firefox starts no drag that carries no data.
                event.dataTransfer.setData('text/plain', card.id);
              }}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                if (dragging === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                if (dragging !== null) edit((was) => moved(was, dragging, index));
                endDrag();
              }}
              onDragEnd={endDrag}
              className={clsx(
                'bg-tint-accent text-on-tint-accent flex items-center gap-[var(--vx-gap-xs)]',
                'rounded p-[var(--vx-pad-xs)] transition-opacity duration-[var(--vx-dur-snap)]',
                dragging === card.id ? 'opacity-40' : '',
              )}
            >
              <button
                type="button"
                aria-label={translator.format('formatBuilder.mark.drag', { mark: markLabel })}
                aria-keyshortcuts="ArrowLeft ArrowRight"
                onPointerDown={() => {
                  setHeld(card.id);
                }}
                onKeyDown={(event) => {
                  // Physical, never mirrored: this row is its own `ltr` island,
                  // so "later in the format" is to the right even on an RTL page.
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    moveByKey(card.id, event.key === 'ArrowRight' ? 1 : -1);
                  }
                }}
                className={clsx(
                  'flex size-[var(--vx-h-control-nested)] shrink-0 items-center justify-center rounded',
                  'text-on-tint-accent cursor-grab active:cursor-grabbing',
                  'hover:bg-fill-ghost-hover outline-none',
                  'focus-visible:relative focus-visible:z-10 focus-visible:shadow-[var(--vx-focus-ring)]',
                )}
              >
                <GripIcon />
              </button>
              <span className="text-footnote font-body-medium whitespace-nowrap">{markLabel}</span>
              {isPaddable ? (
                <Input
                  aria-label={translator.format('formatBuilder.mark.width', { mark: markLabel })}
                  inputMode="numeric"
                  value={card.width === null ? '' : String(card.width)}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^0-9]/g, '');
                    const width =
                      digits === '' ? null : Math.min(WIDEST, Math.max(1, Number(digits)));
                    editCard(card.id, (was) => ({ ...was, width }));
                  }}
                  className={clsx(bareInput, 'w-6')}
                />
              ) : null}
              <Input
                aria-label={translator.format('formatBuilder.mark.suffix', { mark: markLabel })}
                value={card.suffix}
                onChange={(event) => {
                  const suffix = stripBraces(event.target.value);
                  editCard(card.id, (was) => ({ ...was, suffix }));
                }}
                className={clsx(bareInput, 'w-9')}
              />
            </div>
          );
        })}
      </div>

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {description === undefined ? null : (
        <span id={descriptionId} className="text-footnote text-fg-muted">
          {description}
        </span>
      )}
      {errorMessage === undefined ? null : (
        <span id={errorId} role="alert" className="text-footnote text-fg-danger">
          {errorMessage}
        </span>
      )}
    </div>
  );
}

/** Six dots, two by three: a handle for the hand to grab. */
function GripIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[var(--vx-icon)] fill-current">
      <circle cx="7" cy="5" r="1.4" />
      <circle cx="13" cy="5" r="1.4" />
      <circle cx="7" cy="10" r="1.4" />
      <circle cx="13" cy="10" r="1.4" />
      <circle cx="7" cy="15" r="1.4" />
      <circle cx="13" cy="15" r="1.4" />
    </svg>
  );
}
