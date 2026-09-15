import { useState, type ReactNode } from 'react';

import { isOk } from '@vertex/kernel';
import { Banner, Button, Page, TextInput, useTranslator, VertexLogo } from '@vertex/ui';

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
export function SignIn({ themeSwitch }: { readonly themeSwitch: ReactNode }): ReactNode {
  const translator = useTranslator();
  const { signIn } = useSession();

  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ handle: boolean; password: boolean }>({
    handle: false,
    password: false,
  });

  async function attempt(): Promise<void> {
    if (working) return;

    // Checked here rather than left to the browser. `TextInput` announces the
    // constraint and says nothing, because the words the browser would say are
    // in its own language and in nobody's catalogue — so an empty field is
    // answered from ours, and without a round trip to the store node.
    const blank = { handle: handle.trim() === '', password: password === '' };
    setMissing(blank);
    if (blank.handle || blank.password) {
      setRefused(null);
      return;
    }

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
          {/* §4.5 gives the sign-in screen to the brand. Until a tenant has
              supplied theirs, the brand here is the product's own — so the mark
              stands alone rather than on a `fill-brand` plate that would be the
              neutral primary wearing a brand's name. */}
          <VertexLogo
            layout="stacked"
            tagline={translator.format('app.tagline')}
            title={translator.format('app.name')}
            className="h-28 w-auto"
          />
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
            onChange={(next) => {
              setHandle(next);
              setMissing((was) => ({ ...was, handle: false }));
            }}
            autoFocus
            autoComplete="username"
            isRequired
            {...(missing.handle
              ? { errorMessage: translator.format('signIn.handle.required') }
              : {})}
          />
          <TextInput
            label={translator.format('signIn.password')}
            type="password"
            value={password}
            onChange={(next) => {
              setPassword(next);
              setMissing((was) => ({ ...was, password: false }));
            }}
            autoComplete="current-password"
            isRequired
            {...(missing.password
              ? { errorMessage: translator.format('signIn.password.required') }
              : {})}
          />
        </div>

        <Button type="submit" tone="primary" isDisabled={working}>
          {translator.format(working ? 'signIn.working' : 'signIn.submit')}
        </Button>
      </form>

      {/* Last in the tab order and first in the corner, which §11.1 says are
          two different orders: the keyboard follows importance and the eye
          follows the layout. Somebody signing in reaches the fields before a
          control they touch once a day — and `Shift+Tab` from the first field
          still reaches the skip link rather than this.

          `end` and not `right`: the inline end is the left on an Arabic
          interface and the right on an English one, and §9 has direction as a
          consequence of the locale rather than a second thing to remember. */}
      <div className="fixed top-[var(--vx-pad-lg)] end-[var(--vx-pad-lg)]">{themeSwitch}</div>
    </Page>
  );
}
