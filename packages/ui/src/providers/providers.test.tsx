import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Translator } from '@vertex/i18n';

import { VertexProvider } from './VertexProvider.js';

afterEach(cleanup);

const translator = new Translator({ locale: 'ar', catalogue: {} });

/**
 * A detached element to stamp, so each assertion is about one render rather
 * than about whatever the previous test left on the shared document.
 */
function root(): HTMLElement {
  return document.createElement('div');
}

describe('VertexProvider — SYS-01', () => {
  it('makes Arabic the default, right to left, with nothing switched on to get there', () => {
    const element = root();
    render(
      <VertexProvider translator={translator} root={element}>
        <span />
      </VertexProvider>,
    );

    expect(element.getAttribute('lang')).toBe('ar');
    expect(element.getAttribute('dir')).toBe('rtl');
  });

  it('turns the whole document around for English, rather than patching it on', () => {
    const element = root();
    render(
      <VertexProvider translator={translator} root={element} locale="en">
        <span />
      </VertexProvider>,
    );

    expect(element.getAttribute('lang')).toBe('en');
    expect(element.getAttribute('dir')).toBe('ltr');
  });

  it('takes direction from the locale alone, region and all', () => {
    // There is deliberately no direction prop to pass. §9 makes direction a
    // consequence of the locale, so a screen cannot be left in one language and
    // the wrong direction — the state simply does not exist.
    const arabic = root();
    render(
      <VertexProvider translator={translator} root={arabic} locale="ar-SY">
        <span />
      </VertexProvider>,
    );
    const english = root();
    render(
      <VertexProvider translator={translator} root={english} locale="en-GB">
        <span />
      </VertexProvider>,
    );

    expect(arabic.getAttribute('dir')).toBe('rtl');
    expect(english.getAttribute('dir')).toBe('ltr');
  });
});
