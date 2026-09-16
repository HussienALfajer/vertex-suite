import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';

import { useTranslator } from '../providers/context.js';
import { Button, IconButton } from './Button.js';
import type { Tone } from './styles.js';

export interface DialogProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
  /** Rendered as the trigger, so focus returns to it on close. */
  readonly trigger?: ReactNode;
  readonly className?: string;
}

/**
 * A modal.
 *
 * React Aria owns the three things a hand-rolled dialog gets wrong: focus moves
 * into it on open, is **trapped** while it is open, and is **restored to the
 * trigger** on close (§11). A cashier who loses focus to the page behind a
 * dialog has to reach for a mouse, and the register has none.
 *
 * It sits on `surface-3` with `shadow-dialog`. In the light theme `surface-2`
 * and `surface-3` are the same white by design, so on a panel the separation is
 * carried entirely by elevation — which is why the shadow is a token and not a
 * decoration.
 */
export function Dialog({
  title,
  children,
  footer,
  isOpen,
  onOpenChange,
  trigger,
  className,
}: DialogProps): ReactNode {
  const translator = useTranslator();

  const modal = (
    <ModalOverlay
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-center p-[var(--vx-pad-lg)]',
        'bg-[color-mix(in_srgb,var(--vx-neutral-900)_45%,transparent)]',
        'entering:duration-[var(--vx-dur-slow)] entering:ease-out',
      )}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      isDismissable
    >
      <Modal
        className={clsx(
          'bg-surface-3 rounded-card shadow-dialog border border-line',
          'flex max-h-full w-full max-w-[32rem] flex-col',
          className,
        )}
      >
        {/*
          `min-h-0` on both this and the scrolling body, and it is load-bearing
          rather than tidy. A flex child defaults to `min-height: auto`, which
          refuses to shrink below its content — so `max-h-full` on the modal
          above was silently overruled by anything tall inside, and the dialog
          grew past the bottom of the screen taking its footer with it. The
          confirm button was then unreachable: present, focusable, and off the
          viewport. The body scrolls; nothing else does.
        */}
        {/* policy-exempt: §7.3 — the dialog is a programmatic focus landing
            point, not a control; focus moves on to the first control inside it. */}
        <AriaDialog className="flex min-h-0 flex-col outline-none">
          {({ close }) => (
            <>
              <header className="border-line flex items-start justify-between gap-[var(--vx-gap-md)] border-b px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]">
                <Heading slot="title" className="text-title font-body-semibold text-fg">
                  {title}
                </Heading>
                <IconButton aria-label={translator.format('action.close')} onPress={close}>
                  <svg
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    className="fill-none stroke-current"
                    strokeWidth="1.5"
                  >
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                  </svg>
                </IconButton>
              </header>

              <div className="text-body text-fg min-h-0 flex-1 overflow-auto p-[var(--vx-pad-lg)]">
                {children}
              </div>

              {footer === undefined ? null : (
                <footer className="border-line flex items-center justify-end gap-[var(--vx-gap-sm)] border-t px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]">
                  {footer}
                </footer>
              )}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );

  return trigger === undefined ? (
    modal
  ) : (
    <DialogTrigger>
      {trigger}
      {modal}
    </DialogTrigger>
  );
}

export interface ConfirmationDialogProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly tone?: Extract<Tone, 'primary' | 'danger'>;
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly onConfirm: () => void;
  readonly trigger?: ReactNode;
}

/**
 * A modal that asks before something irreversible happens.
 *
 * Every destructive action in this product goes through one: `POS-08` requires
 * a void to be authorised and recorded, `STK-09` requires a reason for an
 * adjustment. A dialog that can be dismissed by accident is not a
 * confirmation, so this one is **not** dismissable — it is answered, not
 * escaped.
 */
export function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  tone = 'primary',
  isOpen,
  onOpenChange,
  onConfirm,
  trigger,
}: ConfirmationDialogProps): ReactNode {
  const translator = useTranslator();

  const modal = (
    <ModalOverlay
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-center p-[var(--vx-pad-lg)]',
        'bg-[color-mix(in_srgb,var(--vx-neutral-900)_45%,transparent)]',
      )}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <Modal className="bg-surface-3 rounded-card shadow-dialog border-line w-full max-w-[26rem] border">
        {/* policy-exempt: §7.3 — see above. */}
        <AriaDialog role="alertdialog" className="flex flex-col outline-none">
          {({ close }) => (
            <>
              <div className="flex flex-col gap-[var(--vx-gap-sm)] p-[var(--vx-pad-lg)]">
                <Heading slot="title" className="text-heading font-body-semibold text-fg">
                  {title}
                </Heading>
                <p className="text-body text-fg-secondary">{message}</p>
              </div>
              <footer className="border-line flex items-center justify-end gap-[var(--vx-gap-sm)] border-t px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]">
                <Button tone="secondary" onPress={close}>
                  {translator.format('action.cancel')}
                </Button>
                <Button
                  tone={tone}
                  onPress={() => {
                    onConfirm();
                    close();
                  }}
                >
                  {confirmLabel}
                </Button>
              </footer>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );

  return trigger === undefined ? (
    modal
  ) : (
    <DialogTrigger>
      {trigger}
      {modal}
    </DialogTrigger>
  );
}
