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

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // `polite` rather than `assertive`: a toast never interrupts a cashier
        // mid-scan. Anything that must interrupt is a Banner or a dialog.
        aria-live="polite"
        aria-relevant="additions"
        className={clsx(
          'pointer-events-none fixed bottom-0 z-50 flex flex-col items-start',
          'inset-inline-start-0 gap-[var(--vx-gap-sm)] p-[var(--vx-pad-lg)]',
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
        'rounded-card pointer-events-auto flex max-w-[28rem] items-start border shadow-lg',
        'gap-[var(--vx-gap-sm)] px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]',
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
      onFocus={() => {
        setIsPaused(true);
      }}
      onBlur={() => {
        setIsPaused(false);
      }}
    >
      <p className="text-body flex-1">{toast.message}</p>
      <IconButton
        aria-label={dismissLabel}
        onPress={() => {
          onDismiss(toast.id);
        }}
        className="-me-[var(--vx-pad-sm)] -mt-[var(--vx-pad-xs)]"
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
