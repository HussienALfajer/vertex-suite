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
  it('follows the device until somebody says otherwise', () => {
    open();

    // The **absence** of the attribute is the state: §3.2 makes it the signal to
    // follow the system, so a default of "light" would quietly take that away
    // from a machine that already turns dark at dusk.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(screen.getByRole('button', { name: labelFor(catalogue['theme.system']) })).toBeTruthy();
  });

  it('cycles through all three, and comes back to the device', async () => {
    open();
    const person = userEvent.setup();
    const press = async (current: string): Promise<void> => {
      await person.click(screen.getByRole('button', { name: labelFor(current) }));
    };

    await press(catalogue['theme.system']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await press(catalogue['theme.light']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Two states would strand somebody who wants the device to decide again.
    await press(catalogue['theme.dark']);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('names the state it is in, because an icon alone is not a label', () => {
    open();
    const control = screen.getByRole('button', { name: labelFor(catalogue['theme.system']) });
    expect(control.getAttribute('aria-label')).toContain(catalogue['theme.system']);
  });

  it('orders the cycle the same way wherever it is asked', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});
