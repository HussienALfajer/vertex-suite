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
  readonly className?: string;
}

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

  const text = new Intl.DateTimeFormat(formattingLocale, options).format(value);

  return (
    <span
      className={clsx('inline-flex items-baseline gap-[0.35em] tabular-nums', className)}
      {...(provisional ? { title: translator.format('date.provisional.explanation') } : {})}
    >
      <span dir="ltr">{text}</span>
      {provisional ? (
        <span className="rounded-pill bg-tint-warning text-on-tint-warning px-[0.5em] text-caption">
          {translator.format('date.provisional')}
        </span>
      ) : null}
      {precision === 'date' ? <span className="text-fg-muted text-caption">{timeZone}</span> : null}
    </span>
  );
}
