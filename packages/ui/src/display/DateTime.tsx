import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import type { LocalDate } from '@vertex/kernel';

import { useTranslator, useVertex } from '../providers/context.js';
import { formatDay, formatMoment, type MomentPrecision } from './format.js';

export interface MomentProps {
  readonly value: Date;
  /** The branch's IANA zone. Required: a timestamp without a zone is a guess. */
  readonly timeZone: string;
  readonly precision?: MomentPrecision;
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

export interface DayProps {
  /**
   * A calendar day, which is **not** a moment: `2026-09-20`, the one spelling
   * `@vertex/kernel` accepts.
   *
   * It takes no zone, and that is the whole difference. A fiscal period opens
   * on a day for the entire tenant (`FIN-05`) — it is not an instant that falls
   * on different days in different branches — so a zone here would be a fact
   * the caller would have to invent in order to satisfy a prop.
   */
  readonly value: LocalDate;
  readonly className?: string;
}

/**
 * Either kind of date this product has, told apart by the type of the value.
 *
 * A union rather than a zone that is sometimes optional: "a timestamp without a
 * zone is a guess" and "a calendar day has no zone at all" are both true, and
 * one optional prop cannot state both — it would let a moment be rendered
 * without its zone, which is the error the required prop exists to prevent.
 */
export type DateTimeProps = MomentProps | DayProps;

/**
 * A moment in the branch's timezone with the zone stated, or a calendar day
 * that belongs to no clock at all.
 *
 * The zone is shown on a moment rather than assumed: a register in one branch
 * and a report read in another are the same instant and different wall clocks,
 * and the difference is exactly what a variance investigation turns on.
 */
export function DateTime(props: DateTimeProps): ReactNode {
  // The value's own type says which of the two this is: a `LocalDate` is a
  // branded string and an instant is a `Date`, so nothing has to be passed
  // alongside to say which was meant.
  return isDay(props) ? <Day {...props} /> : <Moment {...props} />;
}

function isDay(props: DateTimeProps): props is DayProps {
  return typeof props.value === 'string';
}

function Day({ value, className }: DayProps): ReactNode {
  const { formattingLocale } = useVertex();

  return (
    <span className={clsx('inline-flex items-baseline tabular-nums', className)}>
      {/*
        `dir` as well as the marks `formatDay` strips: a day standing on its own
        in a right-to-left column is an `ltr` island for the reason `Code` is
        (§9), and a day inside an Arabic sentence is left to the paragraph.
      */}
      <span dir="ltr">{formatDay(value, formattingLocale)}</span>
    </span>
  );
}

function Moment({
  value,
  timeZone,
  precision = 'minute',
  provisional = false,
  showZone = true,
  className,
}: MomentProps): ReactNode {
  const { formattingLocale } = useVertex();
  const translator = useTranslator();

  const text = formatMoment(value, { locale: formattingLocale, timeZone, precision });

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
