import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface CodeProps {
  /** The exact text, rendered as written and in the order it was written. */
  readonly children: string;
  /** The whole of a value this is a shortened form of, for a pointer to reveal. */
  readonly title?: string;
  readonly className?: string;
}

/**
 * A fragment of machine text inside an Arabic sentence: an identifier, a
 * document number, a till's mark, a numbering format (§5.1's `font-mono`).
 *
 * **It exists because the document's own direction silently reorders one**, and
 * that is a measured fact rather than a precaution. The Unicode bidirectional
 * algorithm resolves a bracket pair to the surrounding paragraph's direction
 * when the paragraph is right-to-left and what is inside the brackets is not
 * (UAX #9, rule N0) — so `SYS-02`'s own default numbering format,
 * `{prefix}-{generation}-{year}-{sequence:6}`, is laid out as four islands in
 * reverse order and **displays as `{sequence:6}-{year}-{generation}-{prefix}`**.
 * Nothing warns anybody: the braces mirror, so each part reads correctly on its
 * own, and only the order of the parts is wrong. An accountant reading that
 * column, or typing into that field, is being shown a format the shop does not
 * use.
 *
 * The same happens to anything beginning or ending with a neutral character —
 * `#{sequence:4}`, `/2026/0001` — which is a format somebody is free to choose.
 *
 * `dir` rather than a CSS property, and on the element itself: it sets the
 * direction **and** `unicode-bidi: isolate`, so the fragment is ordered on its
 * own and cannot reorder the Arabic sentence around it either. §9 bans physical
 * CSS properties, and this is neither — it is a statement about what the text
 * is, which is exactly what `dir` is for, and the same island the map of §9 is.
 */
export function Code({ children, title, className }: CodeProps): ReactNode {
  return (
    <code
      dir="ltr"
      // Inline rather than a block of its own: this sits inside a sentence, a
      // table cell and a form description, and every one of those has already
      // decided where it goes.
      className={clsx('font-mono', className)}
      {...(title === undefined ? {} : { title })}
    >
      {children}
    </code>
  );
}
