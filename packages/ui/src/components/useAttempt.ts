import { useEffect, useRef, useState, type RefObject } from 'react';

import { focusFirstInvalid } from './focusFirstInvalid.js';

/**
 * The state a dialog with a save button keeps regardless of what it saves: a
 * working flag that disables the button while a command is in flight, and a
 * refusal to show beside whatever caused it.
 */
export interface Attempt {
  readonly isWorking: boolean;
  readonly refused: string | null;
  /**
   * Exposed for a dialog's own validation to clear on the way to setting its
   * own field error instead — a stale server refusal about a value that was
   * just edited belongs to a value that no longer exists.
   */
  readonly setRefused: (message: string | null) => void;
  /**
   * Runs `action` unless one is already running, clearing any refusal first
   * and showing whatever it settles on. `action` decides what a null result
   * means — closing the dialog, reloading a list, a toast — because that part
   * is never the same twice; only the bookkeeping around it is.
   */
  readonly attempt: (action: () => Promise<string | null>) => Promise<void>;
  /** Attach to the dialog's own `<form>` — what `reportInvalid` searches. */
  readonly formRef: RefObject<HTMLFormElement | null>;
  /**
   * What a dialog calls instead of `attempt` when its own check — a required
   * field left blank, a value that failed a local rule — refuses the attempt
   * before there is a command to send: clears a stale server refusal the
   * same way a real attempt would, and moves focus to the first field the
   * caller has just marked invalid.
   */
  readonly reportInvalid: () => void;
}

/**
 * `NameDialog`, `PlaceDialog`, `NewBranchDialog` and `NewLocationDialog`
 * (`SYS-09`, `SYS-14`) each hand-rolled this machine once, and it had already
 * drifted: one kept its missing-fields flag as a single boolean, another as a
 * record of two, for the same reason in both. Written once here instead,
 * because a screen never invents a control (`CLAUDE.md`) and this state
 * machine carries nothing that any one app knows.
 *
 * `active` marks both "usable" and "just opened": `isOpen` for a dialog that
 * always edits the same blank, or the record itself for one that can be
 * retargeted at a different row without necessarily passing through closed —
 * `PlaceDialog` reused for branch B before branch A's instance ever unmounts
 * needs the reset to follow the record, not a boolean that never changed.
 * Resetting on the way in rather than the way out is deliberate: a dialog
 * that cleared itself on close would blank a field somebody is still reading
 * as it fades.
 */
export function useAttempt(active: unknown, onReset: () => void): Attempt {
  const [isWorking, setIsWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Which subject the dialog is on, and which of them has an attempt in flight.
  // Refs, because both are read by an attempt that started renders ago: a save
  // for branch A that resolved after the dialog had been reopened for branch B
  // cleared B's working flag while B's own save was running, and wrote A's
  // refusal under B's name.
  const generation = useRef(0);
  const running = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    generation.current += 1;
    running.current = null;
    setIsWorking(false);
    setRefused(null);
    onReset();
    // `onReset` closes over each dialog's own fields and is a new function
    // every render; only `active` changing means "this is a fresh attempt".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function attempt(action: () => Promise<string | null>): Promise<void> {
    // Against the ref rather than the state, which is a render behind: two
    // clicks inside one render both read `isWorking` as false.
    if (running.current === generation.current) return;
    const mine = generation.current;
    running.current = mine;
    setIsWorking(true);
    setRefused(null);

    let message: string | null;
    try {
      message = await action();
    } finally {
      // Settled whether the action answered or threw. A transport failure that
      // escaped `action` once left the button disabled for good.
      if (generation.current === mine) {
        running.current = null;
        setIsWorking(false);
      }
    }
    if (generation.current === mine && message !== null) setRefused(message);
  }

  function reportInvalid(): void {
    setRefused(null);
    focusFirstInvalid(formRef.current);
  }

  return { isWorking, refused, setRefused, attempt, formRef, reportInvalid };
}
