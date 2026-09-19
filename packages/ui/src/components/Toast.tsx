import { clsx } from 'clsx';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { useTranslator } from '../providers/context.js';
import { IconButton } from './Button.js';

/**
 * Transient messages.
 *
 * Built here rather than on React Aria's toast, which the library still exports
 * as `UNSTABLE_`. An `UNSTABLE_` prefix is the maintainers saying the shape will
 * change, and this product ships to machines that are updated on a schedule and
 * rolled back automatically (`SYS-10`) — the cost of a churning API there is
 * paid by a shop, not by us. A toast is a live region, a queue and a timer;
 * that is a small thing to own, unlike the focus management of a dialog.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  readonly tone?: ToastTone;
  /** Milliseconds. `null` keeps it until it is dismissed. */
  readonly duration?: number | null;
}

interface QueuedToast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
  readonly duration: number | null;
}

interface ToastApi {
  readonly show: (message: string, options?: ToastOptions) => number;
  readonly dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Pushes a message. Throws outside a `ToastRegion`, rather than silently losing it. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToast was called outside <ToastRegion>.');
  }
  return api;
}

const DEFAULT_DURATION = 6000;

export interface ToastRegionProps {
  readonly children: ReactNode;
  readonly className?: string;
}

const toneClasses: Readonly<Record<ToastTone, string>> = {
  info: 'bg-tint-info text-on-tint-info border-line-info',
  success: 'bg-tint-success text-on-tint-success border-line-success',
  warning: 'bg-tint-warning text-on-tint-warning border-line-warning',
  danger: 'bg-tint-danger text-on-tint-danger border-line-danger',
};

export function ToastRegion({ children, className }: ToastRegionProps): ReactNode {
  const [toasts, setToasts] = useState<readonly QueuedToast[]>([]);
  const nextId = useRef(0);
  const translator = useTranslator();

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, options: ToastOptions = {}): number => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [
      ...current,
      {
        id,
        message,
        tone: options.tone ?? 'info',
        duration: options.duration === undefined ? DEFAULT_DURATION : options.duration,
      },
    ]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const region = (
    <div
      // `polite` rather than `assertive`: a toast never interrupts a cashier
      // mid-scan. Anything that must interrupt is a Banner or a dialog.
      aria-live="polite"
      aria-relevant="additions"
      // Outside the application, and marked as a top layer. A dialog hides
      // everything outside itself from assistive technology and lays a scrim
      // over it; rendered inside the app, the region went with it, so a toast
      // a dialog raised about its own work — "assigned", "withdrawn" — was
      // dimmed, unreachable and never announced. React Aria leaves an element
      // with this attribute alone.
      data-react-aria-top-layer=""
      className={clsx(
        // Top and centred: the one place on the screen nothing else is ever
        // laid out against, in either direction — a corner competes with
        // whatever a right-to-left or left-to-right document already keeps
        // there (a nav, a brand mark, this app's own theme switch). Above the
        // z-50 a dialog's scrim is drawn at.
        'pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center',
        'gap-[var(--vx-gap-sm)] p-[var(--vx-pad-lg)]',
        className,
      )}
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={dismiss}
          dismissLabel={translator.format('action.dismiss')}
        />
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(region, globalThis.document.body)}
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
  dismissLabel,
}: {
  toast: QueuedToast;
  onDismiss: (id: number) => void;
  dismissLabel: string;
}): ReactNode {
  const [isPaused, setIsPaused] = useState(false);
  // Where focus was before it entered this toast, so that dismissing the toast
  // from the keyboard gives it back. The button pressed unmounts with the toast,
  // and focus used to fall to the document body — the start of the page.
  const cameFrom = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (toast.duration === null || isPaused) return undefined;
    const timer = globalThis.setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [toast.id, toast.duration, isPaused, onDismiss]);

  return (
    <div
      className={clsx(
        // Centred on the cross axis: the dismiss control is a fixed square
        // taller than one line of text, and `items-start` left it sitting
        // low against the text's cap height instead of the middle of the row.
        'rounded-card pointer-events-auto flex items-center border shadow-lg',
        // A floor as well as a ceiling. Sized to its text alone, a
        // confirmation naming a one-character branch is a 7rem chip that reads
        // as a stray badge; the floor keeps every message the same deliberate
        // object regardless of how short the name inside it happens to be.
        'min-w-[22rem] max-w-[38rem]',
        'gap-[var(--vx-gap-md)] px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]',
        toneClasses[toast.tone],
      )}
      // A message that vanishes while it is being read is a message that was
      // not delivered. Hovering or focusing anything inside holds it.
      onMouseEnter={() => {
        setIsPaused(true);
      }}
      onMouseLeave={() => {
        setIsPaused(false);
      }}
      onFocus={(event) => {
        setIsPaused(true);
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
          cameFrom.current = from;
        }
      }}
      onBlur={() => {
        setIsPaused(false);
      }}
    >
      <p className="text-body flex-1">{toast.message}</p>
      <IconButton
        aria-label={dismissLabel}
        onPress={() => {
          const back = cameFrom.current;
          if (back?.isConnected === true) back.focus();
          onDismiss(toast.id);
        }}
        className="-me-[var(--vx-pad-sm)]"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="fill-none stroke-current"
          strokeWidth="1.5"
        >
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </IconButton>
    </div>
  );
}
