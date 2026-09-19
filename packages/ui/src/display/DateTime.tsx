import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { useTranslator, useVertex } from '../providers/context.js';

export interface DateTimeProps {
  readonly value: Date;
  /** The branch's IANA zone. Required: a timestamp without a zone is a guess. */
  readonly timeZone: string;
  readonly precision?: 'date' | 'minute' | 'second';
  /**
   * A shift opened without the store node carries a **provisional** business
   * date (`POS-01`), which the node later confirms or quarantines. §12 requires
   * it to be marked visibly wherever it appears, because a figure filed under
   * the wrong day is a figure nobody can reconcile.
   */
  readonly provisional?: boolean;
  /**
   * Whether a date-only value spells its zone out beside it. On unless a
   * caller says otherwise, which is what §12 asks of the component: the caller
   * that turns it off is one whose own context already names the branch whose
   * day this is, such as a row on that branch's rate board. It changes nothing
   * for the other two precisions, where the zone is part of the text `Intl`
   * writes rather than a label beside it.
   */
  readonly showZone?: boolean;
  readonly className?: string;
}

/**
 * The marks `Intl` puts between the parts of an Arabic date.
 *
 * `ar` writes `19‏/09‏/2026` with a right-to-left mark in front of each slash,
 * which is right inside an Arabic sentence and wrong inside the isolated
 * left-to-right span below: there the marks are strong right-to-left
 * characters in a left-to-right run, and the bidirectional algorithm reorders
 * whatever they touch — the year lands beside the day and the slashes fall to
 * the far end, so a date reads `19 2026/09/`. The span already fixes the
 * direction, which is all the marks were for, so they go. Built from code
 * points rather than written as literals, because an invisible character in
 * source is one nobody can see was put there.
 */
const DIRECTION_MARKS = new RegExp(
  `[${[0x200e, 0x200f, 0x061c].map((code) => String.fromCodePoint(code)).join('')}]`,
  'gu',
);

/**
 * A moment, in the branch's timezone, with the zone stated.
 *
 * The zone is shown rather than assumed: a register in one branch and a report
 * read in another are the same instant and different wall clocks, and the
 * difference is exactly what a variance investigation turns on.
 */
export function DateTime({
  value,
  timeZone,
  precision = 'minute',
  provisional = false,
  showZone = true,
  className,
}: DateTimeProps): ReactNode {
  const { formattingLocale } = useVertex();
  const translator = useTranslator();

  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(precision === 'date'
      ? {}
      : {
          hour: '2-digit',
          minute: '2-digit',
          ...(precision === 'second' ? { second: '2-digit' } : {}),
          timeZoneName: 'short',
        }),
  };

  const text = new Intl.DateTimeFormat(formattingLocale, options)
    .format(value)
    .replace(DIRECTION_MARKS, '');

  return (
    <span
      className={clsx('inline-flex items-baseline gap-[0.35em] tabular-nums', className)}
      {...(provisional ? { title: translator.format('date.provisional.explanation') } : {})}
    >
      <span dir="ltr">{text}</span>
      {provisional ? (
        <span className="rounded bg-tint-warning text-on-tint-warning px-[0.5em] text-caption">
          {translator.format('date.provisional')}
        </span>
      ) : null}
      {precision === 'date' && showZone ? (
        <span className="text-fg-muted text-caption">{timeZone}</span>
      ) : null}
    </span>
  );
}
