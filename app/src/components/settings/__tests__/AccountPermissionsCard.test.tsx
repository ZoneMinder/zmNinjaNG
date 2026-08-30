/**
 * The one place that shows the whole permission picture.
 *
 * Every other surface explains its own refusal in a sentence; this card is
 * where a user goes to find out why, including for the surfaces that vanish
 * entirely and have nowhere to put a note.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { AccountPermissionsCard } from '../AccountPermissionsCard';
import { createHttpError } from '../../../lib/http/types';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const profileId = makeProfile('p1', { username: 'bob' }).id;

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountPermissionsCard profileId={profileId} />
    </QueryClientProvider>
  );
}

describe('AccountPermissionsCard', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('lists the level ZoneMinder reported for each column', async () => {
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(profileId, fakeApiClient({
      '/users.json': {
        users: [{ User: {
          Username: 'bob', System: 'View', Monitors: 'Edit', Stream: 'None', Events: 'View', Control: 'None', Groups: 'View',
        } }],
      },
    }));

    renderCard();

    await waitFor(() => expect(screen.getByTestId('account-permission-system')).toHaveTextContent('View'));
    expect(screen.getByTestId('account-permission-monitors')).toHaveTextContent('Edit');
    expect(screen.getByTestId('account-permission-stream')).toHaveTextContent('None');
  });

  it('says a column is undetermined rather than inventing a level', async () => {
    // An account below System View cannot read its own row (a 401 naming
    // insufficient privileges), so everything but System stays unknown.
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(profileId, fakeApiClient({
      '/users.json': () => {
        throw createHttpError(401, 'Unauthorized', { success: false, data: { name: 'Insufficient Privileges' } }, {});
      },
    }));

    renderCard();

    await waitFor(() => expect(screen.getByTestId('account-permission-system')).toHaveTextContent('None'));
    expect(screen.getByTestId('account-permission-events')).toHaveTextContent(
      'server.permission_unknown',
    );
  });

  it('shows nothing until the probe settles', () => {
    // Username set but no /users.json route installed and no waitFor: the
    // probe is still in flight when this assertion runs.
    seedProfiles([makeProfile('p1', { username: 'bob' })]);

    renderCard();

    expect(screen.queryByTestId('account-permissions-card')).not.toBeInTheDocument();
  });
});
