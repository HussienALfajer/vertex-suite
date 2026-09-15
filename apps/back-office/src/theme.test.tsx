import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { catalogue } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import { nextTheme } from '@vertex/ui';

afterEach(cleanup);

function open(): void {
  render(<App system={developmentSystem({ people: [] })} />);
}

function labelFor(current: string): string {
  return catalogue['theme.switch'].replace('{current}', current);
}

describe('The theme axis — §3.2', () => {
  it('starts light, not following the device', () => {
    open();

    // §3.2's third state — the absent attribute, meaning "follow the
    // device" — is still something `VertexProvider` can be asked for
    // explicitly, but this app no longer asks for it: a shop's shared till
    // does not turn dark at dusk the way a device its owner also uses
    // privately does, so the choice starts concrete and stays that way
    // until pressed.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('button', { name: labelFor(catalogue['theme.light']) })).toBeTruthy();
  });

  it('cycles between exactly two states', async () => {
    open();
    const person = userEvent.setup();
    const press = async (current: string): Promise<void> => {
      await person.click(screen.getByRole('button', { name: labelFor(current) }));
    };

    await press(catalogue['theme.light']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await press(catalogue['theme.dark']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('names the state it is in, because an icon alone is not a label', () => {
    open();
    const control = screen.getByRole('button', { name: labelFor(catalogue['theme.light']) });
    expect(control.getAttribute('aria-label')).toContain(catalogue['theme.light']);
  });

  it('orders the cycle the same way wherever it is asked', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});
