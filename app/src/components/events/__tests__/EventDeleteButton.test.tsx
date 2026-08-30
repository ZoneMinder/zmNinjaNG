import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { EventDeleteButton } from '../EventDeleteButton';
import { useDeleteSelectionStore, eventSelectionKey } from '../../../stores/deleteSelection';
import { asProfileId } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

function renderButton(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useDeleteSelectionStore.getState().clear();
  // No username on either profile: fetchAccountPermissions short-circuits to
  // UNRESTRICTED_PERMISSIONS with no network call, matching this describe's
  // "delete is allowed" default (the permission-denial paths below give a
  // username and script /users.json instead).
  seedProfiles([makeProfile('p1'), makeProfile('p2')]);
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventDeleteButton', () => {
  it('toggles the event id in the selection store on click', () => {
    renderButton(<EventDeleteButton eventId="42" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual(['42']);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });

  it('reflects the selected state via aria-pressed', () => {
    useDeleteSelectionStore.getState().toggle('42');
    renderButton(<EventDeleteButton eventId="42" />);
    expect(screen.getByTestId('event-delete-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not bubble the click to a parent row', () => {
    const parentClick = vi.fn();
    renderButton(
      <div role="presentation" onClick={parentClick}>
        <EventDeleteButton eventId="42" />
      </div>
    );
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('selecting one profile\'s event leaves the same raw id on another profile unselected', () => {
    renderButton(
      <>
        <EventDeleteButton eventId="1234" profileId={P1} />
        <EventDeleteButton eventId="1234" profileId={P2} />
      </>
    );
    const [first, second] = screen.getAllByTestId('event-delete-button');
    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P1, '1234')]);
  });
});

/**
 * Queueing an event for deletion needs Events: Edit (refs #344).
 *
 * Greying beats hiding here: the button is what tells an administrator their
 * account is short a permission. It must still explain itself, which is why it
 * is aria-disabled rather than disabled - a disabled button would receive no
 * click and show no hint.
 */
describe('EventDeleteButton without permission to delete', () => {
  it('greys the control and refuses to queue the event', async () => {
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(P1, fakeApiClient({ '/users.json': { users: [{ User: { Username: 'bob', Events: 'View' } }] } }));

    renderButton(<EventDeleteButton eventId="42" profileId={P1} />);
    const button = screen.getByTestId('event-delete-button');
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));

    fireEvent.click(button);

    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });

  it('still queues when the account may delete', async () => {
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(P1, fakeApiClient({ '/users.json': { users: [{ User: { Username: 'bob', Events: 'Edit' } }] } }));

    renderButton(<EventDeleteButton eventId="42" profileId={P1} />);
    const button = screen.getByTestId('event-delete-button');
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(button);

    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P1, '42')]);
  });

  it('still queues while the permission is unknown', () => {
    // Username set, but no /users.json route installed: the probe errors
    // (not a permission-denied error), leaving permissions undefined/unknown
    // rather than resolved - synchronously true right after render, since
    // the fetch has not settled yet either way.
    seedProfiles([makeProfile('p1', { username: 'bob' })]);

    renderButton(<EventDeleteButton eventId="42" profileId={P1} />);
    fireEvent.click(screen.getByTestId('event-delete-button'));

    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P1, '42')]);
  });
});
