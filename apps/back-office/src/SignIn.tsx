import { useState, type ReactNode } from 'react';

import { isOk } from '@vertex/kernel';
import { Banner, Button, Page, TextInput, useTranslator } from '@vertex/ui';

import { messageForRefusal } from './catalogue.js';
import { useSession } from './session.js';

/**
 * The first screen anybody sees, and the only one reachable without signing in.
 *
 * Three things here are the specification rather than taste:
 *
 * **The brand mark, and only here.** §4.5 gives `fill-brand` to the sign-in
 * screen, the printed document header and the register idle screen, and nowhere
 * else — so a tenant whose brand is red does not get red buttons. The colour is
 * the tenant's; `on-brand` is computed against it at load, never chosen.
 *
 * **One message for two failures.** `SEC` returns one refusal for a name that
 * does not exist and for a wrong password, and this screen must not be able to
 * tell them apart — a screen that answered differently would hand back the list
 * of everybody who works here to anybody who can reach a till.
 *
 * **The submit is `primary`, which is neutral, not the accent.** §4.4 keeps the
 * accent for interaction and focus; spending it on every confirm button is how
 * focus stops being the thing a keyboard-only user can track.
 */
export function SignIn(): ReactNode {
  const translator = useTranslator();
  const { signIn } = useSession();

  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  async function attempt(): Promise<void> {
    if (working) return;

    setWorking(true);
    setRefused(null);
    try {
      const outcome = await signIn({ handle, password });
      if (!isOk(outcome)) setRefused(messageForRefusal(translator, outcome.error.code));
    } catch {
      // A defect rather than a refusal — the store node unreachable, a
      // transport that failed. It still has to say something a person can act
      // on, and it must not say anything about which name exists.
      setRefused(translator.format('refusal.unknown'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Page className="grid place-items-center">
      <form
        onSubmit={(event) => {
          // The browser would navigate; §11 wants Enter to submit this form and
          // leave the person where they are.
          event.preventDefault();
          void attempt();
        }}
        className="flex w-full max-w-[26rem] flex-col gap-[var(--vx-gap-lg)]"
      >
        <div className="flex flex-col items-center gap-[var(--vx-gap-md)]">
          <p
            className={
              'bg-fill-brand text-on-brand rounded-card text-title font-body-semibold ' +
              'px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]'
            }
          >
            {translator.format('app.name')}
          </p>
          <div className="flex flex-col items-center gap-[var(--vx-gap-xs)] text-center">
            <h1 className="text-page font-body-bold text-fg">
              {translator.format('signIn.title')}
            </h1>
            <p className="text-body text-fg-secondary">{translator.format('signIn.description')}</p>
          </div>
        </div>

        {refused === null ? null : (
          <Banner tone="danger" title={translator.format('signIn.failed')}>
            {refused}
          </Banner>
        )}

        <div className="flex flex-col gap-[var(--vx-gap-md)]">
          <TextInput
            label={translator.format('signIn.handle')}
            value={handle}
            onChange={setHandle}
            autoFocus
            autoComplete="username"
            isRequired
          />
          <TextInput
            label={translator.format('signIn.password')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            isRequired
          />
        </div>

        <Button type="submit" tone="primary" isDisabled={working}>
          {translator.format(working ? 'signIn.working' : 'signIn.submit')}
        </Button>
      </form>
    </Page>
  );
}
