import { useState, type ReactNode } from 'react';

import { Banner, Button, Dialog, TextInput, useAttempt, useToast, useTranslator } from '@vertex/ui';

import { useDeliveryMessage } from './organisation.js';
import { useSession } from './session.js';

/**
 * `Credentials.changeOwnPassword`, reached from the frame rather than from any
 * screen of the shop's structure — it names nobody but the person already
 * signed in, so there is no row for it to hang off and no listing it belongs
 * in. Every other password action in this application is something an
 * administrator does to somebody else (`SecurityDialog`, in `Users.tsx`); this
 * is the one the contract keeps open to everybody regardless, shared sign-in
 * or not (`SEC-09`).
 */

export interface ChangePasswordDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

export function ChangePasswordDialog({
  isOpen,
  onOpenChange,
}: ChangePasswordDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { changeOwnPassword } = useSession();
  const messageFor = useDeliveryMessage();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [missing, setMissing] = useState({ current: false, next: false });
  const [mismatch, setMismatch] = useState(false);
  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(isOpen, () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setMissing({ current: false, next: false });
    setMismatch(false);
  });

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = { current: current === '', next: next === '' };
    setMissing(blank);
    if (blank.current || blank.next) {
      reportInvalid();
      return;
    }
    if (next !== confirm) {
      setMismatch(true);
      reportInvalid();
      return;
    }
    setMismatch(false);

    const typedCurrent = current;
    const typedNext = next;
    await attemptWith(async () => {
      const delivery = await changeOwnPassword(typedCurrent, typedNext);
      const message = messageFor(delivery);
      if (message === null) {
        toast.show(translator.format('account.changePassword.done'), { tone: 'success' });
        onOpenChange(false);
      }
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('account.changePassword.title')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      footer={
        <>
          <Button
            tone="secondary"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            {translator.format('action.cancel')}
          </Button>
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('account.changePassword.submit')}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <TextInput
          label={translator.format('account.changePassword.current')}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(value) => {
            setCurrent(value);
            setMissing((was) => ({ ...was, current: false }));
          }}
          autoFocus
          isRequired
          {...(missing.current
            ? { errorMessage: translator.format('account.changePassword.current.required') }
            : {})}
        />
        <TextInput
          label={translator.format('account.changePassword.next')}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(value) => {
            setNext(value);
            setMissing((was) => ({ ...was, next: false }));
            setMismatch(false);
          }}
          isRequired
          {...(missing.next
            ? { errorMessage: translator.format('account.changePassword.next.required') }
            : {})}
        />
        <TextInput
          label={translator.format('account.changePassword.confirm')}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(value) => {
            setConfirm(value);
            setMismatch(false);
          }}
          isRequired
          {...(mismatch
            ? { errorMessage: translator.format('account.changePassword.mismatch') }
            : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
