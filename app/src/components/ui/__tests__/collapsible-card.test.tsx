/**
 * CollapsibleCard remembers its open state per device through localStorage
 * when given a storageKey. This is per-device UI state, which the Settings
 * contract keeps out of the profile settings on purpose.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleCard } from '../collapsible-card';

const KEY = 'zmng-test-card-open';

describe('CollapsibleCard', () => {
  beforeEach(() => localStorage.clear());

  it('collapses on header click and records the choice', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleCard header="Advanced" storageKey={KEY} data-testid="adv">
        <span>body text</span>
      </CollapsibleCard>,
    );
    expect(screen.getByText('body text')).toBeVisible();

    await user.click(screen.getByTestId('adv-toggle'));

    expect(screen.queryByText('body text')).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('starts from the recorded state on the next mount, over defaultOpen', () => {
    localStorage.setItem(KEY, 'false');
    render(
      <CollapsibleCard header="Advanced" storageKey={KEY} defaultOpen>
        <span>body text</span>
      </CollapsibleCard>,
    );
    expect(screen.queryByText('body text')).toBeNull();
  });

  it('without a storageKey it honours defaultOpen and writes nothing', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleCard header="Plain" defaultOpen={false} data-testid="plain">
        <span>hidden body</span>
      </CollapsibleCard>,
    );
    expect(screen.queryByText('hidden body')).toBeNull();
    await user.click(screen.getByTestId('plain-toggle'));
    expect(screen.getByText('hidden body')).toBeVisible();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
