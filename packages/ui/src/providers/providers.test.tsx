import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Translator } from '@vertex/i18n';

import { useTranslator, useVertex } from './context.js';
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

describe('VertexProvider — §5.5 numerals, everywhere a figure is written', () => {
  it('hands its screens a translator that writes figures in the tenant’s digits', () => {
    // A count inside a sentence and the money beside it follow one setting.
    const counting = new Translator({ locale: 'ar', catalogue: { count: '{n, number}' } });
    let written = '';
    function Reader(): ReactNode {
      written = useTranslator().format('count', { n: 12 });
      return null;
    }

    render(
      <VertexProvider translator={counting} root={root()} numerals="arab">
        <Reader />
      </VertexProvider>,
    );
    expect(written).toBe('١٢');
  });

  it('writes Western digits under a locale whose own convention is Arabic-Indic', () => {
    let formatting = '';
    function Reader(): ReactNode {
      formatting = useVertex().formattingLocale;
      return null;
    }
    render(
      <VertexProvider translator={translator} root={root()} locale="ar-SY">
        <Reader />
      </VertexProvider>,
    );
    expect(new Intl.NumberFormat(formatting).format(12)).toBe('12');
  });

  it('accepts a locale that already carries an extension, rather than throwing on every figure', () => {
    expect(() =>
      render(
        <VertexProvider translator={translator} root={root()} locale="ar-u-ca-gregory">
          <span />
        </VertexProvider>,
      ),
    ).not.toThrow();
  });
});
